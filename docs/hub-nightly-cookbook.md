# Hub Nightly Channel Cookbook

> **Goal:** read any message in `#camunda-hub-nightly-test-results` and know what it means, whether it is
> yours to act on, and what to do. You need to know Hub, not how the generator works; the few terms it uses (pin, skip, triage, medic) are explained in "Words used" at the end.
> Messages about a single camunda-hub PR are in `#camunda-hub-pr-e2e-results` instead; see
> [hub-pr-check-cookbook.md](hub-pr-check-cookbook.md).

## Who owns what

- **Generator owner:** the Hub team once the handover is done (until then, the test automation team). The generator owner
  acts on the spec-bump, re-enable and weekly-report posts, and on the weekly coverage issues.
- **Medic:** `hub-medic`. After the handover it also covers the generator and the pipeline. Until the workflows are
  changed, alerts about the generator still ping `test-automation-medic`.
- **The PR check is informational, not required:** a red check does not block merging.
- **A normal night** has 0 failed tests. Known Hub bugs are skipped, not run, so they do not count as failures. Any number above 0 is news.

## Start here

**What is this channel?** Every night the generated Hub API tests run against the latest Hub image (`camunda/hub:SNAPSHOT`).
A set of automatic jobs then post what they found. Most nights the posts are green and need nothing from you.

**What you will see, in the order it happens** (all times UTC):

| When | Message | Do you need to act? |
|---|---|---|
| 02:00 | Posted every night. Two posts: **positive suite** and **negative suite**, each with a ✅ passed / ❌ failed count | Only if ❌ is above 0 |
| After the run | Posted every night. **Triage digest**, with "No failures tonight" when green, and links to the nightly run and the triage run. When there are failures, a thread under it has one line per failure | Only if the digest lists failures |
| 03:00 | **Spec-bump alert**, only when the spec changed (the pinned spec is behind Hub's latest), or when the check itself failed and cannot tell | Only the generator owner (the Hub team after the handover) |
| 04:00 | **Re-enable check**, only when a watched Hub bug closed: a skipped test can come back, or a skip that cannot come back (closed as not planned) needs a decision | Only the generator owner (the Hub team after the handover) |
| Monday 05:00 | Posted every week. **Weekly coverage report** | Only the generator owner (the Hub team after the handover) |

So a night with no spec-bump or re-enable post is normal. A night with no nightly post or no triage digest is not (see below).

**If a morning has no nightly post,** the problem is the run or the posting, not Hub: a failing Hub still produces a post.
Open [nightly-camunda-hub](https://github.com/camunda/api-test-generator/actions/workflows/nightly-camunda-hub.yml) and check, in this order:

1. **No run around 02:00 UTC.** The schedule did not fire. Start one with "Run workflow".
2. **The run is red with "Slack alert not posted".** The Slack token could not be read from Vault, or Slack rejected the
   post. The tests may be fine. Ask the generator owner to check the Vault role and the Slack bot. Every scheduled Hub
   workflow (triage, spec-bump, re-enable, weekly report, gap digest) shows the same error.
3. **The run is red for another reason.** Open the failing step.

**Where to look (GitHub Actions pages, in `camunda/api-test-generator`)**

| Page | Shows |
|---|---|
| [nightly-camunda-hub](https://github.com/camunda/api-test-generator/actions/workflows/nightly-camunda-hub.yml) | The 02:00 run behind the nightly posts |
| [triage-camunda-hub-nightly](https://github.com/camunda/api-test-generator/actions/workflows/triage-camunda-hub-nightly.yml) | The triage behind the digest |
| [spec-bump-check](https://github.com/camunda/api-test-generator/actions/workflows/spec-bump-check.yml) | The 03:00 spec check |
| [hub-known-issue-reenable-check](https://github.com/camunda/api-test-generator/actions/workflows/hub-known-issue-reenable-check.yml) | The 04:00 re-enable check |
| [hub-response-coverage](https://github.com/camunda/api-test-generator/actions/workflows/hub-response-coverage.yml) | The weekly coverage report (Run workflow starts a dry run) |
| [hub-ondemand-test](https://github.com/camunda/api-test-generator/actions/workflows/hub-ondemand-test.yml) | Run the generated suite by hand for any branch |

**Is it my problem?**

| The message shows | Whose problem | Do this |
|---|---|---|
| ❌ failed above 0, triage says **product** | Probably Hub's | Open the issue linked in the thread. If there is none, filing failed or the finding is marked *report only*: read the finding in the triage run. `hub-medic` is pinged only when a new Hub issue was filed |
| Triage says **test-generation** | The generator's, not a Hub bug | Nothing, unless asked. When a fix PR or suppress PR was opened it is linked in the thread and `test-automation-medic` is pinged. When none was (the fix was not safe, or opening it failed) the finding is *report only*: read it in the triage run |
| Triage says **infrastructure** or **flakiness** | Neither | Nothing at first. If the same failure shows up several nights in a row, raise it in the channel |
| Triage says **known issue** | Already tracked | Nothing. The linked Hub issue is the work item |
| A spec-bump or re-enable post | The generator owner's | See the sections below |

## The nightly posts (02:00)

> 🎭 **camunda-hub positive (lifecycle) suite (SNAPSHOT)**
> ✅ 120 passed · ❌ 0 failed (example numbers)
> 📊 View run · 📋 positive (the TestRail run)

- The **positive** suite sends good requests and expects success (including create, read, delete and restore flows).
  The **negative** suite sends bad requests and expects 400, 401, 403, 404 or 409.
- **A thread reply under the post** lists the known issues that limit what the suite covers. Each item is either skipped
  on purpose (the tests are left out) or only partly checked (the test still runs but one assertion, such as the error-body
  shape, is not made), because of a Hub issue, with its link. A green run does **not** fully cover those. An item can stay
  listed after its issue is closed, when Hub closed it as not planned.
  The re-enable check does not watch the partly checked items; see "Not watched" in the re-enable section.
- **`⚠️ config drift: positive-suppress lists X not in the current spec`**: an operation the config skips no longer exists
  upstream (renamed or removed). The generator owner updates `configs/camunda-hub/positive-suppress.json`.

## The triage digest (after the run)

A reading of the failures, sorted by cause. Examples of the main line (the numbers are made up):

> **Suites** • positive: ✅ 120 passed / 0 failed • negative: ✅ 640 passed / 0 failed
> ✅ **No failures tonight** — both suites green, no coverage gaps.

or

> **Triage — 3 failing test(s):** 📦 product: 1  🔧 infrastructure: 1  🧪 test-generation: 1
> 🎫 known issue: 1  📝 filed: 1
> 🚫 **Coverage gap:** 2 operation(s) with no generated test — 1 fix PR(s) opened.

| Icon in the digest | Category | Meaning |
|---|---|---|
| 📦 product | Hub | Hub answers differently from its spec |
| 🔧 infrastructure | Environment | The run itself had a problem (Hub start, network, registry) |
| 🎲 flakiness | Unstable test | Passed on a retry, a timing race between calls, or a one-off that did not repeat |
| 🧪 test-generation | api-test-generator | The generator wrote a wrong test, or none, for an endpoint |
| 🎫 known issue | Already tracked | A Hub issue exists; nothing new to file |
| 📝 filed | New | A new Hub issue was opened tonight |
| ⏩ skipped (recent change) | Explained by a Hub change | An intentional recent Hub change explains the new answer, so no Hub issue is filed; the generated tests or the pin need to catch up |

The **thread** under the digest has one line per failure: the category icon, the operation, and links to the Hub
issue (🎫) or the fix or suppress PR it opened. Pings:

- **`hub-medic`** is pinged when a **new** Hub issue was filed that night. Never for a failure that is already known.
- **`test-automation-medic`** is pinged when a generator fix PR or a suppress PR was opened (it needs review), or when the
  triage could not classify a failure.

Three warnings replace the normal digest. Treat each as "do not trust a green night":

- **Inconclusive**: the nightly produced no report to read. The run probably crashed. Open the nightly run.
- **Triage incomplete**: the triage step itself failed. Open the triage run.
- **Triage result has a schema violation**: the triage wrote an unreadable result. Open the triage run.

## The spec-bump alert (03:00)

This job compares the spec the tests were checked against (the *pin*, in `configs/camunda-hub/spec-pin.json`) with
Hub's latest spec. The headline says what changed:

| Headline | Meaning |
|---|---|
| **op-surface drift** vs the pin, with 🆕 added and 🗑️ removed operations | Endpoints were added or removed upstream |
| **coverage regression** | A new endpoint has no generated test (🚫 *missing coverage*, blocks auto-adopt) |
| **spec pin is behind** latest | The spec changed in small ways (fields), no endpoint churn |

The last line says what to do:

- **➡️ Adopt via bump PR #N**: the new spec is safe. The generator owner reviews and merges the bump PR, which moves the pin.
- **📋 Blocked — see tracking issue #N**: the new spec breaks something, or needs a test the generator does not have. Read
  the issue. The pin does not move until it is fixed.
- **⚠️ Spec-bump check failed for X**: a step of the job itself failed, so the drift result may be missing. Open the run
  before trusting that there is no drift.

Nightlies are **not** blocked by a pending bump: they run against Hub's latest spec regardless. The pin only affects the
invariant tests.

## The re-enable check (04:00)

Skipped tests point to a Hub bug. This job watches those bugs. When one closes, it tries to bring the tests back.

| Message | Meaning | Do this |
|---|---|---|
| 🎉 *issue* is closed — re-enabled: `ops` → draft PR | The skip was removed in a draft PR | Review the draft PR and let the live check run. Merge if it is green **and** the Hub issue was closed as fixed. If Hub closed it as not planned, close the PR: the skip must stay |
| 🎉 … already has an open unskip PR | A PR for it exists already | Review that PR |
| ⚠️ … breaks local generate/tests | Removing the skip makes generation or tests fail | Open the workflow run and investigate |
| ⚠️ … no generator token was available | The job could not open a PR this time | Nothing, it retries next run |
| ⚠️ … opening the unskip PR failed | The PR could not be created | Open the workflow run |
| 📋 … is closed as **fixed**, no specific operation(s) to auto-unskip | A suite-wide skip whose Hub bug is fixed. Nothing can be done automatically | Remove its entry from `knownIssues` in `configs/camunda-hub/request-validation.json` (and any generator skip it describes), then regenerate and run the suite |
| 📋 … is closed as **not planned** | Hub will not fix it, so the skip must stay | Set `"acknowledgedNotPlanned": true` on its `knownIssues` entry in `configs/camunda-hub/request-validation.json`. The alert then stops. Until you do, it repeats every day |

**Not watched:** the "partly checked" items in the negative thread (`knownProblemDetailShapeGaps` in
`request-validation.json`) are not covered by this check, so nothing tells you when their Hub issue closes. Look at the
issue's close reason first. **Closed as fixed:** remove the entry by hand. **Closed as not planned:** keep the entry, since
Hub still does not meet that assertion and removing it would make the nightly fail.

**Check why the issue closed.** If Hub closed it as "not planned", the skip must stay. The check does not read the close
reason for skips tied to one operation yet, so for those it is a human check.

## The weekly coverage report (Monday 05:00)

Counts how many endpoints have a test for every response the spec lists, split into **positive** and **negative** tests,
with the change since last week in brackets. Gaps become issues. Read
[hub-response-coverage-report.md](hub-response-coverage-report.md).

**Is a gap bad?** It is a to-do, not an incident. Nothing is broken. A line such as "Lifecycle tests (create, read, delete): 4 of 6
resources. Missing: ProjectSnapshot, Version" means those two resources have no single test that creates, reads and deletes
one, while their individual endpoint tests still exist. Today those two are simply not added yet; no Hub bug excludes
them. The generator owner fixes it by adding the resource to `configs/camunda-hub/ontology/entity-kinds.json`. Lifecycle gaps open no
issue, so only the weekly report shows them.

## What the workflows depend on

If one of these breaks, the matching alerts stop or fail. The owner and the rotation of each are to be named in the handover.

| Dependency | Used for | Where it is configured |
|---|---|---|
| GitHub App `camunda/qa-processes` | Cloning the private camunda-hub repo, opening and editing issues and comments | Vault, `secret/data/products/qa/ci/github.com/apps/camunda/qa-processes` |
| Vault login (JWT role and an approle) | Every workflow reads its secrets from Vault | Repo secrets `VAULT_ADDR`, `VAULT_JWT_PATH`, `VAULT_JWT_ROLE`, `VAULT_JWT_AUDIENCE`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID` |
| Slack bot token | Every post in the Slack channels | Vault, read by `.github/actions/slack-token` |
| TestRail credentials | Publishing the nightly results | Vault, `secret/data/products/qa/ci/common` |
| `ANTHROPIC_API_KEY` | The classifier on PRs and the nightly triage | Repo secret |
| Container registry login | Pulling the PR's Hub image | Repo secrets `CAMUNDA_CONTAINER_REGISTRY_USER` and `_PASSWORD` |

## Who to ask

- Anything in this channel you cannot place: write in the channel.
- The generator itself (new endpoint, wrong test, skip): `test-automation-medic` today, `hub-medic` after the handover.
- A Hub behaviour question: `hub-medic`.

## Words used

More terms (medic, ontology, live check, invariant tests, fingerprint) are in the glossary of [hub-pr-check-cookbook.md](hub-pr-check-cookbook.md).

- **Pin:** the camunda-hub commit the invariant tests are checked against.
- **Skip:** a test left out on purpose because of a tracked Hub limitation, with an issue link. It can stay after the issue closes, when Hub will not fix it.
- **Suite-wide skip:** a skip that is not tied to one endpoint.
- **TestRail:** the test-management tool the nightly results are also published to.
- **Vault:** the secrets store the workflows read their tokens from.
- **Unmapped operation / coverage gap:** an endpoint with no generated test at all.
