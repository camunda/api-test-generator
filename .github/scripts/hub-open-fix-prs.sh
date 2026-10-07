#!/usr/bin/env bash
# Write the open `nightly-api-fix` PRs of this repo, with their diffs, as a JSON array of
# {number, url, diff} to the file given as $1 ([] when there are none). An agent searches the
# diffs to avoid opening a second PR for work that is already in flight.
#
# Needs GH_TOKEN with pull-requests: read. Fails closed: if the listing or any diff cannot be read, or a
# diff is larger than MAX_DIFF_BYTES, the duplicate check cannot be trusted (a truncated diff could hide the
# very operation being searched for), so the script exits non-zero and writes nothing. Agent PRs are meant
# to be small: an oversized one is itself a reason to stop and have a person look.
set -euo pipefail

out="${1:?usage: hub-open-fix-prs.sh <out.json>}"
repo="${GITHUB_REPOSITORY:-camunda/api-test-generator}"
max_bytes="${MAX_DIFF_BYTES:-200000}"
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
  if ! gh pr diff "$n" --repo "$repo" > "$full_diff" 2>"$list_err"; then
    echo "::error::Could not read the diff of open PR #${n} ($(cat "$list_err")); the duplicate check cannot be trusted."
    exit 1
  fi
  if [ "$(wc -c < "$full_diff")" -gt "$max_bytes" ]; then
    echo "::error::The diff of open PR #${n} is larger than ${max_bytes} bytes; a partial diff cannot be trusted for the duplicate check. Have a person look at that PR."
    exit 1
  fi
  cp "$full_diff" "$diff_file"
  jq -n --slurpfile acc "$acc" --arg n "$n" \
    --arg url "https://github.com/${repo}/pull/${n}" --rawfile diff "$diff_file" \
    '$acc[0] + [{number: ($n|tonumber), url: $url, diff: $diff}]' > "$acc.new"
  mv "$acc.new" "$acc"
done <<< "$nums"

cp "$acc" "$out"
echo "Open nightly-api-fix PRs found: $(jq 'length' "$out")"
