#!/usr/bin/env bash
# Open or update the single rolling "spec-bump drift" tracking issue for the
# active config (CONFIG). Called by .github/workflows/spec-bump-check.yml only
# when a drift signal is present (generation/invariants broke, or the operation
# surface changed). Idempotent: one issue per config, found by exact title;
# re-runs edit it in place and drop a fresh dated comment rather than opening
# duplicates.
#
# Required env: GH_TOKEN, CONFIG, ISSUE_TITLE, DRIFT_LABEL, UPSTREAM_REPO,
# UPSTREAM_BRANCH, PINNED, LATEST, N_ADDED, N_REMOVED, ADDED, REMOVED,
# GEN_OUTCOME, INV_OUTCOME. Optional: UNMAPPED (comma-separated operationIds
# with no generated test coverage — see the "Check for unmapped operations"
# step; empty when generate didn't succeed or nothing's unmapped). GitHub
# provides GITHUB_* automatically.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN required for gh auth}"
: "${ISSUE_TITLE:?}" "${DRIFT_LABEL:?}" "${UPSTREAM_REPO:?}" "${UPSTREAM_BRANCH:?}"
: "${CONFIG:?}" "${PINNED:?}" "${LATEST:?}"
N_ADDED="${N_ADDED:-0}"
N_REMOVED="${N_REMOVED:-0}"
GEN_OUTCOME="${GEN_OUTCOME:-unknown}"
INV_OUTCOME="${INV_OUTCOME:-unknown}"
UNMAPPED="${UNMAPPED:-}"

# shellcheck source=.github/scripts/spec-bump-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/spec-bump-common.sh"

compare_url="https://github.com/${UPSTREAM_REPO}/compare/${PINNED}...${LATEST}"

emoji() { [ "$1" = "success" ] && echo "✅" || echo "❌"; }

# --- Build the body ---------------------------------------------------------
body_file="$(mktemp)"
{
  echo "The scheduled check fetched \`${UPSTREAM_REPO}@${UPSTREAM_BRANCH}\` and ran the ${CONFIG} generate pipeline + regression invariants against it. It drifted from the pin — details below. This issue is updated in place on every run and closed automatically once latest flows through cleanly again."
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| Pinned | \`${PINNED}\` |"
  echo "| Latest \`${UPSTREAM_BRANCH}\` | \`${LATEST}\` ([compare](${compare_url})) |"
  echo "| Generate pipeline | $(emoji "$GEN_OUTCOME") \`${GEN_OUTCOME}\` |"
  echo "| Regression invariants | $(emoji "$INV_OUTCOME") \`${INV_OUTCOME}\` |"
  echo "| Unmapped (uncovered) operations | $([ -n "$UNMAPPED" ] && echo "❌ ${UNMAPPED}" || echo "✅ none") |"
  echo "| Operations added / removed | ${N_ADDED} / ${N_REMOVED} |"
  echo
  if [ -n "$UNMAPPED" ]; then
    echo "⚠️ **Generate and invariants both passed, but this is still not safe to auto-adopt**: \`${UNMAPPED}\` has no generated test coverage at all (no entity-kind/scenario-template maps it, and it's not in \`positive-suppress.json\` either) — model it before bumping, or add it to the suppress list with a tracked reason."
    echo
  fi
  echo "🆕 **Added operations** (new upstream surface to model):"
  list_or_none "${ADDED:-}"
  echo
  echo "🗑️ **Removed operations:**"
  list_or_none "${REMOVED:-}"
  echo
  echo "🔎 [Full logs + generated-output artifact](${run_url})"
  echo
  echo "---"
  echo "**To adopt this bump**: re-pin with \`npm run bump-spec-pin -- --config ${CONFIG} --ref ${LATEST}\` (the single source of truth for pin writes), regenerate, update \`configs/${CONFIG}/spec-pin.json\` + any legitimately-changed invariants, and commit. See \`README.md → Spec pin → Bumping the spec pin\`. If it isn't ready to adopt, this is the heads-up to model the new surface first."
} > "$body_file"

# --- Ensure the labels exist (best-effort) -----------------------------------
# spec-drift + auto-generated always apply (this issue is only ever opened by
# the check, never a human); missing-coverage is added/removed below depending
# on whether THIS run's blocker is an uncovered operation (#475's gate).
gh label create "$DRIFT_LABEL" --color BFD4F2 --description "Upstream spec drifted from the pin (spec-bump check)" 2>/dev/null || true
gh label create auto-generated --color ededed --description "Opened by automation, not a human" 2>/dev/null || true
gh label create missing-coverage --color D93F0B --description "A spec operation has no generated test coverage" 2>/dev/null || true

# --- Find the rolling issue by exact title ----------------------------------
existing="$(find_rolling_issue)"

if [ -n "$existing" ]; then
  echo "Updating existing tracking issue #${existing}"
  gh issue edit "$existing" --body-file "$body_file" >/dev/null
  # Re-add spec-drift + auto-generated on every update too, not just at
  # creation — self-heals an issue opened before this change (or one a human
  # accidentally un-labeled), so it doesn't stay permanently unlabeled.
  # Best-effort (labeling is an auxiliary signal): a transient API error or a
  # label that failed to create above must not abort the issue update itself.
  gh issue edit "$existing" --add-label "$DRIFT_LABEL" --add-label auto-generated >/dev/null || true
  # Sync missing-coverage to THIS run's state — add it when unmapped ops are
  # the blocker, remove it if a later run clears them but the issue stays open
  # for another reason (e.g. invariants still broken). Both best-effort, same
  # reasoning as above; --remove-label on a label the issue doesn't have is a
  # no-op anyway, not an error.
  if [ -n "$UNMAPPED" ]; then
    gh issue edit "$existing" --add-label missing-coverage >/dev/null || true
  else
    gh issue edit "$existing" --remove-label missing-coverage >/dev/null 2>&1 || true
  fi
  gh issue comment "$existing" --body "🔁 Re-checked against \`${LATEST}\` — still drifted (generate: \`${GEN_OUTCOME}\`, invariants: \`${INV_OUTCOME}\`, unmapped: \`${UNMAPPED:-none}\`, +${N_ADDED}/-${N_REMOVED} ops). [Run](${run_url})" >/dev/null
else
  echo "Opening new tracking issue"
  # Create with only the always-present labels — if missing-coverage's create
  # failed above (label create is itself best-effort), --label missing-coverage
  # here would fail the WHOLE issue creation, losing the tracking issue
  # entirely rather than just the label. Add it separately, best-effort, after.
  new_url="$(gh issue create --title "$ISSUE_TITLE" --body-file "$body_file" --label "$DRIFT_LABEL" --label auto-generated)"
  echo "Opened ${new_url}"
  if [ -n "$UNMAPPED" ]; then
    gh issue edit "${new_url##*/}" --add-label missing-coverage >/dev/null || true
  fi
fi

# Close a stale auto-bump PR if one is open: we're on the issue path because
# latest no longer flows through cleanly (or no App token), so a pin-bump PR
# pointing at an older clean SHA would be misleading.
if [ -n "${CONFIG:-}" ]; then
  bump_pr="$(find_bump_pr)"
  if [ -n "$bump_pr" ]; then
    gh pr close "$bump_pr" \
      --comment "Latest no longer flows through cleanly (see the tracking issue) — closing this auto-bump PR until it's green again." >/dev/null || true
    echo "Closed stale bump PR #${bump_pr}."
  fi
fi
