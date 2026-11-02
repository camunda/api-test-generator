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

# Idempotency, mirroring the gap-issue assignee guard: only act when nobody has been requested yet,
# so a human's manual reviewer change sticks across re-runs.
have=$(GH_TOKEN="$GEN_TOKEN" gh pr view "$PR" --repo "$GEN_REPO" \
  --json reviewRequests --jq '.reviewRequests | length' 2>/dev/null || echo "")
if [ -z "$have" ]; then
  warn "could not read review requests on $GEN_REPO#$PR (token/access?) — leaving CODEOWNERS to request the team"
  exit 0
fi
if [ "$have" != "0" ]; then
  echo "A reviewer is already requested on $GEN_REPO#$PR — leaving it as is."
  exit 0
fi

# Resolve one owner login for an operationId into the global RESOLVED_LOGIN (empty = unattributable).
# Returns through a global, not stdout, so warnings can't be mistaken for the result.
RESOLVED_LOGIN=""
resolve_author() {
  op="$1"
  RESOLVED_LOGIN=""
  # 1. Which spec file declares it — a local grep of the sibling working tree (no token, depth-safe).
  file=$(grep -rl --include='*.yaml' --include='*.yml' --include='*.json' \
    -e "operationId: $op" -e "\"operationId\": \"$op\"" "$HUB_DIR/$HUB_SPEC_DIR" 2>/dev/null | head -1)
  if [ -z "$file" ]; then
    warn "operation '$op': no spec file under $HUB_SPEC_DIR declares it — cannot attribute"
    return 0
  fi
  rel="${file#"$HUB_DIR"/}"

  # 2. The commit that introduced the operationId, preferred; else the most recent commit touching the
  #    file. Uses the Contents:read token (the qa-processes issues-only token cannot list commits).
  commits=$(GH_TOKEN="$HUB_CONTENTS_TOKEN" gh api \
    "repos/camunda/camunda-hub/commits?path=$rel&per_page=100" \
    --jq '.[].sha' 2>/dev/null || echo "")
  if [ -z "$commits" ]; then
    warn "operation '$op': could not list commits for $rel (needs Contents: read on camunda-hub) — cannot attribute"
    return 0
  fi
  # shellcheck disable=SC2086
  # Oldest first, so the first commit whose diff ADDS the operationId is where it was introduced.
  intro=""
  for sha in $(echo "$commits" | tac); do
    patch=$(GH_TOKEN="$HUB_CONTENTS_TOKEN" gh api "repos/camunda/camunda-hub/commits/$sha" \
      --jq '[.files[].patch // ""] | join("\n")' 2>/dev/null || echo "")
    if echo "$patch" | grep -qE "^\+.*operationId.*[\": ]$op([\"[:space:]]|$)"; then
      intro="$sha"
      break
    fi
  done
  # Fall back to the newest commit touching the file (current owner-ish) when no additive hit is found.
  [ -n "$intro" ] || intro=$(echo "$commits" | head -1)

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
