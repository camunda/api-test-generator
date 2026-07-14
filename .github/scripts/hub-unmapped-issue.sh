#!/usr/bin/env bash
# Rolling tracking issue for camunda-hub unmapped spec operations (#471 follow-up).
#
# Single issue found by exact title (same pattern as spec-bump-check.yml's
# tracking issue) — no duplicate spam across nightly runs. Opens when
# summary.unmappedOperations is non-empty, updates the body if the list
# changed, closes it once the list is empty again.
set -euo pipefail

ISSUE_TITLE='camunda-hub: unmapped spec operations have no generated test coverage'
RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

unmapped="$(python3 -c "
import json
try:
    d = json.load(open('generated/camunda-hub/playwright/coverage.json'))
    print(', '.join(d.get('summary', {}).get('unmappedOperations', [])))
except Exception:
    pass
")"

existing_num="$(gh issue list --state open --search "in:title \"${ISSUE_TITLE}\"" \
  --json number,title --jq "[.[] | select(.title == \"${ISSUE_TITLE}\")] | .[0].number // empty")"

if [ -z "$unmapped" ]; then
  if [ -n "$existing_num" ]; then
    gh issue comment "$existing_num" --body "Resolved — the latest nightly run found no unmapped operations. [Run]($RUN_URL)"
    gh issue close "$existing_num"
    echo "Closed #${existing_num} (unmapped list is now empty)."
  else
    echo "No unmapped operations, no tracking issue open — nothing to do."
  fi
  exit 0
fi

body="Spec operation(s) with zero generated test coverage — no entity-kind or scenario-template maps them, and they aren't in \`positive-suppress.json\` either. Run \`npm run coverage:report\` locally for details.

**Unmapped:** \`${unmapped}\`

[Latest run]($RUN_URL)"

if [ -n "$existing_num" ]; then
  gh issue comment "$existing_num" --body "Still unmapped as of the latest nightly run.

**Unmapped:** \`${unmapped}\`

[Run]($RUN_URL)"
  echo "Updated #${existing_num}."
else
  url="$(gh issue create --title "$ISSUE_TITLE" --body "$body")"
  echo "Opened ${url}."
fi
