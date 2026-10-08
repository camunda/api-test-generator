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

## Reading a result

| You see | Meaning | First thing to check |
|---|---|---|
| No `api-test-generator/hub-suite` status at all | Usually skipped: draft PR, fork, `self-managed/*` base, or the path gate. Not proof of a skip: the status is also missing if the reporter could not get its App token | The "Trigger api-test-generator hub suite" job summary on the PR (RUN or SKIPPED) |
| `success` | Every generated test passed | Nothing. Coverage gaps alone are also reported `success`; the description lists them |
| `success` with `coverage gap: …` | Tests pass, but some operations have no generated test | The tracking issue `[hub-pr-check] Coverage gap on camunda-hub#N` |
| `failure`, Slack says **startup** | The PR image never became ready | The run's "Wait for Hub to be ready" step |
| `failure`, Slack says **presuite** | A setup step failed before the suites (checkout, clone, install, registry login, image pull) | The failed step in the run; not a Hub or PR problem |
| `failure`, **generator-gap** | api-test-generator does not handle this endpoint shape yet | Spec diff for the named operations; then the ontology/scenario templates |
| `failure`, **product**, high confidence | A specific code change in the PR plausibly caused it | The cited controller/handler change in the PR |
| `failure`, **infra / unknown** | Environmental, or not enough evidence | Reports in the `hub-suite-reports` artifact |
| `failure`, **flaky** | An intermittent failure: a test or Hub defect that has to be diagnosed, not retried away | Passed and failed attempts in the `hub-suite-reports` artifact (see "Debugging steps" below) |

## Who gets told what

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

When the generator gap is caused by the PR's own spec change, an issue
`[hub-pr-check] Generator gap on camunda-hub#N` is also opened in this repo. It is edited in place on later pushes and
closes itself on a green run.

**Assignment is best effort.** The issue is assigned to the camunda-hub PR's author only when that author is a plain GitHub
login (bots such as `dependabot[bot]` are skipped) and has access to this repo. If GitHub rejects the login, the run logs a
warning and the issue stays **unassigned**. The title always names the camunda-hub PR, so if you find no assignee, ask in
`#camunda-hub-pr-e2e-results`. The `Coverage gap` issue is a different issue and is never assigned.

Every Slack reply lists the source PR and commit, then one line of links: the run, the camunda-hub run that triggered it, and this cookbook.

### Why a Slack message is sometimes edited instead of posted again

A PR can get many pushes. To keep the channel readable, the alert for a PR is **edited** when it fails the same
way again, and a **new** message is posted only when the failure is different. "The same way" is decided by the
*fingerprint*: the list of failing tests plus the endpoints that have no test.

Example for PR #28390:

1. A push fails `createFile` and `updateFolder`. A new message is posted and the medic is pinged.
2. The next push still fails the same two tests. Same fingerprint, so the message is edited. No new ping.
3. A later push fails only `createFile`. The fingerprint changed, so a new message is posted and the medic is pinged again.

The rules, in short. Alerts are grouped in one Slack thread per day, with one reply per PR and failure:

- **A failing test or an untested endpoint** (there is evidence): identified by its fingerprint, as above.
- **Startup or pre-suite failure:** identified by its category. One reply per PR per day, paged once.
- **No evidence** (the run left no readable report): these cannot be told apart from the previous push's,
  and paging on every push is what flooded the channel. They share one reply per PR per day, edited with the
  latest run, and nobody is pinged. If the same PR fails this way a 3rd time that day, one extra reply pings
  `test-automation-medic`, because by then it is the pipeline, not the PR. The counter is stored in the reply
  (`seen:N`) and counts failures that day, not only consecutive ones.

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

