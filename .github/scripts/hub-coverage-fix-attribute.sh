#!/usr/bin/env bash
# Request the endpoint author's review on each coverage-fix PR this run opened —
# "a gap in an endpoint's coverage belongs to whoever added the endpoint" (handover
# call, 2026-10-28), the same attribution the nightly fix PRs use. Reads the
# verifier output (`authors: [{number, operationId}]`, deterministic — the verifier
# reuses its own branch -> candidate mapping, never the agent's text), resolves each
# operation's camunda-hub author by git-blaming its spec line
# ([hub-endpoint-author.sh](hub-endpoint-author.sh)), and requests their review on the
# PR. Falls back to the @camunda/hub team so a PR always ends with a reviewer.
#
#   GH_TOKEN=<api-test-generator PR write> \
#   HUB_TOKEN=<camunda-hub Contents:Read> \
#     hub-coverage-fix-attribute.sh <verify-out.json> <camunda-hub-checkout-dir>
#
# Best-effort and purely additive: every GitHub call is non-fatal, so a miss (bot /
# unresolved author, a contributor without access, a gh error) degrades to the team
# fallback or a warning and never fails the caller. Reviewer-only (no assignee): the
# coverage-fix PR is generator-side test code the Hub team reviews; the endpoint owner
# just sanity-checks that their endpoint's new test is right.
#
# Env knobs (defaults are the production values; the tests override them):
#   HUB_TEAM        team used for the @camunda/hub fallback   (camunda/hub)
#   AUTHOR_RESOLVER operationId -> login resolver              (hub-endpoint-author.sh)
#   GH              the GitHub CLI                             (gh)
set -uo pipefail

out="${1:-}"
hub="${2:-}"
if [ -z "$out" ] || [ -z "$hub" ]; then
  echo "usage: hub-coverage-fix-attribute.sh <verify-out.json> <camunda-hub-checkout-dir>" >&2
  exit 2
fi
hub_team="${HUB_TEAM:-camunda/hub}"
resolver="${AUTHOR_RESOLVER:-$(dirname "$0")/hub-endpoint-author.sh}"
GH="${GH:-gh}"
repo="${GITHUB_REPOSITORY:-camunda/api-test-generator}"

[ -s "$out" ] || { echo "No verifier output — nothing to attribute."; exit 0; }
jq empty "$out" 2>/dev/null || {
  echo "::warning::verifier output is not JSON — skipping coverage-fix attribution"
  exit 0
}
# The camunda-hub checkout is OPTIONAL: without it (minting or cloning the private repo
# failed) we cannot resolve individual authors, but we still request the @camunda/hub team
# for every PR so a verified PR never ends up with no reviewer. Requesting the team needs
# only GH_TOKEN (api-test-generator), not camunda-hub access.
have_hub=1
if [ ! -d "${hub}/.git" ]; then
  echo "::warning::camunda-hub checkout not available at ${hub} — requesting ${hub_team} for every PR instead."
  have_hub=0
fi

# Request $hub_team as the fallback reviewer on PR #$1; $2 is a context phrase.
request_team() {
  if "$GH" pr edit "$1" --repo "$repo" --add-reviewer "$hub_team" 2>/tmp/hub-cov-attr.err; then
    echo "  ${2} — requested ${hub_team} team review."
  else
    echo "::warning::could not request ${hub_team} review on PR #${1}: $(cat /tmp/hub-cov-attr.err 2>/dev/null)"
  fi
}

TAB=$(printf '\t')
# (pr_number <TAB> operationId), only well-formed rows.
jq -r '
  (.authors // [])[]
  | select(((.number // 0) | type) == "number" and (.number // 0) > 0
           and ((.operationId // "") != ""))
  | "\(.number)\t\(.operationId)"
' "$out" | while IFS="$TAB" read -r num op; do
  [ -n "$num" ] || continue
  login=""
  [ "$have_hub" = 1 ] && [ -n "$op" ] &&
    login=$(GH_TOKEN="$HUB_TOKEN" bash "$resolver" "$op" "$hub" || true)
  if [ -n "$login" ]; then
    if "$GH" pr edit "$num" --repo "$repo" --add-reviewer "$login" 2>/tmp/hub-cov-attr.err; then
      echo "Requested review from ${login} (owns ${op}) on PR #${num}"
      continue
    fi
    echo "::warning::could not request review from ${login} on PR #${num}: $(cat /tmp/hub-cov-attr.err 2>/dev/null)"
  fi
  # No individual author resolved, or the request failed → the team reviews it.
  request_team "$num" "no endpoint author for PR #${num}"
done
