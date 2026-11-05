#!/usr/bin/env bash
# Attribute a nightly generator-fix PR to the endpoint's author and request their
# review (handover call, 2026-10-28: a generator gap "belongs end-to-end" to
# whoever added the operation). Reads the triage agent's result JSON, groups fix
# PRs, resolves the deduped set of each PR's operations' authors, assigns them +
# requests their review, and falls back to the @camunda/hub team so a fix PR
# always ends with a reviewer.
#
#   GH_TOKEN_GENERATOR=<api-test-generator PR write> \
#   HUB_TOKEN=<camunda-hub Contents:Read> \
#     hub-assign-fix-prs.sh <triage.json> <camunda-hub-checkout-dir>
#
# Best-effort and purely additive: every GitHub call is non-fatal, so a miss
# (bot author, a contributor without repo access, a gh error) degrades to the
# team fallback or a warning and never fails the caller.
#
# Two kinds of PR, routed differently:
#   - a test-generation / unmapped-op FIX PR (fix_pr_url): the endpoint owner is
#     both assigned and asked to review — they own the fix.
#   - a product-bug SUPPRESS PR (suppress_pr_url): the endpoint owner is asked to
#     REVIEW only, no assignee — they sanity-check that suppressing their
#     endpoint's test is right, but the Hub bug itself (tracked in the filed
#     issue) is not theirs to fix, and blame would mis-attribute it.
# Both fall back to the @camunda/hub team so a PR always ends with a reviewer.
#
# Env knobs (defaults are the production values; the tests override them):
#   HUB_TEAM        reviewer team when no individual resolves   (camunda/hub)
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
trap 'rm -f "$pairs_file" "$prs_file"' EXIT

# (pr_url <TAB> operationId <TAB> kind): "fix" for a test-generation / unmapped-op
# fix PR (fix_pr_url), "suppress" for a product-bug suppress PR (suppress_pr_url).
jq -r '
  ( [ (.failures // [])[]
      | select((.subcategory // "") == "test-generation"
               and (.action // "") == "fix-pr"
               and ((.fix_pr_url // "") != "")
               and ((.operationId // "") != ""))
      | {pr: .fix_pr_url, op: .operationId, kind: "fix"} ]
  + [ (.unmapped_operations // [])[]
      | select((.action // "") == "fix-pr"
               and ((.fix_pr_url // "") != "")
               and ((.operationId // "") != ""))
      | {pr: .fix_pr_url, op: .operationId, kind: "fix"} ]
  + [ (.failures // [])[]
      | select(((.suppress_pr_url // "") != "")
               and ((.operationId // "") != ""))
      | {pr: .suppress_pr_url, op: .operationId, kind: "suppress"} ] )
  | .[] | "\(.pr)\t\(.op)\t\(.kind)"
' "$f" | sort -u > "$pairs_file"

if [ ! -s "$pairs_file" ]; then
  echo "No fix or suppress PRs to attribute."
  exit 0
fi
# (pr_url <TAB> kind), unique — a PR url belongs to exactly one kind.
cut -f1,3 "$pairs_file" | sort -u > "$prs_file"

# Request $hub_team as reviewer; $1 is a context phrase for the log line.
request_team() {
  if GH_TOKEN="$GH_TOKEN_GENERATOR" "$GH" pr edit "$pr" --add-reviewer "$hub_team" 2>/tmp/hub-assign.err; then
    echo "  ${1} — requested ${hub_team} team review."
  else
    echo "::warning::could not request ${hub_team} review on ${pr} (the team may lack ${repo_label} access): $(cat /tmp/hub-assign.err 2>/dev/null)"
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
