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

# Validate MODE up front — the missing-file and malformed-JSON early exits
# below each have their own case "$MODE" with no `*)` fallback, so an
# unexpected mode combined with either of those conditions would otherwise
# fall through silently (exit 0, no output) instead of the clear "unknown
# mode" error the final case block gives for a well-formed file.
case "$MODE" in
  summary | thread) ;;
  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac

# Missing/empty file: the agent crashed before writing. Emit a sentinel the
# caller can post rather than a misleading green.
if [ ! -s "$FILE" ]; then
  case "$MODE" in
    summary) printf ':warning: Triage produced no result file — the agent may have crashed. Check the run.' ;;
    thread)  printf '' ;;
  esac
  exit 0
fi

# Malformed (non-JSON) content: same degrade-gracefully contract as the
# missing-file case above, rather than letting jq's non-zero exit propagate
# under set -e (the caller currently does `|| true`, which would otherwise
# turn this into a silent empty Slack message instead of a visible warning).
if ! jq empty "$FILE" 2>/dev/null; then
  case "$MODE" in
    summary) printf ':warning: Triage result file is not valid JSON — the agent may have written a partial/corrupt result. Check the run.' ;;
    thread)  printf '' ;;
  esac
  exit 0
fi

case "$MODE" in
  summary)
    jq -r '
      # Coerce to a number regardless of whether the agent wrote it as a JSON
      # number or (schema drift) a numeric string — a bare `x // 0` still
      # throws on a string in later numeric comparisons/arithmetic.
      def n(x): (x // 0) as $v | (if ($v|type) == "number" then $v
                                   elif ($v|type) == "string" then ($v|tonumber? // 0)
                                   else 0 end);
      # length does not throw on a scalar (string to char count, object to
      # key count), so a malformed failures/unmapped_operations (wrong type,
      # not an array) would not crash here, it would silently produce a
      # nonsense count (e.g. a 4-char string masquerading as "4 operations").
      # Coerce non-arrays to [] first so the count is 0, not a lie.
      def arrlen(x): (x // []) as $v | (if ($v|type) == "array" then ($v|length) else 0 end);
      # A present-but-wrong-typed field is a genuine schema violation, not
      # legitimate "nothing to report" (that case is field ABSENT, i.e. null,
      # which arrlen already treats as 0 correctly). Coercing a violation to 0
      # the same way would silently turn real, lost triage data into a false
      # all-clear — exactly what this script exists to prevent. Caught
      # separately below, before the normal zero-failures path can fire.
      def bad_type(x): x as $v | ($v != null) and (($v|type) != "array");
      # Category breakdown lines: only the categories that actually happened
      # tonight, not a wall of "label: 0"s for every category the schema
      # happens to define. Same "only show a non-zero one" rule the coverage
      # line below already uses.
      def counters(items):
        items | map(select(.count > 0)) | map(.icon + " " + .label + ": " + (.count|tostring)) | join("   ");
      # No-false-all-clear: an inconclusive / crashed run must say so, never green.
      if (.inconclusive // false) then
        ":warning: *Inconclusive* — the nightly produced no report artifact to triage. The test run may have crashed before uploading results; check the nightly run."
      elif (.agent_error // false) then
        ":warning: *Triage incomplete* — the agent errored before writing a result. Check the triage run."
      elif (bad_type(.failures) or bad_type(.unmapped_operations)) then
        ":warning: *Triage result has a schema violation* — failures or unmapped_operations is not an array. Treating as inconclusive rather than risk reporting a false all-clear; check the raw triage JSON for this run."
      else
      (
      (.counts // {}) as $c
      | (.suites // {}) as $s
      | (n(arrlen(.failures))) as $total
      | (n(arrlen(.unmapped_operations))) as $unmapped_total
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
      # Count entries with a fix_pr_url directly within unmapped_operations —
      # counts.fixed is scored by the agent across BOTH unmapped operations
      # AND test-generation failures, so using it here would over-report (a
      # night with only test-generation fixes, zero unmapped-op fixes, would
      # still show a non-zero "fix PR(s) opened" on the coverage-gap line).
      # action == "skip" also carries a fix_pr_url (pointing at an existing,
      # already-in-flight PR — see the dedup check), so counting any non-null
      # fix_pr_url here would overstate how many PRs were freshly OPENED this
      # run. Only action == "fix-pr" is a new PR.
      | ((.unmapped_operations // []) | map(select((.action // "") == "fix-pr")) | length) as $unmapped_fixed
      | (
          if $unmapped_total == 0 then ""
          else "\n:no_entry_sign: *Coverage gap:* " + ($unmapped_total|tostring)
               + " operation(s) with no generated test — " + ($unmapped_fixed|tostring) + " fix PR(s) opened."
          end
        ) as $coverage_line
      | (counters([
          {icon: ":package:", label: "product", count: n($c.product)},
          {icon: ":wrench:", label: "infrastructure", count: n($c.infrastructure)},
          {icon: ":game_die:", label: "flakiness", count: n($c.flakiness)},
          {icon: ":test_tube:", label: "test-generation", count: n($c.test_generation)}
        ])) as $cat_line
      | (counters([
          {icon: ":ticket:", label: "known issue", count: n($c.known_issue)},
          {icon: ":memo:", label: "filed", count: n($c.filed)},
          {icon: ":fast_forward:", label: "skipped (recent change)", count: n($c.skipped_recent_change)}
        ])) as $meta_line
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
          + (if ($cat_line|length) > 0 then "\n  " + $cat_line else "" end)
          + (if ($meta_line|length) > 0 then "\n  " + $meta_line else "" end)
          + $coverage_line
        end
      )
      end
    ' "$FILE"
    ;;

  thread)
    # One bullet per failure (in report order, not grouped by category) plus
    # one bullet per unmapped operation appended after them. Empty output only
    # when BOTH failures and unmapped_operations are empty (caller then skips
    # the thread reply) — a clean suite pair with a real coverage gap still
    # produces bullets here.
    jq -r '
      # Coerce any field to a display string regardless of its actual JSON
      # type (the schema promises strings, but a malformed field — a number,
      # object, or null slipping past `// "?"` — must still degrade to a
      # readable line instead of a jq "cannot add ... and string" error).
      def s(x; d): ((x // d) | tostring);
      # Leading numeric token (a status code, in practice) if the value starts
      # with one, else the value itself capped short — the compact title line
      # wants just "expected 200, got 400", not the full reasoning string the
      # guidance already asks the agent to keep out of these fields anyway.
      def leadNum(x; d):
        (s(x; d)) as $v
        | (try ($v | capture("^(?<n>[0-9]+)").n) catch null)
          // (if ($v | length) > 20 then ($v[0:20] + "…") else $v end);
      def icon(f):
        if (f.subcategory // "") == "test-generation" then ":test_tube:"
        elif f.category == "product" then ":package:"
        elif f.category == "infrastructure" then ":wrench:"
        elif f.category == "flakiness" then ":game_die:"
        else ":grey_question:" end;
      def catlabel(f):
        if (f.subcategory // "") == "test-generation" then "test-generation (api-test-generator)"
        else s(f.category; "?") end;
      # True only for an actual, non-empty URL string. Checks (x|type) itself
      # rather than routing through s()/tostring: a schema-violating non-
      # string value (true, 42, {}) would stringify to something non-empty
      # ("true", "42", "{}") and be wrongly treated as a present URL — this
      # pages real on-call groups (and, below, renders a Slack link), so only
      # a genuine string counts either way.
      def has_url(x): (x | type) == "string" and (x | length) > 0;
      # Compact icon+link, e.g. ":ticket: <url>" — no text label, the icon
      # carries the meaning (matches the rest of this compact per-finding
      # line). Only rendered when the URL is actually a present, non-empty
      # string — the same has_url() rule the medic-ping triggers use, so a
      # schema-violating non-string value (true, 42, {}) is silently omitted
      # here rather than rendered as a garbage link (<true>, <42>). Omitting
      # (not a "(no URL recorded)" fallback) is deliberate: this compact line
      # only shows what IS there, it does not call out what is missing.
      def compactLink(url; icon): if has_url(url) then icon + " <" + s(url; "") + ">" else "" end;
      # Owner→medic Slack subteam mentions — pings the actual on-call group,
      # not plain text (same mechanism as the camunda/camunda AlwaysGreen
      # feedback.mjs / alwaysgreen-streak-detector.yml). Fires on:
      #   - hub_medic: action == "file" AND a non-empty issue_url — a FRESH
      #     hub issue was actually filed this run. Requiring the URL guards
      #     against paging on a schema-violating/incomplete agent-authored
      #     entry that claims action "file" without one.
      #   - test_automation_medic: action == "fix-pr" with a non-empty
      #     fix_pr_url (a fresh generator-side fix PR) OR a non-empty
      #     suppress_pr_url (a suppress PR — also lives in api-test-generator,
      #     needs our review) — deduped to exactly one mention even if both
      #     happened to be true for the same finding (the schema does not
      #     declare them mutually exclusive).
      #
      # hub_medic never fires on an already-known recurrence (action ==
      # "report-only"/"skip") — otherwise it gets paged nightly for something
      # already tracked and unfixed. The test_automation_medic suppress_pr_url
      # trigger is intentionally independent of action: per the guidance, a
      # suppress PR is opened for every confirmed bug, including one already
      # known (action == "report-only", known_issue == true) — the PR is
      # fresh and needs review either way, even though the underlying hub
      # issue is not.
      #
      # One mention per finding, inline in the thread reply only (never the
      # top-level summary message) so it stays precise, not a blanket ping.
      def hub_medic: "<!subteam^S014VK4482H|hub-medic>";
      def test_automation_medic: "<!subteam^S09UF0EV0HG|test-automation-medic>";
      # Compact per-finding line: title (category, operationId, short
      # expected/actual) + one links line (icon+URL only, whichever are
      # present — nothing shown for whichever are absent) + medic ping(s) +
      # any operational error warnings. Full detail (the full agent
      # reasoning, response bodies, etc.) lives in the linked issue, PR, or
      # nightly run, not repeated here — this is a pointer, not the evidence.
      def line(f):
        (((f.action // "") == "fix-pr" and has_url(f.fix_pr_url)) or has_url(f.suppress_pr_url)) as $needs_ta_medic
        | ([
            (if (f.known_issue // false) then compactLink(f.known_issue_url; ":ticket:") else "" end),
            (if (f.related_commit // null) != null then ":fast_forward: recent change" else "" end),
            compactLink(f.issue_url; ":memo:"),
            compactLink(f.fix_pr_url; if (f.action // "") == "skip" then ":recycle:" else ":hammer_and_wrench:" end),
            compactLink(f.suppress_pr_url; ":no_entry:")
          ] | map(select(length > 0)) | join("  ")) as $links_line
        | "• " + icon(f) + " " + catlabel(f) + " — `" + s(f.operationId; "?")
        + "` — expected " + leadNum(f.expected; "?") + ", got " + leadNum(f.actual; "?")
        + (if ($links_line | length) > 0 then "\n    " + $links_line else "" end)
        + (if (f.action // "") == "file" and has_url(f.issue_url)
           then "\n    :rotating_light: " + hub_medic else "" end)
        + (if $needs_ta_medic then "\n    :rotating_light: " + test_automation_medic else "" end)
        + (if (f.action // "") == "report-only" and ((f.file_error // "") != "") then
             (if (f.subcategory // "") == "test-generation"
              then "\n    :warning: could not open fix PR: "
              else "\n    :warning: could not file issue: " end) + s(f.file_error; "")
           else "" end)
        + (if (f.category // "") == "product" and (f.suppress_pr_url // null) == null and ((f.suppress_error // "") != "") then
             "\n    :warning: could not suppress: " + s(f.suppress_error; "")
           else "" end);
      def uline(u):
        ((u.action // "") == "fix-pr" and has_url(u.fix_pr_url)) as $needs_ta_medic
        | (compactLink(u.fix_pr_url; if (u.action // "") == "skip" then ":recycle:" else ":hammer_and_wrench:" end)) as $link
        | "• :no_entry_sign: unmapped — `" + s(u.operationId; "?") + "` — no generated test"
        + (if ($link | length) > 0 then "\n    " + $link else "" end)
        + (if $needs_ta_medic then "\n    :rotating_light: " + test_automation_medic else "" end)
        + (if (u.action // "") == "report-only" and ((u.file_error // "") != "") then "\n    :warning: could not open fix PR: " + s(u.file_error; "") else "" end);
      # Guard against the schema being violated (e.g. failures/unmapped_operations
      # written as an object or string instead of an array) — arr() coerces
      # anything non-array to [] rather than letting map() throw.
      def arr(x): (x // []) as $v | (if ($v|type) == "array" then $v else [] end);
      (arr(.failures) | map(line(.))) as $flines
      | (arr(.unmapped_operations) | map(uline(.))) as $ulines
      | ($flines + $ulines) as $all
      | if ($all | length) == 0 then "" else ($all | join("\n")) end
    ' "$FILE"
    ;;

  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac
