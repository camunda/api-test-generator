# AGENTS.md

> **Note:** This file extends a central Camunda AGENTS.md. Read and apply it before proceeding.
>
> **URL:** https://raw.githubusercontent.com/camunda/.github/refs/heads/main/AGENTS.md
>
> Treat the central file's contents as if they were written directly here.
> The instructions below extend those guidelines and take precedence if there
> is any conflict.

Operational guide for AI coding agents working in this repository. Read this
before making any change. For deeper background, see [README.md](README.md)
(architecture, scripts, environment) and [CONTRIBUTING.md](CONTRIBUTING.md)
(test strategy and standing rules).

## What this repo is

`api-test-generator` produces Playwright integration suites for the Camunda
REST API by analysing the upstream OpenAPI spec. Two suites are emitted:

- **Positive** scenarios (happy paths, dependency chains, oneOf variants,
  artifact deployments) via `path-analyser`.
- **Negative** request-validation tests (HTTP 400 expectations across ~24
  malformed-request kinds) via `request-validation`.

Inputs flow through the processing pipeline `semantic-graph-extractor`
→ `path-analyser` → `materializer` (with `request-validation` as a
parallel pipeline). The new `@camunda8/emitter-sdk` workspace is a
contract dependency consumed by `materializer/` (and by external
emitter packages) — it sits beside the pipeline, not inside it. The
bundled OpenAPI spec is fetched by `camunda-schema-bundler` (a dev
dependency).

## Project layout

npm workspaces monorepo. Node `>=22`.

| Path | Purpose |
|---|---|
| `semantic-graph-extractor/` | Parses bundled spec, emits `operation-dependency-graph.json` |
| `path-analyser/` | BFS scenario planner — emits scenario JSON |
| `path-analyser/src/scenarioGenerator.ts` | Core BFS planner — `generateScenariosForEndpoint()` |
| `materializer/` | Test-suite materialization — reads scenarios JSON + ABox views and emits Playwright suites (positive). Owns the Playwright emitter, role-templating renderer, and vendored support helpers. Depends on path-analyser only via published `exports` (loaders + types). |
| `emitter-sdk/` | `@camunda8/emitter-sdk` — public contract package for SDK emitter contributors (JS/C#/Python OCA emitters). Defines `EmitterStrategy`, `EmitContext`, `EmittedFile`, `LoadedRoleBundle`, `RoleMatchSpec`, `JSONSchema`, `RoleHookProvider`, and the singleton registries. Consumed by `materializer/` and by external emitter packages. |
| `request-validation/` | Negative-test generator (HTTP 400 suite) |
| `optional-responses/` | Optional response field analyser |
| `tests/fixtures/extractor/` | Layer-1 hand-curated OpenAPI snippets |
| `tests/fixtures/planner/` | Layer-2 minimal `OperationGraph` chain assertions |
| `tests/regression/` | Layer-3 invariants over the bundled-spec pipeline output |
| `configs/` | Per-target generator configs (one directory per named config) |
| `configs/camunda-oca/spec-pin.json` | Pinned upstream `specRef` + `expectedSpecHash` for the camunda-oca config |
| `configs/camunda-oca/{domain-semantics,filter-providers,request-defaults}.json` | Domain rules, value providers, and request-body defaults for camunda-oca |
| `configs/camunda-oca/fixtures/` | Deployment-artifact fixture registry + BPMN/DMN/Form files for camunda-oca (#221 / Lift 11) |
| `configs/camunda-hub/spec-pin.json` | Pinned `specRef` (a `camunda/camunda-hub` SHA) + `expectedSpecHash` for camunda-hub. **Local-bundle mode — see Spec pin.** |
| `configs/camunda-hub/positive-suppress.json` | Per-op positive-suite suppressions for camunda-hub (upstream-blocked / opt-in ops), each with an optional `knownIssue { summary, url }` surfaced in the nightly |
| `configs.json` | Index of named configs (default + per-config metadata) |
| `spec/<config>/bundled/` | Gitignored bundled-spec output (partitioned by active CONFIG) |
| `generated/<config>/` | Gitignored generator output (graph, scenarios, playwright suite, request-validation) |
| `dist/`, `**/generated/` | Gitignored generator output (built each CI run) |
| `scripts/e2e/` | End-to-end driver scripts: `run-hub.sh` / `run-oca.sh` (generate → run → curl-compare) and `curl_compare.py` (independent curl oracle). See README §End-to-end validation scripts. |
| `plugins/no-unsafe-type-assertion.grit` | Custom Biome lint banning `as T` |
| `.github/workflows/ci.yml` | Single CI workflow (lint, typecheck, pipeline, tests) |

There is no `commitlint`, `husky`, or `.githooks/` directory in this repo.
No commit-message linting, no local pre-commit hook. CI is the gate.

## Pipeline / common commands

Always run from the repo root (`npm` resolves workspaces from there).

```bash
npm install                          # one-shot for all workspaces

# Spec
npm run fetch-spec                   # latest main
SPEC_REF=stable/8.10 npm run fetch-spec:ref

# Per-stage (rarely needed individually)
npm run extract-graph                # build extractor + emit dependency graph
npm run generate:scenarios           # build planner + emit scenario JSON
npm run codegen:playwright:all       # emit positive Playwright suite
npm run generate:request-validation  # emit negative suite

# End-to-end
npm run pipeline                     # fetch-spec + testsuite:generate + generate:request-validation
npm run testsuite:generate           # extract-graph + scenarios + codegen (no fetch)

# Quality gates
npm run lint                         # Biome (lint + plugin)
npm run lint:fix                     # apply safe fixes
npm test                             # vitest (regression + unit)
npx tsc --noEmit -p <workspace>/tsconfig.json   # per-workspace typecheck

# Ontology artefacts
npm run build:ontology               # regenerate ontology/vocabulary/*.schema.json from TS source
```

`spec/`, `dist/`, and `**/generated/` are gitignored. CI regenerates them
from scratch on every run.

## Determinism

`TEST_SEED` defaults to `'snapshot-baseline'`. Generator output is
byte-reproducible across runs and machines without setting it. Set
`TEST_SEED=random` only for live-broker exploration. Any other value is a
custom deterministic seed.

CI passes `TEST_SEED=snapshot-baseline` explicitly.

## Spec pin (do not skip)

Bundled-spec invariants are evaluated against a pinned upstream commit SHA
in `configs/<active>/spec-pin.json` (active config selected via the `CONFIG`
env var; default `camunda-oca`). A vitest `globalSetup`
(`tests/regression/spec-pin.setup.ts`) aborts the entire run if the bundled
spec content drifts.

> **This callout applies to `camunda-oca` (network-fetch mode). `camunda-hub`
> pins to `camunda/camunda-hub` in local-bundle mode — see the subsection below,
> where `git ls-remote camunda/camunda` does NOT apply.**
>
> **`specRef` is a commit SHA on the upstream `camunda/camunda` repo — NOT
> on this repo (`camunda/api-test-generator`).** `camunda-schema-bundler`
> shallow-clones `camunda/camunda` and runs `git fetch --depth 1 origin
> <specRef>`. If you paste a SHA that doesn't exist there (e.g. a SHA from
> this repo, a fork, or a squashed/rebased commit), CI fails the
> "Fetch pinned OpenAPI spec" step with:
>
> ```
> fatal: remote error: upload-pack: not our ref <sha>
> ```
>
> Verify before committing: `git ls-remote https://github.com/camunda/camunda <sha>`
> must print a line. If it prints nothing, the SHA is wrong.

To bump, use the script (it handles both configs and writes the resolved SHA +
hash into `spec-pin.json`), then verify and commit:

```bash
npm run bump-spec-pin -- --config <name> [--ref <sha|branch|tag>]   # omit --ref → default branch tip
CONFIG=<name> npm run testsuite:generate \
  && CONFIG=<name> npm run generate:request-validation \
  && CONFIG=<name> npm test
# update any invariants whose values legitimately changed, then commit spec-pin.json + updates
```

See [README.md → Spec pin → Bumping the spec pin](README.md) for details. The
manual equivalent (for reference): `SPEC_REF=<sha> npm run fetch-spec:ref` →
regenerate → set `configs/<config>/spec-pin.json` `specRef` (the **resolved
40-char SHA**, never a branch) + `expectedSpecHash` (from
`spec/<config>/bundled/spec-metadata.json`) → update invariants → commit.

The procedure above (and the `git ls-remote camunda/camunda` callout) is
**network-fetch mode**, used by `camunda-oca`. `camunda-hub` differs:

### camunda-hub: local-bundle mode

Hub's spec lives at `restapi/public-api/src/main/resources/openapi/v2/` inside
the **private** `camunda/camunda-hub` repo — a non-default path the bundler's
network-fetch CLI can't target. So `fetch-spec` bundles from a **sibling clone**
(`../camunda-hub`) instead, and **`SPEC_REF` is ignored** — it bundles whatever
ref that clone currently has checked out. Implications:

- `configs/camunda-hub/spec-pin.json`'s `specRef` is a SHA on
  **`camunda/camunda-hub`** (not `camunda/camunda`), so the `git ls-remote
  camunda/camunda` check above does **not** apply.
- To reproduce a hub invariant failure or bump the pin, check the ref out **in
  the sibling clone first**, then bundle + generate:
  ```bash
  git -C ../camunda-hub checkout <specRef>   # or latest main to bump
  CONFIG=camunda-hub npm run fetch-spec       # NOT fetch-spec:ref — SPEC_REF is ignored here
  CONFIG=camunda-hub npm run testsuite:generate && CONFIG=camunda-hub npm run generate:request-validation
  ```
  Then update `configs/camunda-hub/spec-pin.json` (`specRef` = the checked-out
  `camunda/camunda-hub` SHA, `expectedSpecHash` = the `specHash` in
  `spec/camunda-hub/bundled/spec-metadata.json`), as in steps 4–5 above.
- The nightly (`.github/workflows/nightly-camunda-hub.yml`) runs hub **unpinned**
  (clones `camunda-hub@main`, bundles latest) — the pin governs only the
  Layer-3 invariants in `configs/camunda-hub/regression-invariants.test.ts`.
- **Running the hub suites locally (the nightly's path):** the hub spec is bundled
  from the `../camunda-hub` **sibling clone** at runtime and is **gitignored** — no
  branch commit or the spec-pin governs it (local runs are unpinned, like the
  nightly). The prebuilt Hub runs the `camunda/hub:${HUB_IMAGE_TAG:-SNAPSHOT}` image
  (`SNAPSHOT` = latest published build; override `HUB_IMAGE_TAG` to pin), so keep the
  sibling at the matching ref for spec↔runtime parity:
  ```bash
  git -C ../camunda-hub checkout main && git -C ../camunda-hub pull   # sibling → latest
  HUB_MODE=prebuilt ./docker/start-hub.sh start
  STEPS="generate run" RV_PROFILES="secured rbac" ./scripts/e2e/run-hub.sh
  ```
  `run-hub.sh`'s `generate` step **auto-re-bundles** from the sibling (so it never
  runs against a stale on-disk bundle — this bit us once: a day-old bundle marked
  `page.startCursor/endCursor` `required` while latest had dropped them, producing
  false search-op failures). Set `SKIP_BUNDLE=1` to run against the current on-disk
  bundle instead. Don't invoke `npx playwright` directly — that skips the
  `POS_FIXTURE_*` env `run-hub.sh` sets (e.g. valid-BPMN `POS_FIXTURE_FILE_CONTENT`).

## Code style & lint (Biome)

Biome 2.4.12 owns both linting and formatting. Config: [biome.json](biome.json).

- Format: 2-space indent, single quotes, trailing commas all, semicolons, line width 100
- `recommended` ruleset, with these escalated to **error**:
  - `suspicious/noExplicitAny`
  - `suspicious/noImplicitAnyLet`
  - `suspicious/noEvolvingTypes`
- Custom GritQL plugin `plugins/no-unsafe-type-assertion.grit` bans `as T`
  outside imports and `as const`. Use type guards, narrowing, or `satisfies`.
  Suppress only with a justified `// biome-ignore lint/plugin: <reason>`
  comment when truly unavoidable (e.g. parsed-JSON contract boundaries).
- `dist/`, `**/generated/`, `node_modules/`, `spec/`, `external-spec/` are
  excluded from Biome.

Run `npm run lint` (or `npx biome check <files>`) before commit.

### Zero tolerance for warnings

`npm run lint` must report **zero warnings and zero infos** — not just
zero errors. Warnings are latent bugs or stale code (unused imports,
redundant suppressions, dead biome-ignore comments, style nudges); they
accumulate silently and erode the signal of the lint gate. Treat every
warning as a hard failure and clear it before you commit.

Fix warnings **at the root**, not by suppressing them:

- An unused import means dead code — delete the import (and any other
  artefacts left behind by the same refactor).
- A redundant `// biome-ignore …` comment means the rule no longer
  fires on that site — delete the comment.
- A `useTemplate` warning means a string concat should be a template
  literal — rewrite the expression.
- A `noExplicitAny`/`noImplicitAnyLet`/`noEvolvingTypes` warning means
  the type is wrong — narrow it.

Add a `// biome-ignore lint/<rule>: <reason>` suppression only when the
rule is genuinely wrong for the call site (e.g. a runtime contract
boundary parsing `unknown` JSON), and always include a concrete
justification. Reviewers will reject suppressions added to silence a
warning that has a real fix.

## TypeScript

- Five workspace tsconfigs: `semantic-graph-extractor/tsconfig.json`,
  `path-analyser/tsconfig.json`, `emitter-sdk/tsconfig.json`,
  `materializer/tsconfig.json`, `request-validation/tsconfig.json`. CI
  typechecks each in turn (and builds path-analyser + emitter-sdk before
  the materializer typecheck so `.d.ts` files exist for the
  subpath-exports resolution). A separate `tests/tsconfig.json` covers
  the test sources (which import workspace sources directly via `.ts`
  extensions; see `allowImportingTsExtensions` in that file); CI runs
  `npx tsc --noEmit -p tests/tsconfig.json` as its own gate.
- **No `any`.** Narrow `unknown` with type guards.
- **No unsafe type assertions.** `as T` is banned by the
  `plugins/no-unsafe-type-assertion.grit` Biome plugin in both `src/` and
  `tests/`. Permitted exceptions: `as const` and import renames. Use type
  guards, narrowing, or `satisfies` instead.

  If a cast is genuinely unavoidable (e.g. parsed-JSON contract boundary
  where the schema is verified out-of-band), suppress it with an explicit
  justification:

  ```ts
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
  const graph = JSON.parse(raw) as DependencyGraph;
  ```

  Reviewers will reject suppressions without a clear reason. The
  GritQL plugin and the three escalated `suspicious/*` rules
  (`noExplicitAny`, `noImplicitAnyLet`, `noEvolvingTypes`) together
  prevent the `any`/cast back-door.

## Test strategy (layered — see CONTRIBUTING.md)

There is **no end-to-end snapshot guard**. The previous SHA-256 manifest
diff was retired because a 412-file diff is not a useful signal. Layered
fixtures and named invariants point directly at the broken property.

| Layer | Location | What it asserts |
|---|---|---|
| 1 — extractor constructs | `tests/fixtures/extractor/extractor-constructs.test.ts` | One OpenAPI construct → one extractor property (`required`, `provider`, `fieldPath`, …) |
| 2 — planner contracts | `tests/fixtures/planner/planner-contracts.test.ts` | Hand-built minimal `OperationGraph` → chain-shape assertion on `generateScenariosForEndpoint` |
| 3 — bundled-spec invariants | `configs/<config>/regression-invariants.test.ts` (e.g. `configs/camunda-oca/regression-invariants.test.ts`) | Per-config (#128 PR 3) named, human-readable invariants over real pipeline output (requires `npm run pipeline` first). Each file `describe.skipIf`-guards itself to its own CONFIG, so a run only executes the active config's invariants: the `regression` CI job runs camunda-oca's, and the `hub invariants` CI job runs camunda-hub's (#128). |

`tests/regression/standalone-suite-imports.test.ts` and the suites under
`tests/codegen/` and `tests/request-validation/` cover emitter and
materialisation behaviour.

### Coverage has two axes: presence and completeness

- **Endpoint presence** — does this operation have a generated test at all.
  `coverage.json`'s `summary.unmappedOperations` (per-config, see the
  nightly/CI job summaries) measures exactly this, and only this.
- **Assertion completeness** — for a test that exists, does it check every
  part of the documented contract (status code, response body shape,
  headers, …), or only part of it.

An empty `unmappedOperations` proves the first axis, not the second. When
asked whether coverage is complete, don't answer from that one metric alone.
Enumerate the contract dimensions that matter and check each one explicitly
against the product's actual documented spec — not against this generator's
own internal definition of "has a test."

### Standing rule for every bug fix to extractor or planner

1. **Add a fixture demonstrating the bug BEFORE the fix.** The fixture
   must fail on `main` and pass on your branch. One `it` block = one
   regression statement.
2. **Add an invariant if the property is observable at the chain or graph
   level on the real bundled spec.** Use a named, human-readable
   assertion, not a generic structural diff.
3. **Scope the test to the defect class, not just the instance.** If the
   bug is "operation X re-uses a swallowed prereq", assert that **no**
   operation in the bundled output does so. Instance-only tests rot.

### Vitest conventions

- vitest 4.1.5, `npm test` = `vitest run`.
- `describe` blocks group an extractor construct, a fixture, or a
  bundled-spec invariant family. Each `it` is one named assertion.
- The bundled-spec invariants depend on generator output; if the test
  reports a missing graph or scenarios directory, run `npm run pipeline`
  (or at least `npm run testsuite:generate` + `npm run generate:request-validation`).
- For runtime contract boundaries that genuinely need to parse `unknown`
  JSON, use `// biome-ignore lint/plugin: runtime contract boundary for parsed JSON`.

## Bug-fix discipline (red / green / class-scoped)

Mandatory for every behaviour change:

1. **Red** — write the failing fixture or invariant first. It must fail
   for the reason you expect.
2. **Green** — apply the minimal production fix.
3. **Class-scoped** — broaden the assertion so the same category of bug
   can't recur in a sibling code path. The fixture is a permanent
   regression guard, not a one-shot.

Reviewers may ask you to demonstrate the red step (e.g. a separate commit
or a clear PR description note).

### Behaviour tests are the regression guard

During a behaviour-preserving refactor, do **not** modify Layer-1 fixtures,
Layer-2 chain assertions, or Layer-3 invariants. If a fixture or invariant
fails, the production code is usually wrong — not the test. The whole
point of the layered strategy is that named, hand-curated assertions
encode preserved behaviour; rewriting them to match the new output erases
the guard.

If a change intentionally modifies observable behaviour (e.g. a planner
chain shape, an emitter contract, or an extractor property), update the
affected fixtures/invariants and explicitly document and justify the
intended behaviour change in the PR.

### Coverage analysis before a behaviour-preserving refactor (green/green)

Before any non-trivial refactor of `path-analyser` or
`semantic-graph-extractor`, audit whether the surface you're about to
change is sufficiently guarded. A passing test suite is necessary but not
sufficient — it only proves that *what is currently tested* still works.
The risk of a refactor is the behaviour that nobody asserts.

For each behaviour you intend to preserve, find or write the fixture or
invariant that would fail if it changed. If the surface is unguarded,
**add the missing fixture/invariant first, on the pre-refactor branch**,
and prove it passes against the current implementation. This is the
green/green discipline:

1. **Green on the pre-refactor code** — proves the assertion encodes
   preserved behaviour, not aspirational behaviour.
2. **Green on the refactored code** — proves the refactor preserved it.

Land the new guard fixtures in a separate PR off `main` and merge it
before the refactor PR. A guard that lands together with the change it's
supposed to guard has no recorded moment at which it passed against the
old code.

### There are no flaky tests

Intermittent failures are either a **test defect** (race, unsynchronised
readiness signal, timeout-as-correctness, wall-clock dependency, shared
temp dir across runs, parallel-test interaction) or a **product defect**
(race, missed signal, resource leak under load). Either way, an
intermittent failure is a real defect that must be diagnosed and fixed
before the change merges.

Never: retry CI, mark the test `it.skip`, add `.retry()`, or describe the
failure as "flaky" or "unrelated" in the PR description. "Re-run and
hope" is a coping strategy, not engineering.

When triaging:

- Reproduce locally if possible (loops, resource pressure, timeout
  reduction). If you can't reproduce, reason from first principles about
  what could differ between local and CI (load, network, vitest worker
  scheduling, fs semantics).
- Common causes for this repo specifically: tests that race the spec
  fetch, tests that depend on `**/generated/` output without first
  running the pipeline, tests that share a temp dir without isolating
  per-`it`, fixtures whose ordering depends on a non-deterministic
  `TEST_SEED`.
- In the fix commit, name "test defect" or "product defect" explicitly
  and explain which signal the test was previously relying on vs the new
  deterministic one.
- Generous timeouts are safety nets, not correctness signals — comment
  them so future maintainers don't tighten them back into a race.

## Commit conventions

This repo follows [Conventional Commits](https://www.conventionalcommits.org/).
Format:

```
<type>: <description>
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`,
`build`, `perf`, `style`, `revert`. Use imperative mood, lowercase subject.

There is **no `commitlint` configuration** in this repo, so the format is
not enforced mechanically — but PRs are expected to follow it.

### Review-comment fix-ups

Commits that address PR review comments must use `chore:`, **not** `fix:`.
A `fix:` commit signals a user-visible bug fix; review iterations are not.

```
# Correct
chore: address review comments — let findOperation throw on unknown opId

# Wrong
fix: address review comments — …
```

## Git workflow

- `main` is the default branch. Open a PR from a feature branch.
- Never `git push --force` on `main`. Use `--force-with-lease` on feature
  branches when rewriting history.
- Branch naming is informal (e.g. `fix/<slug>-issue-<n>`,
  `chore/<slug>`). The PR title (Conventional Commit format) is what
  matters.
- Reference the closing issue in the PR description (`Closes #NN`).

## Continuous integration

PR/branch workflow: [.github/workflows/ci.yml](.github/workflows/ci.yml). Runs
on every PR to `main` and every push to `main`. It has **three parallel jobs**:
per-config `regression` (camunda-oca) and `hub invariants` (camunda-hub), plus
an advisory `spec-freshness` heads-up.

**`Lint, typecheck, regression` (camunda-oca)** — the required gate. Steps (in
order — match these locally before pushing):

1. `npm ci`
2. `npm run check:no-bom` — fail on any UTF-8 BOM in a tracked file
3. Read `configs/camunda-oca/spec-pin.json` → `specRef`
4. `npm run lint` — Biome
5. `tsc --noEmit` for each workspace tsconfig
6. `SPEC_REF=<pinned> npm run fetch-spec:ref`
7. `TEST_SEED=snapshot-baseline npm run testsuite:generate` + `npm run generate:request-validation`
8. `npm run lint:generated` — Biome on the generated suite (emitter regression guard)
9. `npm test`

On failure, the `pipeline-outputs` artifact is uploaded for inspection.

**`Lint, typecheck, hub invariants` (camunda-hub)** — the same lint + typecheck,
then clones the **pinned** `camunda-hub` spec (private repo → Vault → GitHub App
token, same pattern as the nightly), bundles + generates both suites, and runs
`configs/camunda-hub/regression-invariants.test.ts`. No live Hub — pinned +
generate + invariants only, so no backend flakiness. Runs on `push` + same-repo
PRs (fork PRs lack the clone secrets). It becomes a *merge-blocking* gate only
when added to branch protection's required checks (that toggle is the on-switch).

**`Spec freshness (pins vs upstream main)`** — an **advisory** job (never make it
a required check): it compares each config's pinned spec to its upstream default
branch **by content hash** and fails (red) when a pin is behind, as a "bump the
pin" nudge (`npm run bump-spec-pin`). It intentionally depends on external state
(upstream moves on its own), so it must not gate merges. Same fork/secret guard
as the hub leg.

The **nightly** ([nightly-camunda-hub.yml](.github/workflows/nightly-camunda-hub.yml))
is the complementary hub leg: it clones `camunda-hub@main` **unpinned** and runs
the positive + negative suites against a **live Hub** — catching upstream drift
and runtime breakage the pinned PR leg deliberately can't.

The **on-demand hub test** ([hub-ondemand-test.yml](.github/workflows/hub-ondemand-test.yml))
is the nightly's manual sibling: `workflow_dispatch` it against **any branch**
(`gh workflow run hub-ondemand-test.yml --ref <branch>`, or the Actions UI branch
picker) to run the same generate → live-Hub flow on that branch's generator without
waiting for the schedule. It's a test tool — results go to the run summary + uploaded
Playwright reports only (no Slack/TestRail). `hub_ref` / `hub_image_tag` inputs default
to `main` / `SNAPSHOT` (dispatch-overridable). It shares all its hub plumbing with the
nightly rather than duplicating it — the composite actions
[`hub-clone-token`](.github/actions/hub-clone-token),
[`clone-hub-sibling`](.github/actions/clone-hub-sibling),
[`wait-for-hub`](.github/actions/wait-for-hub), and
[`hub-run-summary`](.github/actions/hub-run-summary), plus `scripts/e2e/run-hub.sh`
(which auto-re-bundles). (`clone-hub-sibling` is also used by ci.yml's hub-invariants leg.)

The **spec-bump check** ([spec-bump-check.yml](.github/workflows/spec-bump-check.yml),
#387) is a scheduled (**daily** 06:00 UTC) + `workflow_dispatch` job — a
per-config **matrix over `camunda-oca` and `camunda-hub`**, never `pull_request`
(it can't fail anyone's PR). For each config it resolves latest upstream `main`,
generates + runs that config's invariants against it, diffs the operation
surface, then routes: **clean** drift → opens/updates a rolling bump PR
(`chore/spec-bump-<config>`) via `bump-spec-pin`; **broken** drift → one rolling
tracking issue; **no content change** → closes the artifact. Generate + invariants
are gated on real content drift (SHA-only moves are cheap no-ops). Two App tokens:
**preview-envs** (Vault JWT/OIDC) mints a read token to clone the private
`camunda-hub` sibling (oca is a public network-fetch, no token); **qa-processes**
(Vault approle) opens the bump PR as `app/qa-processes` so `ci.yml` triggers on it
(the built-in `GITHUB_TOKEN` can't — loop-prevention). If the qa-processes token
is unavailable, routing falls back to the tracking issue. Checkout uses
`persist-credentials: false` so its read-only header can't shadow the App-token
push.

For **camunda-hub** only, when the *operation* surface changed (an operationId
added/removed, not just a field), it also posts a Slack alert to
`#camunda-hub-api-test-results` (Slack bot token via the same Vault JWT auth)
linking the bump PR / tracking issue it just created — so the hub team sees a
new upstream domain in their channel, not only as a GitHub issue (#435). The
op-surface diff is already computed for the routing above, so the Slack step
only formats + links; it does not recompute.

## Pre-push checklist

Local equivalent of the CI gate. Run before every push:

```bash
npm run lint
npx tsc --noEmit -p semantic-graph-extractor/tsconfig.json
npx tsc --noEmit -p path-analyser/tsconfig.json
npm run build:analyser   # emits .d.ts that emitter-sdk + materializer typechecks depend on
npx tsc --noEmit -p emitter-sdk/tsconfig.json
npm run build:emitter-sdk   # emits .d.ts that materializer's typecheck depends on
npx tsc --noEmit -p materializer/tsconfig.json
npx tsc --noEmit -p request-validation/tsconfig.json
TEST_SEED=snapshot-baseline npm run testsuite:generate
npm run generate:request-validation
npm test
```

> **The `build:analyser` and `build:emitter-sdk` steps are mandatory
> before the materializer typecheck.** Materializer imports
> `from 'path-analyser/configResolver'` and
> `from '@camunda8/emitter-sdk'`, both resolved via subpath `exports`
> maps to `dist/**/*.d.ts`. Those declarations only exist after `tsc`
> has emitted them. CI builds both in the typecheck job for the same
> reason; if you skip the builds locally you'll miss CI failures that
> a fresh clone would surface.

> **`npm test` alone is not sufficient.** The Layer-3 invariants in
> `configs/<config>/regression-invariants.test.ts` read regenerated
> pipeline output (per-endpoint scenario JSON, feature-output files,
> emitted Playwright suites). If you skip the regen step you'll be testing
> against stale output and CI will surface a regression you didn't see
> locally — which is what happened on PR #62 (the L3 `#58` reproducer
> only fails when the pipeline is regenerated against the current
> `scenarioGenerator.ts`).
>
> Any change under `semantic-graph-extractor/`, `path-analyser/`,
> `materializer/`, `request-validation/`, or any file under
> `configs/<name>/` (notably
> `domain-semantics.json`, `filter-providers.json`, `request-defaults.json`)
> requires the regen. When in doubt, regen.
>
> CI's "Regenerate pipeline outputs" step runs the same two commands
> (`testsuite:generate` + `generate:request-validation`) under
> `TEST_SEED=snapshot-baseline`. The `npm run pipeline` script also
> works but additionally re-fetches the spec, which is slower and
> usually unnecessary.

For Layer-3 invariant changes you must run the regen step or the test
file aborts with a "graph not found" / "scenarios directory not found"
error.

> **`npm run build:ontology` is a separate step.** Run it whenever you
> edit any TypeScript file under `path-analyser/src/ontology/` (e.g.
> `edgeSchema.ts`). It regenerates the committed JSON Schema artefacts
> under `ontology/vocabulary/` that external SPARQL/SHACL/OWL tooling
> reads. A Layer-3 drift-detector invariant in
> `configs/<config>/regression-invariants.test.ts` fails if the
> committed JSON drifts from the TS source of truth, so a stale file
> will surface as a test failure rather than shipping silently.

## Terminal commands (agent tooling)

- Avoid heredocs (`<< EOF`) when running shell commands through an AI
  agent or other automation tool — they don't work reliably in zsh on
  macOS and produce confusing failures that look like syntax errors.
- Prefer the agent's native file-editing tools for creating or modifying
  files. Don't pipe content through `cat > file` from the shell.
- Appending a single line with `echo` or `printf >> file` is fine.

## Boundaries

**Always:**
- Follow the layered test strategy and the standing red/green/class-scoped
  rule for extractor and planner changes.
- Treat `configs/<active>/spec-pin.json` (e.g. `configs/camunda-oca/spec-pin.json`)
  as the source of truth for which upstream spec the invariants run against.
- Keep fixtures tiny and named after the property they guard.

**Ask first:**
- Bumping the pinned upstream spec ref (it can ripple through many
  invariants).
- Modifying any `configs/<name>/{domain-semantics,filter-providers,request-defaults}.json` —
  these are configuration, not code, and changes shift many generated
  outputs at once.
- Adding a new emitter target (`path-analyser/src/codegen/emitter.ts`) —
  the contract is currently experimental.
- **Adding a parallel implementation of an existing pipeline stage**
  (a new scenario builder alongside `scenarioGenerator.ts`, a new
  Playwright emitter alongside `materializer/src/playwright/emitter.ts`,
  a new feature-coverage generator alongside `featureCoverageGenerator.ts`,
  etc.). In the PR description, justify why a unification with the
  existing canonical implementation is not possible. Parallel
  implementations drift: every diverged code path silently grows
  bug-fix asymmetries and feature gaps that don't surface until much
  later (see issues #286 and #288 for two concurrent examples of this
  failure mode). If the new requirement genuinely doesn't fit the
  canonical implementation, prefer extending the canonical one — even
  if the extension is larger than the parallel implementation would be.

**Never:**
- Reintroduce an end-to-end snapshot/manifest guard (it was retired
  deliberately — see README §Regression Testing).
- Use `as T` type assertions outside imports / `as const` without a
  justified `// biome-ignore lint/plugin:` comment.
- `git push --force` on `main`.
- Commit `dist/`, `spec/`, or `**/generated/` (all gitignored).

## Upstream dependencies

These are upstream — when they misbehave, report it; do not work around
them here:

- [`camunda-schema-bundler`](https://github.com/camunda/camunda-schema-bundler) — bundles upstream multi-file spec
- Upstream Camunda OpenAPI spec at `camunda/camunda` — pinned by
  `configs/camunda-oca/spec-pin.json`
