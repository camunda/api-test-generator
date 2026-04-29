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

Inputs flow through three workspaces in order:
`semantic-graph-extractor` → `path-analyser` (+ `request-validation`)
→ generated `*.spec.ts` files. The bundled OpenAPI spec is fetched by
`camunda-schema-bundler` (a dev dependency).

## Project layout

npm workspaces monorepo. Node `>=22`.

| Path | Purpose |
|---|---|
| `semantic-graph-extractor/` | Parses bundled spec, emits `operation-dependency-graph.json` |
| `path-analyser/` | BFS scenario planner + Playwright codegen (positive suite) |
| `path-analyser/src/scenarioGenerator.ts` | Core BFS planner — `generateScenariosForEndpoint()` |
| `path-analyser/domain-semantics.json` | Domain rules (artifact kinds, runtime states, capabilities) |
| `path-analyser/filter-providers.json` | Field → value-provider map |
| `request-validation/` | Negative-test generator (HTTP 400 suite) |
| `optional-responses/` | Optional response field analyser |
| `tests/fixtures/extractor/` | Layer-1 hand-curated OpenAPI snippets |
| `tests/fixtures/planner/` | Layer-2 minimal `OperationGraph` chain assertions |
| `tests/regression/` | Layer-3 invariants over the bundled-spec pipeline output |
| `tests/regression/spec-pin.json` | Pinned upstream `specRef` + `expectedSpecHash` |
| `spec/bundled/` | Gitignored bundled-spec output |
| `dist/`, `**/generated/` | Gitignored generator output (built each CI run) |
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
in `tests/regression/spec-pin.json`. A vitest `globalSetup`
(`tests/regression/spec-pin.setup.ts`) aborts the entire run if the bundled
spec content drifts.

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

To bump:

1. Pick a real commit SHA from `camunda/camunda` (e.g. from
   <https://github.com/camunda/camunda/commits/main>) and confirm it with
   `git ls-remote` as above.
2. `SPEC_REF=<that-sha> npm run fetch-spec:ref` — the bundler resolves any
   branch/tag/SHA to a SHA and writes `spec/bundled/spec-metadata.json`.
3. `npm run testsuite:generate && npm run generate:request-validation`
4. Update `spec-pin.json`:
   - `specRef`: the **resolved 40-char commit SHA** from
     `spec/bundled/spec-metadata.json` (never a branch — branches drift,
     and never this repo's own SHA — see the callout above)
   - `expectedSpecHash`: the `specHash` printed in `spec/bundled/spec-metadata.json`
5. Update any invariants whose values legitimately changed; commit together.

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

## TypeScript

- Three workspace tsconfigs: `semantic-graph-extractor/tsconfig.json`,
  `path-analyser/tsconfig.json`, `request-validation/tsconfig.json`. CI
  typechecks each in turn.
- Tests under `tests/**` import workspace sources directly (e.g.
  `../../../path-analyser/src/scenarioGenerator.ts`) and run via vitest with
  on-the-fly transformation — no separate test tsconfig.
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
| 3 — bundled-spec invariants | `tests/regression/bundled-spec-invariants.test.ts` | Named, human-readable invariant over real pipeline output (requires `npm run pipeline` first) |

`tests/regression/standalone-suite-imports.test.ts` and the suites under
`tests/codegen/` and `tests/request-validation/` cover emitter and
materialisation behaviour.

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

Single workflow: [.github/workflows/ci.yml](.github/workflows/ci.yml). Runs
on every PR to `main` and every push to `main`.

Steps (in order — match these locally before pushing):

1. `npm ci`
2. Read `tests/regression/spec-pin.json` → `specRef`
3. `npm run lint` — Biome
4. `tsc --noEmit` for each workspace tsconfig
5. `SPEC_REF=<pinned> npm run fetch-spec:ref`
6. `TEST_SEED=snapshot-baseline npm run testsuite:generate` + `npm run generate:request-validation`
7. `npm test`

On failure, the `pipeline-outputs` artifact is uploaded for inspection.

## Pre-push checklist

Local equivalent of the CI gate. Run before every push:

```bash
npm run lint
npx tsc --noEmit -p semantic-graph-extractor/tsconfig.json
npx tsc --noEmit -p path-analyser/tsconfig.json
npx tsc --noEmit -p request-validation/tsconfig.json
TEST_SEED=snapshot-baseline npm run testsuite:generate
npm run generate:request-validation
npm test
```

> **`npm test` alone is not sufficient.** The Layer-3 invariants in
> `tests/regression/bundled-spec-invariants.test.ts` read regenerated
> pipeline output (per-endpoint scenario JSON, feature-output files,
> emitted Playwright suites). If you skip the regen step you'll be testing
> against stale output and CI will surface a regression you didn't see
> locally — which is what happened on PR #62 (the L3 `#58` reproducer
> only fails when the pipeline is regenerated against the current
> `scenarioGenerator.ts`).
>
> Any change under `semantic-graph-extractor/`, `path-analyser/`,
> `request-validation/`, `domain-semantics.json`, `filter-providers.json`,
> or `request-defaults.json` requires the regen. When in doubt, regen.
>
> CI's "Regenerate pipeline outputs" step runs the same two commands
> (`testsuite:generate` + `generate:request-validation`) under
> `TEST_SEED=snapshot-baseline`. The `npm run pipeline` script also
> works but additionally re-fetches the spec, which is slower and
> usually unnecessary.

For Layer-3 invariant changes you must run the regen step or the test
file aborts with a "graph not found" / "scenarios directory not found"
error.

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
- Treat `tests/regression/spec-pin.json` as the source of truth for which
  upstream spec the invariants run against.
- Keep fixtures tiny and named after the property they guard.

**Ask first:**
- Bumping the pinned upstream spec ref (it can ripple through many
  invariants).
- Modifying `domain-semantics.json`, `filter-providers.json`, or
  `request-defaults.json` — these are configuration, not code, and changes
  shift many generated outputs at once.
- Adding a new emitter target (`path-analyser/src/codegen/emitter.ts`) —
  the contract is currently experimental.

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
  `tests/regression/spec-pin.json`
