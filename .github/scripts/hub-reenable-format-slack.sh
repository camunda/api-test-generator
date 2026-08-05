#!/usr/bin/env bash
# Format the summary JSON written by hub-reenable-check.sh into a Slack
# mrkdwn message body. Prints nothing (exit 0) when there's nothing to
# report — the caller should skip posting entirely in that case, matching
# spec-bump-check.yml's "non-spammy" convention (silent on a no-op run).
#
#   hub-reenable-format-slack.sh <summary.json>
set -euo pipefail

FILE="${1:?usage: hub-reenable-format-slack.sh <summary.json>}"

if [ ! -s "$FILE" ]; then
  exit 0
fi

if ! jq empty "$FILE" 2>/dev/null; then
  echo ":warning: hub-known-issue-reenable-check produced a non-JSON summary — check the run."
  exit 0
fi

jq -r '
  def line(item):
    item.url as $url | item.title as $title | (item.operations // "") as $ops |
    if item.type == "opened" then
      "🎉 <" + $url + "|camunda-hub#" + ($url | split("/") | last) + "> (\"" + $title + "\") is closed — re-enabled: `" + $ops + "` → <" + item.pr_url + "|draft PR> (pending live-Hub validation)"
    elif item.type == "already_in_flight" then
      "🎉 <" + $url + "|camunda-hub#" + ($url | split("/") | last) + "> is closed — `" + $ops + "` already has an open unskip PR: <" + item.pr_url + ">"
    elif item.type == "aborted_broke_checks" then
      "⚠️ <" + $url + "|camunda-hub#" + ($url | split("/") | last) + "> is closed, but re-enabling `" + $ops + "` breaks local generate/tests — needs manual investigation (see the workflow run log)."
    elif item.type == "aborted_no_token" then
      "⚠️ <" + $url + "|camunda-hub#" + ($url | split("/") | last) + "> is closed and `" + $ops + "` is ready to re-enable, but no generator token was available this run — will retry."
    elif item.type == "aborted_pr_create_failed" then
      "⚠️ <" + $url + "|camunda-hub#" + ($url | split("/") | last) + "> is closed, but opening the unskip PR for `" + $ops + "` failed — see the workflow run log."
    elif item.type == "suite_wide_closed" then
      "📋 <" + $url + "|camunda-hub#" + ($url | split("/") | last) + "> (\"" + (item.summary // "") + "\") is closed but has no specific operation(s) to auto-unskip — needs manual follow-up."
    else
      "❓ Unrecognized summary item type: " + (item.type // "?")
    end;
  if length == 0 then "" else
    ":gear: *camunda-hub known-issue re-enable check*\n" + (map(line(.)) | join("\n"))
  end
' "$FILE"
