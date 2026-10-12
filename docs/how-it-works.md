# How it works (start here)

This page is for the Hub team. You know Hub; you do not need to know how the generator is built. It
explains what runs, what you will see, and what is yours to do. Everything else is in the guides it links to.

## The idea in one minute

Hub has an API, and the API has a written description (the OpenAPI spec). This project **reads that
description and writes API tests from it automatically**. Nobody writes or edits those tests by hand.

When the spec changes, the tests change with it. The tests are then run against a real Hub. If a test
fails, either Hub changed, or the generator did not understand the change. The alerts tell you which.

```
Hub's API description  →  tests written automatically  →  run against a real Hub  →  result in Slack / on your PR
```

## What you will see

There are four things. The weekly report and the agent PRs need you every week; the PR check and the nightly run only when something fails.

| What | Where you see it | When | Is it yours? | Guide |
|---|---|---|---|---|
| **PR check** | A status on your camunda-hub pull request, and an alert in `#camunda-hub-pr-e2e-results` when red (a yellow alert when only a coverage gap was found, with a green status) | Every Hub PR, except drafts, forks, PRs into `self-managed/*` and changes that cannot affect the API (details in the PR check guide) | Only when red. The alert says whose problem it is. The check never blocks merging | [PR check guide](hub-pr-check-cookbook.md) |
| **Nightly run** | Posts in `#camunda-hub-nightly-test-results` | Every night, 02:00 UTC | Only when something failed. A normal night has 0 failures | [Nightly guide](hub-nightly-cookbook.md) |
| **Weekly coverage report** | A post in the same channel | Monday, 05:00 UTC | Yes: it lists the API cases still not tested | [Coverage report guide](hub-response-coverage-report.md) |
| **Coverage-fix PRs** | Small draft pull requests in this repo, opened by an AI agent | After the Monday report | Yes: you review them. A person always decides to merge | [Coverage report guide](hub-response-coverage-report.md) |

Three more posts show up only when needed:

- **spec-bump alert**: Hub's API changed since we last looked;
- **re-enable check**: a Hub bug we had worked around was fixed, so a skipped test can come back;
- weekday **gap digest**: a merged Hub PR left a generator gap.

## When something happens, what do I do?

| You see | Do this |
|---|---|
| Red PR check, alert says "likely a real regression" | It is probably your change. Read what the alert points to |
| Red PR check, alert says "api-test-generator not yet handling a new/changed endpoint" | Not a Hub bug, but you act first: open the generator PR (see the PR check guide). Stuck? Ask in `#ask-qa` (tag `@test-automation-medic`) |
| Red PR check, alert says "infrastructure failure" | Not yours. Open the failed step and find the outside cause. Stuck? Ask in `#ask-qa` (tag `@test-automation-medic`) with the run link |
| Nightly post shows failures | Open the triage thread: one line per failure says whose it is |
| No nightly post in the morning | The run or the posting broke, not Hub. See ["When a post is missing"](hub-nightly-cookbook.md#when-a-post-is-missing) in the nightly guide |
| Spec-bump alert | Hub's API changed. Usually the bot has already opened a PR that updates the pinned spec: review it and merge it. If the alert says it is blocked or the check failed, it links a tracking issue or the run instead (see [the nightly guide](hub-nightly-cookbook.md#the-spec-bump-alert-0300)) |
| Re-enable check | A Hub bug was fixed. Bring the test back, or decide on a bug closed as not planned |
| A weekday post in `#camunda-hub-pr-e2e-results` listing generator gaps | A merged Hub PR left a generator gap. Open each issue and finish the generator PR |
| Weekly report lists gaps | Read the "what to do" column. Some are Hub bugs, some are generator gaps |
| A draft PR from the coverage-fix agent | Read its "In plain words" section first. Review it like any PR, within a day: a PR with no activity for a day is closed unless it has the `do-not-close` label |
| Not sure | Ask in `#ask-qa` (tag `@test-automation-medic`) and include the run link |

## Who owns what

**The Hub team owns this project**: the alerts, the Hub settings, and the generator itself,
including changing it when a new kind of coverage needs it. The test automation enablement team does not
carry on-call or maintenance duties for it.

The Hub team:

- reads and acts on every alert on this page, and is the on-call group (`hub-medic`), including for generator and pipeline problems;
- reviews and merges coverage-fix PRs, and fixes the Hub bugs the tests find;
- keeps the Hub settings in `configs/camunda-hub/`. Most coverage gaps are fixed there, and the coverage-fix agent handles many of them;
- changes the generator when a gap needs new behaviour. The agent only reports those, and a person opens the change. The code is in `request-validation/`, `path-analyser/` and `materializer/`, and [AGENTS.md](../AGENTS.md) lists the rules a change must follow.

**Who gets pinged.** `hub-medic` is pinged for every alert: a failed PR check, a newly filed Hub issue, a fix or suppress PR
that needs review, the spec-bump alert, the re-enable check, and the weekly report when it lists gaps.
`test-automation-medic` is also pinged only when a PR check fails before the tests start (a setup problem such as a clone
token or registry login) or keeps failing with no evidence. Every PR to this repo requests a review from
`@camunda/hub-backend` (see `.github/CODEOWNERS`). The daily gap digest and the coverage-fix agent's thread reply ping nobody
by name, so whoever is on call as `hub-medic` reads both Slack channels each morning: PR-check alerts and the gap digest
are in `#camunda-hub-pr-e2e-results`, everything else is in `#camunda-hub-nightly-test-results`.

**Questions or help:** ask in `#ask-qa` and tag `@test-automation-medic`. The enablement team answers there, but nothing here depends on a reply.

## Words used

- **Generated suite:** the tests the generator writes from the spec. Nobody edits them by hand.
- **Positive suite / negative suite:** the two groups of generated tests. The **positive** suite sends good requests and expects success, including create, read, delete and restore flows, and the 409 (conflict) tests, which need setup calls first. The **negative** suite sends bad requests and expects a refusal (400, 401, 403 or 404); a few edge cases it sends are ones the API should accept, and those expect 200.
- **Operation:** one API endpoint, as the spec names it (for example `getWorkspace`). The guides use "endpoint" and "operation" for the same thing.
- **Generator gap:** the generator does not understand something in Hub's API. The effect is a test it generated that is **wrong** and fails, or, for a new endpoint it does not know yet, **no test at all**. It is a **cause**, and it is not a Hub bug. The fix is a generator PR, usually a config entry.
- **Coverage gap:** a test is **missing**: an endpoint, response or kind of bad request with none yet. It is a **measurement**, it never fails a test, and it is a to-do, not an incident. A test can be missing because the generator could not build it, or because it was skipped on purpose for a Hub bug.
- **Unmapped operation:** the narrowest coverage gap: an endpoint with **no generated test at all**. For a new endpoint in your PR, the PR check reports it as a generator gap, because the generator does not know the endpoint yet.
- **Coverage:** how many of the API's answers (success, 403, 404, bad request...) have a test.
- **Pin:** the camunda-hub commit whose API description the invariant tests are checked against. The spec-bump alert moves it.
- **Invariant tests:** tests in this repo that check the generated output against the pinned spec. They guard the generator, not Hub.
- **Skip:** a test left out on purpose because of a tracked Hub limitation, with an issue link. It can stay after the issue closes, when Hub will not fix it. A **suite-wide skip** is not tied to one endpoint.
- **Partly checked:** the test runs, but one assertion (the error-body shape) is not made.
- **Fix PR / suppress PR:** a draft PR the triage agent opens in this repo. A fix PR corrects a wrong generated test. A suppress PR switches a test off until a Hub bug is fixed; its branch is named `fix/nightly-triage-suppress-…`. Both carry the labels `nightly-api-fix`, `auto-generated` and `hub`.
- **Medic:** a Slack group on call for a test area. `hub-medic` is the on-call group.
- **Classifier:** the automated step that reads a failed PR check and picks a verdict. It is an AI agent and can be wrong; it is told to answer "unknown" rather than guess.
- **Ontology:** the config files in `configs/camunda-hub/ontology/` that tell the generator how each resource is created, read, deleted and linked.
- **Live check:** running the generated suite against a real Hub. `hub-pr-live-check` does it on PRs to this repo and `hub-ondemand-test` does it by hand.
- **Fingerprint:** the failing tests plus the endpoints with no test. The same fingerprint edits one Slack message instead of posting a new one.

Want to change how the generator works? See the [README](../README.md) and [AGENTS.md](../AGENTS.md).
