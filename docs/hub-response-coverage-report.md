# Hub response coverage report

> **Goal:** know, every week, which camunda-hub endpoints are missing a test, and know what to do about it.

The report answers one question: for each endpoint in the latest camunda-hub API spec, does the
generated test suite check every response the spec lists, and every kind of bad request that applies?
It reads the generated test files. It does not start Hub, so it cannot fail because of a flaky backend.

Workflow: [`hub-response-coverage.yml`](../.github/workflows/hub-response-coverage.yml). Analysis:
[`scripts/e2e/hub_response_coverage.py`](../scripts/e2e/hub_response_coverage.py).

## What you get each Monday

| Where | What it shows |
|---|---|
| Slack `#camunda-hub-nightly-test-results` | The summary (see below) |
| Tracking issue `[hub-response-coverage] Endpoints missing response or bad-request tests` | An index: one line per API area, linking to that area's issue |
| One issue per API area `[hub-response-coverage] <Area>: missing response or bad-request tests` | A table of that area's endpoints and what each is missing |
| Run summary and the `hub-coverage-report` artifact | The full per-endpoint table, `history.csv` (one row per scheduled run), `page.html` |

### Reading the Slack message

The numbers below are an example.

```
Hub API test coverage (weekly)
camunda-hub@abc1234 · 66 endpoints · 1203 negative tests

56 of 66 endpoints have a test for every response the API spec lists (+2). A number in brackets is the change since the last report.

Positive tests (the request is right)
• Success (2xx): 64 of 66
• Optional request fields sent in a success test: 63 of 68
• Endpoints that never check the shape of the success response: 0
• Resources with a create, read and delete flow test: 4 of 6. Missing: ProjectSnapshot, Version
• Resources with a delete and restore flow test: 4 of 4

Negative tests (the request is wrong)
• Bad request (400), Not authenticated (401), Forbidden (403), Not found (404), Conflict (409): "x of y" each
• Every kind of bad request tested: 32 of 36 endpoints. <which kinds are missing most often>

Across positive and negative tests
• Biggest gaps ...
• N endpoints are missing a test for a success, 400, 401, 404 or 409 response
```

- "x of y" means: y endpoints document that response, x of them have a test that asserts it.
- A number in brackets is the change since the previous scheduled report. Nothing is shown when it is unchanged or there is no previous report.
- A "resource" is something the API lets you create, read by key and delete (files, folders, projects, and so on; one nested under a parent key counts too); it needs a
  restore flow too if a delete is soft: the key path has a `.../restoration` endpoint and the collection has a
  `.../recently-deleted/search` endpoint. A restoration endpoint alone does not count (restoring a version or a snapshot does not undelete anything). A flow test is the generated lifecycle test for it
  (`generated/camunda-hub/playwright/templates/EntityLifecycle/<Resource>.lifecycle.spec.ts`, and `RestoreLifecycle/` for restore).
  A resource with no such test is listed as missing. These lines count whole flows, so they do not show up in the per-endpoint issues.
  A new resource needs an entry in `configs/camunda-hub/ontology/entity-kinds.json` to get its flow tests.
- 500 responses are not counted. 403 is counted but not part of the "missing a test" roll-up (it is tracked separately).
- "Every kind of bad request" counts kinds with at least one test (missing required field, wrong type, bad enum, and so on), not how many tests each kind has.
  It is only as complete as the generator's own rules for when a kind applies, so for body-schema kinds treat it as an upper bound.

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

## Closing a gap

1. Open the area issue and find the endpoint and the response or bad-request kind it lacks.
2. Add the test. Most are derived automatically; state-dependent 409/400 cases are written by hand in
   `configs/camunda-hub/conflict-replay.json`. Search paging and optional fields have their own
   `auto`/`exclude` config files. See AGENTS.md for each.
3. Regenerate and check the number moved with the local command above.
4. Raise the matching floor in `configs/camunda-hub/coverage-floors.json`.

### Floors

`coverage-floors.json` pins the numbers this report shows. The Hub invariant `response coverage does not regress`
runs the same script and fails a PR if a number drops below its floor, or if an endpoint has no test at all
and is not listed in `zeroTestOperations` with a reason. A floor only goes up. Never lower one to make CI pass; add the missing test.

## Changing the report

- Slack wording and layout: `slack()` in the script. Tests: `tests/request-validation/hub-gap-issue.test.ts` (stub `gh`, so no network).
- Issue bodies: `issue_body()` and `area_issues()` in the script; the shell scripts only open, edit and close.
- After a change, run a dry run and read `slack.txt` before merging.
