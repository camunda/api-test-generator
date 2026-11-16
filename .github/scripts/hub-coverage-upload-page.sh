#!/usr/bin/env bash
# Uploads the rendered coverage report page (page.html) as a file into the weekly Slack message's
# thread, so people can open the full report straight from the channel. Uses Slack's external-upload
# flow (files.getUploadURLExternal -> POST the bytes -> files.completeUploadExternal).
#
# Best-effort by design: the weekly message itself matters more, so every Slack-side problem (a missing
# files:write scope, an empty channel/thread id, an API error) is logged as a warning and the script
# still exits 0 — it must never fail the weekly run. Only a usage error (no file argument) is fatal.
#
# Env: SLACK_BOT_TOKEN (needs the files:write scope), CHANNEL (the channel id from the posted message),
#      THREAD_TS (the posted message's ts). Arg: $1 = path to page.html.
set -euo pipefail

file="${1:?usage: hub-coverage-upload-page.sh <page.html>}"

if [ -z "${SLACK_BOT_TOKEN:-}" ] || [ -z "${CHANNEL:-}" ] || [ -z "${THREAD_TS:-}" ]; then
  echo "::warning::no Slack token, channel or thread id — skipping the report-page upload."
  exit 0
fi
if [ ! -s "$file" ]; then
  echo "::warning::$file is missing or empty — skipping the report-page upload."
  exit 0
fi

name="hub-coverage-report.html"
len=$(wc -c < "$file" | tr -d ' ')

# 1. Reserve an upload URL and a file id.
resp=$(curl -fsS -G "https://slack.com/api/files.getUploadURLExternal" \
  -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
  --data-urlencode "filename=${name}" --data-urlencode "length=${len}" || true)
if [ "$(jq -r '.ok // false' <<< "${resp:-}" 2>/dev/null)" != "true" ]; then
  echo "::warning::files.getUploadURLExternal failed: $(jq -r '.error // "no response"' <<< "${resp:-}" 2>/dev/null) — report page not uploaded."
  exit 0
fi
upload_url=$(jq -r '.upload_url' <<< "$resp")
file_id=$(jq -r '.file_id' <<< "$resp")

# 2. Upload the bytes to the reserved URL.
if ! curl -fsS -F "file=@${file};type=text/html" "$upload_url" >/dev/null; then
  echo "::warning::uploading the report-page bytes to Slack failed — report page not uploaded."
  exit 0
fi

# 3. Complete the upload, posting the file as a reply in the weekly message's thread.
payload=$(jq -n --arg id "$file_id" --arg ch "$CHANNEL" --arg ts "$THREAD_TS" \
  '{files: [{id: $id, title: "Hub coverage report"}], channel_id: $ch, thread_ts: $ts,
    initial_comment: "Full coverage report (open the attached page)."}')
done=$(curl -fsS -X POST "https://slack.com/api/files.completeUploadExternal" \
  -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
  -H "Content-Type: application/json; charset=utf-8" --data "$payload" || true)
if [ "$(jq -r '.ok // false' <<< "${done:-}" 2>/dev/null)" != "true" ]; then
  echo "::warning::files.completeUploadExternal failed: $(jq -r '.error // "no response"' <<< "${done:-}" 2>/dev/null) — report page not uploaded."
  exit 0
fi
echo "Uploaded ${name} into the Slack thread."
