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

The report job starts at 05:00 UTC on Monday, and the Slack message and issues appear when it finishes. The coverage-fix agent starts after that.

**Who acts.** The Hub team. Nobody is pinged: the Slack message is a plain post, and the area issues have no assignee. Someone on the Hub team (the person on call as `hub-medic`) reads the channel on Monday and picks up the gaps and the agent's draft PRs.

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

When the coverage-fix agent has pull requests waiting for review, a reply appears **in the thread** of this message (a week without any such pull requests has no reply):

```
🤖 Coverage-fix agent: 1 PR waiting for review. These were opened by the agent, not a person; please review before merging: #690 ...
```

- "x of y" means: y endpoints document that response, x of them have a test that asserts it. Not every line counts endpoints: "Optional request fields" counts **fields** (63 of 68 fields), and the lifecycle lines count **resources** or **links**.
- A number in brackets is the change since the previous scheduled report. Nothing is shown when it is unchanged or there is no previous report.
- "Endpoints with no test at all" are listed with the issue that explains each one, taken from the `knownIssue` URL on the endpoint's
  entry in `positive-suppress.json` or `request-validation.json`. An endpoint with no such entry is listed bare, which means nobody has explained it yet.
- **What counts as covered.** A test that exists in the generated files and asserts that response. A test left out by a suppression or exclusion in the config (usually for a
  known Hub bug, but an exclusion needs only a `reason`) is **not** counted as tested: it stays in the "of" number and shows as held in the full table. The one exception is
  the "Every kind of bad request" line, which treats a skip in two ways. A **kind** excluded in the config is
  taken out of what that endpoint needs, so the endpoint can still count as fully covered by its other kinds. An endpoint whose
  bad-request tests are **all** skipped or excluded is left out of both numbers.

## Closing a gap

Some gaps need a generator change, not just a Hub setting. An area issue lists, per endpoint, the **missing responses**
and the **missing bad-request tests**. Find the endpoint's row, then use the table for what it lacks.

| The row says it is missing | What it means | Where to look, and the usual fix |
|---|---|---|
| **success** | No success test for the endpoint | First check `configs/camunda-hub/positive-suppress.json`: if it is listed, read its `reason`: it says whether this is a Hub limitation (the fix is on the Hub side), a generator gap (for example the planner cannot source an ID), or an operation left out on purpose. Do not assume it is Hub's. If it is not listed, the generator could not chain the calls the endpoint needs (an ID it cannot create). See `unmappedOperations` in `generated/camunda-hub/playwright/coverage.json`, then teach the generator how to create that resource in `configs/camunda-hub/ontology/` (`entity-kinds.json`, `runtime-states.json`) or the fixtures |
| **400**, **401**, **403**, **404** | A bad-request, no-auth, forbidden or not-found test is missing | Generated when the operation is eligible and not excluded. First check `excludeOperations` in `configs/camunda-hub/request-validation.json` (the entry always has a `reason`; a Hub issue is optional, and some exclusions such as `purgeFile` and `addMember` have only a reason). If it is not excluded, it is not eligible: **403** needs a request that reaches the authorization check, so a valid fixture-backed request body and path (`resourceFixtures` in the same file; the rule is `isAuthDenyEligible` in `request-validation/src/analysis/authDeny.ts`), and **404** needs an ID the generator can make up (`isNotFoundEligible` in `request-validation/src/analysis/notFoundFakeId.ts`). The fix is then fixture modelling or the eligibility rule, not an exclusion. The modes `authAbsentMode`, `authDenyMode` and `notFoundMode` in the same file set how Hub is expected to answer. A 404 test needs an ID it can make up, so an endpoint with no path key needs the not-found generator extended (`notFoundFakeId.ts` and the emitter that writes its tests). Do not add a test file by hand: generation deletes the output folder every time, and the report only counts generated files |
| **409** | A documented conflict is not tested (only a 409 the spec documents is counted) | Needs a state first. In `configs/camunda-hub/conflict-replay.json`, use `replay` when repeating the same call is enough to conflict (a duplicate create), or `sequences` for setup calls followed by the call that should answer 409 (for example restoring a file whose project was deleted). List it under `untested` with an issue if it cannot be provoked. The weekly report reads the latest Hub `main` spec, but the invariant tests use the pinned one (`spec-pin.json`), and they fail an entry for a 409 the pinned spec does not document: if the 409 is new, bump the pin first (see the README) |
| **a bad-request kind** (for example `allof-conflict`, `union`, `missing-body`) | The endpoint has no test of that kind | Generated from the spec's schema. For the body-shape kinds the report can list a kind that cannot be built for that endpoint, so first generate (see below) and look for the endpoint in `generated/camunda-hub/request-validation/COVERAGE.md`. If the kind applies but is not generated, the fix is in the generator's code (`request-validation/src/analysis/`, and `request-validation/scripts/generate.ts` decides which kinds count as applicable), not in config. If it does not apply it is an over-count: there is no switch today to mark a kind not applicable, so say so in the issue and leave it open |
| **Lifecycle tests** (in the weekly Slack message, not in an area issue) | A resource or link has no create, read, delete flow | Add it to `configs/camunda-hub/ontology/entity-kinds.json` or `edges.json` |

After the fix:

1. Regenerate and run the report, and check that the number moved. With `../camunda-hub` checked out and up to date:

   ```bash
   CONFIG=camunda-hub npm run fetch-spec
   CONFIG=camunda-hub npm run testsuite:generate
   CONFIG=camunda-hub npm run generate:request-validation
   python3 scripts/e2e/hub_response_coverage.py --out /tmp/cov
   cat /tmp/cov/slack.txt
   ```

   Or run the "Hub response coverage" workflow from the Actions tab. It is a dry run by default and posts nothing; `hub_ref` picks the camunda-hub branch or commit to audit.
2. Run `CONFIG=camunda-hub npx vitest run tests/request-validation configs/camunda-hub/regression-invariants.test.ts`. The report only reads the generated files; to see the new test pass against a real Hub, run the `hub-ondemand-test` workflow on your branch (Actions, Run workflow).
3. Raise the matching number in `configs/camunda-hub/coverage-floors.json` in the same PR.
4. If the fix needed a flag or a new resource, see [Adding or changing an endpoint in Hub](hub-pr-check-cookbook.md#adding-or-changing-an-endpoint-in-hub-do-you-need-a-generator-pr) for the labels.

`AGENTS.md` has more on each config file, but it is written for AI agents and is long. If a step here is unclear, ask in
`#ask-qa`.

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
2. **An endpoint with no 403 (forbidden) or 404 (not found) test.** The agent reads the cause first. If the only thing
   missing is a small config entry that the test setup already supports, it adds it. If the only thing missing is a test
   record that the setup could create through a Hub call the API spec describes (for example a workspace member), it may
   also add a few lines to `scripts/e2e/run-hub.sh` that create it. Those lines are additions only, at most eight, in one
   block right after an existing fixture line, and each must be one of a few fixed shapes (the verify job rejects anything else). Its pull request then has a section
   called **"Setup change: needs careful review"**. Everything else (generator code, a product setting, an exclusion that
   was decided on purpose) gets **no pull request**: the agent writes down the change it would make and why a person
   should decide, and that text appears in the run summary of the workflow run.

**Every pull request opens with "In plain words".** A short section in everyday words that says what was missing, what
the pull request adds, why it is safe to look at and what to do next, so that someone who has never seen the generator can
follow it. The verify job fails the run if it is missing.

**One exception to know about.** Sometimes an existing check says "this resource must have its own separate test file",
and the new lifecycle test replaces those files. The agent may then adapt that one check, but only so that it asks for
the same proof in the new place, never less. Its pull request has a section called **"Test change: needs careful
review"** that shows the check before and after. Read that section first.

**How you recognise its pull requests.** They are drafts, opened by the `qa-processes` bot, on a branch starting with
`fix/coverage-`, with the labels `nightly-api-fix`, `auto-generated` and `hub`. The body ends with
"Found by the camunda-hub coverage-fix agent". The thread under the weekly Slack message lists the ones still open.

**Who reviews them.** A person, always, like any other pull request. The native live Hub check (`hub-pr-live-check`)
skips the agent's pull requests: it would run the agent's code with Hub access before anything had checked it. What
happens instead depends on the kind of pull request.

- **Pull requests with constrained content** start by themselves. That is a 403/404 pull request (one fixture entry, the
  floors, and the fixture block of the setup script) or a lifecycle pull request that changes only the floors and adds one
  plain-data entry to `entity-kinds.json`. Once the `verify` job has checked them from GitHub, it pins the commit it checked
  under a `hub-live-check/*` tag, starts `hub-ondemand-test` on that tag (not on the branch, which could move afterwards)
  and comments the run link on the pull request. The run covers exactly that commit; a later push is not tested. Its result
  is that run's status, not a check on the pull request. Read the diff and that run, and only then mark the pull request
  ready. If the verify job fails, no live check starts.
- **A lifecycle pull request that also edits the invariants test file** (code, not data) stays manual: read the diff, then
  run `hub-ondemand-test` on the branch, and only then mark the pull request ready.

A pull request that sits unreviewed is closed by the same stale-PR clean-up as the nightly fix pull requests.

**What it tells people.** After a real run, the `verify` job posts what the agent found, including the gaps that got no PR:
one comment on the weekly tracking issue (the full record: each gap, what the agent did, its reason and proposal) and one
reply in the weekly Slack message's thread (one line per gap, with links to the PRs). Nothing is posted for a dry run or
for a run with no PR and no gap. The agent's text is untrusted: it is cleaned and cut before posting, and the PR links come
from GitHub. The Slack reply needs the weekly report run to have saved its Slack message id (artifact
`hub-coverage-slack-ts`); a report from before that existed gets only the issue comment, and the run says so in a warning.
A failed post never fails the run.

**How it runs.** Two ways.

- **By hand:** start the workflow [`hub-coverage-fix.yml`](../.github/workflows/hub-coverage-fix.yml) from the Actions tab.
  It is a **dry run by default**: it does everything except push and open the pull request, so you can read what it would
  do. Untick "dry run" to let it open real draft pull requests. It reads the latest weekly report, so run the weekly
  report first if you changed something.
- **After the weekly report:** when the scheduled weekly report run finishes successfully, the coverage-fix starts by
  itself, as a real run, on the report that run just produced. It is on by default. To switch it off, set the repository
  variable `COVERAGE_FIX_AUTO` to `false` (Settings, Secrets and variables, Actions, Variables); delete the variable to
  switch it on again. No code change is needed. A manual run of the weekly report does not start it, and neither does a
  weekly report that failed (a failed Slack post counts as a failed report).

**Limits.** The limits are checked by code, not by the agent. At most one pull request per API area, and a separate job checks from GitHub that the agent opened only what it was allowed to.
