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
| Spec-bump alert | Hub's API changed. Update the pinned spec as the alert describes |
| Re-enable check | A Hub bug was fixed. Bring the test back, or decide on a bug closed as not planned |
| Weekly report lists gaps | Read the "what to do" column. Some are Hub bugs, some are generator gaps |
| A draft PR from the coverage-fix agent | Read its "In plain words" section first. Review it like any PR |
| Not sure | Post the run link in `#camunda-hub-pr-e2e-results` |

## Who owns what

| Hub team | Test automation enablement team |
|---|---|
| Reading and acting on the alerts above | The generator itself: how tests are written from the spec |
| Reviewing and merging coverage-fix PRs | Shared automation: workflow files, Vault and Slack access, the AI agents and their limits |
| Fixing Hub bugs the tests find | Fixing generator gaps the Hub team reports |
| The Hub settings in `configs/camunda-hub/` (skips, floors, resource setup) | Other products' settings (for example `camunda-oca`) |
| Being the on-call group for alerts (`hub-medic`) | Being the on-call group for generator and pipeline faults (`test-automation-medic`) until the workflows are re-pointed |

If you are unsure which side a problem is on, ask in `#camunda-hub-pr-e2e-results`. We would rather
answer a question than have a red check ignored.

## Words used

- **Generated suite:** the tests the generator writes. Nobody edits them by hand.
- **Generator gap:** the generator has no test, or a wrong one, for something. Not a Hub bug.
- **Coverage:** how many of the API's answers (success, 403, 404, bad request...) have a test.
- **Pin:** the exact version of Hub's API description the tests are built from.
- **Medic:** a Slack group on call for a test area.

Deeper detail for maintainers is in [docs/maintainers/](maintainers/). Want to change how the generator works? See the [README](../README.md) and [AGENTS.md](../AGENTS.md).
