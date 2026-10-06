#!/usr/bin/env bash
# Heartbeat for the Hub Slack alerts. Checks, through the GitHub API only (no Slack), that the nightly
# and the triage ran recently and that their main Slack post steps really succeeded. Every Hub workflow
# skips its Slack steps and still ends green when the Slack token cannot be read, so this is the only
# thing that notices alerts have stopped. Run by .github/workflows/hub-alerts-heartbeat.yml; tested with
# a stub `gh` in tests/request-validation/hub-alerts-heartbeat.test.ts.
#
# Problems found: open or update one rolling issue, and exit 1 so the heartbeat run itself is red.
# None found: close that issue if it is open, exit 0.
#
# Environment: REPO_URL, RUN_URL (this run), DRY_RUN (true: print only, change nothing),
# MAX_AGE_HOURS (default 26), NOW_EPOCH (tests only).
set -uo pipefail

TITLE='[hub-alerts] Slack alerts are not being posted'
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
NOW="${NOW_EPOCH:-$(date +%s)}"
DRY_RUN="${DRY_RUN:-false}"

# file | label | name of the step(s) that post the main message
WATCH=(
  'nightly-camunda-hub.yml|nightly posts|^Notify Slack \((positive|negative) suite\)$'
  'triage-camunda-hub-nightly.yml|triage digest|^Post triage summary to Slack$'
)

problems=()
for entry in "${WATCH[@]}"; do
  IFS='|' read -r file label step_re <<<"$entry"
  runs=$(gh run list --workflow "$file" --limit 10 --json databaseId,createdAt,status,url) || runs='[]'
  latest=$(jq -c --argjson now "$NOW" --argjson max "$((MAX_AGE_HOURS * 3600))" \
    '[.[] | select(($now - (.createdAt | fromdateiso8601)) <= $max)] | sort_by(.createdAt) | last // empty' <<<"$runs")
  if [ -z "$latest" ]; then
    problems+=("- **${label}**: no \`${file}\` run started in the last ${MAX_AGE_HOURS} hours. Is the schedule running?")
    continue
  fi
  # A run still in progress is judged the next day, not now.
  [ "$(jq -r .status <<<"$latest")" = "completed" ] || continue
  id=$(jq -r .databaseId <<<"$latest")
  url=$(jq -r .url <<<"$latest")
  steps=$(gh run view "$id" --json jobs | jq -c --arg re "$step_re" '[.jobs[].steps[] | select(.name | test($re))]')
  total=$(jq 'length' <<<"${steps:-[]}")
  if [ "${total:-0}" = "0" ]; then
    problems+=("- **${label}**: [the latest run](${url}) has no Slack post step. Was the workflow changed?")
    continue
  fi
  bad=$(jq -r '[.[] | select(.conclusion != "success") | "\(.name) (\(.conclusion // "not finished"))"] | join(", ")' <<<"$steps")
  if [ -n "$bad" ]; then
    problems+=("- **${label}**: in [the latest run](${url}) these Slack steps did not post: ${bad}. Usually the Slack token could not be read from Vault.")
  fi
done

existing=$(gh issue list --state all --search "in:title \"${TITLE}\"" --json number,title,state 2>/dev/null \
  | jq -r --arg t "$TITLE" '[.[] | select(.title == $t)] | sort_by(.state != "OPEN") | first // empty | "\(.number) \(.state)"')
number=${existing% *}
state=${existing#* }

if [ "${#problems[@]}" -eq 0 ]; then
  echo "Slack alerts look healthy."
  if [ "$DRY_RUN" != "true" ] && [ -n "$existing" ] && [ "$state" = "OPEN" ]; then
    gh issue close "$number" --reason completed \
      --comment "The nightly and triage posted to Slack again, so this is closed automatically. ${RUN_URL:-}"
  fi
  exit 0
fi

body_file=$(mktemp)
{
  echo "_Kept up to date by the **Hub alerts heartbeat** workflow, which does not use Slack. It closes this issue itself once the alerts post again._"
  echo
  echo "Checked on $(date -u -d "@${NOW}" +%F 2>/dev/null || date -u -r "${NOW}" +%F):"
  echo
  printf '%s\n' "${problems[@]}"
  echo
  echo "What to do: see \"If a morning has no nightly post\" in docs/hub-nightly-cookbook.md. The usual cause is the Slack token (Vault role or bot); ask the generator owner."
  [ -n "${RUN_URL:-}" ] && echo && echo "Heartbeat run: ${RUN_URL}"
} > "$body_file"

printf '%s\n' "${problems[@]}"
if [ "$DRY_RUN" = "true" ]; then
  echo "Dry run: not touching issues."
  exit 0
fi

if [ -z "$existing" ]; then
  gh issue create --title "$TITLE" --body-file "$body_file" --label hub
else
  [ "$state" = "OPEN" ] || gh issue reopen "$number"
  gh issue edit "$number" --body-file "$body_file"
  gh issue comment "$number" --body "Still not posting as of $(date -u +%F). ${RUN_URL:-}"
fi
exit 1
