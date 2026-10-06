# Hub Nightly Channel Cookbook

> **Goal:** read any message in `#camunda-hub-nightly-test-results` and know what it means, whether it is
> yours to act on, and what to do. No knowledge of the generator needed.
> Messages about a single camunda-hub PR are in `#camunda-hub-pr-e2e-results` instead; see
> [hub-pr-check-cookbook.md](hub-pr-check-cookbook.md).

## Start here

**What is this channel?** Every night the generated Hub API tests run against the latest Hub image (`camunda/hub:SNAPSHOT`).
A set of automatic jobs then post what they found. Most nights the posts are green and need nothing from you.

**What you will see, in the order it happens** (all times UTC):

| When | Message | Needs you? |
|---|---|---|
| 02:00 | Two posts: **positive suite** and **negative suite**, each with a ✅ passed / ❌ failed count | Only if ❌ is above 0 |
| After the run | **Triage digest**, plus a thread with one line per failure | Only if it lists failures |
| 03:00 | **Spec-bump alert**: the pinned spec is behind Hub's latest | Only the generator owner |
| 04:00 | **Re-enable check**: a skipped test can come back because its Hub bug is closed | Only the generator owner |
| Monday 05:00 | **Weekly coverage report** | Only the generator owner |

The spec-bump and re-enable posts are silent when there is nothing to report.

**If a morning has no nightly post at all,** something is wrong with the posting itself, not with Hub. A missing
Slack token makes every workflow finish green without posting. Open the Actions tab of `camunda/api-test-generator`
and look at `nightly-camunda-hub`.

**Is it my problem?**

| The message shows | Whose problem | Do this |
|---|---|---|
| ❌ failed above 0, triage says **product** | Probably Hub's | Read the linked issue. `hub-medic` is pinged only when a new Hub issue was filed |
| Triage says **test-generation** | The generator's, not a Hub bug | Nothing, unless asked. `test-automation-medic` gets the fix PR |
| Triage says **infrastructure** or **flakiness** | Neither | Nothing at first. If the same failure shows up several nights in a row, raise it in the channel |
| Triage says **known issue** | Already tracked | Nothing. The linked Hub issue is the work item |
| A spec-bump or re-enable post | The generator owner's | See the sections below |

## The nightly posts (02:00)

> 🎭 **camunda-hub positive (lifecycle) suite (SNAPSHOT)**
> ✅ 120 passed · ❌ 0 failed (example numbers)
> 📊 View run · 📋 positive (the TestRail run)

- The **positive** suite sends good requests and expects success (including create, read, delete and restore flows).
  The **negative** suite sends bad requests and expects 400, 401, 403 or 404.
- **A thread reply under the post** lists the known issues that limit what the suite covers. Each item is either skipped
  on purpose (the tests are left out) or only partly checked (the test still runs but one assertion, such as the error-body
  shape, is not made), because of a Hub issue, with its link. A green run does **not** fully cover those. An item can stay
  listed after its issue is closed, when Hub closed it as not planned.
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
| 🎉 *issue* is closed — re-enabled: `ops` → draft PR | The skip was removed in a draft PR | Review the draft PR, let the live check run, merge if green |
| 🎉 … already has an open unskip PR | A PR for it exists already | Review that PR |
| ⚠️ … breaks local generate/tests | Removing the skip makes generation or tests fail | Open the workflow run and investigate |
| ⚠️ … no generator token was available | The job could not open a PR this time | Nothing, it retries next run |
| ⚠️ … opening the unskip PR failed | The PR could not be created | Open the workflow run |
| 📋 … is closed as **fixed**, no specific operation(s) to auto-unskip | A suite-wide skip whose Hub bug is fixed. Nothing can be done automatically | Remove its entry from `knownIssues` in `configs/camunda-hub/request-validation.json` (and any generator skip it describes), then regenerate and run the suite |
| 📋 … is closed as **not planned** | Hub will not fix it, so the skip must stay | Set `"acknowledgedNotPlanned": true` on its `knownIssues` entry. The alert then stops. Until you do, it repeats every day |

**Check why the issue closed.** If Hub closed it as "not planned", the skip must stay. The check does not read the close
reason for skips tied to one operation yet, so for those it is a human check.

## The weekly coverage report (Monday 05:00)

Counts how many endpoints have a test for every response the spec lists, split into **positive** and **negative** tests,
with the change since last week in brackets. Gaps become issues. Read
[hub-response-coverage-report.md](hub-response-coverage-report.md).

## Who to ask

- Anything in this channel you cannot place: write in the channel.
- The generator itself (new endpoint, wrong test, skip): `test-automation-medic`.
- A Hub behaviour question: `hub-medic`.

## Words used

- **Pin:** the camunda-hub commit the invariant tests are checked against.
- **Skip:** a test left out on purpose because of an open Hub bug, with an issue link.
- **Suite-wide skip:** a skip that is not tied to one endpoint.
- **Medic:** a Slack group on call for a test area.
- **Unmapped operation / coverage gap:** an endpoint with no generated test at all.
