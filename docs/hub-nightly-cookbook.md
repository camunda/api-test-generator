# Hub Nightly Channel Cookbook

> **Goal:** read any message in `#camunda-hub-nightly-test-results` and know what it means, whether it is
> yours to act on, and what to do. You need to know Hub, not how the generator works: the few steps that touch the generator are spelled out in "Run it by hand" below, and the big picture is in [how-it-works.md](how-it-works.md). Terms are explained in "Words used" at the end.
> Messages about a single camunda-hub PR are in `#camunda-hub-pr-e2e-results` instead; see
> [hub-pr-check-cookbook.md](hub-pr-check-cookbook.md).

## Start here

**What is this channel?** Every night the generated Hub API tests run against the latest Hub image (`camunda/hub:SNAPSHOT`).
A set of automatic jobs then post what they found. Most nights the posts are green and need nothing from you.

**A normal night has 0 failed tests.** Known Hub bugs do not count as failures: their tests are either skipped or run
without the one assertion Hub cannot meet yet. So any number above 0 is news.

> **Status, 8 October 2026:** the handover to the Hub team is in progress. The Hub team already owns everything in this
> guide and `hub-medic` is the on-call group. The alert pings have not been switched yet: some generator alerts still go
> to `test-automation-medic`. The change is tracked in [camunda/api-test-generator#712](https://github.com/camunda/api-test-generator/issues/712).

**Who acts.** The Hub team (the **generator owner**) acts on the spec-bump, re-enable and weekly-report posts. **Nobody is
pinged for these three**: they are plain posts in the channel, and the PRs and issues they open have no assignee or
reviewer. So the person on call as `hub-medic` reads the channel each morning and owns them: review the PR, or decide
what to do with the post. A PR nobody picks up just sits there.

**What you will see, in the order it happens** (all times UTC; examples of each message are in the sections below):

| When | Message | Do you need to act? | Workflow |
|---|---|---|---|
| 02:00 | Posted every night. Two posts: **positive suite** and **negative suite**, each with a ✅ passed / ❌ failed count | Only if ❌ is above 0 | [nightly-camunda-hub](https://github.com/camunda/api-test-generator/actions/workflows/nightly-camunda-hub.yml) |
| After the run | Posted every night. **Triage digest**, with "No failures tonight" when green, and links to the nightly run and the triage run. When there are failures, a thread under it has one line per failure | Only if the digest lists failures | [triage-camunda-hub-nightly](https://github.com/camunda/api-test-generator/actions/workflows/triage-camunda-hub-nightly.yml) |
| 03:00 | **Spec-bump alert**, only when the spec changed (the pinned spec is behind Hub's latest), or when the check itself failed and cannot tell | Only the generator owner (the Hub team after the handover) | [spec-bump-check](https://github.com/camunda/api-test-generator/actions/workflows/spec-bump-check.yml) |
| 04:00 | **Re-enable check**, only when a watched Hub bug closed: a skipped test can come back, or a skip that cannot come back (closed as not planned) needs a decision | Only the generator owner (the Hub team after the handover) | [hub-known-issue-reenable-check](https://github.com/camunda/api-test-generator/actions/workflows/hub-known-issue-reenable-check.yml) |
| Monday 05:00 | Posted every week. **Weekly coverage report** | Only the generator owner (the Hub team after the handover) | [hub-response-coverage](https://github.com/camunda/api-test-generator/actions/workflows/hub-response-coverage.yml) (Run workflow starts a dry run) |

The times are when each job **starts**, not when its post arrives. The spec-bump post comes about 2 minutes later; the nightly posts and the triage digest come after the run finishes, usually 20 to 25 minutes later (the nightly job is allowed 25).

So a night with no spec-bump or re-enable post is normal. A night with no nightly post or no triage digest is not: see "When a post is missing" below.

**What to do with a failure.** Only when the digest lists failures.

1. Open the thread under the digest. There is one line per failed test.
2. Find your line below, by the icon at its start and the link at its end, and do what the last column says.

| The line shows | What happened | PR opened automatically? | What you do |
|---|---|---|---|
| 🎫 known issue | Hub already has an issue for it | **No** | Nothing. The linked issue is the work |
| 📦 product, with 📝 and ⛔ links | Hub is wrong. The agent filed a **new** Hub issue (`hub-medic` was pinged) and opened a **suppress PR** that switches the test off until Hub fixes it | **Yes**, a suppress PR | Open the Hub issue and take it, or hand it to the owning team. Review the suppress PR: merge it only if the linked Hub issue is real |
| 📦 product, with a 📝 link, **no** ⛔ link | A Hub issue was filed, but no suppress PR: the test was already suppressed, an open PR already covers it, or opening it failed (the line shows ⚠️) | **No** | Open the Hub issue and take it. If the line shows ⚠️, add the suppress entry yourself |
| 📦 product, **no link** | Hub is probably wrong, but no issue was filed and **nobody was pinged** | **No** | Open the triage run and read the finding. Then file the Hub issue yourself |
| 🧪 test-generation, with a 🛠️ link | The generated test is wrong; the agent opened a **fix PR** | **Yes**, a fix PR | Open the PR, read the diff, and merge it if it is right |
| 🧪 test-generation, with a ♻️ link | An open PR already covers it | **No** (one exists) | Open that PR and review it |
| 🧪 test-generation, **no link** | The agent could not fix it safely, so it only reported | **No** | Open the triage run, read the finding, and fix the test yourself. If you are stuck, ask in `#ask-qa` |
| 🔧 infrastructure | The run broke (Hub start, network, registry), not Hub or the tests | **No** | Open the failed step in the nightly run and read the error. Say so in the channel with the run link. Re-run only once the outside cause is fixed |
| 🎲 flakiness | A test passes sometimes and fails sometimes | **No** | Open the test in the nightly report and compare the passed and failed attempts. If Hub caused it, file a Hub issue. If the test did, fix the test. Do not just re-run |
| ⏳ or 🔗 on a line | A hint that a recent Hub change may explain it. It is a guess | **No**. It does not mean a PR exists | Investigate by hand |
| 🚫 unmapped, or the 🚫 *Coverage gap* line in the digest | An operation has no generated test at all. It is not a failing test | **Sometimes**: a 🛠️ fix PR on the line | Review the PR if there is one. With none, it is only reported: see [the coverage report guide](hub-response-coverage-report.md) |
| ⚠️ on a line | The agent tried to open an issue or PR and failed | **No** | Do it by hand |

**When may I re-run?** Only to see whether it still fails after you fixed an outside cause (🔧 infrastructure). A re-run
never fixes a flaky test (🎲): it only hides it.

A line in the thread looks like this (an example):

> • 📦 product — `getWorkspace` — expected 200, got 500
> &nbsp;&nbsp;&nbsp;&nbsp;📝 *link to the new Hub issue*
> &nbsp;&nbsp;&nbsp;&nbsp;🚨 @hub-medic

The first line says what failed. The next line holds the links, and the last line is the ping.

The spec-bump and re-enable posts are explained in their own sections below.

## When a post is missing

If a morning has no nightly post, the problem is the run or the posting, not Hub: a failing Hub still produces a post.
Open [nightly-camunda-hub](https://github.com/camunda/api-test-generator/actions/workflows/nightly-camunda-hub.yml) and check, in this order:

1. **No run around 02:00 UTC.** The schedule did not fire. Start one with "Run workflow".
2. **The run is red with "Slack alert not posted".** The Slack token could not be read from Vault, or Slack rejected the
   post. The tests may be fine. You cannot fix this from the Hub side: post the run link in `#ask-qa`. Every scheduled Hub
   workflow (triage, spec-bump, re-enable, weekly report, gap digest) shows the same error.
3. **The run is red for another reason.** Open the failing step.

While Slack is down you can still read the night's result: open the nightly run, then the job summary and the report artifacts; the triage run keeps its digest as an artifact too. You do not need to re-post it.

## Run it by hand

Several actions below say "run the suite on a branch". Do it on GitHub:

1. Open [hub-ondemand-test](https://github.com/camunda/api-test-generator/actions/workflows/hub-ondemand-test.yml), click **Run workflow**, and under **Use workflow from** pick the **api-test-generator** branch you want to test (your generator fix, or `main`).
2. Leave the two inputs alone unless you need to: `hub_ref` (a **camunda-hub** branch name or commit, such as your Hub PR's branch: the spec is read from it; default `main`) and `hub_image_tag` (the Hub image to run against, default `SNAPSHOT`).
3. Read the result in the run summary and the uploaded reports. This workflow posts nothing to Slack or TestRail.

On your own machine you need Docker, Node 22, Python 3 and a camunda-hub clone next to this repo. The commands are under
"Reproducing locally" in [maintainers/hub-pr-check-reference.md](maintainers/hub-pr-check-reference.md).


## The nightly posts (02:00)

> 🎭 **camunda-hub positive (lifecycle) suite (SNAPSHOT)**
> ✅ 120 passed · ❌ 0 failed (example numbers)
> 📊 View run · 📋 positive (the TestRail run)

- The **positive** suite sends good requests and expects success (including create, read, delete and restore flows).
  The **negative** suite sends bad requests and expects 400, 401, 403 or 404. The 409 (conflict) tests are in the positive suite, because they need setup calls first.
- **A thread reply under the post** lists the known Hub issues that limit what the suite covers. Each item is either
  skipped on purpose (the tests are left out) or only partly checked (the test runs, but one assertion, such as the
  error-body shape, is not made). A green run does **not** fully cover those. What to do when one of those issues
  closes is in "The re-enable check" below. The re-enable check does **not** watch the partly checked items; see "Not watched" there.
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

The categories are 📦 product (Hub is wrong), 🧪 test-generation (our generated test is wrong or missing, not a Hub
bug), 🔧 infrastructure (the run itself broke), 🎲 flakiness (passes sometimes), 🎫 known issue (already tracked) and
📝 filed (a new Hub issue was opened tonight).

The **thread** under the digest has one line per failure: the category icon, the operation, and a link. What each icon
and link means, and what to do, is in the table under "What to do with a failure" above. Fix PRs and suppress PRs from the agent carry the
labels `nightly-api-fix`, `auto-generated` and `hub`.

**Pings.** `hub-medic` is pinged for a newly filed Hub issue, a fix or suppress PR that needs review, and a failure the triage
could not classify. `test-automation-medic` is pinged only for shared-pipeline faults the Hub team cannot fix (Vault, the Slack bot).
The status note at the top says which pings have not been switched yet.

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
| **coverage regression** | A new endpoint has no generated test (🚫 *missing coverage*; the bot will not open a bump PR until it is fixed) |
| **spec pin is behind** latest | The spec changed in small ways (fields), no endpoint churn |

The last line says what to do:

- **➡️ Adopt via bump PR #N** (PR opened automatically: **yes**): the new spec is safe, and the bot has already opened the bump PR for you. The generator owner reviews and merges it, which moves the pin. While it stays open, later checks update the same PR; once it is merged, the next change gets a new one.
- **📋 Blocked — see tracking issue #N** (PR opened automatically: **no**, only an issue): the new spec breaks something, or needs a test the generator does not have. Read
  the issue. The pin does not move until it is fixed.
- **⚠️ Spec-bump check failed for X** (PR opened automatically: **no**): a step of the job itself failed, so the drift result may be missing. Open the run
  before trusting that there is no drift.

Nightlies are **not** blocked by a pending bump: they run against Hub's latest spec regardless. The pin only affects the
invariant tests.

## The re-enable check (04:00)

Nobody is pinged for this post, and the draft PR it opens has no reviewer. It is only a message in the channel at about 04:00 UTC, and it is silent on most days. A message that says "see the workflow run log" ends with an **Open the workflow run** link. Posts from before 7 October have no link; open the [workflow page](https://github.com/camunda/api-test-generator/actions/workflows/hub-known-issue-reenable-check.yml) instead.

Skipped tests point to a Hub bug. This job watches those bugs. When one closes, it tries to bring the tests back.

| Message | Meaning | PR opened automatically? | Do this |
|---|---|---|---|
| 🎉 *issue* is closed — re-enabled: `ops` → draft PR | The skip was removed in a draft PR | **Yes**, a draft unskip PR | Review the draft PR and run the suite on its branch (see "Run it by hand"; the automatic live check skips PRs from the automation account). Merge if it is green **and** the Hub issue was closed as fixed. If Hub closed it as not planned, close the PR: the skip must stay |
| 🎉 … already has an open unskip PR | A PR for it exists already | **No** (one exists) | Review that PR |
| ⚠️ … breaks local generate/tests, no generator token was available, or opening the unskip PR failed | The job could not bring the test back this time | **No** | Open the workflow run and read the error. A missing token fixes itself on the next run |
| 📋 … is closed as **fixed**, no specific operation(s) to auto-unskip | A suite-wide skip whose Hub bug is fixed. Nothing can be done automatically | **No** | Remove its entry from `knownIssues` in `configs/camunda-hub/request-validation.json` and, if the same operation is also skipped in `positive-suppress.json` (key `suppress`) or excluded in `request-validation.json` (key `excludeOperations`), that entry too. Then run the suite on your branch (see "Run it by hand") |
| 📋 … is closed as **not planned** | Hub will not fix it, so the skip must stay | **No** | Set `"acknowledgedNotPlanned": true` on its `knownIssues` entry in `configs/camunda-hub/request-validation.json`. The alert then stops. Until you do, it repeats every day |

**Not watched:** the "partly checked" items in the negative thread (`knownProblemDetailShapeGaps` in
`request-validation.json`) are not covered by this check, so nothing tells you when their Hub issue closes. Look at the
issue's close reason first. **Closed as fixed:** remove the entry by hand. **Closed as not planned:** keep the entry, since
Hub still does not meet that assertion and removing it would make the nightly fail.

## The weekly coverage report (Monday 05:00)

Counts how many endpoints have a test for every response the spec lists, split into **positive** and **negative** tests,
with the change since last week in brackets.

**A gap is a to-do, not an incident.** Nothing is broken. Gaps in endpoint responses and bad-request tests become issues.
Lifecycle gaps (a resource with no create-read-delete test) open no issue, so only this report shows them.

After the report, the coverage-fix agent starts by itself. For small, safe gaps it opens **draft pull requests for you to
review**. It never merges anything, and the thread under the weekly Slack message lists the ones still waiting.

How to read the message, how to close a gap, and what the agent does and never does:
[hub-response-coverage-report.md](hub-response-coverage-report.md).

## Who to ask

- An alert about Hub or the generator (a failure, a wrong test, a skip): `hub-medic`.
- Anything in this channel you cannot place: write in the channel.
- Any question or help request, such as how the generator works or a Slack or Vault outage you cannot fix: ask in `#ask-qa` and tag `@test-automation-medic`.
- Adding a generator PR next to a Hub change (labels, feature flags): see [Adding or changing an endpoint in Hub](hub-pr-check-cookbook.md#adding-or-changing-an-endpoint-in-hub-do-you-need-a-generator-pr).

## Words used

More terms (medic, ontology, fingerprint, invariant tests, live check) are in the glossary of [hub-pr-check-cookbook.md](hub-pr-check-cookbook.md).

- **Operation:** one API endpoint, as the spec names it (for example `getWorkspace`). The guide says "endpoint" and "operation" for the same thing.
- **Fix PR / suppress PR:** a draft PR the triage agent opens in this repo. A fix PR corrects a wrong generated test. A suppress PR switches a test off until a Hub bug is fixed. It carries the same labels as a fix PR; its branch is named `fix/nightly-triage-suppress-…`.
- **Pin:** the camunda-hub commit the invariant tests are checked against.
- **Skip:** a test left out on purpose because of a tracked Hub limitation, with an issue link. It can stay after the issue closes, when Hub will not fix it. A **suite-wide skip** is not tied to one endpoint.
- **Partly checked:** the test runs, but one assertion (the error-body shape) is not made.
- **Unmapped operation / coverage gap:** an endpoint with no generated test at all.

What the workflows depend on (Vault, Slack token, registry login): [maintainers/workflow-dependencies.md](maintainers/workflow-dependencies.md).
