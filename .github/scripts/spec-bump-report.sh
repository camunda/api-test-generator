#!/usr/bin/env bash
# Open or update the single rolling "spec-bump drift" tracking issue for
# camunda-oca. Called by .github/workflows/spec-bump-dryrun.yml only when a
# drift signal is present (generation/invariants broke, or the operation
# surface changed). Idempotent: one issue, found by exact title; re-runs edit
# it in place and drop a fresh dated comment rather than opening duplicates.
#
# Required env: GH_TOKEN, PINNED, LATEST, N_ADDED, N_REMOVED, ADDED, REMOVED,
# GEN_OUTCOME, INV_OUTCOME. GitHub provides GITHUB_* automatically.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN required for gh auth}"
: "${ISSUE_TITLE:?}" "${DRIFT_LABEL:?}" "${UPSTREAM_REPO:?}" "${UPSTREAM_BRANCH:?}"
: "${PINNED:?}" "${LATEST:?}"
N_ADDED="${N_ADDED:-0}"
N_REMOVED="${N_REMOVED:-0}"
GEN_OUTCOME="${GEN_OUTCOME:-unknown}"
INV_OUTCOME="${INV_OUTCOME:-unknown}"

run_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
compare_url="https://github.com/${UPSTREAM_REPO}/compare/${PINNED}...${LATEST}"

emoji() { [ "$1" = "success" ] && echo "✅" || echo "❌"; }

# --- Build the body ---------------------------------------------------------
list_or_none() {
  local lines total
  # Keep only non-empty lines. Treats an empty OR whitespace-only value (e.g. a
  # stray newline from a multiline step output) as "none". grep no-match exits 1
  # — || true keeps that non-fatal under `set -euo pipefail`.
  lines=$(printf '%s\n' "$1" | grep -E '.' || true)
  if [ -z "$lines" ]; then
    echo "_(none)_"
    return
  fi
  total=$(printf '%s\n' "$lines" | grep -c . || true)
  # Cap the printed list so a huge diff can't produce an oversized issue body.
  # head closes the pipe after 50 lines (SIGPIPE upstream) — || true guards it.
  # shellcheck disable=SC2016  # literal backticks for markdown, no expansion wanted
  printf '%s\n' "$lines" | head -50 | sed 's/^/- `/;s/$/`/' || true
  if [ "$total" -gt 50 ]; then
    echo "- …and $((total - 50)) more"
  fi
}

body_file="$(mktemp)"
{
  echo "The scheduled dry-run fetched \`${UPSTREAM_REPO}@${UPSTREAM_BRANCH}\` and ran the camunda-oca generate pipeline + regression invariants against it. It drifted from the pin — details below. This issue is updated in place on every run and closed automatically once latest flows through cleanly again."
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| Pinned | \`${PINNED}\` |"
  echo "| Latest \`${UPSTREAM_BRANCH}\` | \`${LATEST}\` ([compare](${compare_url})) |"
  echo "| Generate pipeline | $(emoji "$GEN_OUTCOME") \`${GEN_OUTCOME}\` |"
  echo "| Regression invariants | $(emoji "$INV_OUTCOME") \`${INV_OUTCOME}\` |"
  echo "| Operations added / removed | ${N_ADDED} / ${N_REMOVED} |"
  echo
  echo "🆕 **Added operations** (new upstream surface to model):"
  list_or_none "${ADDED:-}"
  echo
  echo "🗑️ **Removed operations:**"
  list_or_none "${REMOVED:-}"
  echo
  echo "🔎 [Full logs + generated-output artifact](${run_url})"
  echo
  echo "---"
  echo "**To adopt this bump** (see \`tests/regression/spec-pin.setup.ts\` for the full procedure): re-fetch with \`SPEC_REF=${LATEST} npm run fetch-spec:ref\`, regenerate, update \`configs/camunda-oca/spec-pin.json\` + any legitimately-changed invariants, and commit. If it isn't ready to adopt, this is the heads-up to model the new surface first."
} > "$body_file"

# --- Ensure the label exists (best-effort) ----------------------------------
gh label create "$DRIFT_LABEL" --color BFD4F2 --description "Upstream spec drifted from the pin (spec-bump dry-run)" 2>/dev/null || true

# --- Find the rolling issue by exact title ----------------------------------
existing="$(gh issue list --state open --search "in:title \"${ISSUE_TITLE}\"" \
  --json number,title --jq "[.[] | select(.title == \"${ISSUE_TITLE}\") | .number] | first // empty")"

if [ -n "$existing" ]; then
  echo "Updating existing tracking issue #${existing}"
  gh issue edit "$existing" --body-file "$body_file" >/dev/null
  gh issue comment "$existing" --body "🔁 Re-checked against \`${LATEST}\` — still drifted (generate: \`${GEN_OUTCOME}\`, invariants: \`${INV_OUTCOME}\`, +${N_ADDED}/-${N_REMOVED} ops). [Run](${run_url})" >/dev/null
else
  echo "Opening new tracking issue"
  gh issue create --title "$ISSUE_TITLE" --body-file "$body_file" --label "$DRIFT_LABEL" >/dev/null
fi

# Close a stale auto-bump PR if one is open: we're on the issue path because
# latest no longer flows through cleanly (or no App token), so a pin-bump PR
# pointing at an older clean SHA would be misleading.
if [ -n "${CONFIG:-}" ]; then
  bump_branch="chore/spec-bump-${CONFIG}"
  bump_pr="$(gh pr list --head "$bump_branch" --state open --json number --jq '.[0].number // empty')"
  if [ -n "$bump_pr" ]; then
    gh pr close "$bump_pr" \
      --comment "Latest no longer flows through cleanly (see the tracking issue) — closing this auto-bump PR until it's green again." >/dev/null || true
    echo "Closed stale bump PR #${bump_pr}."
  fi
fi
