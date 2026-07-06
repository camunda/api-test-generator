#!/usr/bin/env bash
# Close the rolling "spec-bump drift" tracking issue when latest upstream main
# flows through the camunda-oca pipeline cleanly (generate + invariants pass,
# operation surface unchanged). Called by spec-bump-dryrun.yml. No-op if no
# such issue is open.
#
# Required env: GH_TOKEN, LATEST. GitHub provides GITHUB_* automatically.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN required for gh auth}"
: "${ISSUE_TITLE:?}" "${LATEST:?}"
run_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

existing="$(gh issue list --state open --search "in:title \"${ISSUE_TITLE}\"" \
  --json number,title --jq ".[] | select(.title == \"${ISSUE_TITLE}\") | .number" | head -1)"

if [ -n "$existing" ]; then
  echo "Closing tracking issue #${existing} — latest now flows through cleanly."
  gh issue close "$existing" \
    --comment "✅ camunda-oca is clean against latest \`${LATEST}\` (the pin is at latest, or latest flows through generate + invariants with no operation-surface change) — closing. [Run](${run_url})" >/dev/null
else
  echo "No open tracking issue — nothing to close."
fi
