#!/usr/bin/env bash
# Append `closes #<issue>` to each coverage-fix PR the verifier matched to a tracking issue, so the PR and
# the issue cross-reference each other on GitHub (and the per-endpoint issue auto-closes when the PR merges).
# The issue per PR comes from the verifier output (`links: [{number, issue}]`), which is deterministic and
# reuses the selector's branch -> candidate -> endpoint mapping — never from the agent.
#
#   usage: hub-coverage-fix-link-issues.sh <verify-out.json>
#
# The PR body is read FRESH from GitHub immediately before editing, not from an earlier snapshot: the live-Hub
# check step runs before this one and adds a `### Live Hub check` section to the body, so editing from a stale
# snapshot would erase it. On a failed read the PR is left untouched. Idempotent: a body that already carries
# the exact `closes #<issue>` reference (with a digit boundary, so #42 does not match #420) is skipped.
# Never fails the run — a missing cross-reference is a convenience, not a correctness gate. A `closes` link
# on purpose: one PR fixes one endpoint, and that endpoint now has its own issue, so merging the PR closes it.
set -uo pipefail

out="${1:?usage: hub-coverage-fix-link-issues.sh <verify-out.json>}"
repo="${GITHUB_REPOSITORY:-camunda/api-test-generator}"

[ -s "$out" ] || { echo "No verifier output to read; nothing to link."; exit 0; }

count=0
while read -r link; do
  [ -n "$link" ] || continue
  num="$(jq -r '.number' <<< "$link")"
  issue="$(jq -r '.issue' <<< "$link")"
  case "$num" in '' | 0 | *[!0-9]*) echo "::warning::skipping link with a bad PR number: $link"; continue ;; esac
  case "$issue" in '' | 0 | *[!0-9]*) echo "::warning::skipping link with a bad issue number: $link"; continue ;; esac
  # Read the current body, so the live-check section this run just added is preserved. Leave the PR alone if the
  # read fails rather than overwriting it from nothing.
  if ! body="$(gh api "repos/${repo}/pulls/${num}" --jq '.body // ""')"; then
    echo "::warning::Could not read the description of PR #${num}; leaving it untouched."
    continue
  fi
  # A digit boundary after the number: `closes #42` must not be considered present by `closes #420`.
  if printf '%s' "$body" | grep -qE "closes #${issue}([^0-9]|\$)"; then
    echo "PR #${num} already links #${issue}."
    continue
  fi
  # Append after a blank line; the body still opens with the agent's "## In plain words" section the verifier
  # required, and keeps the live-check section, so the link disturbs neither.
  if printf '%s\n\n%s\n' "$body" "closes #${issue}" | gh pr edit "$num" --repo "$repo" --body-file -; then
    echo "Linked PR #${num} to #${issue}."
    count=$((count + 1))
  else
    echo "::warning::Could not link PR #${num} to #${issue}."
  fi
done < <(jq -c '.links[]?' "$out")

echo "Linked ${count} PR(s) to their tracking issue."
exit 0
