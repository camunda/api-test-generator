# Hub coverage report: internals

Detail behind [the coverage report guide](../hub-response-coverage-report.md).

## How it runs

```
Monday 05:00 UTC (or workflow_dispatch)
  ├── clone camunda-hub main next to this repo, bundle its spec
  ├── generate the positive and request-validation suites
  ├── download the previous run's summary.json (for the brackets)
  ├── hub_response_coverage.py  → summary.json, rows.json, matrix.md, slack.txt, issue.md, areas.json, history.csv
  ├── per-area issues   (hub-coverage-area-issues.sh)   ← runs first, writes area-index.md
  ├── tracking issue    (hub-coverage-summary-issue.sh) ← fills <!-- AREA_INDEX --> from area-index.md
  ├── render page.html, upload the artifact, write the run summary
  └── post to Slack
```

Issue rules:

- The tracking issue is opened or rewritten while any endpoint is missing something, and closed once nothing is.
- Each API area (the spec's first tag) with a gap gets its own issue: found by exact title in any state,
  rewritten in place, reopened if a gap comes back, closed when the area is clean.
- At most 10 brand-new area issues are opened per run. An area without an issue yet is listed in the tracking issue with its endpoints, and gets its issue on a later run.
- The older manual epic #618 is not read or touched.

The script exits non-zero if the generated test format no longer parses, so a format change fails the run instead of reporting zeros.

## Running it yourself

Dry run on GitHub (posts nothing): Actions → "Hub response coverage" → Run workflow. `dry_run` defaults to true.
Untick it to open or update the issues and post to Slack. `hub_ref` picks the camunda-hub branch or SHA to audit.

Locally, with `../camunda-hub` checked out and up to date:

```bash
CONFIG=camunda-hub npm run fetch-spec
CONFIG=camunda-hub npm run testsuite:generate
CONFIG=camunda-hub npm run generate:request-validation
python3 scripts/e2e/hub_response_coverage.py --out /tmp/cov [--previous old/summary.json]
cat /tmp/cov/slack.txt
```

## Changing the report

- Slack wording and layout: `slack()` in the script. Tests: `tests/request-validation/hub-gap-issue.test.ts` (stub `gh`, so no network).
- Issue bodies: `issue_body()` and `area_issues()` in the script; the shell scripts only open, edit and close.
- After a change, run a dry run and read `slack.txt` before merging.

## The coverage-fix agent: limits

Checked by code, not by the agent. At most one pull request per API area (an open or recently merged pull
request holds its area; one that was closed without merging does not, so a gap can be tried again), and none for a
resource that another open fix pull request already covers. After every run a separate job checks, from GitHub, that the agent opened
only what it was allowed to open, as drafts, with the right labels, and nothing else. The same job reads each pull
request's changed files from GitHub: a lifecycle fix may only touch the entity list, the floors and the one adapted check; a
403 or 404 fix may only add fixture entries to the request-validation config and raise one floor. Any other file, a
changed exclusion, a lowered floor or a new "no test at all" entry fails the run.


