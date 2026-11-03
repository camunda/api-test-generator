#!/usr/bin/env bash
# Request a review on an agent-opened api-test-generator PR from the camunda-hub developer who owns
# the endpoint(s) the PR is about — Wolfgang's rule from the 2026-10-28 handover call: "the person who
# added the endpoint should review it; it belongs to the end-to-end story." This is layered ON TOP of
# CODEOWNERS (which already requests the team): the author is added as an extra reviewer, and if
# attribution or access fails the team still stands in. The gap-issue assignee logic in
# hub-pr-check.yml is the model (request once, only if unset, skip bots/no-access with a warning,
# never fail the run).
#
# Inputs (environment):
#   PR               (required) api-test-generator PR number to request review on
#   OPERATION_IDS    (required) implicated operationIds, whitespace- or newline-separated
#   GEN_REPO         default "$GITHUB_REPOSITORY" or camunda/api-test-generator — repo the PR is in
#   GEN_TOKEN        (required) token with Pull requests: write on GEN_REPO (GH_TOKEN_GENERATOR)
#   HUB_DIR          default ../camunda-hub — the sibling clone (working tree; history may be shallow)
#   HUB_SPEC_DIR     default restapi/public-api/src/main/resources/openapi/v2 — spec root in the clone
#   HUB_CONTENTS_TOKEN  token with Contents: read on camunda-hub (the clone/preview-envs token), for
#                       listing commits that touch a spec file. Falls back to HUB_PR_TOKEN if unset.
#   HUB_PR_TOKEN     token with Pull requests: read on camunda-hub (GH_TOKEN_HUB), to map a commit to
#                    its PR author. Falls back to HUB_CONTENTS_TOKEN if unset.
#   MAX_REVIEWERS    default 3 — cap, so one PR never pages a crowd
#   DRY_RUN          if non-empty, resolve + print the reviewers but request none
#
# Never exits non-zero on an attribution/access miss: it warns and lets CODEOWNERS be the reviewer.
# Only a missing required input (PR / GEN_TOKEN) is a hard error, because then it cannot do its job.
set -uo pipefail

# Annotations go to stderr so they never land in a $(...) capture of this script's helpers.
# GitHub still renders ::warning:: / ::error:: workflow commands written to stderr.
warn() { echo "::warning::request-hub-author-review: $*" >&2; }
die() {
  echo "::error::request-hub-author-review: $*" >&2
  exit 1
}

PR="${PR:-}"
GEN_REPO="${GEN_REPO:-${GITHUB_REPOSITORY:-camunda/api-test-generator}}"
GEN_TOKEN="${GEN_TOKEN:-}"
HUB_DIR="${HUB_DIR:-../camunda-hub}"
HUB_SPEC_DIR="${HUB_SPEC_DIR:-restapi/public-api/src/main/resources/openapi/v2}"
HUB_CONTENTS_TOKEN="${HUB_CONTENTS_TOKEN:-${HUB_PR_TOKEN:-}}"
HUB_PR_TOKEN="${HUB_PR_TOKEN:-${HUB_CONTENTS_TOKEN:-}}"
MAX_REVIEWERS="${MAX_REVIEWERS:-3}"
DRY_RUN="${DRY_RUN:-}"

[ -n "$PR" ] || die "PR is required"
[ -n "$GEN_TOKEN" ] || die "GEN_TOKEN is required (Pull requests: write on $GEN_REPO)"

# Idempotency, mirroring the gap-issue assignee guard: only act when no INDIVIDUAL reviewer has yet been
# requested OR has already submitted a review, so the author is requested once and a human's manual
# reviewer change sticks across re-runs. Two exclusions:
#   - team requests don't count — CODEOWNERS (#718) auto-requests @camunda/hub-backend on every PR, and a
#     team entry has no `.login` (a user entry does), so counting teams would always see a reviewer;
#   - a submitted review drops OUT of reviewRequests, so without counting completed reviews a later run
#     would re-request (and re-notify) an author who has already reviewed. Non-bot `reviews[]` are added
#     to the count and deduped against pending requests.
have=$(GH_TOKEN="$GEN_TOKEN" gh pr view "$PR" --repo "$GEN_REPO" \
  --json reviewRequests,reviews \
  --jq '([.reviewRequests[] | select(.login) | .login]
         + [.reviews[] | .author.login | select(. and (endswith("[bot]") | not))]) | unique | length' \
  2>/dev/null || echo "")
if [ -z "$have" ]; then
  warn "could not read review requests on $GEN_REPO#$PR (token/access?) — leaving CODEOWNERS to request the team"
  exit 0
fi
if [ "$have" != "0" ]; then
  echo "An individual reviewer is already requested on or has reviewed $GEN_REPO#$PR — leaving it as is."
  exit 0
fi

# Resolve one owner login for an operationId into the global RESOLVED_LOGIN (empty = unattributable).
# Returns through a global, not stdout, so warnings can't be mistaken for the result.
RESOLVED_LOGIN=""
resolve_author() {
  op="$1"
  RESOLVED_LOGIN=""
  # OpenAPI operationIds are identifier-safe ([A-Za-z0-9_]). Anything else is unexpected input; rather
  # than risk a malformed/injected regex below, treat it as unattributable and leave it to CODEOWNERS.
  case "$op" in
    "" | *[!A-Za-z0-9_]*)
      warn "operation '$op': not an identifier-safe operationId — cannot attribute"
      return 0
      ;;
  esac
  # 1. Which spec file declares it — a local grep of the sibling working tree (no token, depth-safe).
  #    Match the COMPLETE operationId (end-anchored) so `getFile` does not also match `getFileVersions`.
  file=$(grep -rlE --include='*.yaml' --include='*.yml' --include='*.json' \
    -e "operationId:[[:space:]]*[\"']?${op}[\"']?[[:space:]]*(#.*)?\$" \
    -e "\"operationId\"[[:space:]]*:[[:space:]]*\"${op}\"" \
    "$HUB_DIR/$HUB_SPEC_DIR" 2>/dev/null | head -1)
  if [ -z "$file" ]; then
    warn "operation '$op': no spec file under $HUB_SPEC_DIR declares it — cannot attribute"
    return 0
  fi
  rel="${file#"$HUB_DIR"/}"

  # 2. The commit that INTRODUCED the operationId (a line adding it). Uses the Contents:read token (the
  #    qa-processes issues-only token cannot list commits). Only a true introduction is attributed: we do
  #    NOT fall back to the latest editor of the file, who may have touched an unrelated endpoint or docs.
  commits=$(GH_TOKEN="$HUB_CONTENTS_TOKEN" gh api \
    "repos/camunda/camunda-hub/commits?path=$rel&per_page=100" \
    --jq '.[].sha' 2>/dev/null || echo "")
  if [ -z "$commits" ]; then
    warn "operation '$op': could not list commits for $rel (needs Contents: read on camunda-hub) — cannot attribute"
    return 0
  fi
  # The exact operationId declaration as it appears in a diff line, in either spec form, quote-tolerant
  # and end-anchored — the same shape as the file lookup above, so a bare mention (e.g. the id used in a
  # test or example) is not treated as a declaration.
  decl_re="(operationId:[[:space:]]*[\"']?${op}[\"']?[[:space:]]*(#.*)?\$|\"operationId\"[[:space:]]*:[[:space:]]*\"${op}\")"
  # shellcheck disable=SC2086
  # Oldest first: the first commit that ADDS the declaration in the spec file's own patch and does NOT
  # remove it ANYWHERE in the same commit is where the operation was introduced. Added is checked in
  # `$rel`'s patch only, so a mere mention of the id in a test or example elsewhere never attributes the
  # endpoint. Removed is checked across ALL the commit's file patches, so both a formatting reflow
  # (remove + re-add in the same file) and a move between spec files (removed from one file, added to
  # another) are rejected rather than attributed to the editor/mover. grep reads from here-strings, not a
  # pipe, so pipefail + a SIGPIPE on a large patch (grep -q exits on first match) cannot flip the result.
  # No qualifying commit in the window → unresolved → CODEOWNERS.
  intro=""
  for sha in $(echo "$commits" | tac); do
    commit=$(GH_TOKEN="$HUB_CONTENTS_TOKEN" gh api "repos/camunda/camunda-hub/commits/$sha" 2>/dev/null || echo "")
    [ -n "$commit" ] || continue
    rel_patch=$(jq -r --arg rel "$rel" '[.files[]? | select(.filename == $rel) | .patch // ""] | join("\n")' <<< "$commit" 2>/dev/null || echo "")
    all_patch=$(jq -r '[.files[]? | .patch // ""] | join("\n")' <<< "$commit" 2>/dev/null || echo "")
    if grep -qE "^\+[[:space:]]*${decl_re}" <<< "$rel_patch" &&
      ! grep -qE "^-[[:space:]]*${decl_re}" <<< "$all_patch"; then
      intro="$sha"
      break
    fi
  done
  # No introducing commit in the scanned history (older than the last 100 file commits, or patches
  # unavailable) → leave unresolved rather than guess. CODEOWNERS remains the reviewer.
  if [ -z "$intro" ]; then
    warn "operation '$op': no introducing commit found in the last 100 commits touching $rel — cannot attribute"
    return 0
  fi

  # 3. commit -> GitHub login. Prefer the resolved commit author; fall back to the author of the PR the
  #    commit belongs to (handles squash merges), which needs Pull requests: read.
  login=$(GH_TOKEN="$HUB_CONTENTS_TOKEN" gh api "repos/camunda/camunda-hub/commits/$intro" \
    --jq '.author.login // empty' 2>/dev/null || echo "")
  if [ -z "$login" ]; then
    login=$(GH_TOKEN="$HUB_PR_TOKEN" gh api "repos/camunda/camunda-hub/commits/$intro/pulls" \
      --jq '.[0].user.login // empty' 2>/dev/null || echo "")
  fi
  [ -n "$login" ] || warn "operation '$op': commit $intro has no resolvable GitHub author — cannot attribute"
  RESOLVED_LOGIN="$login"
}

# Collect, dedupe, drop bots, cap.
logins=""
for op in $OPERATION_IDS; do
  [ -n "$op" ] || continue
  resolve_author "$op"
  case "$RESOLVED_LOGIN" in
    "") ;;                           # unattributable — already warned
    *"[bot]" | *-bot | *-robot) ;;   # never request a bot
    *) logins="$logins $RESOLVED_LOGIN" ;;
  esac
done

reviewers=$(echo "$logins" | tr ' ' '\n' | sed '/^$/d' | awk '!seen[$0]++' | head -n "$MAX_REVIEWERS")
if [ -z "$reviewers" ]; then
  echo "No camunda-hub author could be attributed — CODEOWNERS team remains the reviewer."
  exit 0
fi

for login in $reviewers; do
  if [ -n "$DRY_RUN" ]; then
    echo "[dry-run] would request review from @$login on $GEN_REPO#$PR"
    continue
  fi
  if GH_TOKEN="$GEN_TOKEN" gh pr edit "$PR" --repo "$GEN_REPO" --add-reviewer "$login" >/dev/null 2>&1; then
    echo "Requested review from @$login on $GEN_REPO#$PR"
  else
    warn "could not request @$login (no access to $GEN_REPO, or not a user there?) — CODEOWNERS team stands in"
  fi
done
exit 0
