#!/usr/bin/env bash
# Opens, rewrites, reopens or closes the one summary issue of the weekly Hub response coverage
# report. Run by .github/workflows/hub-response-coverage.yml; tested against a stub `gh` in
# tests/request-validation/hub-gap-issue.test.ts.
#
# Inputs (environment): ISSUE_TITLE, REPORT_DIR (holds issue.md, and area-index.md when the per-area
# script ran first), REPO_URL, RUN_URL. The tracking issue is an index: the marker line in issue.md is
# replaced by the contents of area-index.md (one line per area, linking its issue).
# Writes REPORT_DIR/issue-url.txt when there is an issue the Slack message should link to.
set -euo pipefail

# All states, open first: a gap that comes back after the issue was closed reopens that issue
# instead of starting a second one.
found=$(gh issue list --state all --limit 100 --search "in:title \"$ISSUE_TITLE\"" \
  --json number,title,state \
  --jq "[.[] | select(.title == \"$ISSUE_TITLE\")] | sort_by(.state != \"OPEN\") | first // empty | \"\\(.number) \\(.state)\"")
num=${found% *}
state=${found#* }

if [ -s "$REPORT_DIR/issue.md" ]; then
  touch "$REPORT_DIR/area-index.md"
  # awk, not shell substitution: the index holds backticks, #-references and &.
  # Matching on the file name, not on FNR == NR: with an empty index file that test is also true
  # for the issue itself, which would then be swallowed.
  awk -v marker='<!-- AREA_INDEX -->' -v indexfile="$REPORT_DIR/area-index.md" \
    'FILENAME == indexfile { index_text = index_text $0 "\n"; next }
    $0 == marker { printf "%s", index_text; next } { print }' \
    "$REPORT_DIR/area-index.md" "$REPORT_DIR/issue.md" > "$REPORT_DIR/issue.rendered.md"
  if [ -z "$found" ]; then
    url=$(gh issue create --title "$ISSUE_TITLE" --body-file "$REPORT_DIR/issue.rendered.md" \
      --label missing-coverage --label auto-generated --label hub)
  else
    [ "$state" = "OPEN" ] || gh issue reopen "$num"
    gh issue edit "$num" --body-file "$REPORT_DIR/issue.rendered.md"
    gh issue comment "$num" --body "Re-checked on $(date -u +%F): still missing. See the updated list above. $RUN_URL"
    url="$REPO_URL/issues/$num"
  fi
  echo "$url" > "$REPORT_DIR/issue-url.txt"
elif [ -n "$found" ] && [ "$state" = "OPEN" ]; then
  gh issue close "$num" --reason completed \
    --comment "Nothing is missing any more in the weekly check on $(date -u +%F), so this is closed automatically."
  echo "$REPO_URL/issues/$num" > "$REPORT_DIR/issue-url.txt"
fi
