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
# cut, the number of gaps and PRs is capped, `&`, `<`, `>`, `@` and backticks are neutralised, and each agent text is put in
# a code span, which GitHub and Slack show literally: a reason cannot add a link, an image, a mention or formatting.
# The whole comment is also cut to a fixed size, below GitHub's comment limit. The PR links come from GitHub
# (run-prs.json), never from the agent's file.
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

# An unusable agent result (a crash sentinel, no gaps list) must not hide the PRs that GitHub shows for this run: report
# them with no gaps and a warning line.
missing=false
# The comment is cut at this size; a test lowers it to check the cut. GitHub allows 65,536 characters.
max_issue="${ISSUE_MAX_CHARS:-50000}"
if ! jq -e '(.gaps | type) == "array"' "$result" > /dev/null 2>&1; then
  echo "::warning::The agent result has no gaps list; reporting only the PRs GitHub shows for this run."
  fallback="$(mktemp)"
  trap 'rm -f "$fallback"' EXIT
  printf '{"gaps":[]}\n' > "$fallback"
  result="$fallback"
  missing=true
fi

# shellcheck disable=SC2016
common='
  def clean($n): tostring | gsub("[[:cntrl:]]"; " ") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")
    | if length > $n then .[0:$n] + "…" else . end;
  def neutral: gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;") | gsub("@"; "@\u200b") | gsub("`"; "'"'"'");
  # A code span shows its text as it is: no link, image, mention or formatting. Backticks are replaced first, so
  # the text cannot close the span.
  def code($n): (. // "") | clean($n) | gsub("`"; "'"'"'") | if . == "" then "-" else "`" + . + "`" end;
  def slackcode($n): (. // "") | clean($n) | neutral | if . == "" then "-" else "`" + . + "`" end;
  # Cut at the end of a complete line, so no code span loses its closing backtick (every agent text is on one line).
  def cap($n): if length > $n then (.[0:$n] | sub("\n[^\n]*$"; "")) + "\n\n…cut here, see the run for the rest." else . end;
'

jq -r --arg run "$run_id" --argjson base "$base" --arg runurl "$run_url" --arg issue "${ISSUE_URL:-}" --argjson missing "$missing" \
  --slurpfile prs "$prs" "$common"'
  ([ $prs[0][] | select(.number > $base and .state == "OPEN" and (.headRefName | test("^fix/coverage-.+-" + $run + "$"))) ]) as $opened
  | ([ .gaps[]? | select(.action != "fix-pr") ]) as $left
  | if ($opened | length) == 0 and ($left | length) == 0 and ($missing | not) then empty else
      (":robot_face: *Coverage-fix agent run* <\($runurl)|\($run)>: \($opened | length) PR\(if ($opened | length) == 1 then "" else "s" end) opened, \($left | length) gap\(if ($left | length) == 1 then "" else "s" end) left for a person."
      + (if ($opened | length) > 0 then "\n" + ($opened[:20] | map("• PR <\(.url)|#\(.number)> \(.title | slackcode(120))") | join("\n")) else "" end)
      + (if ($left | length) > 0 then "\n" + ($left[:20] | map("• \(.resource | slackcode(60)) (\(.kind | slackcode(20))): \(.action | slackcode(20)) — \(.reason | slackcode(220))") | join("\n")) else "" end)
      + (if ($left | length) > 20 then "\n…and \($left | length - 20) more, see the tracking issue." else "" end)
      + (if $missing then "\n:warning: The agent left no usable result, so only the PRs found on GitHub are listed." else "" end)
      + (if $issue != "" then "\nDetails: <\($issue)|tracking issue>" else "" end)) | cap(3000)
    end' "$result" > "$slack_out"

jq -r --arg run "$run_id" --argjson base "$base" --arg runurl "$run_url" --argjson missing "$missing" --argjson maxissue "$max_issue" \
  --slurpfile prs "$prs" "$common"'
  ([ $prs[0][] | select(.number > $base and .state == "OPEN" and (.headRefName | test("^fix/coverage-.+-" + $run + "$"))) ]) as $opened
  | ([ .gaps[]? | select(.action != "fix-pr") ]) as $left
  | if ($opened | length) == 0 and ($left | length) == 0 and ($missing | not) then empty else
      ("<!-- coverage-fix-run:\($run) -->\n### Coverage-fix agent run [\($run)](\($runurl))\n\n"
      + "\($opened | length) PR\(if ($opened | length) == 1 then "" else "s" end) opened, \($left | length) gap\(if ($left | length) == 1 then "" else "s" end) left for a person.\n"
      + (if ($opened | length) > 0 then "\n**Opened**\n\n" + ($opened[:20] | map("- \(.url) — \(.title | code(120))") | join("\n")) + (if ($opened | length) > 20 then "\n- …and \($opened | length - 20) more" else "" end) + "\n" else "" end)
      + (if ($left | length) > 0 then "\n**Not opened**\n\n" + ($left[:20] | map(
          "- \(.resource | code(60)) (\(.kind | code(20))): **\(.action | code(20))**\n  - Reason: \(.reason | code(800))"
          + (if (.proposal // "") != "" then "\n  - Proposal: \(.proposal | code(1200))" else "" end)
          + (if (.file_error // "") != "" then "\n  - Error: \(.file_error | code(200))" else "" end)
        ) | join("\n")) + "\n" else "" end)
      + (if ($left | length) > 20 then "\n…and \($left | length - 20) more not shown.\n" else "" end)
      + (if $missing then "\n:warning: The agent left no usable result, so only the PRs found on GitHub are listed.\n" else "" end)
      + "\n_Text written by the agent, shown as code; check it against the code before acting on it._") | cap($maxissue)
    end' "$result" > "$issue_out"

echo "Report: issue comment $([ -s "$issue_out" ] && echo written || echo none), Slack text $([ -s "$slack_out" ] && echo written || echo none)"
exit 0
