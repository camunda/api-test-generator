#!/usr/bin/env bash
# Opens, rewrites, reopens or closes one issue per API area of the weekly Hub response coverage
# report. Run by .github/workflows/hub-response-coverage.yml; tested against a stub `gh` in
# tests/request-validation/hub-gap-issue.test.ts.
#
# Inputs (environment): ISSUE_TITLE (the summary issue, never touched here), MAX_NEW_AREA_ISSUES,
# REPORT_DIR (holds areas.json), REPO_URL, RUN_URL.
# Appends one Slack-formatted entry per area to REPORT_DIR/area-links.txt, and one markdown line per
# area to REPORT_DIR/area-index.md (a link to its issue; an area with no issue yet lists its endpoints),
# which the summary script puts into the tracking issue.
set -euo pipefail

today=$(date -u +%F)
prefix='[hub-response-coverage] '
suffix=': missing response or bad-request tests'
# Every existing coverage issue (any state), so duplicates resolve to one.
existing=$(gh issue list --state all --limit 300 --search "in:title \"$prefix\"" \
  --json number,title,state)
new=0
current=$(mktemp)
while read -r entry; do
  title=$(jq -r '.title' <<< "$entry")
  file=$(jq -r '.file' <<< "$entry")
  label=$(jq -r '"\(.area) (\(.gaps))"' <<< "$entry")
  echo "$title" >> "$current"
  found=$(jq -r --arg t "$title" '[.[] | select(.title == $t)] | sort_by(.state != "OPEN") | first // empty | "\(.number) \(.state)"' <<< "$existing")
  if [ -z "$found" ]; then
    if [ "$new" -ge "${MAX_NEW_AREA_ISSUES:-10}" ]; then
      echo "Cap reached: '$title' will be opened on a later run."
      echo "$label" >> "$REPORT_DIR/area-links.txt"
      jq -r '"- **\(.area)**: \(.gaps) \(if .gaps == 1 then "endpoint" else "endpoints" end) (its issue opens on a later run): " + ([(.endpoints // [])[] | "`" + . + "`"] | join(", "))' <<< "$entry" >> "$REPORT_DIR/area-index.md"
      continue
    fi
    url=$(gh issue create --title "$title" --body-file "$file" \
      --label missing-coverage --label auto-generated --label hub)
    new=$((new + 1))
  else
    num=${found% *}
    state=${found#* }
    [ "$state" = "OPEN" ] || gh issue reopen "$num"
    gh issue edit "$num" --body-file "$file"
    gh issue comment "$num" --body "Re-checked on $today: still missing. $RUN_URL"
    url="$REPO_URL/issues/$num"
  fi
  echo "<$url|$label>" >> "$REPORT_DIR/area-links.txt"
  jq -r --arg n "${url##*/}" '"- [ ] #\($n) **\(.area)**: \(.gaps) \(if .gaps == 1 then "endpoint" else "endpoints" end)"' <<< "$entry" >> "$REPORT_DIR/area-index.md"
done < <(jq -c '.[]' "$REPORT_DIR/areas.json")

# Close open area issues whose area no longer has a gap (the summary issue is not one).
jq -r --arg p "$prefix" --arg s "$ISSUE_TITLE" --arg x "$suffix" \
  '.[] | select(.state == "OPEN" and (.title | startswith($p)) and .title != $s and (.title | contains($x))) | "\(.number)\t\(.title)"' \
  <<< "$existing" | while IFS=$'\t' read -r num title; do
  if ! grep -qxF "$title" "$current"; then
    gh issue close "$num" --reason completed \
      --comment "Nothing is missing in this area any more in the weekly check on $today, so this is closed automatically."
  fi
done
