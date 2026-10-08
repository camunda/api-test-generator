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
• Lifecycle tests (create, read, delete): 4 of 6 resources. Missing: ProjectSnapshot, Version
• Lifecycle tests (delete, restore): 4 of 4 resources
• Lifecycle tests (add, remove): 1 of 1 links

Negative tests (the request is wrong)
• Bad request (400), Not authenticated (401), Forbidden (403), Not found (404), Conflict (409): "x of y" each
• Every kind of bad request tested: 32 of 64 endpoints. <which kinds are missing most often>

Across positive and negative tests
• Biggest gaps ...
• N endpoints are missing a test for a success, 400, 401, 404 or 409 response

Tracking issue · Area issues: ...
```

When the coverage-fix agent has pull requests waiting for review, a reply appears **in the thread** of this message:

```
🤖 Coverage-fix agent: 1 PR waiting for review. These were opened by the agent, not a person; please review before merging: #690 ...
```

- "x of y" means: y endpoints document that response, x of them have a test that asserts it. Not every line counts endpoints: "Optional request fields" counts **fields** (63 of 68 fields), and the lifecycle lines count **resources** or **links**.
- The thread reply, starting with the robot, appears only when the coverage-fix agent (see "The coverage-fix agent" below) has pull requests waiting for review. It says how many and links each one. A week without such PRs has no reply, and the main message never changes.
- A number in brackets is the change since the previous scheduled report. Nothing is shown when it is unchanged or there is no previous report.
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
- "Endpoints with no test at all" are listed with the issue that explains each one, taken from the `knownIssue` URL on the endpoint's
  entry in `positive-suppress.json` or `request-validation.json`. An endpoint with no such entry is listed bare, which means nobody has explained it yet.
- **What counts as covered.** A test that exists in the generated files and asserts that response. A test left out by a suppression or exclusion in the config (usually for a
  known Hub bug, but an exclusion needs only a `reason`) is **not** counted as tested: it stays in the "of" number and shows as held in the full table. The one exception is
  the "Every kind of bad request" line, which treats a skip in two ways. A **kind** excluded in the config is
  taken out of what that endpoint needs, so the endpoint can still count as fully covered by its other kinds. An endpoint whose
  bad-request tests are **all** skipped or excluded is left out of both numbers.
- The report's "Negative tests" section also counts 409 (a request that is wrong for the current state), although the generated 409 tests live in the positive suite, because they need setup calls first.
- 500 responses are not counted. 403 is counted but not part of the "missing a test" roll-up (it is tracked separately).
- "Every kind of bad request" counts kinds with at least one test (missing required field, wrong type, bad enum, and so on), not how many tests each kind has. A kind skipped on purpose is not counted as missing and does not count as tested; it only leaves the endpoint's list of needed kinds.
  It is only as complete as the generator's own rules for when a kind applies, so for body-schema kinds treat it as an upper bound: the headline can overstate real coverage.

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

This is maintainer work: it needs the generator, not just Hub. An area issue lists, per endpoint, the **missing responses**
and the **missing bad-request tests**. Find the endpoint's row, then use the table for what it lacks.

| The row says it is missing | What it means | Where to look, and the usual fix |
|---|---|---|
| **success** | No success test for the endpoint | First check `configs/camunda-hub/positive-suppress.json`: if it is listed, read its `reason`: it says whether this is a Hub limitation (the fix is on the Hub side), a generator gap (for example the planner cannot source an ID), or an operation left out on purpose. Do not assume it is Hub's. If it is not listed, the generator could not chain the calls the endpoint needs (an ID it cannot create). See `unmappedOperations` in `generated/camunda-hub/playwright/coverage.json`, then teach the generator how to create that resource in `configs/camunda-hub/ontology/` (`entity-kinds.json`, `runtime-states.json`) or the fixtures |
| **400**, **401**, **403**, **404** | A bad-request, no-auth, forbidden or not-found test is missing | Generated when the operation is eligible and not excluded. First check `excludeOperations` in `configs/camunda-hub/request-validation.json` (the entry always has a `reason`; a Hub issue is optional, and some exclusions such as `purgeFile` and `addMember` have only a reason). If it is not excluded, it is not eligible: **403** needs a request that reaches the authorization check, so a valid fixture-backed request body and path (`resourceFixtures` in the same file; the rule is `isAuthDenyEligible` in `request-validation/src/analysis/authDeny.ts`), and **404** needs an ID the generator can make up (`isNotFoundEligible` in `request-validation/src/analysis/notFoundFakeId.ts`). The fix is then fixture modelling or the eligibility rule, not an exclusion. The modes `authAbsentMode`, `authDenyMode` and `notFoundMode` in the same file set how Hub is expected to answer. A 404 test needs an ID it can make up, so an endpoint with no path key needs the not-found generator extended (`notFoundFakeId.ts` and the emitter that writes its tests). Do not add a test file by hand: generation deletes the output folder every time, and the report only counts generated files |
| **409** | A documented conflict is not tested (only a 409 the spec documents is counted) | Needs a state first. In `configs/camunda-hub/conflict-replay.json`, use `replay` when repeating the same call is enough to conflict (a duplicate create), or `sequences` for setup calls followed by the call that should answer 409 (for example restoring a file whose project was deleted). List it under `untested` with an issue if it cannot be provoked. The weekly report reads the latest Hub `main` spec, but the invariant tests use the pinned one (`spec-pin.json`), and they fail an entry for a 409 the pinned spec does not document: if the 409 is new, bump the pin first (see the README) |
| **a bad-request kind** (for example `allof-conflict`, `union`, `missing-body`) | The endpoint has no test of that kind | Generated from the spec's schema. For the body-shape kinds the report can list a kind that cannot be built for that endpoint, so first generate (see below) and look for the endpoint in `generated/camunda-hub/request-validation/COVERAGE.md`. If the kind applies but is not generated, the fix is in the generator's code (`request-validation/src/analysis/`, and `request-validation/scripts/generate.ts` decides which kinds count as applicable), not in config. If it does not apply it is an over-count: there is no switch today to mark a kind not applicable, so say so in the issue and leave it open |
| **Lifecycle tests** (in the weekly Slack message, not in an area issue) | A resource or link has no create, read, delete flow | Add it to `configs/camunda-hub/ontology/entity-kinds.json` or `edges.json` |

After the fix:

1. Regenerate and run the report with the commands in "Running it yourself" above, and check that the number moved.
2. Run `CONFIG=camunda-hub npx vitest run tests/request-validation configs/camunda-hub/regression-invariants.test.ts`. The report only reads the generated files; to see the new test pass against a real Hub, run the `hub-ondemand-test` workflow on your branch (Actions, Run workflow).
3. Raise the matching number in `configs/camunda-hub/coverage-floors.json` in the same PR.
4. If the fix needed a flag or a new resource, see "Adding or changing an endpoint in Hub" in the PR-check cookbook for the labels.

`AGENTS.md` has more on each config file, but it is written for AI agents and is long. If a step here is unclear, ask in
`#camunda-hub-pr-e2e-results`.

### Floors

`coverage-floors.json` pins the numbers this report shows. The Hub invariant `response coverage does not regress`
runs the same script and fails a PR if a number drops below its floor, or if an endpoint has no test at all
and is not listed in `zeroTestOperations` with a reason. A floor only goes up. Never lower one to make CI pass; add the missing test.

## The coverage-fix agent

Some gaps are small and safe to fix, so an AI agent can fix them and open a pull request for a person to review.
It is a helper: it never merges anything.

**What it fixes.** Two kinds of gap:

1. **A resource with no "create, read, delete" test** (the "Lifecycle tests (create, read, delete)" line in the Slack
   message). The fix is to add the resource to `configs/camunda-hub/ontology/entity-kinds.json` so the generator writes
   that test, and to raise the matching number in `coverage-floors.json`.
2. **An endpoint with no 403 (forbidden) or 404 (not found) test**, but only when the cause is a small config entry
   that the test setup can already satisfy. Most of these gaps need something else: a test record that setup does not
   create yet (for example a workspace member), a change in the generator's own code, or they are left out on purpose.
   For those the agent opens **no pull request**. It writes down the exact change it would make (for a missing test
   record, the lines to add to `scripts/e2e/run-hub.sh`, the config entry and the floor) so a person can apply it. That
   text appears in the run summary of the workflow run. The agent never edits setup scripts itself: a live Hub run
   executes a pull request's own code with Hub access, and after the merge the script runs in every Hub suite, so a
   change to it must be written or approved by a person first.

**One exception to know about.** Sometimes an existing check says "this resource must have its own separate test file",
and the new lifecycle test replaces those files. The agent may then adapt that one check, but only so that it asks for
the same proof in the new place, never less. Its pull request has a section called **"Test change: needs careful
review"** that shows the check before and after. Read that section first.

**How you recognise its pull requests.** They are drafts, opened by the `qa-processes` bot, on a branch starting with
`fix/coverage-`, with the labels `nightly-api-fix`, `auto-generated` and `hub`. The body ends with
"Found by the camunda-hub coverage-fix agent". The thread under the weekly Slack message lists the ones still open.

**Who reviews them.** A person, always, like any other pull request. The native live Hub check (`hub-pr-live-check`) skips the
agent's pull requests: it would run the agent's code with Hub access before anything had checked it. Instead, once the
`verify` job has checked the pull requests from GitHub (files, config, floors), it pins the commit it checked under a
`hub-live-check/*` tag, starts `hub-ondemand-test` on that tag (not on the branch, which could move afterwards) and
comments the run link on the pull request. The run covers exactly that commit; a later push is not tested. That is the same live check, started automatically but
only after verification; its result is that run's status, not a check on the pull request. Read the diff and that run,
and only then mark the pull request ready. If the verify job fails, no live check starts. A pull request that sits unreviewed is closed by the
same stale-PR clean-up as the nightly fix pull requests.

**How it runs today.** By hand only: start the workflow
[`hub-coverage-fix.yml`](../.github/workflows/hub-coverage-fix.yml) from the Actions tab. It is a **dry run by default**:
it does everything except push and open the pull request, so you can read what it would do. Untick "dry run" to let it
open real draft pull requests. It reads the latest weekly report, so run the weekly report first if you changed
something.

**Limits, checked by code, not by the agent.** At most one pull request per API area, and none for a resource that
another open fix pull request already covers. After every run a separate job checks, from GitHub, that the agent opened
only what it was allowed to open, as drafts, with the right labels, and nothing else. The same job reads each pull
request's changed files from GitHub: a lifecycle fix may only touch the entity list, the floors and the one adapted check; a
403 or 404 fix may only add fixture entries to the request-validation config and raise one floor. Any other file, a
changed exclusion, a lowered floor or a new "no test at all" entry fails the run.

## Changing the report

- Slack wording and layout: `slack()` in the script. Tests: `tests/request-validation/hub-gap-issue.test.ts` (stub `gh`, so no network).
- Issue bodies: `issue_body()` and `area_issues()` in the script; the shell scripts only open, edit and close.
- After a change, run a dry run and read `slack.txt` before merging.
