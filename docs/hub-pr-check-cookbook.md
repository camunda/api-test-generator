# Hub PR Check Cookbook

> **Goal:** understand and debug any `api-test-generator/hub-suite` result on a camunda-hub PR
> without asking for help.

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
| No `api-test-generator/hub-suite` status at all | Skipped: draft PR, fork, `self-managed/*` base, or the path gate | The "Trigger api-test-generator hub suite" job summary on the PR (RUN or SKIPPED) |
| `success` | Every generated test passed | Nothing. Coverage gaps alone are also reported `success`; the description lists them |
| `success` with `coverage gap: …` | Tests pass, but some operations have no generated test | The tracking issue `[hub-pr-check] Coverage gap on camunda-hub#N` |
| `failure`, Slack says **startup** | The PR image never became ready | The run's "Wait for Hub to be ready" step |
| `failure`, Slack says **presuite** | A setup step failed before the suites (checkout, clone, install, registry login, image pull) | The failed step in the run; not a Hub or PR problem |
| `failure`, **generator-gap** | api-test-generator does not handle this endpoint shape yet | Spec diff for the named operations; then the ontology/scenario templates |
| `failure`, **product**, high confidence | A specific code change in the PR plausibly caused it | The cited controller/handler change in the PR |
| `failure`, **infra / flaky / unknown** | Environmental, retried, or not enough evidence | Reports in the `hub-suite-reports` artifact |

## Who gets told what

| Outcome | Status | Slack (`#camunda-hub-pr-e2e-results`) | Comment on the camunda-hub PR |
|---|---|---|---|
| Pass | `success` | no | no |
| Draft PR fails | `failure` | no | no |
| Startup failure | `failure` | yes, hub-medic + test-automation-medic | no |
| Pre-suite failure | `failure` | yes, test-automation-medic | no |
| product (high confidence) | `failure` | yes, hub-medic + test-automation-medic | no |
| product (lower), infra, flaky, unknown | `failure` | yes, test-automation-medic | no |
| generator-gap on an operation the PR did not touch | `failure` | yes, test-automation-medic | no |
| generator-gap caused by the PR's own spec change (high confidence) | `failure` | yes, test-automation-medic | **yes**, one sticky comment |

When the generator gap is caused by the PR's own spec change, an issue
`[hub-pr-check] Generator gap on camunda-hub#N` is also opened in this repo and assigned to the
camunda-hub PR's author. It is edited in place on later pushes and closes itself when a push clears
the gap.

Slack is one thread per day with one reply per (PR, failure fingerprint). The same failure on a
later push edits its reply in place and does not page again; a different failure gets a new reply.

## Debugging steps

1. **Open the run** from the status's "Details" link (it points at the `hub-pr-check.yml` run in
   this repo). The run summary has the PR number, sha, image and a link back to the camunda-hub run.
2. **Download the `hub-suite-reports` artifact.** `pw-positive.json`, `pw-secured.json`,
   `pw-rbac.json` (+ `.junit.xml`, HTML reports) and `pw-*.stderr.log`. A directory with only logs
   means Playwright died before writing a report: look at the stderr log, not at the PR.
3. **Find the failing tests.** Playwright nests `suites[].suites[].specs[]`. A spec with
   `ok: false` failed every attempt. The negative suite attaches `request.json` / `response.json`
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

```bash
git -C ../camunda-hub checkout <PR sha>                 # sibling clone; SPEC_REF is ignored
HUB_MODE=prebuilt HUB_IMAGE_TAG=pr-<sha> ./docker/start-hub.sh start   # needs registry access
STEPS="generate run" RV_PROFILES="secured rbac" ./scripts/e2e/run-hub.sh
```

Do not call `npx playwright` directly: it skips the `POS_FIXTURE_*` environment `run-hub.sh` sets.
To re-run in CI without a new push, dispatch `trigger-api-test-generator.yml` in camunda-hub with
`pr_number` and `source_sha` (this bypasses the path gate and the draft skip), or run
`hub-ondemand-test.yml` here against any branch.

## Common failure patterns

- **New endpoint, nothing generated.** Operation is in `unmappedOperations`. The ontology and
  scenario templates do not cover it yet. Not a Hub bug; the coverage-gap issue tracks it.
- **Changed response shape.** Generated assertions expect the old schema. Generator gap.
- **One broad acceptance failure on an untouched endpoint** (handler accepts any malformed input).
  Usually long-standing, not caused by this PR. Check `git log` of the controller before blaming.
- **No reports at all.** Hub or Playwright died early. Startup/presuite, not the PR.
- **A test passed on retry.** Playwright exits 0 when a retry passes, so this alone does not fail
  the run. If the run failed, something else did.

## Things that look wrong but are not

- *No status on my PR:* drafts, forks, `self-managed/*` bases and docs/frontend-only PRs are
  skipped by design. Mark the PR ready, or dispatch it by hand.
- *Green despite a coverage gap:* intentional. Missing coverage alone is never a failing check
  (#480); the gap is on the status description, the tracking issue and Slack (yellow headline).
- *Red but "not a Hub bug":* the check is informational, not required, while reliability proves out.
- *Slack edited instead of a new message:* same PR, same failure fingerprint.
- *The classifier said `unknown`:* it is told to prefer that over guessing `product`, because
  `product` at high confidence pages hub-medic.

## Keeping track of pending generator fixes

- **Where:** open issues with the `generator-gap` label. Each title names the camunda-hub PR.
- **Who:** the author of that camunda-hub PR (assigned automatically; reassign freely, it will not
  be overwritten).
- **Daily nudge:** `hub-generator-gap-digest.yml` posts to `#camunda-hub-pr-e2e-results` on weekdays
  at 07:00 UTC, listing issues whose camunda-hub PR has merged and whose issue is still open,
  oldest merge first. Silent when there is nothing overdue.
- **Cleanup:** an issue closes by itself when a later push to the camunda-hub PR clears the gap, or
  when that PR is closed without merging.
- **Try it without posting:** run the digest workflow by hand (it is a dry run by default).
