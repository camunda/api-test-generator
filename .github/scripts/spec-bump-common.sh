#!/usr/bin/env bash
# Shared helpers for the spec-bump-check scripts (open-pr / report / resolve),
# invoked by .github/workflows/spec-bump-check.yml. SOURCE this file (don't
# execute it): callers own `set -euo pipefail` and provide the environment
# (CONFIG, ISSUE_TITLE, GITHUB_*); these are pure functions/vars that read that
# environment at call time. Extracted so the gh lookups + list renderer live in
# one place (a change — like the `| head -1` → jq `first` fix — lands once).
#
# shellcheck shell=bash

# This workflow run's URL. GITHUB_* are provided by Actions; defaults keep this
# safe to source under `set -u` in a bare local run.
# shellcheck disable=SC2034  # consumed by the sourcing scripts, not this file
run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"

# The rolling auto-bump PR's branch for the active config.
bump_branch() { echo "chore/spec-bump-${CONFIG:?CONFIG required}"; }

# Number of the open rolling tracking issue whose title is exactly $ISSUE_TITLE,
# or empty. The first match is selected inside jq (`first // empty`) rather than
# piped to `head -1`: under `set -euo pipefail`, `head` closing the pipe can
# SIGPIPE the upstream gh/jq (non-zero exit) and abort the caller before cleanup.
find_rolling_issue() {
  gh issue list --state open --search "in:title \"${ISSUE_TITLE:?}\"" \
    --json number,title --jq "[.[] | select(.title == \"${ISSUE_TITLE}\") | .number] | first // empty"
}

# Number of the open rolling auto-bump PR for the active config, or empty.
find_bump_pr() {
  gh pr list --head "$(bump_branch)" --state open --json number --jq '.[0].number // empty'
}

# Render a newline-separated list as backtick-wrapped markdown bullets, capped at
# 50 lines with an "…and N more" suffix so a huge diff can't produce an oversized
# PR/issue body (and the cap is never silent). "_(none)_" for empty/whitespace.
list_or_none() {
  local lines total
  # Keep only non-empty lines; grep no-match exits 1 → || true under pipefail.
  lines=$(printf '%s\n' "$1" | grep -E '.' || true)
  if [ -z "$lines" ]; then
    echo "_(none)_"
    return
  fi
  total=$(printf '%s\n' "$lines" | grep -c . || true)
  # shellcheck disable=SC2016  # literal backticks for markdown, no expansion wanted
  printf '%s\n' "$lines" | head -50 | sed 's/^/- `/;s/$/`/' || true
  if [ "$total" -gt 50 ]; then
    echo "- …and $((total - 50)) more"
  fi
}
