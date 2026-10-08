#!/usr/bin/env bash
# Starts the live Hub check (hub-ondemand-test.yml) on each PR of this coverage-fix run, after the verify step passed.
#
# The live run has Hub access and runs the code of the ref it is started on. So it is started on a tag pinned at
# the exact commit the verify step inspected (headRefOid of the PR list snapshot), never on a branch name, which could
# move to an unverified commit between the check and the dispatch.
#
# Inputs (environment): RUN_PRS (the PR list JSON the verifier used), BASELINE (PR number above which PRs are this
# run's), GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_REPOSITORY, GITHUB_SERVER_URL, GH_TOKEN.
# Optional: POLL_SECONDS (default 10), POLL_TRIES (default 12).
#
# Exit code is non-zero if any PR got no live check or no comment, so a gap is visible in the run.
set -uo pipefail

failed=0
poll_seconds="${POLL_SECONDS:-10}"
poll_tries="${POLL_TRIES:-12}"
seen_dir="$(mktemp -d)"

tag_for() { echo "hub-live-check/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-$1"; }
note() {
  gh pr comment "$1" --repo "$GITHUB_REPOSITORY" --body "$2" || {
    echo "::warning::Could not comment on PR #$1"
    failed=1
  }
}

# First start every run, then look for all of them together: the lookup wait is paid once, not once per PR, because
# the number of PRs per run is not capped.
runs_of() {
  gh run list --repo "$GITHUB_REPOSITORY" --workflow=hub-ondemand-test.yml \
    --event workflow_dispatch --commit "$1" --limit 30 --json databaseId --jq '.[].databaseId'
}
pending=""
for n in $(jq -r --arg run "$GITHUB_RUN_ID" --argjson base "$BASELINE" \
  '.[] | select(.number > $base and .state == "OPEN" and (.headRefName | test("^fix/coverage-.+-" + $run + "$"))) | .number' \
  "$RUN_PRS"); do
  sha="$(jq -r --argjson n "$n" '.[] | select(.number == $n) | .headRefOid' "$RUN_PRS")"
  tag="$(tag_for "$n")"
  # Without the list of runs that already exist for this commit, a new run cannot be told from an old one: do not start.
  if [ -z "$sha" ] || [ "$sha" = null ] || ! runs_of "$sha" > "$seen_dir/$n" 2>/dev/null \
    || ! gh api -X POST "repos/${GITHUB_REPOSITORY}/git/refs" -f ref="refs/tags/${tag}" -f sha="$sha" >/dev/null \
    || ! gh workflow run hub-ondemand-test.yml --repo "$GITHUB_REPOSITORY" --ref "$tag"; then
    echo "::warning::Could not start the live Hub check for PR #$n"
    note "$n" "The live Hub check could not be started automatically. Run \`hub-ondemand-test.yml\` on the branch before merging."
    failed=1
    continue
  fi
  pending="$pending $n:$sha"
done

# A run started on a tag is matched by the commit it runs and by being new: its id was not among the runs of that commit
# before this script dispatched it. That keeps an earlier attempt's run, or any earlier dispatch of the same commit,
# from being linked by mistake. No clock is involved.
for _ in $(seq 1 "$poll_tries"); do
  [ -n "$pending" ] || break
  sleep "$poll_seconds"
  still=""
  for item in $pending; do
    n="${item%%:*}"
    sha="${item#*:}"
    id="$(runs_of "$sha" 2>/dev/null | grep -vxFf "$seen_dir/$n" | head -n 1)"
    if [ -n "$id" ]; then
      note "$n" "The live Hub check was started automatically on the verified commit ${sha:0:7} after the verify job passed: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${id}"
    else
      still="$still $item"
    fi
  done
  pending="$still"
done
for item in $pending; do
  n="${item%%:*}"
  sha="${item#*:}"
  note "$n" "The live Hub check was started on the verified commit ${sha:0:7}, but its run could not be found. See the hub-ondemand-test.yml runs on tag \`$(tag_for "$n")\`."
  failed=1
done
exit "$failed"
