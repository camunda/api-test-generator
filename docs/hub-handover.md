# Hub test generator: handover

> **For:** the camunda-hub team, taking over the generated Hub API test suite.
> **Read first:** sections 1 to 4 (10 minutes). The rest is a reference you come back to.
> **Numbers in this page** were taken on 2026-10-06. Re-check anything that matters (section 11 says how).

## 1. What this is

`api-test-generator` reads the Hub OpenAPI spec and **writes Playwright API tests for it**. Nobody writes the
tests by hand for a normal endpoint. When the spec changes, the tests change with it.

It gives the Hub team three things:

- **A nightly run** of the whole generated suite against the latest Hub image.
- **A check on every camunda-hub PR** that runs the suite against that PR's own image and spec.
- **A weekly report** of what is still not tested, with one issue per API area.

It is not a replacement for Hub's own unit and integration tests. It only checks the public API (`/api/v2`).

## 2. How it works, in six lines

1. The spec is bundled from the `camunda-hub` repo (`restapi/public-api/.../openapi/v2`) into `spec/camunda-hub/bundled/`.
2. The generator works out which calls each endpoint needs first (create a workspace, then a project, then a folder).
3. It writes tests for each endpoint: success, bad request (400), no auth (401), forbidden (403), not found (404), and more.
4. Output goes to `generated/camunda-hub/` (**git-ignored**; it is rebuilt on every run, so never edit it).
5. Playwright runs it against a real Hub (the published `camunda/hub:SNAPSHOT` image, or a PR's `pr-<sha>` image).
6. Failures are classified and sent to Slack, and gaps become GitHub issues.

You change behaviour through **config files** (section 6), not by editing generated tests.

## 3. What runs, and when

All times are UTC. Slack channels: **N** = `#camunda-hub-nightly-test-results`, **P** = `#camunda-hub-pr-e2e-results`.

| Workflow | When | Tells you | Channel | Who acts |
|---|---|---|---|---|
| `nightly-camunda-hub` | 02:00 daily | Pass/fail counts for the positive and negative suites | N | Read the triage thread below it |
| `triage-camunda-hub-nightly` | after the nightly | Each failure sorted into Hub bug, generator gap, infra or flaky; opens issues/PRs | N | Hub team for Hub bugs |
| `spec-bump-check` | 03:00 daily | The pinned spec is behind camunda-hub `main` | N | Whoever owns the generator |
| `hub-known-issue-reenable-check` | 04:00 daily | A Hub bug we skipped is now closed, so the skip can be removed | N | Whoever owns the generator |
| `hub-response-coverage` | Monday 05:00 | Weekly coverage report (see [the guide](hub-response-coverage-report.md)) | N | Whoever owns the generator |
| `hub-generator-gap-digest` | weekdays 07:00 | Open "generator gap" issues caused by camunda-hub PRs | P | PR author |
| `hub-pr-check` | each camunda-hub PR | Generated suite result for that PR; alert only on failure | P | See the [cookbook](hub-pr-check-cookbook.md) |
| `hub-pr-live-check` | each PR to this repo | Runs the suite against live Hub. **The only required check** here | GitHub | PR author |
| `hub-ondemand-test` | manual | Run the suite for any ref | none | You |

The Slack messages are described in section 12.

## 4. If something just went red

1. **Failing check on a camunda-hub PR.** Open [hub-pr-check-cookbook.md](hub-pr-check-cookbook.md). It explains each
   verdict (product, generator-gap, infra, flaky, startup) and what to do.
2. **Nightly failure.** Open the triage thread under the nightly post. It names the cause and links the issue or PR it opened.
3. **Weekly coverage gap.** Open the area issue linked from the report. It lists the endpoints and what each lacks.
4. **Not sure whose problem it is.** The generator is "ours" if a new or changed endpoint has no test or a wrong test
   (a generator gap). Hub is "yours" if the test is right and Hub answers differently from the spec.

Draft in review: PR #583 adds a Hub-developer cookbook for reacting to alerts, including how to suppress a test as a bridge
and track it. It overlaps this section; decide which to keep before handover (section 13).

## 5. What is automatic and what is by hand

| You add or change... | What happens | You do |
|---|---|---|
| An endpoint | Success, 400, 401, 403, 404 tests appear on the next run | Nothing |
| A search endpoint (body takes `page` and a sort) | Paging, sort and offset tests appear (`search-paging.json` `auto`) | Nothing |
| Optional string fields echoed in the response | An "optional strings" test appears (`optional-fields.json` `auto`) | Nothing |
| A new resource (create, get, delete) | The weekly report lists it as missing a lifecycle test | Add it to `ontology/entity-kinds.json` |
| A link (add/remove pair, such as workspace members) | Reported as missing a lifecycle test | Add it to `ontology/edges.json` |
| A documented 409, or a 400 that needs a state set up first | Not generated | Add a sequence to `conflict-replay.json` |
| An endpoint the generator cannot test yet | The suite fails or skips | Suppress it with a reason and a tracking issue (section 9) |

The proposal in section 13 would make the 409 case automatic too.

## 6. The config files (`configs/camunda-hub/`)

| File | What it controls | Touch it when |
|---|---|---|
| `positive-suppress.json` | Operations left out of the **success** suite, each with a reason and a `knownIssue` | A success test cannot pass because of a Hub bug |
| `request-validation.json` | The **negative** suite. Keys below | A bad-request, 401, 403 or 404 test is wrong or blocked |
| `conflict-replay.json` | Hand-written state flows for 409 and state-dependent 400 (`replay`, `sequences`, `untested`) | A documented 409/400 needs setup calls |
| `search-paging.json` | Paging and sort tests for search endpoints (`auto`, `exclude`, `offsetFrom`) | A search endpoint behaves differently |
| `optional-fields.json` | Optional-field echo and read-back tests (`auto`, `exclude`, `variants`, `untested`) | A field cannot be echoed or needs setup |
| `coverage-floors.json` | The lowest allowed coverage numbers; a PR that lowers one fails CI | You closed a gap: raise the floor in the same PR |
| `spec-pin.json` | Which camunda-hub commit the **invariant tests** are checked against (nightly ignores it) | Bumping the spec (section 7) |
| `ontology/entity-kinds.json` | Resources: how to create, read, delete, restore them | A new resource needs lifecycle tests |
| `ontology/edges.json` | Add/remove links | A new link needs lifecycle tests |
| `ontology/scenario-templates.json` | The lifecycle test shapes (`EntityLifecycle`, `RestoreLifecycle`, `EdgeLifecycle`) | Rarely |
| `ontology/runtime-states.json` | States one call leaves behind that another call needs (for example "review requested") | An operation needs a state produced by another |
| `ontology/semantics.json`, `file-fixtures.json` | Meaning of ID fields; sample file contents for uploads | A new key type or file type |
| `codegen/`, `fixtures/` | Emitter overrides and sample assets | Rarely |

Main keys inside `request-validation.json`:

- `resourceFixtures` / `pathResourceFixtures`: real resources created before the negative run, so a bad field still reaches validation.
- `excludeOperations`: drop a whole operation, or only some test kinds, with a `reason` and a `knownIssue`.
- `knownIssues`: Hub bugs that affect the suite as a whole, shown in the nightly's "skipped due to known issues" thread.
- `knownProblemDetailShapeGaps`: test kinds where Hub breaks the error format (for example empty 401 bodies); the status is still checked.
- `nonScalarKeyOperations`: operations where an object or array in an ID field must answer 400. CI fails if one stops producing tests.
- `unenforcedStringFormats`, `enumCaseInsensitive`, `authAbsentMode`, `authDenyMode`, `notFoundMode`: how strict Hub is, set to match what Hub really does.

**Rule for every skip:** write why, and link a tracking issue. An entry without an issue is a debt nobody will find.

## 7. The spec: pinned or latest?

- The **nightly and weekly report** use the latest camunda-hub `main`. They are not pinned.
- The **invariant tests** (`configs/camunda-hub/regression-invariants.test.ts`) check the generated output against one
  pinned commit in `spec-pin.json`, so they do not change under you.
- `spec-bump-check` tells you when the pin is behind. To bump it:

```bash
git -C ../camunda-hub checkout <new commit>
CONFIG=camunda-hub npm run fetch-spec          # not fetch-spec:ref
# copy the commit into specRef and the specHash from spec/camunda-hub/bundled/spec-metadata.json into expectedSpecHash
CONFIG=camunda-hub npm run testsuite:generate && CONFIG=camunda-hub npm run generate:request-validation
CONFIG=camunda-hub npx vitest run tests/request-validation configs/camunda-hub/regression-invariants.test.ts
```

## 8. Run it on your machine

Needs: Docker, Node 22, Python 3, and `camunda-hub` cloned **next to this repo** (`../camunda-hub`).

```bash
git -C ../camunda-hub checkout main && git -C ../camunda-hub pull   # keep it close to the image you run
HUB_MODE=prebuilt ./docker/start-hub.sh start                       # Hub on http://localhost:8088
STEPS="generate run" RV_PROFILES="secured rbac" ./scripts/e2e/run-hub.sh
./docker/start-hub.sh stop
```

Do not run `npx playwright` directly; `run-hub.sh` sets the fixtures the tests need.

Things that have bitten us:

| Symptom | Cause | Fix |
|---|---|---|
| `exec format error` when Hub starts (Apple Silicon) | The `arm64` build of `camunda/hub:SNAPSHOT` from 2026-10-06 has an empty `/docker-entrypoint.sh` | Run the amd64 image: add `platform: linux/amd64` to the `hub` service in `docker/docker-compose.hub.yml` (do not commit it), pull `--platform linux/amd64`, and tell the image owners |
| `Cannot connect to the Docker daemon` mid-run or mid-pull | Docker Desktop crashed | `open -a Docker`, remove any half-pulled image, retry |
| `network ... not found` on start | A stale `hub` container from an earlier run | `docker rm -f hub; docker compose -f docker/docker-compose.hub.yml down -v` |
| 409 on create tests in later runs | Leftover state (a test published a fixed template id) | Reset with `down -v` |
| Failures that look like spec drift | Your `../camunda-hub` is older or newer than the image | Update the clone, or pin the image with `HUB_IMAGE_TAG` |
| `Repository not found` on clone in CI | Transient; the clone retries | Re-run only if it still fails |
| Build needs JDK 25 | Source mode only (`HUB_MODE=source`) | Use `HUB_MODE=prebuilt` |
| "Spec freshness" check red on a PR | Long-standing, not required | Ignore unless you are working on it |

## 9. Skipped tests and Hub bugs

Every skipped test is meant to be temporary:

1. Add the skip (`positive-suppress.json` or `request-validation.json`) with a `reason` and a `knownIssue` (summary and URL).
   Entries pointing at the same URL must use the same summary (a test enforces this).
2. The nightly lists it under "skipped due to known issues".
3. `hub-known-issue-reenable-check` watches the issue. When it closes, it opens a PR that removes the skip and checks the suite still passes.
4. **Check why it closed.** If Hub closed it as "not planned", the skip must stay. The check does not read the close reason yet (section 13).

Current blockers, all open in `camunda/camunda-hub`: #25907 (cluster ID cannot be chained), #26447 (empty 401 bodies),
#26448 (error body missing `type` on framework errors), #27155 (`createWorkspace` accepts invalid JSON), #29306
(`updateVersion` does not enforce `name`). Details are in the config `reason` fields.

## 10. Access and secrets

| What | Used for | Where it lives |
|---|---|---|
| GitHub App `camunda/qa-processes` | Clone the private `camunda-hub` repo; open and edit issues and PR comments | Vault `secret/data/products/qa/ci/github.com/apps/camunda/qa-processes` |
| Vault JWT role and an approle | Workflows log in to Vault | Repo secrets `VAULT_ADDR`, `VAULT_JWT_PATH`, `VAULT_JWT_ROLE`, `VAULT_JWT_AUDIENCE`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID` |
| Slack bot token | Posting alerts | Vault, read by `.github/actions/slack-token` |
| `ANTHROPIC_API_KEY` | The failure classifier and the nightly triage | Repo secret |
| Registry login | Pulling PR images | Repo secrets `CAMUNDA_CONTAINER_REGISTRY_USER` / `_PASSWORD` (and `REGISTRY_USERNAME` / `_PASSWORD` in the shared runner) |

**Before handover, confirm with the current owner:** who administers the App and the Vault roles, how each secret is rotated,
and who can change branch protection. If the Slack token is missing, the workflows skip posting and still finish green
(section 12, item 1), so a broken secret is invisible.

## 11. Today's state (2026-10-06)

- **Health, last 10 runs:** nightly, triage and the re-enable check were 10 of 10 green; the weekly report and the gap digest were green;
  `spec-bump-check` failed twice (2026-09-28 and 09-30) because the clone token came back empty; `hub-pr-check` had one "failure" that was a run cancelled by newer push.
- **Coverage (weekly report):** 66 endpoints; 56 have a test for every documented response. By code: success 64 of 66, 400 35 of 36, 401 64 of 66,
  403 61 of 66, 404 42 of 45, 409 9 of 12. Optional fields sent: 63 of 68. Every kind of bad request tested: 32 of 64 endpoints.
  Lifecycle tests: create-read-delete 4 of 6 (ProjectSnapshot and Version missing), delete-restore 4 of 4, add-remove 1 of 1.
  The "every kind of bad request" figure over-counts gaps for some body-shape kinds; the guide explains why.
- **No test at all:** `getClusterUsageMetrics` (camunda-hub#25907, #26448).
- **Re-check any number** with `python3 scripts/e2e/hub_response_coverage.py --out /tmp/cov` after generating, or read the latest
  `hub-coverage-report` artifact.
- **Merge rules in this repo:** squash merge, conventional prefix (`feat:`, `fix:`, `docs:`), one PR at a time. Only "Live Hub suite" is a required check.
  Lint is `npm run lint` (zero warnings). Test layers are in `CONTRIBUTING.md`.

## 12. Review of the Slack messages

Verdict key: **ok** = a newcomer can tell what happened, whether it is theirs, and what to do; **needs work** = missing something.

| Message | Verdict | Main problem |
|---|---|---|
| PR check alert (failing camunda-hub PR) | ok | Cookbook link added in #667. Add an owner line for the generator |
| Nightly summary | needs work | A count line with no PASSED/FAILED word; does not say the triage thread below is where to act |
| Triage digest | ok | No link to a runbook |
| Spec-bump alert | needs work | Says the pin is behind, not who bumps it, how, or whether it blocks anything |
| Re-enable alert | needs work | No run link; does not say what to do |
| Weekly coverage report | ok | Does not say who acts on the gaps |
| Gap digest | needs work | Names the assignee as text, so nobody is notified |
| PR sticky comment and commit status | needs work | No cookbook link, no owner, no next step |

Recommendations, most valuable first:

1. **Make a missing Slack token loud.** Today every workflow skips posting when the token is empty and still ends green.
   A broken Vault role or expired token silences every alert. Fail the job or open an issue, and add a daily heartbeat
   that checks a nightly post exists. (`.github/actions/slack-token`, and the post steps in each workflow.)
2. **Put the cookbook link and a one-line next step on the PR sticky comment and commit status** (`hub-pr-check.yml`).
3. **Give the nightly post a verdict word and point to triage** (`nightly-camunda-hub.yml`).
4. **Add the run link to the re-enable messages** (`.github/scripts/hub-reenable-format-slack.sh`).
5. **Fix the re-enable check** to read the close reason (`hub-reenable-check.sh`, section 13).
6. **@-mention the assignee in the gap digest** (`scripts/triage/hub-gap-digest.ts`).
7. **Explain the spec-bump alert**: the bump command, the owner, and whether nightlies are blocked (`spec-bump-check.yml`).
8. **Say which channel to watch** (N for the nightly family, P for PR checks); this page now does.
9. **Keep the medic group IDs in one place.** They are copied into `hub-pr-check.yml` and `hub-triage-format-slack.sh`.

Messages for a PR run on a **draft** are not posted to Slack on purpose; the commit status still shows the result.

## 13. Open items and known debts

- **#638** (needs a Hub-team answer): three documented 409s nobody could provoke (`updateVersion`, `updateProject`, `restoreProjectSnapshot`).
- **#655:** optional fields that need an element-template file, an environment, or a read-back.
- **#529:** registry "unauthorized" during bursts of dispatches.
- **#515:** whether the classifier may open fix PRs.
- **#584:** suppress `replaceWorkspaceEnvironments` (open since 2026-09-17).
- **#583:** the Hub-developer cookbook draft, which overlaps section 4 and the PR-check cookbook. Merge or close.
- **Re-enable check ignores the close reason.** An issue closed as "not planned" is treated as fixed. Not yet fixed.
- **Lifecycle gaps:** ProjectSnapshot and Version have no create-read-delete test (they are not in `entity-kinds.json`).
- **Spec hints proposal** (a draft for the Hub API owners): an optional field on each documented 4xx saying which calls provoke it,
  so state-dependent 409/400 tests are generated. Needs the Hub team to agree.
- **Undocumented elsewhere:** `AGENTS.md` is written for AI coding agents and is long; this page is the human entry point.
  `README.md` still leads with the Camunda Orchestration Cluster and shows source-mode Hub start-up. Both should point here.

## 14. Handover checklist

- [ ] Name an owner for the generator and for each secret in section 10.
- [ ] Add the owner to the repo, to `#camunda-hub-nightly-test-results`, and to the `hub-medic` group if wanted.
- [ ] Run section 8 once on a laptop and fix whatever breaks in this page.
- [ ] Decide on #583 and #584.
- [ ] Agree who acts on spec-bump, re-enable and weekly-coverage messages.
- [ ] Pick the Slack fixes from section 12 to do first (item 1 first).
- [ ] Walk through one real gap: open an area issue, close it, and raise the floor.

## 15. Words used in this repo

- **Positive suite:** tests that send good requests and expect success. **Negative suite:** bad requests that expect 400, 401, 403, 404.
- **Profile:** `unsecured`, `secured` or `rbac`; the same negative tests run with different auth setups.
- **Lifecycle test:** create, read, delete (and restore) one resource in a single test.
- **Edge / link:** a two-way relation you add and remove, such as workspace membership.
- **Fixture:** a real resource created before a test so the request reaches the check being tested.
- **Generator gap:** the generator does not handle an endpoint correctly yet. **Hub bug:** Hub answers differently from its spec.
- **Medic:** the Slack group on call for a test area (`hub-medic`, `test-automation-medic`).
- **Floor:** the lowest coverage number CI accepts.
- **Pin:** the camunda-hub commit the invariant tests are checked against.
