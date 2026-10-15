#!/usr/bin/env bash
# Append `relates to #<issue>` to each coverage-fix PR the verifier matched to a tracking issue, so the PR and
# the issue cross-reference each other on GitHub. The issue per PR comes from the verifier output
# (`links: [{number, issue}]`), which is deterministic and reuses the selector's branch -> candidate -> area
# mapping — never from the agent. The PR body comes from the run PR snapshot.
#
#   usage: hub-coverage-fix-link-issues.sh <verify-out.json> <run-prs.json>
#
# Idempotent: the verifier already drops a PR whose body carries the link, and this re-checks before editing.
# Never fails the run — a missing cross-reference is a convenience, not a correctness gate. A `relates to`
# (not `closes`) link on purpose: one PR fixes one endpoint, the area issue usually lists several.
set -uo pipefail

out="${1:?usage: hub-coverage-fix-link-issues.sh <verify-out.json> <run-prs.json>}"
prs="${2:?missing run-prs.json}"
repo="${GITHUB_REPOSITORY:-camunda/api-test-generator}"

[ -s "$out" ] || { echo "No verifier output to read; nothing to link."; exit 0; }

count=0
while read -r link; do
  [ -n "$link" ] || continue
  num="$(jq -r '.number' <<< "$link")"
  issue="$(jq -r '.issue' <<< "$link")"
  case "$num" in '' | 0 | *[!0-9]*) echo "::warning::skipping link with a bad PR number: $link"; continue ;; esac
  case "$issue" in '' | 0 | *[!0-9]*) echo "::warning::skipping link with a bad issue number: $link"; continue ;; esac
  body="$(jq -r --argjson n "$num" '.[] | select(.number == $n) | .body // ""' "$prs")"
  line="relates to #${issue}"
  if printf '%s' "$body" | grep -qF "$line"; then
    echo "PR #${num} already links #${issue}."
    continue
  fi
  # Append after a blank line; the body still opens with the agent's "## In plain words" section the
  # verifier required, so the link never disturbs that check.
  if printf '%s\n\n%s\n' "$body" "$line" | gh pr edit "$num" --repo "$repo" --body-file -; then
    echo "Linked PR #${num} to #${issue}."
    count=$((count + 1))
  else
    echo "::warning::Could not link PR #${num} to #${issue}."
  fi
done < <(jq -c '.links[]?' "$out")

echo "Linked ${count} PR(s) to their tracking issue."
exit 0
