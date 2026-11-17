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
# Appends one markdown line per endpoint to REPORT_DIR/endpoint-index.md (a link to its issue, grouped by
# area; an endpoint with no issue yet is listed with its area), which the summary script puts into the
# tracking issue — that issue is the index people read, so the Slack message links it rather than listing
# every endpoint inline. Also writes
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

# Every existing coverage issue (any state), so duplicates resolve to one. The title search is capped at
# $lookup_limit (GitHub's search API itself caps at 1000). Today's coverage-issue count is far below this,
# but a truncated lookup would miss an existing issue — creating a duplicate and skipping its cleanup — so
# warn loudly rather than degrade silently. (COVERAGE_ISSUE_LOOKUP_LIMIT lets a test force the cap.)
lookup_limit="${COVERAGE_ISSUE_LOOKUP_LIMIT:-1000}"
existing=$(gh issue list --state all --limit "$lookup_limit" --search "in:title \"$prefix\"" \
  --json number,title,state,createdAt)
if [ "$(jq 'length' <<< "$existing")" -ge "$lookup_limit" ]; then
  echo "::warning::coverage-issue lookup hit the ${lookup_limit}-result cap; dedup and cleanup may be incomplete — split the search by area or state." >&2
fi
new=0
current=$(mktemp)
# operationId<TAB>issue-number, one line per endpoint that has an issue this run; folded into
# endpoint-issues.json below.
pairs=$(mktemp)
# operationId<TAB>days-open, folded into endpoint-ages.json below so the page can show how long each
# gap has been open (from its tracking issue's latest reopen, or its creation when never reopened).
ages=$(mktemp)
while read -r entry; do
  title=$(jq -r '.title' <<< "$entry")
  file=$(jq -r '.file' <<< "$entry")
  op=$(jq -r '.operationId' <<< "$entry")
  area=$(jq -r '.area' <<< "$entry")
  echo "$title" >> "$current"
  found=$(jq -r --arg t "$title" '[.[] | select(.title == $t)] | sort_by(.state != "OPEN") | first // empty | "\(.number)\t\(.state)\t\(.createdAt)"' <<< "$existing")
  if [ -z "$found" ]; then
    if [ "$new" -ge "${MAX_NEW_ENDPOINT_ISSUES:-40}" ]; then
      echo "Cap reached: '$title' will be opened on a later run."
      printf -- '- `%s` — %s (its issue opens on a later run)\n' "$op" "$area" >> "$REPORT_DIR/endpoint-index.md"
      continue
    fi
    url=$(gh issue create --title "$title" --body-file "$file" \
      --label missing-coverage --label auto-generated --label hub --label team/hub)
    new=$((new + 1))
    assign_owner "${url##*/}" "$op"
    # Freshly opened this run, so its gap is zero days old.
    open_day="$today"
  else
    IFS=$'\t' read -r num state created <<< "$found"
    # Reopen a returning gap (its endpoint was covered, now regressed). Not gated on the brand-new
    # flood-guard counter ($new) — reopening is not creating — so a returning gap is reopened even when the
    # cap on brand-new issues is reached. It lands in this run's endpoint-issues.json like any other tracked
    # gap, so the movement block below counts it as reported-this-week on its own.
    [ "$state" = "OPEN" ] || gh issue reopen "$num"
    # Add team/hub on the edit path too, so a pre-existing open endpoint issue also lands on the Hub board.
    gh issue edit "$num" --body-file "$file" --add-label team/hub
    gh issue comment "$num" --body "Re-checked on $today: still missing. $RUN_URL"
    url="$REPO_URL/issues/$num"
    # Age the gap from the latest reopen, not the original createdAt. An endpoint issue is reopened when a
    # gap returns, so counting from creation would include the interval it was closed — over-reporting a
    # returning gap as continuously unaddressed, and stalling it. The timeline is read AFTER the reopen
    # above, so a gap that returned THIS run already carries today's reopen event and reads as 0 days open.
    # Falls back to createdAt when never reopened; a timeline-lookup failure degrades to createdAt too.
    open_day="${created%%T*}"
    reopened_at=$(gh api --paginate "repos/{owner}/{repo}/issues/${num}/timeline" 2>/dev/null \
      | jq -s -r '[.[][]? | select(.event == "reopened") | .created_at] | max // empty' 2>/dev/null || true)
    [ -n "$reopened_at" ] && open_day="${reopened_at%%T*}"
  fi
  printf -- '- [ ] #%s `%s` — %s\n' "${url##*/}" "$op" "$area" >> "$REPORT_DIR/endpoint-index.md"
  printf '%s\t%s\n' "$op" "${url##*/}" >> "$pairs"
  # Days this endpoint's gap has been open, from the latest reopen (or creation if never reopened); 0 for
  # one opened or reopened this run. Robust to a bad/absent date: skip the age rather than fail the run.
  c_epoch=$(date -u -d "${open_day:-$today}" +%s 2>/dev/null || true)
  t_epoch=$(date -u -d "$today" +%s 2>/dev/null || true)
  if [ -n "$c_epoch" ] && [ -n "$t_epoch" ]; then
    days=$(( (t_epoch - c_epoch) / 86400 ))
    [ "$days" -lt 0 ] && days=0
    printf '%s\t%s\n' "$op" "$days" >> "$ages"
  fi
done < <(jq -c '.[]' "$REPORT_DIR/endpoints.json")

# Fold the operationId -> issue-number pairs into endpoint-issues.json (an empty object when none).
jq -R -s 'split("\n") | map(select(length > 0) | split("\t") | {(.[0]): (.[1] | tonumber)}) | add // {}' \
  "$pairs" > "$REPORT_DIR/endpoint-issues.json"

# Fold operationId -> days-open into endpoint-ages.json (an empty object when none), for the page's
# "open N weeks" labels.
jq -R -s 'split("\n") | map(select(length > 0) | split("\t") | {(.[0]): (.[1] | tonumber)}) | add // {}' \
  "$ages" > "$REPORT_DIR/endpoint-ages.json"

# This week's movement, for the report page and the Slack Wins section — computed symmetrically from two
# tracking-issue sets so it is robust to runs between two scheduled reports (a non-dry manual run, or a failed
# run that already reconciled issues): the endpoints that have a per-endpoint coverage issue THIS run (keys of
# the endpoint-issues.json just written above) against the endpoints that had one in the previous scheduled
# report (previous endpoint-issues.json keys, PREV_ENDPOINT_ISSUES). "Reported" = tracked this run but not in
# the previous report (a brand-new issue, a reopened returning gap, or a gap an intervening run already
# issued); "closed" = in the previous report but no longer a gap this run (also catching a gap an owner or an
# intervening run already closed). Counting only this invocation's own create/reopen mutations would miss a
# gap an intervening run already issued, leaving Reported understated while its eventual fix still bumps
# Closed. Using this run's issue set (not every gappy endpoint) keeps a capped endpoint — gappy but not yet
# issued — out of both sides until its issue actually opens, so it is reported once, not every run until the
# cap clears. operationIds, not just counts, so the page and Slack can name the endpoints.
cur_ops=$(mktemp)  # endpoints with a coverage issue this run (reopened gaps included; capped-but-unissued excluded)
jq -r 'keys[]' "$REPORT_DIR/endpoint-issues.json" 2>/dev/null | sort -u > "$cur_ops" || true
prev_ops=$(mktemp)  # endpoints that had a coverage issue in the previous scheduled report (empty on the first run)
if [ -n "${PREV_ENDPOINT_ISSUES:-}" ] && [ -s "$PREV_ENDPOINT_ISSUES" ]; then
  jq -r 'keys[]' "$PREV_ENDPOINT_ISSUES" 2>/dev/null | sort -u > "$prev_ops" || true
fi
new_json=$(comm -13 "$prev_ops" "$cur_ops" | jq -R -s 'split("\n") | map(select(length > 0))')
# A closure must be a real one — a test was added. An endpoint leaves the issue set for three reasons: its
# gap was genuinely covered (count it), its last gap was suppressed/excluded or parked as a known hold (no
# test added — not a win), or the operation was removed from the spec (the endpoint is gone — not a win).
# The last two would otherwise show as green Closed bars and Slack Wins, misrepresenting a suppression or a
# deletion as dev progress. So restrict the previous-report set to endpoints that are genuinely handled this
# run: present in rows.json (removed ops are absent), with no held response cell, request-checks not held, and
# no held request kind. A whole-op suppression and a whole-op negative exclusion surface as a 'hold' cell or
# 'hold' requestChecks; a scoped kind exclusion that parks only one kind of a many-kind code (e.g. one 400
# kind) leaves requestChecks 'ok' and the cell un-parked, so it shows only in requestHeldKinds — without that
# check, suppressing an endpoint's last missing kind would pass as a closure. Conservative by design — an
# endpoint whose genuine fix lands the same week it also carries an unrelated held check is not counted that
# week, which under-credits rather than inventing a false win.
clean_now=$(mktemp)  # endpoints genuinely handled this run (present and not parked); excludes removed + held/suppressed
if [ -s "$REPORT_DIR/rows.json" ]; then
  jq -r '.[]
    | select(([.cells[]?] | any(. == "hold")) | not)
    | select(.requestChecks != "hold")
    | select(((.requestHeldKinds // []) | length) == 0)
    | .operationId' \
    "$REPORT_DIR/rows.json" 2>/dev/null | sort -u > "$clean_now" || true
fi
closed_candidates=$(mktemp)  # had an issue last report, no coverage issue this run (fixed, suppressed, or removed)
comm -23 "$prev_ops" "$cur_ops" > "$closed_candidates"
closed_json=$(comm -12 "$closed_candidates" "$clean_now" | jq -R -s 'split("\n") | map(select(length > 0))')
jq -n --argjson new "$new_json" --argjson closedops "$closed_json" \
  '{newThisWeek: $new, closedThisWeek: ($closedops | length), closedOps: $closedops}' \
  > "$REPORT_DIR/gaps-progress.json"

# Accumulate one weekly row of reported-vs-closed counts into progress-history.csv, so the report page can
# chart developer engagement over time (does the team close the gaps the generator reports?). Like
# history.csv, it round-trips through the artifact: the previous run's file (PREV_PROGRESS_HISTORY, from the
# downloaded previous artifact) carries the earlier weeks, and this run appends its own row. Absent on the
# first run after this shipped — the history simply starts here.
reported_n=$(jq 'length' <<< "$new_json")
closed_n=$(jq 'length' <<< "$closed_json")
prev_progress="${PREV_PROGRESS_HISTORY:-}"
{
  if [ -n "$prev_progress" ] && [ -s "$prev_progress" ]; then
    cat "$prev_progress"
  else
    echo 'date,reported,closed'
  fi
  printf '%s,%s,%s\n' "$today" "$reported_n" "$closed_n"
} > "$REPORT_DIR/progress-history.csv"

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
