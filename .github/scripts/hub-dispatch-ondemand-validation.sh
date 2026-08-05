#!/usr/bin/env bash
# Dispatch hub-ondemand-test.yml (a live-Hub run) against every PR URL read
# from stdin (one per line), then comment the run link back on the PR.
# Extracted from triage-camunda-hub-nightly.yml's "Trigger on-demand
# validation for any opened fix/suppress PR" step so a second caller
# (hub-known-issue-reenable-check.yml) doesn't need its own copy of this
# logic — see AGENTS.md's standing rule against parallel implementations
# that drift.
#
# Required env: GH_TOKEN (must have contents:write + pull-requests:write on
# $REPO, and permission to dispatch workflows there — the qa-processes App
# token both current callers use). Optional: REPO (default
# camunda/api-test-generator).
#
# Never fails the run: every step here is continue-on-error at the shell
# level (the caller is expected to also wrap this in continue-on-error, but
# this script degrades gracefully even without that).
set -uo pipefail

: "${GH_TOKEN:?GH_TOKEN (App/PAT with contents+PR write + workflow dispatch) required}"
REPO="${REPO:-camunda/api-test-generator}"

urls="$(cat)"
if [ -z "$urls" ]; then
  echo "No PR URLs to validate."
  exit 0
fi

pr_url_re="^https://github\\.com/${REPO}/pull/[0-9]+\$"

while IFS= read -r pr_url; do
  [ -z "$pr_url" ] && continue
  # The caller may be feeding this URLs sourced from untrusted content (e.g.
  # an agent's triage JSON) — validate the URL is exactly a well-formed PR
  # URL on $REPO before deriving anything from it. $REPO itself is never
  # derived from $pr_url, so this can't redirect gh calls to a different
  # repo, but an unvalidated value could still resolve to an unrelated real
  # PR number on THIS repo and cause a dispatch/comment against the wrong
  # branch.
  if ! [[ "$pr_url" =~ $pr_url_re ]]; then
    echo "::warning::Skipping malformed/unexpected PR URL: ${pr_url}"
    continue
  fi
  pr_num="${pr_url##*/}"
  echo "Validating PR #${pr_num} (${pr_url})"

  branch=$(gh pr view "$pr_num" --repo "$REPO" --json headRefName --jq .headRefName 2>/dev/null || true)
  if [ -z "$branch" ]; then
    echo "::warning::Could not resolve branch for ${pr_url} — skipping validation dispatch."
    continue
  fi

  # SECURITY: `gh workflow run ... --ref "$branch"` runs hub-ondemand-test.yml
  # AS IT EXISTS ON THAT BRANCH, not the version on main — and that workflow
  # calls _hub-suite-run.yml with real VAULT_* secrets. A PR that also edits
  # .github/** would have its own modified workflow code execute with
  # production secrets, no human review required, if this dispatched blindly.
  # Refuse to dispatch — fail CLOSED (skip) if we can't even determine the
  # changed files, since the cost of an unnecessary manual dispatch is
  # trivial next to the cost of a wrong guess here.
  if changed=$(gh pr diff "$pr_num" --repo "$REPO" --name-only 2>/dev/null); then
    touches_github=false
    grep -qE '^\.github/' <<<"$changed" && touches_github=true
  else
    echo "::warning::Could not fetch changed-files list for ${pr_url} — assuming it may touch .github/** out of caution."
    touches_github=true
  fi
  if [ "$touches_github" = true ]; then
    echo "::warning::PR #${pr_num} changes .github/** (or its changed files couldn't be verified) — skipping auto-validation dispatch; a human must review and dispatch it manually."
    gh pr comment "$pr_num" --repo "$REPO" \
      --body ":warning: This PR touches \`.github/**\` (or its changed files could not be verified), so automatic on-demand validation was skipped for safety — dispatching \`hub-ondemand-test.yml\` runs *this branch's own* workflow code with production secrets. A maintainer must review the workflow changes and dispatch it manually before merging." \
      2>/dev/null || true
    continue
  fi

  if ! gh workflow run hub-ondemand-test.yml --repo "$REPO" --ref "$branch"; then
    echo "::warning::Could not dispatch hub-ondemand-test.yml for ${pr_url}"
    gh pr comment "$pr_num" --repo "$REPO" \
      --body ":warning: Could not auto-dispatch on-demand validation (\`hub-ondemand-test.yml\`) for this PR — please trigger it manually against this branch before merging (it starts a live Hub and runs the real suite; \`hub-invariants\` on this PR only checks static invariants against the pinned spec, not a live run)." \
      2>/dev/null || true
    continue
  fi

  # workflow_run creation isn't synchronous with the dispatch call — poll
  # briefly for the run this dispatch just created.
  run_url=""
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 3
    run_id=$(gh run list --repo "$REPO" --workflow=hub-ondemand-test.yml --branch "$branch" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)
    if [ -n "$run_id" ]; then
      run_url="https://github.com/${REPO}/actions/runs/${run_id}"
      break
    fi
  done

  # shellcheck disable=SC2016  # literal backticks for markdown, no expansion wanted
  note_body=$(if [ -n "$run_url" ]; then
    printf '🔎 **On-demand validation**: [hub-ondemand-test run](%s) — dispatched automatically. This confirms the change actually passes against a live Hub, not just static invariants (which is all `hub-invariants` on this PR checks).' "$run_url"
  else
    printf '⚠️ Dispatched `hub-ondemand-test.yml` for validation but could not resolve the run URL within the poll window — check the Actions tab for branch `%s`.' "$branch"
  fi)
  gh pr comment "$pr_num" --repo "$REPO" --body "$note_body" 2>/dev/null \
    || echo "::warning::Could not comment validation link on #${pr_num}"
done <<< "$urls"
