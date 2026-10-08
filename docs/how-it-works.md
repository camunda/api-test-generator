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

There are four things. Most weeks, three of them need nothing from you.

| What | Where you see it | When | Is it yours? | Guide |
|---|---|---|---|---|
| **PR check** | A status on your camunda-hub pull request, and an alert in `#camunda-hub-pr-e2e-results` when red | Every Hub PR | Only when red. The alert says whose problem it is. The check never blocks merging | [PR check guide](hub-pr-check-cookbook.md) |
| **Nightly run** | Posts in `#camunda-hub-nightly-test-results` | Every night, 02:00 UTC | Only when something failed. A normal night has 0 failures | [Nightly guide](hub-nightly-cookbook.md) |
| **Weekly coverage report** | A post in the same channel | Monday, 05:00 UTC | Yes: it lists the API cases still not tested | [Coverage report guide](hub-response-coverage-report.md) |
| **Coverage-fix PRs** | Small draft pull requests in this repo, opened by an AI agent | After the Monday report | Yes: you review them. A person always decides to merge | [Coverage report guide](hub-response-coverage-report.md) |

Two more posts show up only when needed: a **spec-bump alert** (Hub's API changed since we last looked) and
a **re-enable check** (a Hub bug we had worked around was fixed, so a skipped test can come back).

## When something happens, what do I do?

| You see | Do this |
|---|---|
| Red PR check, alert says "likely a real regression" | It is probably your change. Read what the alert points to |
| Red PR check, alert says "generator not handling a new endpoint" | Not a Hub bug. Ask in `#camunda-hub-pr-e2e-results` |
| Red PR check, alert says "infrastructure failure" | Not yours. Open the failed step, find the outside cause, ask if unsure |
| Nightly post shows failures | Open the triage thread: one line per failure says whose it is |
| No nightly post in the morning | The run or the posting broke, not Hub. See "If a morning has no nightly post" in the nightly guide |
| Spec-bump alert | Hub's API changed. The bot has already opened a PR that updates the pinned spec: review it and merge it |
| Re-enable check | A Hub bug was fixed. Bring the test back, or decide on a bug closed as not planned |
| Weekly report lists gaps | Read the "what to do" column. Some are Hub bugs, some are generator gaps |
| A draft PR from the coverage-fix agent | Read its "In plain words" section first. Review it like any PR |
| Not sure | Post the run link in `#camunda-hub-pr-e2e-results` (for a question about how the generator works, `#ask-qa`) |

## Who owns what

**After the handover the Hub team owns this project**: the alerts, the Hub settings, and the generator itself,
including changing it when a new kind of coverage needs it. The test automation enablement team does not
carry on-call or maintenance duties for it.

The Hub team:

- reads and acts on every alert on this page, and is the on-call group (`hub-medic`), including for generator and pipeline problems;
- reviews and merges coverage-fix PRs, and fixes the Hub bugs the tests find;
- keeps the Hub settings in `configs/camunda-hub/`. Most coverage gaps are fixed there, and the coverage-fix agent handles many of them;
- changes the generator when a gap needs new behaviour. The agent only reports those, and a person opens the change. The code is in `request-validation/`, `path-analyser/` and `materializer/`, and [AGENTS.md](../AGENTS.md) lists the rules a change must follow.

Some alerts still ping `test-automation-medic` until the workflows are changed to ping `hub-medic`. That change is part of the handover.

**Questions:** ask in `#ask-qa`. The enablement team answers there, but nothing here depends on a reply.

## Words used

- **Generated suite:** the tests the generator writes. Nobody edits them by hand.
- **Generator gap:** the generator has no test, or a wrong one, for something. Not a Hub bug.
- **Coverage:** how many of the API's answers (success, 403, 404, bad request...) have a test.
- **Pin:** the exact version of Hub's API description the tests are built from.
- **Medic:** a Slack group on call for a test area.

Deeper detail for maintainers is in [docs/maintainers/](maintainers/). Want to change how the generator works? See the [README](../README.md) and [AGENTS.md](../AGENTS.md).
