# Hub team cookbook: reacting to generated-suite alerts

This is for camunda-hub engineers reacting to generated-suite alerts. It
covers what the automated checks on your PRs and the nightly mean, how to
tell a real hub bug from a generator limitation, and what to do next —
including opening the fix yourself in api-test-generator, which you're
welcome to do. See `CONTRIBUTING.md` there for the full contributor
mechanics beyond what's covered here.

## What's actually running

There are two different checks, and they behave differently once something
fails — worth knowing which one you're looking at.

### On your PR — `Hub PR live check`

`Guard`, `Run hub suite (internal)`, and `Live Hub suite` regenerate a
Playwright suite from your PR's spec and run it against a live Hub built
from your branch. On failure, a **read-only** classification agent
(`hub-pr-check.yml`) tags a category + confidence and posts a Slack alert
like:

> :red_circle: Generated Hub Suite Failed on a camunda-hub PR
> • Source: camunda/camunda-hub PR #NNNNN @ `<sha>`
> • Run: view run
> • Triggered by: camunda-hub run
>
> Likely api-test-generator not yet handling a new/changed endpoint shape,
> not a hub bug (confidence: high). ...

That agent never files an issue or opens a PR itself — it only classifies.
Everything from here (Steps 1–4 below) is on a human to act on. Read the
confidence line as a strong hint, not a verdict.

### Nightly — `triage-camunda-hub-nightly.yml`

Runs against unpinned `main` on a schedule, and is fully autonomous where
the PR-time check is read-only: it files camunda-hub product-bug issues,
opens api-test-generator suppression/fix PRs (labeled `nightly-api-fix`),
dedups against already-open fix PRs, re-verifies negative-suite failures
live via `curl` before filing, and separately checks for operations with
*no* generated coverage at all (a check that only runs here, not per-PR).
Most of the time you'll see its output as an already-filed camunda-hub
issue or an already-opened, already-tracked fix PR — not a raw failure
that still needs triaging.

## Step 1: is this a hub bug or a generator gap?

- **Hub bug**: your API genuinely does the wrong thing (wrong status code,
  wrong response shape, a regression against previously-passing behavior).
  Fix it in camunda-hub like any other bug.
- **Generator gap**: the test itself can't be satisfied through no fault of
  the API — most commonly one of:
  - The planner has no way to obtain a real resource ID to test against
    (e.g. a GET-only, externally-discovered resource with no create op to
    chain from).
  - The OpenAPI schema says one thing (e.g. a field is `required`) but the
    live implementation does something else (e.g. accepts it omitted).
  - A brand-new operation's shape doesn't fit an existing test template yet.

If you're not sure which it is, ask in the hub-test-generator channel — the
classification confidence score is a hint, not a guarantee.

## Step 2: if it's a generator gap, what happens next

Someone (a human or the nightly triage bot) opens a PR against
**camunda/api-test-generator** that suppresses or narrows the affected
test(s), in `configs/camunda-hub/positive-suppress.json` (drops an op from
the positive suite) and/or `configs/camunda-hub/request-validation.json`
(drops specific negative scenarios via `excludeOperations`). See either
file's own `$comment` header for the exact mechanics.

If your camunda-hub PR is still open when this happens, the fix PR gets
labeled `nightly-api-fix` (see `CONTRIBUTING.md`'s "Opening a fix PR for a
not-yet-merged hub API change") so the nightly doesn't open a competing
duplicate before yours merges.

## Step 3: every suppression needs a tracking issue

This is the part that's easy to skip and shouldn't be. Every suppress entry
can carry:

```json
"knownIssue": { "summary": "...", "url": "https://github.com/camunda/camunda-hub/issues/NNNNN" }
```

Skip `knownIssue` **only** when the op is suppressed by deliberate choice
(genuinely out of scope, not a bug or a gap worth revisiting). For
everything else — a chaining limitation, a schema/implementation mismatch,
anything you'd want someone to eventually come back to — `knownIssue` is
required, not optional, because two things key off `knownIssue.url`:

1. **The nightly's "skipped due to known issues" Slack thread** is derived
   straight from these entries. No URL means the gap doesn't show up there.
2. **`hub-known-issue-reenable-check.yml`** watches every `knownIssue.url`
   nightly. Once that GitHub issue closes as genuinely fixed (`stateReason:
   COMPLETED` — not closed as declined or a duplicate), this automation
   removes the suppression, regenerates, and opens a draft PR + Slack
   notice automatically.

Without a tracking issue, a suppression just sits there permanently, with
no mechanism — automated or human — that will ever revisit it.

## Step 4: who opens the tracking issue, and where

The camunda-hub engineer who owns the underlying behavior — usually the
author of the PR that introduced or changed the operation — not whoever
authored the api-test-generator suppression PR. They didn't design the
behavior and can't speak to whether it's intentional.

- **If the camunda-hub PR is still open**: comment directly on it. This is
  the highest-leverage moment — the behavior can still be fixed or
  clarified before it ships, instead of becoming a bug report against
  already-merged code.
- **If it's already merged**: open a new issue against camunda-hub (or
  api-test-generator, if the gap is really a generator capability
  limitation rather than anything hub needs to change — e.g. "the planner
  can't chain a GET-only discovered resource").

Once the issue exists, add the `knownIssue` entry (or ask whoever opened
the suppression PR to add it) referencing it.

## Quick reference

- Suppression configs: `configs/camunda-hub/positive-suppress.json`,
  `configs/camunda-hub/request-validation.json`
- Ahead-of-merge fix PR process: `CONTRIBUTING.md` → "Opening a fix PR for
  a not-yet-merged hub API change"
- Nightly re-enable automation: `.github/workflows/hub-known-issue-reenable-check.yml`
- Questions: ask in the hub-test-generator Slack channel
