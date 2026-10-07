#!/usr/bin/env bash
# Write the open `nightly-api-fix` PRs of this repo, with their diffs, as a JSON array of
# {number, url, diff} to the file given as $1 ([] when there are none). An agent searches the
# diffs to avoid opening a second PR for work that is already in flight.
#
# Needs GH_TOKEN with pull-requests: read. Prints a warning and writes what it could read when a
# listing or a diff fails: the caller's own limits (hub-coverage-fix-select.ts) do not depend on it.
set -euo pipefail

out="${1:?usage: hub-open-fix-prs.sh <out.json>}"
repo="${GITHUB_REPOSITORY:-camunda/api-test-generator}"
acc="$(mktemp)"
diff_file="$(mktemp)"
list_err="$(mktemp)"
trap 'rm -f "$acc" "$acc.new" "$diff_file" "$list_err"' EXIT
echo '[]' > "$acc"

if ! nums=$(gh pr list --repo "$repo" --search "label:nightly-api-fix is:open" \
  --limit 50 --json number --jq '.[].number' 2>"$list_err"); then
  echo "::warning::Could not list open nightly-api-fix PRs ($(cat "$list_err")); the dedup list for this run is empty."
  nums=""
fi

while IFS= read -r n; do
  [ -z "$n" ] && continue
  # Cap each diff: agent PRs are meant to be small, so a big one is a signal in itself.
  if ! gh pr diff "$n" --repo "$repo" 2>/dev/null | head -c 20000 > "$diff_file"; then
    echo "::warning::Could not read the diff of open PR #${n}; its entry is empty."
    : > "$diff_file"
  fi
  jq -n --slurpfile acc "$acc" --arg n "$n" \
    --arg url "https://github.com/${repo}/pull/${n}" --rawfile diff "$diff_file" \
    '$acc[0] + [{number: ($n|tonumber), url: $url, diff: $diff}]' > "$acc.new"
  mv "$acc.new" "$acc"
done <<< "$nums"

cp "$acc" "$out"
echo "Open nightly-api-fix PRs found: $(jq 'length' "$out")"
