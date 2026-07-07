#!/usr/bin/env bash
# Close the rolling "spec-bump drift" tracking issue when latest upstream main
# flows through the active config's pipeline cleanly (generate + invariants
# pass, operation surface unchanged), or when there's no meaningful drift.
# Called by spec-bump-check.yml for both configs. No-op if no such issue is open.
#
# Required env: GH_TOKEN, LATEST. GitHub provides GITHUB_* automatically.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN required for gh auth}"
: "${ISSUE_TITLE:?}" "${LATEST:?}"

# shellcheck source=.github/scripts/spec-bump-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/spec-bump-common.sh"

existing="$(find_rolling_issue)"

if [ -n "$existing" ]; then
  echo "Closing tracking issue #${existing} — latest now flows through cleanly."
  gh issue close "$existing" \
    --comment "✅ ${CONFIG:-config} is clean against latest \`${LATEST}\` (the pin is at latest, or latest flows through generate + invariants with no operation-surface change) — closing. [Run](${run_url})" >/dev/null
else
  echo "No open tracking issue — nothing to close."
fi

# Also close the rolling auto-bump PR if open: no drift means the pin is already
# at latest (the bump was adopted, or never needed).
if [ -n "${CONFIG:-}" ]; then
  bump_pr="$(find_bump_pr)"
  if [ -n "$bump_pr" ]; then
    gh pr close "$bump_pr" \
      --comment "Pin is at latest (no drift) — closing this auto-bump PR." >/dev/null || true
    echo "Closed auto-bump PR #${bump_pr}."
  fi
fi
