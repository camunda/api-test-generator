#!/usr/bin/env bash
# Opens, rewrites, reopens, assigns or closes one issue per uncovered endpoint of the weekly Hub
# response coverage report, and migrates the old per-area issues. Run by
# .github/workflows/hub-response-coverage.yml; tested against a stub `gh` in
# tests/request-validation/hub-gap-issue.test.ts.
#
# Each uncovered endpoint gets its own issue, assigned to whoever added the endpoint (the 2026-10-28
# handover decision: a coverage gap belongs to whoever added the endpoint). The author is resolved by
# git-blaming the operation's spec line in the camunda-hub checkout (AUTHOR_RESOLVER); when no login
# resolves (a bot, or a contributor without access) a team cannot be an assignee, so the issue gets an
# @camunda/hub mention comment instead. Best-effort and additive: an assignment miss never fails the run.
#
# Inputs (environment):
#   ISSUE_TITLE               the summary issue, never touched here
#   MAX_NEW_ENDPOINT_ISSUES   flood-guard cap on brand-new issues per run (default 40 — high enough to
#                             clear the current backlog in one run; steady-state new gaps are few, so the
#                             cap is a guard against a pathological spec change, not a weekly throttle)
#   REPORT_DIR                holds endpoints.json + the per-endpoint body files
#   REPO_URL, RUN_URL
#   AUTHOR_RESOLVER           operationId -> login resolver (default .github/scripts/hub-endpoint-author.sh)
#   HUB_DIR                   camunda-hub checkout for the git-blame (default ../camunda-hub); must have FULL
#                             history — a shallow checkout (.git/shallow present) skips blame and uses the team
#   HUB_TOKEN                 camunda-hub read token the resolver uses
#   HUB_TEAM                  team for the @-mention fallback (default camunda/hub)
#
# Appends one Slack-formatted entry per endpoint to REPORT_DIR/endpoint-links.txt and one markdown line
# per endpoint to REPORT_DIR/endpoint-index.md (a link to its issue, grouped by area; an endpoint with no
# issue yet is listed with its area), which the summary script puts into the tracking issue. Also writes
# REPORT_DIR/endpoint-issues.json, a {"<operationId>": <issue-number>} map for every endpoint that has an
# issue this run (endpoints whose issue opens on a later run are omitted). The coverage-fix selector reads
# it so a fix PR can link `closes #<issue>` to the endpoint it fixes.
set -euo pipefail

today=$(date -u +%F)
prefix='[hub-response-coverage] '
# Singular "test" marks a per-endpoint issue; the old per-area issues end with plural "tests", and the
# summary issue has no colon suffix at all — so endswith on these two keeps the three kinds apart.
endpoint_suffix=': missing response or bad-request test'
area_suffix=': missing response or bad-request tests'
resolver="${AUTHOR_RESOLVER:-$(dirname "$0")/hub-endpoint-author.sh}"
hub_dir="${HUB_DIR:-../camunda-hub}"
hub_team="${HUB_TEAM:-camunda/hub}"

# A missing or malformed endpoints.json (an upstream report step that crashed, not a real "no gaps"
# result) would make the loop below read zero endpoints, leaving $current empty — and the cleanup loop
# would then close EVERY open endpoint issue as resolved. A genuine no-gaps run is a valid empty array
# `[]`, which still parses and still (correctly) closes them. So require a valid JSON array here and abort
# otherwise, rather than mistake a broken report for resolved coverage.
endpoints_json="$REPORT_DIR/endpoints.json"
if [ ! -s "$endpoints_json" ] || ! jq -e 'type == "array"' "$endpoints_json" >/dev/null 2>&1; then
  echo "::error::$endpoints_json is missing or not a JSON array; refusing to close issues (a broken report must not be read as 'no coverage gaps')." >&2
  exit 1
fi

# Assign issue #$1 (operationId $2) to the endpoint author, or mention the team when none resolves.
# Called only when the issue is freshly created (a new issue has no assignee). Best-effort — a miss is
# logged and the run continues. The author is resolved by git-blaming the operation's spec line, which
# needs full history: a SHALLOW checkout (clone-hub-sibling fetches --depth 1) blames every line to the
# fetched tip, so when `.git/shallow` is present the blame is skipped and the issue falls through to the
# @camunda/hub mention instead — a correct-but-unassigned issue beats one assigned to the wrong person.
# The workflow deepens the checkout before this step; if that fetch failed the marker remains and we degrade.
assign_owner() {
  local num="$1" op="$2" login=''
  if [ -n "$op" ] && [ -d "${hub_dir}/.git" ] && [ ! -f "${hub_dir}/.git/shallow" ]; then
    login=$(GH_TOKEN="${HUB_TOKEN:-}" bash "$resolver" "$op" "$hub_dir" 2>/dev/null || true)
  fi
  if [ -n "$login" ] && gh issue edit "$num" --add-assignee "$login" >/dev/null 2>&1; then
    echo "Assigned ${login} to #${num} (${op})"
    return 0
  fi
  # No individual owner (a bot, an unresolved author, or no access) — a team cannot be an assignee, so
  # mention it on the issue instead.
  if gh issue comment "$num" \
      --body "@${hub_team} — automated coverage triage could not resolve an endpoint owner for \`${op}\`; please take it." \
      >/dev/null 2>&1; then
    echo "Mentioned @${hub_team} on #${num} (no endpoint author for ${op})"
  else
    echo "::warning::could not assign or mention an owner on #${num}"
  fi
}

# Every existing coverage issue (any state), so duplicates resolve to one.
existing=$(gh issue list --state all --limit 500 --search "in:title \"$prefix\"" \
  --json number,title,state)
new=0
current=$(mktemp)
# operationId<TAB>issue-number, one line per endpoint that has an issue this run; folded into
# endpoint-issues.json below.
pairs=$(mktemp)
while read -r entry; do
  title=$(jq -r '.title' <<< "$entry")
  file=$(jq -r '.file' <<< "$entry")
  op=$(jq -r '.operationId' <<< "$entry")
  area=$(jq -r '.area' <<< "$entry")
  echo "$title" >> "$current"
  found=$(jq -r --arg t "$title" '[.[] | select(.title == $t)] | sort_by(.state != "OPEN") | first // empty | "\(.number) \(.state)"' <<< "$existing")
  if [ -z "$found" ]; then
    if [ "$new" -ge "${MAX_NEW_ENDPOINT_ISSUES:-40}" ]; then
      echo "Cap reached: '$title' will be opened on a later run."
      echo "$op ($area)" >> "$REPORT_DIR/endpoint-links.txt"
      printf -- '- `%s` — %s (its issue opens on a later run)\n' "$op" "$area" >> "$REPORT_DIR/endpoint-index.md"
      continue
    fi
    url=$(gh issue create --title "$title" --body-file "$file" \
      --label missing-coverage --label auto-generated --label hub --label team/hub)
    new=$((new + 1))
    assign_owner "${url##*/}" "$op"
  else
    num=${found% *}
    state=${found#* }
    [ "$state" = "OPEN" ] || gh issue reopen "$num"
    # Add team/hub on the edit path too, so a pre-existing open endpoint issue also lands on the Hub board.
    gh issue edit "$num" --body-file "$file" --add-label team/hub
    gh issue comment "$num" --body "Re-checked on $today: still missing. $RUN_URL"
    url="$REPO_URL/issues/$num"
  fi
  echo "<$url|$op ($area)>" >> "$REPORT_DIR/endpoint-links.txt"
  printf -- '- [ ] #%s `%s` — %s\n' "${url##*/}" "$op" "$area" >> "$REPORT_DIR/endpoint-index.md"
  printf '%s\t%s\n' "$op" "${url##*/}" >> "$pairs"
done < <(jq -c '.[]' "$REPORT_DIR/endpoints.json")

# Fold the operationId -> issue-number pairs into endpoint-issues.json (an empty object when none).
jq -R -s 'split("\n") | map(select(length > 0) | split("\t") | {(.[0]): (.[1] | tonumber)}) | add // {}' \
  "$pairs" > "$REPORT_DIR/endpoint-issues.json"

# Close open per-endpoint issues whose endpoint no longer has a gap (the singular "test" suffix matches
# only the per-endpoint issues, never the plural-"tests" summary or the old per-area issues).
# Anchor on the prefix too: `in:title "$prefix"` above is a substring match, so $existing can also hold a
# manual follow-up like "Investigate [hub-response-coverage] Foo: ... test" that ends with the suffix but
# is not ours — startswith($p) keeps the close scoped to issues this workflow actually owns.
jq -r --arg x "$endpoint_suffix" --arg p "$prefix" \
  '.[] | select(.state == "OPEN" and (.title | startswith($p)) and (.title | endswith($x))) | "\(.number)\t\(.title)"' \
  <<< "$existing" | while IFS=$'\t' read -r num title; do
  if ! grep -qxF "$title" "$current"; then
    gh issue close "$num" --reason completed \
      --comment "This endpoint has a test for every response and bad-request kind now (weekly check on $today), so this is closed automatically."
  fi
done

# Migration: close the old per-area issues (plural-"tests" suffix) that the per-endpoint model replaces.
# One-time — they are never recreated. The summary issue has no colon suffix, so it is never matched.
jq -r --arg x "$area_suffix" --arg p "$prefix" \
  '.[] | select(.state == "OPEN" and (.title | startswith($p)) and (.title | endswith($x))) | .number' \
  <<< "$existing" | while read -r num; do
  gh issue close "$num" --reason completed \
    --comment "Coverage gaps are now tracked per endpoint (one issue per endpoint, assigned to its author), so this per-area issue is superseded and closed automatically. See the summary issue for the index."
done
