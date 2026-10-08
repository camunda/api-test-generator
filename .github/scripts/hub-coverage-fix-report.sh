#!/usr/bin/env bash
# Turn one coverage-fix run into two short texts: a comment for the tracking issue (the full record) and a Slack
# thread reply (one line per gap, with links).
#
#   usage: hub-coverage-fix-report.sh <agent-result.json> <run-prs.json> <issue-comment.md> <slack.txt>
#
# Environment: BASELINE (PR number above which PRs belong to this run), GITHUB_RUN_ID, GITHUB_SERVER_URL,
# GITHUB_REPOSITORY. Optional: ISSUE_URL (the tracking issue, linked from the Slack text).
#
# The agent's result file is text the agent wrote, so it is untrusted: control characters are removed, long texts are
# cut, the number of gaps is capped, and `&`, `<`, `>`, `@` and backticks are neutralised so a reason cannot add a link,
# a mention or markup. The PR links come from GitHub (run-prs.json), never from the agent's file.
#
# Both output files are empty when the run opened no PR and left no gap, so nothing is posted for a quiet run.
set -uo pipefail

result="${1:?usage: hub-coverage-fix-report.sh <agent-result.json> <run-prs.json> <issue-comment.md> <slack.txt>}"
prs="${2:?missing run-prs.json}"
issue_out="${3:?missing issue comment output}"
slack_out="${4:?missing slack output}"
: > "$issue_out"
: > "$slack_out"

run_id="${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
base="${BASELINE:-0}"
run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-camunda/api-test-generator}/actions/runs/${run_id}"

if ! jq -e '(.gaps | type) == "array"' "$result" > /dev/null 2>&1; then
  echo "::warning::The agent result has no gaps list; nothing to report."
  exit 0
fi

# shellcheck disable=SC2016
common='
  def clean($n): tostring | gsub("[[:cntrl:]]"; " ") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")
    | if length > $n then .[0:$n] + "…" else . end;
  def neutral: gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;") | gsub("@"; "@​") | gsub("`"; "'"'"'");
  def text($n): (. // "") | clean($n) | neutral;
'

jq -r --arg run "$run_id" --argjson base "$base" --arg runurl "$run_url" --arg issue "${ISSUE_URL:-}" \
  --slurpfile prs "$prs" "$common"'
  ([ $prs[0][] | select(.number > $base and .state == "OPEN" and (.headRefName | test("^fix/coverage-.+-" + $run + "$"))) ]) as $opened
  | ([ .gaps[]? | select(.action != "fix-pr") ]) as $left
  | if ($opened | length) == 0 and ($left | length) == 0 then empty else
      ":robot_face: *Coverage-fix agent run* <\($runurl)|\($run)>: \($opened | length) PR\(if ($opened | length) == 1 then "" else "s" end) opened, \($left | length) gap\(if ($left | length) == 1 then "" else "s" end) left for a person."
      + (if ($opened | length) > 0 then "\n" + ($opened | map("• PR <\(.url)|#\(.number) \(.title | text(120))>") | join("\n")) else "" end)
      + (if ($left | length) > 0 then "\n" + ($left[:20] | map("• `\(.resource | text(60))` (\(.kind | text(20))): \(.action | text(20)) — \(.reason | text(220))") | join("\n")) else "" end)
      + (if ($left | length) > 20 then "\n…and \($left | length - 20) more, see the tracking issue." else "" end)
      + (if $issue != "" then "\nDetails: <\($issue)|tracking issue>" else "" end)
    end' "$result" > "$slack_out"

jq -r --arg run "$run_id" --argjson base "$base" --arg runurl "$run_url" \
  --slurpfile prs "$prs" "$common"'
  ([ $prs[0][] | select(.number > $base and .state == "OPEN" and (.headRefName | test("^fix/coverage-.+-" + $run + "$"))) ]) as $opened
  | ([ .gaps[]? | select(.action != "fix-pr") ]) as $left
  | if ($opened | length) == 0 and ($left | length) == 0 then empty else
      "<!-- coverage-fix-run:\($run) -->\n### Coverage-fix agent run [\($run)](\($runurl))\n\n"
      + "\($opened | length) PR\(if ($opened | length) == 1 then "" else "s" end) opened, \($left | length) gap\(if ($left | length) == 1 then "" else "s" end) left for a person.\n"
      + (if ($opened | length) > 0 then "\n**Opened**\n\n" + ($opened | map("- \(.url) — \(.title | text(120))") | join("\n")) + "\n" else "" end)
      + (if ($left | length) > 0 then "\n**Not opened**\n\n" + ($left[:20] | map(
          "- `\(.resource | text(60))` (\(.kind | text(20))): **\(.action | text(20))**\n  - Reason: \(.reason | text(1500))"
          + (if (.proposal // "") != "" then "\n  - Proposal: \(.proposal | text(2000))" else "" end)
          + (if (.file_error // "") != "" then "\n  - Error: \(.file_error | text(300))" else "" end)
        ) | join("\n")) + "\n" else "" end)
      + (if ($left | length) > 20 then "\n…and \($left | length - 20) more not shown.\n" else "" end)
      + "\n_Text written by the agent; check it against the code before acting on it._"
    end' "$result" > "$issue_out"

echo "Report: issue comment $([ -s "$issue_out" ] && echo written || echo none), Slack text $([ -s "$slack_out" ] && echo written || echo none)"
exit 0
