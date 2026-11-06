#!/usr/bin/env bash
# Attribute a nightly triage finding to the endpoint's author on GitHub (handover
# call, 2026-10-28: a generator gap "belongs end-to-end" to whoever added the
# operation). Reads the triage agent's result JSON and routes three kinds of
# finding to that author, resolved by git-blaming the operation's spec line in
# camunda-hub (AUTHOR_RESOLVER):
#
#   - a test-generation / unmapped-op FIX PR (fix_pr_url): the endpoint owner is
#     ASSIGNED and asked to REVIEW it (an api-test-generator PR) — they own the fix.
#   - a product-bug SUPPRESS PR (suppress_pr_url): the endpoint owner is asked to
#     REVIEW only (an api-test-generator PR) — they sanity-check that suppressing
#     their endpoint's test is right.
#   - a freshly filed Hub BUG (action "file" + issue_url): the endpoint owner is
#     ASSIGNED the camunda-hub issue — it is theirs to drive.
#
# The nightly digest does NOT ping hub-medic for any of these — the assignee /
# reviewer is the notification. (The digest pings only for a failure that could
# not be classified, which has no owner to assign.)
#
# PR writes use GH_TOKEN_GENERATOR (api-test-generator); the Hub-issue write uses
# GH_TOKEN_HUB (camunda-hub, issues-only). The author lookup reads camunda-hub
# with HUB_TOKEN (Contents:Read).
#
#   GH_TOKEN_GENERATOR=<api-test-generator PR write> \
#   GH_TOKEN_HUB=<camunda-hub issues write> \
#   HUB_TOKEN=<camunda-hub Contents:Read> \
#     hub-assign-fix-prs.sh <triage.json> <camunda-hub-checkout-dir>
#
# Best-effort and purely additive: every GitHub call is non-fatal, so a miss
# (bot author, a contributor without repo access, a gh error, a missing token)
# degrades to the @camunda/hub fallback or a warning and never fails the caller.
# For a PR the fallback is a team review request; a team cannot be assigned to an
# issue, so for the bug issue the fallback is an @camunda/hub mention comment.
#
# Env knobs (defaults are the production values; the tests override them):
#   HUB_TEAM        team used for the @camunda/hub fallback      (camunda/hub)
#   AUTHOR_RESOLVER operationId -> login resolver                (hub-endpoint-author.sh)
#   GH              the GitHub CLI                               (gh)
set -uo pipefail

f="${1:-}"
hub="${2:-}"
if [ -z "$f" ] || [ -z "$hub" ]; then
  echo "usage: hub-assign-fix-prs.sh <triage.json> <camunda-hub-checkout-dir>" >&2
  exit 2
fi
hub_team="${HUB_TEAM:-camunda/hub}"
resolver="${AUTHOR_RESOLVER:-$(dirname "$0")/hub-endpoint-author.sh}"
GH="${GH:-gh}"
repo_label="${GITHUB_REPOSITORY:-this repo}"

[ -s "$f" ] || { echo "no triage result — nothing to attribute"; exit 0; }
jq empty "$f" 2>/dev/null || {
  echo "::warning::triage result is not JSON — skipping endpoint-author attribution"
  exit 0
}
if [ ! -d "${hub}/.git" ]; then
  echo "::warning::camunda-hub checkout not found at ${hub} — skipping endpoint-author attribution"
  exit 0
fi

TAB=$(printf '\t')
pairs_file=$(mktemp)
prs_file=$(mktemp)
issue_pairs_file=$(mktemp)
issues_file=$(mktemp)
trap 'rm -f "$pairs_file" "$prs_file" "$issue_pairs_file" "$issues_file"' EXIT

# (pr_url <TAB> operationId <TAB> kind): "fix" for a test-generation / unmapped-op
# fix PR (fix_pr_url), "suppress" for a product-bug suppress PR (suppress_pr_url).
# operationId may be empty — a PR with no resolvable op still reaches the
# @camunda/hub team-review fallback rather than being dropped, so every PR ends
# with a reviewer.
jq -r '
  ( [ (.failures // [])[]
      | select((.subcategory // "") == "test-generation"
               and (.action // "") == "fix-pr"
               and ((.fix_pr_url // "") != ""))
      | {pr: .fix_pr_url, op: (.operationId // ""), kind: "fix"} ]
  + [ (.unmapped_operations // [])[]
      | select((.action // "") == "fix-pr"
               and ((.fix_pr_url // "") != ""))
      | {pr: .fix_pr_url, op: (.operationId // ""), kind: "fix"} ]
  + [ (.failures // [])[]
      | select(((.suppress_pr_url // "") != ""))
      | {pr: .suppress_pr_url, op: (.operationId // ""), kind: "suppress"} ] )
  | .[] | "\(.pr)\t\(.op)\t\(.kind)"
' "$f" | sort -u > "$pairs_file"

# (issue_url <TAB> operationId): a FRESHLY filed Hub bug (action "file" with an
# issue_url). An already-known recurrence (report-only/skip) carries no "file"
# action, so it is never re-assigned. operationId may be empty — a bug with no
# resolvable op still gets the @camunda/hub mention fallback (below) rather than
# being dropped, since the digest no longer pings for a filed bug.
jq -r '
  [ (.failures // [])[]
    | select((.action // "") == "file"
             and ((.issue_url // "") != ""))
    | {issue: .issue_url, op: (.operationId // "")} ]
  | .[] | "\(.issue)\t\(.op)"
' "$f" | sort -u > "$issue_pairs_file"

if [ ! -s "$pairs_file" ] && [ ! -s "$issue_pairs_file" ]; then
  echo "No fix/suppress PRs or fresh bug issues to attribute."
  exit 0
fi
# (pr_url <TAB> kind), unique — a PR url belongs to exactly one kind.
cut -f1,3 "$pairs_file" | sort -u > "$prs_file"
# issue_url, unique.
cut -f1 "$issue_pairs_file" | sort -u > "$issues_file"

# Fail-safe: a finding that cannot be routed to ANY owner (no individual, and the
# @camunda/hub team fallback below also failed) is recorded here so the caller can
# page hub-medic for it — otherwise it would sit in the digest owned by no one.
# UNROUTED_FILE is optional (the workflow sets it); start it empty when set.
[ -n "${UNROUTED_FILE:-}" ] && : > "$UNROUTED_FILE"
record_unrouted() { [ -n "${UNROUTED_FILE:-}" ] && printf '%s\n' "$1" >> "$UNROUTED_FILE"; return 0; }

# Request $hub_team as reviewer; $1 is a context phrase for the log line.
request_team() {
  if GH_TOKEN="$GH_TOKEN_GENERATOR" "$GH" pr edit "$pr" --add-reviewer "$hub_team" 2>/tmp/hub-assign.err; then
    echo "  ${1} — requested ${hub_team} team review."
  else
    echo "::warning::could not request ${hub_team} review on ${pr} (the team may lack ${repo_label} access): $(cat /tmp/hub-assign.err 2>/dev/null)"
    record_unrouted "$pr"
  fi
}

# Mention @$hub_team on the bug issue — the issue-side fallback, since a team
# cannot be an assignee. $1 is a context phrase for the log line; $issue is the
# current loop's issue url.
mention_team_on_issue() {
  if GH_TOKEN="$GH_TOKEN_HUB" "$GH" issue comment "$issue" \
      --body "@${hub_team} — automated triage could not assign an endpoint owner for this bug; please take it." \
      2>/tmp/hub-assign.err; then
    echo "  ${1} — mentioned @${hub_team} on the issue."
  else
    echo "::warning::could not mention @${hub_team} on ${issue}: $(cat /tmp/hub-assign.err 2>/dev/null)"
    record_unrouted "$issue"
  fi
}

# One PR at a time (files, not pipes, so $logins survives the loop); resolve each
# of its operations' authors and request their review — a fix PR also assigns
# them, a suppress PR requests review only.
while IFS="$TAB" read -r pr kind; do
  [ -n "$pr" ] || continue
  logins=""
  while IFS="$TAB" read -r p op _; do
    [ "$p" = "$pr" ] || continue
    [ -n "$op" ] || continue  # missing op → no author to resolve → team fallback
    login=$(GH_TOKEN="$HUB_TOKEN" bash "$resolver" "$op" "$hub" || true)
    [ -n "$login" ] || continue
    case " ${logins} " in *" ${login} "*) : ;; *) logins="${logins:+${logins} }${login}" ;; esac
  done < "$pairs_file"

  if [ -z "$logins" ]; then
    request_team "no endpoint author resolved for ${pr}"
    continue
  fi

  echo "Attributing ${pr} (${kind}) to: ${logins}"
  reviewer_ok=0
  for login in $logins; do
    if [ "$kind" = "fix" ]; then
      if GH_TOKEN="$GH_TOKEN_GENERATOR" "$GH" pr edit "$pr" --add-assignee "$login" 2>/tmp/hub-assign.err; then
        echo "  assigned ${login}"
      else
        echo "::warning::could not assign ${login} to ${pr} (they may lack ${repo_label} access): $(cat /tmp/hub-assign.err 2>/dev/null)"
      fi
    fi
    if GH_TOKEN="$GH_TOKEN_GENERATOR" "$GH" pr edit "$pr" --add-reviewer "$login" 2>/tmp/hub-assign.err; then
      echo "  requested review from ${login}"
      reviewer_ok=1
    else
      echo "::warning::could not request review from ${login} on ${pr}: $(cat /tmp/hub-assign.err 2>/dev/null)"
    fi
  done

  # If every individual review request failed (e.g. the resolved author is not a
  # collaborator here), fall back to the team so the PR still has a reviewer.
  if [ "$reviewer_ok" -eq 0 ]; then
    request_team "no individual review request succeeded for ${pr}"
  fi
done < "$prs_file"

# Fresh bug issues: assign the endpoint author on the camunda-hub issue (it is
# theirs to drive). A team cannot be assigned to an issue, so the @camunda/hub
# fallback is a mention comment. All writes use GH_TOKEN_HUB (camunda-hub).
if [ -s "$issues_file" ]; then
  if [ -z "${GH_TOKEN_HUB:-}" ]; then
    echo "::warning::GH_TOKEN_HUB is empty — skipping fresh-bug issue assignment"
  else
    while IFS="$TAB" read -r issue; do
      [ -n "$issue" ] || continue
      logins=""
      while IFS="$TAB" read -r i op; do
        [ "$i" = "$issue" ] || continue
        [ -n "$op" ] || continue  # missing op → no author → @camunda/hub mention
        login=$(GH_TOKEN="$HUB_TOKEN" bash "$resolver" "$op" "$hub" || true)
        [ -n "$login" ] || continue
        case " ${logins} " in *" ${login} "*) : ;; *) logins="${logins:+${logins} }${login}" ;; esac
      done < "$issue_pairs_file"

      if [ -z "$logins" ]; then
        mention_team_on_issue "no endpoint author resolved for ${issue}"
        continue
      fi

      echo "Assigning bug ${issue} to: ${logins}"
      assignee_ok=0
      for login in $logins; do
        if GH_TOKEN="$GH_TOKEN_HUB" "$GH" issue edit "$issue" --add-assignee "$login" 2>/tmp/hub-assign.err; then
          echo "  assigned ${login}"
          assignee_ok=1
        else
          echo "::warning::could not assign ${login} to ${issue} (they may lack camunda-hub access): $(cat /tmp/hub-assign.err 2>/dev/null)"
        fi
      done
      # If no individual could be assigned, mention the team so the bug still has
      # an owner in front of it.
      if [ "$assignee_ok" -eq 0 ]; then
        mention_team_on_issue "no individual assignee succeeded for ${issue}"
      fi
    done < "$issues_file"
  fi
fi
