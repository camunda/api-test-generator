#!/usr/bin/env bash
# Write the Slack line for the coverage-fix agent's open PRs to the file given as $1. The file is empty when
# there are none, so a week without agent PRs shows no extra line.
#
# An agent PR is an open PR whose branch starts with `fix/coverage-` and that carries the nightly-api-fix
# label (the agent's own branch and label). Reads over REST only. If the list cannot be read the script
# warns and writes an empty file: the weekly message must still go out, just without this line.
set -uo pipefail

out="${1:?usage: hub-coverage-agent-prs.sh <out.txt>}"
repo="${GITHUB_REPOSITORY:-camunda/api-test-generator}"
err="$(mktemp)"
trap 'rm -f "$err"' EXIT
: > "$out"

if ! prs="$(gh api --paginate "repos/${repo}/pulls?state=open&per_page=100" 2>"$err" | jq -s 'add // []' 2>>"$err")"; then
  echo "::warning::Could not list the agent's open PRs ($(cat "$err")); the Slack message goes out without that line."
  exit 0
fi

# Slack mrkdwn treats & < > as markup, so escape them in the title.
line="$(printf '%s' "$prs" | jq -r --arg repo "$repo" '
  [ .[]
    | select(.head.ref | startswith("fix/coverage-"))
    | select([.labels[].name] | any(. == "nightly-api-fix"))
  ] as $p
  | if ($p | length) == 0 then empty else
      ":robot_face: *Coverage-fix agent: \($p | length) PR\(if ($p | length) == 1 then "" else "s" end) waiting for review.* "
      + "These were opened by the agent, not a person; please review before merging: "
      + ($p | map("<\(.html_url)|#\(.number) \(.title | gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;"))>") | join(" · "))
    end' 2>>"$err")" || { echo "::warning::Could not format the agent's PR line ($(cat "$err"))."; exit 0; }

[ -n "$line" ] && printf '%s\n' "$line" > "$out"
echo "Agent PR line: $([ -s "$out" ] && echo written || echo none)"
exit 0
