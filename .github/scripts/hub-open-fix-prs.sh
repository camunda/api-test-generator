#!/usr/bin/env bash
# Write the open `nightly-api-fix` PRs of this repo, with their diffs, as a JSON array of
# {number, url, diff} to the file given as $1 ([] when there are none). An agent searches the
# diffs to avoid opening a second PR for work that is already in flight.
#
# Needs GH_TOKEN with pull-requests: read. Fails closed: if the listing or any diff cannot be read,
# the duplicate check cannot be trusted, so the script exits non-zero and writes nothing.
set -euo pipefail

out="${1:?usage: hub-open-fix-prs.sh <out.json>}"
repo="${GITHUB_REPOSITORY:-camunda/api-test-generator}"
acc="$(mktemp)"
diff_file="$(mktemp)"
full_diff="$(mktemp)"
list_err="$(mktemp)"
trap 'rm -f "$acc" "$acc.new" "$diff_file" "$full_diff" "$list_err"' EXIT
echo '[]' > "$acc"

if ! nums=$(gh pr list --repo "$repo" --search "label:nightly-api-fix is:open" \
  --limit 50 --json number --jq '.[].number' 2>"$list_err"); then
  echo "::error::Could not list open nightly-api-fix PRs ($(cat "$list_err")); the duplicate check cannot be trusted."
  exit 1
fi

while IFS= read -r n; do
  [ -z "$n" ] && continue
  # Read the whole diff first, then cap it: piping straight into `head` would kill `gh` with a broken
  # pipe on a large diff, which under pipefail looks like a failure. Agent PRs are meant to be small,
  # so a big one is a signal in itself; the cap only bounds the file size.
  if ! gh pr diff "$n" --repo "$repo" > "$full_diff" 2>"$list_err"; then
    echo "::error::Could not read the diff of open PR #${n} ($(cat "$list_err")); the duplicate check cannot be trusted."
    exit 1
  fi
  head -c 20000 "$full_diff" > "$diff_file"
  jq -n --slurpfile acc "$acc" --arg n "$n" \
    --arg url "https://github.com/${repo}/pull/${n}" --rawfile diff "$diff_file" \
    '$acc[0] + [{number: ($n|tonumber), url: $url, diff: $diff}]' > "$acc.new"
  mv "$acc.new" "$acc"
done <<< "$nums"

cp "$acc" "$out"
echo "Open nightly-api-fix PRs found: $(jq 'length' "$out")"
