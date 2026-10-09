# Hub PR check: maintainer reference

Detail behind [the PR check guide](../hub-pr-check-cookbook.md). You do not need this to act on a red check.

## What this check is

The suite is **generated fresh from each PR's own OpenAPI spec** and run against that PR's image.
Because the suite changes with every PR, red does not always mean "the PR broke Hub": it is just as
likely that api-test-generator does not yet model a new or changed endpoint. The `classify` job
exists to tell those apart.

```
camunda-hub PR (non-draft, not a fork, base not self-managed/*)
  └── trigger-api-test-generator.yml          (camunda-hub)
        ├── path gate: skip if every changed file is frontend/e2e/docs/.claude/.agents
        ├── wait for build-restapi-self-managed → image pr-<sha>
        └── repository_dispatch: camunda-hub-pr
              └── hub-pr-check.yml            (this repo)
                    ├── validate     payload (40-char sha, pr number, base_ref, draft?)
                    ├── run          _hub-suite-run.yml: generate → start Hub → positive + secured + rbac
                    ├── classify     read-only agent, only after a failed run that ran the suites
                    ├── coverage-gap-tracker   issue for operations with no generated test
                    └── report       commit status + PR comment (rarely) + Slack
```

## Who gets told what

The pings below are what the workflows do today. They change with [#712](https://github.com/camunda/api-test-generator/issues/712).

| Outcome | Status | Slack (`#camunda-hub-pr-e2e-results`) | Comment on the camunda-hub PR | Issue in api-test-generator |
|---|---|---|---|---|
| Pass | `success` | no | no | none |
| Draft PR, run by hand, fails (drafts are skipped otherwise) | `failure` | no | no | none |
| Startup failure | `failure` | yes, hub-medic + test-automation-medic | no | none |
| Pre-suite failure | `failure` | yes, test-automation-medic | no | none |
| product (high confidence) | `failure` | yes, hub-medic + test-automation-medic | no | none |
| product (lower), infra, flaky, unknown, **with evidence** (a failing spec or unmapped operations) | `failure` | yes, test-automation-medic | no | none |
| any **suite** failure with **no evidence** (the suite ran but left no readable report, and nothing says what failed; not startup or pre-suite) | `failure` | one quiet reply per PR per day, nobody pinged until the 3rd time that day | no | none |
| generator-gap on an operation the PR did not touch | `failure` | yes, test-automation-medic | no | none (Slack only; the nightly sees the same gap later) |
| generator-gap caused by the PR's own spec change (high confidence) | `failure` | yes, test-automation-medic | **yes**, one sticky comment | **`Generator gap on camunda-hub#N`**, assigned to the PR author when possible (see below) |

**One more issue can appear in any row:** if some endpoints have no generated test at all, `[hub-pr-check] Coverage gap
on camunda-hub#N` is opened (labels `missing-coverage` and `hub`, not assigned) and closed again once every endpoint
has a test. It is separate from the `Generator gap` issue above.

**Assignment is best effort.** The issue is assigned to the camunda-hub PR's author only when that author is a plain GitHub
login (bots such as `dependabot[bot]` are skipped) and has access to this repo. If GitHub rejects the login, the run logs a
warning and the issue stays **unassigned**. The title always names the camunda-hub PR, so if you find no assignee, ask in
`#ask-qa` (tag `@test-automation-medic`). The `Coverage gap` issue is a different issue and is never assigned.

Every Slack reply lists the source PR and commit, then one line of links: the run, the camunda-hub run that triggered it, and this cookbook.

### Why a Slack message is sometimes edited instead of posted again

To keep the channel readable, the alert for a PR is **edited** when it fails the same way again, and a **new** message is
posted only when the failure changes. "The same way" is the *fingerprint*: the list of failing tests plus the endpoints
that have no test. Alerts are grouped in one Slack thread per day, with one reply per PR and failure.

Example for PR #28390: a push fails `createFile` and `updateFolder`, so a new message is posted and the medic is pinged.
The next push fails the same two, so the message is edited and nobody is pinged. A later push fails only `createFile`:
the fingerprint changed, so a new message is posted and the medic is pinged again.

A startup or pre-suite failure is identified by its category: one reply per PR per day, paged once. A failure with no
readable report cannot be told apart from the previous push's, so those share one quiet reply per PR per day. If the same PR
fails this way a 3rd time that day, one extra reply pings `test-automation-medic`, because by then it is the pipeline, not
the PR. The count is stored in the reply (`seen:N`) and counts failures that day, not only consecutive ones.

## Debugging steps

1. **Open the run** from the status's "Details" link (it points at the `hub-pr-check.yml` run in
   this repo). The run summary has the PR number, sha, image and a link back to the camunda-hub run.
2. **Download the `hub-suite-reports` artifact.** `pw-positive.json`, `pw-secured.json`,
   `pw-rbac.json` (+ `.junit.xml`, HTML reports) and `pw-*.stderr.log`. A directory with only logs
   means Playwright died before writing a report: look at the stderr log, not at the PR.
3. **Find the failing tests.** Playwright nests `suites[].suites[].specs[]`. A spec with
   `ok: false` ended in an unexpected outcome; its per-attempt `results[].status` shows whether any
   attempt passed (a passed attempt is flakiness evidence; none passed is deterministic). The negative suite attaches `request.json` / `response.json`
   inline in the JSON report: that exchange is the real evidence.
4. **Resolve the operation in the spec.** The PR's spec is `restapi/public-api/src/main/resources/
   openapi/v2` in camunda-hub. Diff it against the PR's base (not `main`: camunda-hub stacks work).
   - Operation **new or changed** by the PR and the test's expectation does not fit the new shape →
     generator gap.
   - Operation **unchanged** and still wrong → either the PR regressed it through shared code, or
     it was always broken. Only call it a regression with a specific causal change in the PR's code.
5. **Check the known-issue configs.** `configs/camunda-hub/positive-suppress.json` and
   `configs/camunda-hub/request-validation.json` (`knownIssue` / `knownProblemDetailShapeGaps`). A
   match means it is already tracked.
6. **Coverage gaps.** `coverage.json` → `summary.unmappedOperations` lists operations with no
   generated test. These never appear as a failing test.

## Reproducing locally

You need Docker, Node 22, Python 3 and, to pull a PR image, access to the container registry (no JDK unless you build Hub from source). The scripts expect
the camunda-hub clone at `../camunda-hub` and the next command **switches its branch**: save or stash your work there
first, and switch back afterwards.

```bash
git -C ../camunda-hub checkout <PR sha>                 # sibling clone; SPEC_REF is ignored
HUB_MODE=prebuilt HUB_IMAGE_TAG=pr-<sha> ./docker/start-hub.sh start   # needs registry access
STEPS="generate run" RV_PROFILES="secured rbac" ./scripts/e2e/run-hub.sh
```

Do not call `npx playwright` directly: it skips the `POS_FIXTURE_*` environment `run-hub.sh` sets.

