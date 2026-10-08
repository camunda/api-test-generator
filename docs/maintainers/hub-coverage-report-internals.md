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

## How the numbers are counted

More on what the lines in the Slack message count.

- A "resource" is something the API lets you create, read by key and delete (files, folders, projects, and so on; one nested under a parent key counts too); it needs a
  restore flow too if a delete is soft: the key path has a `.../restoration` endpoint and the collection has a
  `.../recently-deleted/search` endpoint. A restoration endpoint alone does not count (restoring a version or a snapshot does not undelete anything). A lifecycle test is the generated test for it
  (`generated/camunda-hub/playwright/templates/EntityLifecycle/<Resource>.lifecycle.spec.ts`, and `RestoreLifecycle/` for restore).
  A resource with no such test is listed as missing. The lifecycle lines count whole journeys, so they do not show up in the per-endpoint issues.
  A new resource needs an entry in `configs/camunda-hub/ontology/entity-kinds.json` to get its lifecycle tests.
- An "add-and-remove link" is a POST on a nested path whose sub-path has a DELETE but cannot be read by key (workspace members:
  `POST /workspaces/{key}/members`, `DELETE /workspaces/{key}/members/{email}`). It counts as covered when an edge in
  `configs/camunda-hub/ontology/edges.json` names both operations (`establishedBy`, `revokedBy`) and its
  `EdgeLifecycle/<Edge>.lifecycle.spec.ts` was generated. A new link is listed by its add operation until the edge is added.
- The report's "Negative tests" section also counts 409 (a request that is wrong for the current state), although the generated 409 tests live in the positive suite, because they need setup calls first.
- 500 responses are not counted. 403 is counted but not part of the "missing a test" roll-up (it is tracked separately).
- "Every kind of bad request" counts kinds with at least one test (missing required field, wrong type, bad enum, and so on), not how many tests each kind has. A kind skipped on purpose is not counted as missing and does not count as tested; it only leaves the endpoint's list of needed kinds.
  It is only as complete as the generator's own rules for when a kind applies, so for body-schema kinds treat it as an upper bound: the headline can overstate real coverage.

## The two generator floors

One floor guards the generator itself: `requestKindEndpoints` keeps, for each kind of bad-request test the suite
generates, how many endpoints have at least one test of that kind. The report names a kind as missing only when the
generator can build it, so a generator that quietly stops producing a kind would not appear there; this floor makes
that fail the build instead.

A second floor, `requestScenarioTypes`, does the same for a type of test that the coverage data counts under another
kind's name (a top-level wrong-type body test, `body-top-type-mismatch`, is counted as `type-mismatch`). It keeps the
raw number of tests of that type, so that generator cannot disappear while the kind it is counted under keeps the same
endpoints. Raise either floor in the same PR that makes more endpoints or tests get that kind; if a type counted under
another kind appears without a floor, the build fails until one is added. The script needs `MANIFEST.json` (written
with `COVERAGE.json` by the request-validation generator) and stops with an error if it is missing.
