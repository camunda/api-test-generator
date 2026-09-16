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

You can determine this yourself — it's the same test the triage automation
uses internally: **does the actual response agree with the OpenAPI spec,
or contradict it?**

- **Contradicts the spec → hub bug** (or at minimum a hub-behavior question
  worth raising, even if you don't yet have a fix). Examples: a field the
  schema marks `required` is accepted omitted; the status code doesn't
  match what the spec documents for that case; previously-passing behavior
  regressed.
  - One wrinkle worth knowing before you call something a contradiction:
    Hub checks body-validation (400) before resource-existence (404)
    before the authority gate (403). A negative test that "should" 403 but
    actually 404s isn't automatically a bug — check which layer the
    request is actually failing at first.
- **Agrees with the spec, but the test still failed anyway → generator
  gap.** The test itself couldn't be set up correctly, through no fault of
  the API. Common causes:
  - The planner has no way to obtain a real resource ID to test against
    (e.g. a GET-only, externally-discovered resource with no create op to
    chain from).
  - A brand-new operation's shape doesn't fit an existing test template yet.
  - The test's own expected-status assumption was wrong from the start.

Read the response and spec yourself before reaching for the confidence
score — it's a hint from the same read, not a substitute for it. If you've
done that and it's still genuinely ambiguous, that's when to ask in the
hub-test-generator channel — not before.

## Step 2: if it's a generator gap, open the fix — proactively if you can

Whoever's making the camunda-hub change is the right person to open this —
it's not something to leave to "whoever watches the nightly." If you
already know your PR adds or changes an endpoint the generator will need
to catch up on, open the matching **camunda/api-test-generator** PR
yourself, alongside your hub PR. Best case, it merges before the nightly
ever runs and the failure never happens at all.

The fix PR suppresses or narrows the affected test(s), in
`configs/camunda-hub/positive-suppress.json` (drops an op from the
positive suite) and/or `configs/camunda-hub/request-validation.json`
(drops specific negative scenarios via `excludeOperations`). See either
file's own `$comment` header for the exact mechanics.

**Label it `nightly-api-fix` by hand — this is the one step that's easy to
miss, and it's caused real duplicate-PR pain before.** The nightly triage
agent dedups against already-open fix PRs by searching their diffs, but
only among PRs carrying this label. It's applied automatically to PRs the
bot opens itself, but a manually-opened PR needs it added by hand — with
no label, the agent has no way to know your PR already covers the
endpoint. If the nightly happens to run before your PR merges, it opens
its own competing fix PR, and now there are two covering the same
operation. If that happens: whichever merges first wins, close the other
as a duplicate referencing it.

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
