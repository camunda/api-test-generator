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
      # No-false-all-clear: an inconclusive / crashed run must say so, never green.
      if (.inconclusive // false) then
        ":warning: *Inconclusive* — the nightly produced no report artifact to triage. The test run may have crashed before uploading results; check the nightly run."
      elif (.agent_error // false) then
        ":warning: *Triage incomplete* — the agent errored before writing a result. Check the triage run."
      else
      (
      (.counts // {}) as $c
      | (.suites // {}) as $s
      | (n(.failures | length)) as $total
      | (n(.unmapped_operations | length)) as $unmapped_total
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
      | (
          if $unmapped_total == 0 then ""
          else "\n:no_entry_sign: *Coverage gap:* " + ($unmapped_total|tostring)
               + " operation(s) with no generated test — " + (n($c.fixed)|tostring) + " fix PR(s) opened."
          end
        ) as $coverage_line
      # No-false-all-clear applies here too: zero failing TESTS is not the same
      # as zero gaps — a suite can be all-green while an operation has no test
      # at all (it never appears as a failure). Only call the night fully clean
      # when BOTH are zero.
      | if $total == 0 and $unmapped_total == 0 then
          $suites + "\n:white_check_mark: *No failures tonight* — both suites green, no coverage gaps."
        elif $total == 0 then
          $suites + "\n:white_check_mark: No failing tests." + $coverage_line
        else
          $suites
          + "\n*Triage — " + ($total|tostring) + " failing test(s):*"
          + "\n  :package: product: " + (n($c.product)|tostring)
          + "   :wrench: infrastructure: " + (n($c.infrastructure)|tostring)
          + "   :game_die: flakiness: " + (n($c.flakiness)|tostring)
          + "   :test_tube: test-generation: " + (n($c.test_generation)|tostring)
          + "\n  :ticket: known issue: " + (n($c.known_issue)|tostring)
          + "   :memo: filed: " + (n($c.filed)|tostring)
          + "   :fast_forward: skipped (recent change): " + (n($c.skipped_recent_change)|tostring)
          + $coverage_line
        end
      )
      end
    ' "$FILE"
    ;;

  thread)
    # One bullet per failure, grouped by category. Empty output when there are
    # no failures (caller then skips the thread reply).
    jq -r '
      def icon(f):
        if (f.subcategory // "") == "test-generation" then ":test_tube:"
        elif f.category == "product" then ":package:"
        elif f.category == "infrastructure" then ":wrench:"
        elif f.category == "flakiness" then ":game_die:"
        else ":grey_question:" end;
      def catlabel(f):
        if (f.subcategory // "") == "test-generation" then "test-generation (api-test-generator)"
        else (f.category // "?") end;
      def line(f):
        "• " + icon(f) + " *" + catlabel(f) + "* — `"
        + (f.spec // f.operationId // "?") + "` — " + (f.test // "")
        + "\n    expected: " + (f.expected // "?") + "  |  actual: " + (f.actual // "?")
        + (if (f.known_issue // false) then "\n    :ticket: known issue: <" + (f.known_issue_url // "") + ">" else "" end)
        + (if (f.related_commit // null) != null then "\n    :fast_forward: skipped — explained by recent change: " + (f.related_commit|tostring) else "" end)
        + (if (f.issue_url // null) != null then "\n    :memo: filed: <" + f.issue_url + ">" else "" end)
        + (if (f.fix_pr_url // null) != null then "\n    :hammer_and_wrench: fix PR: <" + f.fix_pr_url + ">" else "" end)
        + (if (f.action // "") == "report-only" and ((f.file_error // "") != "") then "\n    :warning: could not file issue: " + f.file_error else "" end);
      def uline(u):
        "• :no_entry_sign: *unmapped* — `" + (u.operationId // "?") + "` — no generated test"
        + (if (u.fix_pr_url // null) != null then "\n    :hammer_and_wrench: fix PR: <" + u.fix_pr_url + ">" else "" end)
        + (if (u.action // "") == "report-only" and ((u.file_error // "") != "") then "\n    :warning: could not open fix PR: " + u.file_error else "" end);
      ((.failures // []) | map(line(.))) as $flines
      | ((.unmapped_operations // []) | map(uline(.))) as $ulines
      | ($flines + $ulines) as $all
      | if ($all | length) == 0 then "" else ($all | join("\n")) end
    ' "$FILE"
    ;;

  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac
