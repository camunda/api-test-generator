#!/usr/bin/env bash
# Core logic for hub-known-issue-reenable-check.yml (#432): detect camunda-hub
# blocker issues that have closed since a suppress/exclude entry referenced
# them, and for each one, remove the matching entries + open a draft PR so a
# human (backed by an automatic live-Hub validation run) can confirm the
# operation is safe to re-enable.
#
# Deliberately fully deterministic — no LLM/agent judgment anywhere. Detecting
# "is this issue closed" and "remove this JSON entry" are both pure mechanics;
# see the plan/AGENTS.md note on why this isn't built as an agent extension.
#
# Required env: GH_TOKEN_HUB (Issues:read on camunda-hub — may be empty, this
# script degrades gracefully), GH_TOKEN_GENERATOR (contents+PR write on
# api-test-generator — may be empty, blocks only the PR-opening step).
# Run from the repo root.
#
# Never hard-fails the run: every external call (gh, npm) that legitimately
# can fail keeps going to the next candidate rather than aborting the script.
set -uo pipefail

POSITIVE_SUPPRESS=configs/camunda-hub/positive-suppress.json
REQUEST_VALIDATION=configs/camunda-hub/request-validation.json
HUB_REPO=camunda/camunda-hub
GEN_REPO=camunda/api-test-generator
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUMMARY_FILE="${SUMMARY_FILE:-/tmp/hub-reenable-summary.json}"
summary_actions='[]' # accumulated as we go; each item: {type, url, title, ...}

add_summary() {
  # $1: a JSON object literal (already valid JSON) to append.
  summary_actions="$(jq -c --argjson item "$1" '. + [$item]' <<<"$summary_actions")"
}

echo "== Collecting knownIssue entries =="
collected="$(node "${SCRIPT_DIR}/hub-collect-known-issues.mjs" "$POSITIVE_SUPPRESS" "$REQUEST_VALIDATION")"
op_scoped_count=$(jq '.opScoped | length' <<<"$collected")
suite_wide_count=$(jq '.suiteWide | length' <<<"$collected")
echo "Op-scoped blockers: ${op_scoped_count}, suite-wide (no operationId): ${suite_wide_count}"

# --- Suite-wide knownIssues[] — report-only, never acted on -----------------
if [ "$suite_wide_count" -gt 0 ]; then
  while IFS= read -r item; do
    url=$(jq -r '.url' <<<"$item")
    summary=$(jq -r '.summary' <<<"$item")
    if [ -z "${GH_TOKEN_HUB:-}" ]; then
      echo "No GH_TOKEN_HUB — skipping state check for suite-wide ${url}"
      continue
    fi
    state=$(GH_TOKEN="$GH_TOKEN_HUB" gh issue view "$url" --repo "$HUB_REPO" --json state --jq .state 2>/dev/null || true)
    echo "suite-wide: ${url} -> ${state:-unresolved}"
    if [ "$state" = "CLOSED" ]; then
      add_summary "$(jq -nc --arg url "$url" --arg summary "$summary" \
        '{type: "suite_wide_closed", url: $url, summary: $summary}')"
    fi
  done < <(jq -c '.suiteWide[]' <<<"$collected")
fi

# --- Op-scoped blockers — the actionable path -------------------------------
while IFS= read -r group; do
  url=$(jq -r '.url' <<<"$group")
  issue_num="${url##*/}"

  if [ -z "${GH_TOKEN_HUB:-}" ]; then
    echo "No GH_TOKEN_HUB — cannot resolve state for ${url}, skipping."
    continue
  fi

  view_json=$(GH_TOKEN="$GH_TOKEN_HUB" gh issue view "$url" --repo "$HUB_REPO" --json state,title 2>/dev/null || true)
  if [ -z "$view_json" ]; then
    echo "::warning::Could not resolve state for ${url} (empty/403?) — skipping, will retry next run."
    continue
  fi
  state=$(jq -r '.state' <<<"$view_json")
  title=$(jq -r '.title' <<<"$view_json")
  echo "op-scoped: ${url} (${title}) -> ${state}"
  if [ "$state" != "CLOSED" ]; then
    continue
  fi

  ops="$(jq -r '.entries | map(.operationId) | unique | join(", ")' <<<"$group")"
  branch="chore/hub-unskip-${issue_num}"

  # Checked BEFORE any removal/regenerate work (not just before the eventual
  # `gh pr create`) — there is no point running the whole regenerate + test
  # cycle only to discover at the end we have no way to open the PR. Also
  # required for the dedupe lookup right below: without an explicit token,
  # `gh pr list` has no ambient auth in this workflow's minimal-permissions
  # GITHUB_TOKEN context, fails, and its `|| true` fallback would silently
  # read as "no existing PR" even when one is open — reusing
  # GH_TOKEN_GENERATOR here (same token the eventual PR creation needs) makes
  # the dedupe check itself reliable, not just gated on it existing.
  if [ -z "${GH_TOKEN_GENERATOR:-}" ]; then
    echo "::warning::No GH_TOKEN_GENERATOR — cannot check for or open an unskip PR for ${url}."
    add_summary "$(jq -nc --arg url "$url" --arg title "$title" --arg ops "$ops" \
      '{type: "aborted_no_token", url: $url, title: $title, operations: $ops}')"
    continue
  fi

  existing_pr="$(GH_TOKEN="$GH_TOKEN_GENERATOR" gh pr list --repo "$GEN_REPO" --head "$branch" --state open --json url --jq '.[0].url // empty' 2>/dev/null || true)"
  if [ -n "$existing_pr" ]; then
    echo "Blocker ${url} already has an open unskip PR: ${existing_pr}"
    add_summary "$(jq -nc --arg url "$url" --arg title "$title" --arg pr "$existing_pr" --arg ops "$ops" \
      '{type: "already_in_flight", url: $url, title: $title, pr_url: $pr, operations: $ops}')"
    continue
  fi

  # (No separate "already removed?" pre-check needed: hub-collect-known-issues.mjs
  # read the config files fresh at the top of this script, so a blocker whose
  # entries were already removed by a prior, since-merged run would never
  # appear in $collected in the first place.)
  echo "Blocker ${url} is CLOSED — attempting to re-enable: ${ops}"

  # --- Remove the entries (scratch working tree, not yet committed) --------
  removed_ops=""
  while IFS=$'\t' read -r file arrayKey _operationId; do
    out="$(node "${SCRIPT_DIR}/hub-remove-known-issue-entries.mjs" "$file" "$arrayKey" "$url" 2>&1)"
    rc=$?
    if [ $rc -ne 0 ]; then
      echo "::warning::Failed removing entries from ${file} for ${url}: ${out}"
    elif [ -n "$out" ]; then
      removed_ops="${removed_ops}${out}"$'\n'
    fi
  done < <(jq -r '.entries[] | [.file, .arrayKey, .operationId] | @tsv' <<<"$group" | sort -u -t $'\t' -k1,2)

  if [ -z "$removed_ops" ]; then
    echo "::warning::Blocker ${url}: expected to remove entries but nothing changed — skipping."
    git checkout -- "$POSITIVE_SUPPRESS" "$REQUEST_VALIDATION" 2>/dev/null || true
    continue
  fi

  # --- Regenerate + narrow local guard before committing anything ----------
  echo "Regenerating camunda-hub + running local guards for ${url}..."
  if CONFIG=camunda-hub npm run testsuite:generate >/tmp/hub-reenable-generate.log 2>&1 \
    && CONFIG=camunda-hub npm run generate:request-validation >>/tmp/hub-reenable-generate.log 2>&1 \
    && CONFIG=camunda-hub npx vitest run configs/camunda-hub/regression-invariants.test.ts \
         tests/codegen/known-issue-summary-consistency.test.ts >>/tmp/hub-reenable-generate.log 2>&1; then
    checks_ok=true
  else
    checks_ok=false
  fi

  if [ "$checks_ok" != "true" ]; then
    echo "::warning::Blocker ${url}: re-enabling broke local generate/tests — see /tmp/hub-reenable-generate.log. Reverting, NOT opening a PR."
    git checkout -- "$POSITIVE_SUPPRESS" "$REQUEST_VALIDATION" 2>/dev/null || true
    add_summary "$(jq -nc --arg url "$url" --arg title "$title" --arg ops "$ops" \
      '{type: "aborted_broke_checks", url: $url, title: $title, operations: $ops}')"
    continue
  fi

  # GH_TOKEN_GENERATOR is already confirmed non-empty (checked before the
  # dedupe lookup above, before any of this removal/regenerate work started).

  # --- Commit, push, open the draft PR --------------------------------------
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git checkout -B "$branch"
  git add "$POSITIVE_SUPPRESS" "$REQUEST_VALIDATION"
  git commit -m "chore(hub-unskip): re-enable ${ops} — camunda-hub#${issue_num} closed

camunda-hub#${issue_num} (\"${title}\") is closed. This removes the
suppress/exclude entries that were blocked on it, so the following
operation(s) get their tests back: ${ops}." >/dev/null

  git config --local --unset-all 'http.https://github.com/.extraheader' 2>/dev/null || true
  git remote set-url origin "https://x-access-token:${GH_TOKEN_GENERATOR}@github.com/${GEN_REPO}.git"
  git push --force origin "$branch"

  body_file="$(mktemp)"
  {
    echo "camunda-hub#${issue_num} (\"${title}\") is now **closed**. This removes the"
    echo "suppress/exclude entries that were blocked on it:"
    echo
    # shellcheck disable=SC2016  # literal backticks for markdown, no expansion wanted
    printf '%s\n' "$removed_ops" | sed '/^$/d' | sed 's/^/- `/; s/$/`/'
    echo
    echo "This PR is a **draft** — it is not ready to merge on its own. The native"
    echo "\`Hub PR live check\` (see the Checks tab) runs automatically against a live"
    echo "Hub; if the upstream fix was only partial, that check will fail and someone"
    echo "should investigate before merging."
    echo
    echo "Closed blocker: ${url}"
    echo
    echo "🤖 Opened by the hub-known-issue-reenable-check workflow (#432)."
  } > "$body_file"

  GH_TOKEN="$GH_TOKEN_GENERATOR" gh label create nightly-api-fix --repo "$GEN_REPO" --color FF4444 \
    --description "Bot-opened fix PR for a nightly triage finding (test-generation bug or coverage gap)" 2>/dev/null || true

  pr_url="$(GH_TOKEN="$GH_TOKEN_GENERATOR" gh pr create --repo "$GEN_REPO" --base main --head "$branch" --draft \
    --title "chore(nightly): re-enable ${ops} — camunda-hub#${issue_num} closed" \
    --body-file "$body_file" --label nightly-api-fix 2>&1)"
  create_rc=$?
  rm -f "$body_file"

  if [ $create_rc -ne 0 ]; then
    echo "::warning::Could not open unskip PR for ${url}: ${pr_url}"
    add_summary "$(jq -nc --arg url "$url" --arg title "$title" --arg ops "$ops" --arg err "$pr_url" \
      '{type: "aborted_pr_create_failed", url: $url, title: $title, operations: $ops, error: $err}')"
    git checkout main 2>/dev/null || true
    continue
  fi

  echo "Opened unskip PR: ${pr_url}"
  add_summary "$(jq -nc --arg url "$url" --arg title "$title" --arg ops "$ops" --arg pr "$pr_url" \
    '{type: "opened", url: $url, title: $title, operations: $ops, pr_url: $pr}')"

  # No manual live-Hub validation dispatch needed here: hub-pr-live-check.yml
  # already fires automatically on this PR (same-repo, targets main, touches
  # only configs/camunda-hub/*.json — never .github/**) as a native check.

  git checkout main 2>/dev/null || true
done < <(jq -c '.opScoped[]' <<<"$collected")

echo "$summary_actions" > "$SUMMARY_FILE"
echo "== Summary written to ${SUMMARY_FILE} =="
cat "$SUMMARY_FILE"
