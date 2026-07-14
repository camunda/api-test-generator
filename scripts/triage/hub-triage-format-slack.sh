#!/usr/bin/env bash
# Format /tmp/hub-triage.json (written by the triage agent) into Slack mrkdwn.
#
#   hub-triage-format-slack.sh <triage.json> summary   # main message body
#   hub-triage-format-slack.sh <triage.json> thread     # threaded per-failure detail
#
# Kept as pure jq over a fixed schema (see camunda-hub-nightlies.guidance.md) so
# a malformed field degrades to a readable line rather than breaking the nightly
# notification. Mirrors the message style of the c8-cross-component triage bot.
set -euo pipefail

FILE="${1:?usage: hub-triage-format-slack.sh <triage.json> <summary|thread>}"
MODE="${2:?usage: hub-triage-format-slack.sh <triage.json> <summary|thread>}"

# Missing/empty file: the agent crashed before writing. Emit a sentinel the
# caller can post rather than a misleading green.
if [ ! -s "$FILE" ]; then
  case "$MODE" in
    summary) printf ':warning: Triage produced no result file — the agent may have crashed. Check the run.' ;;
    thread)  printf '' ;;
  esac
  exit 0
fi

case "$MODE" in
  summary)
    jq -r '
      def n(x): (x // 0);
      (.counts // {}) as $c
      | (.suites // {}) as $s
      | (n(.failures | length)) as $total
      | (
          "*Suites*  •  positive: " +
          ((n($s.positive.failed) > 0 | if . then ":x: " else ":white_check_mark: " end)
            + (n($s.positive.passed)|tostring) + " passed / " + (n($s.positive.failed)|tostring) + " failed"
            + (if ($s.positive.report // "present") == "missing" then " :warning: no report" else "" end))
          + "   •  negative: " +
          ((n($s.negative.failed) > 0 | if . then ":x: " else ":white_check_mark: " end)
            + (n($s.negative.passed)|tostring) + " passed / " + (n($s.negative.failed)|tostring) + " failed"
            + (if ($s.negative.report // "present") == "missing" then " :warning: no report" else "" end))
        ) as $suites
      | if $total == 0 then
          $suites + "\n:white_check_mark: *No failures tonight* — both suites green."
        else
          $suites
          + "\n*Triage — " + ($total|tostring) + " failing test(s):*"
          + "\n  :package: product: " + (n($c.product)|tostring)
          + "   :wrench: infrastructure: " + (n($c.infrastructure)|tostring)
          + "   :game_die: flakiness: " + (n($c.flakiness)|tostring)
          + "\n  :ticket: known issue: " + (n($c.known_issue)|tostring)
          + "   :memo: filed: " + (n($c.filed)|tostring)
          + "   :fast_forward: skipped (recent change): " + (n($c.skipped_recent_change)|tostring)
        end
    ' "$FILE"
    ;;

  thread)
    # One bullet per failure, grouped by category. Empty output when there are
    # no failures (caller then skips the thread reply).
    jq -r '
      def icon(cat):
        if cat == "product" then ":package:"
        elif cat == "infrastructure" then ":wrench:"
        elif cat == "flakiness" then ":game_die:"
        else ":grey_question:" end;
      def line(f):
        "• " + icon(f.category) + " *" + (f.category // "?") + "* — `"
        + (f.spec // f.operationId // "?") + "` — " + (f.test // "")
        + "\n    expected: " + (f.expected // "?") + "  |  actual: " + (f.actual // "?")
        + (if (f.known_issue // false) then "\n    :ticket: known issue: <" + (f.known_issue_url // "") + ">" else "" end)
        + (if (f.related_commit // null) != null then "\n    :fast_forward: skipped — explained by recent change: " + (f.related_commit|tostring) else "" end)
        + (if (f.issue_url // null) != null then "\n    :memo: filed: <" + f.issue_url + ">" else "" end)
        + (if (f.action // "") == "report-only" and ((f.file_error // "") != "") then "\n    :warning: could not file issue: " + f.file_error else "" end);
      (.failures // [])
      | if length == 0 then "" else (map(line(.)) | join("\n")) end
    ' "$FILE"
    ;;

  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac
