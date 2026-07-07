# API Test Generator

Generates Playwright integration test suites from the Camunda REST API OpenAPI specification.
Analyses the spec's semantic type annotations (`x-semantic-type`) to build an operation
dependency graph, then emits scenario-driven test files with full request/response synthesis.
Also emits **negative request-validation tests** (intended HTTP 400) covering ~24 distinct
malformed-request scenario kinds.

## Architecture

```
┌──────────────────────────┐
│  camunda-schema-bundler  │  Fetches & bundles the upstream multi-file OpenAPI spec
│  (devDependency)         │  → spec/<config>/bundled/rest-api.bundle.json
└────────────┬─────────────┘
             │
             ├──────────────────────────────────────────┐
             ▼                                          ▼
┌──────────────────────────┐               ┌──────────────────────────┐
│ semantic-graph-extractor │               │   request-validation     │
│                          │               │ (negative-test generator)│
│ Parses bundled spec,     │               │                          │
│ extracts semantic types  │               │ Synthesizes ~24 kinds of │
│ & operations             │               │ malformed-request tests  │
│ → operation-dependency-  │               │ expecting HTTP 400       │
│   graph.json             │               │ → generated/<config>/    │
└────────────┬─────────────┘               │   request-validation/    │
             │                             │   *.spec.ts              │
             ▼                             └──────────────────────────┘
┌──────────────────────────┐
│     path-analyser        │  Reads graph + spec, plans positive scenarios
│                          │  per endpoint
│                          │  → generated/<config>/feature-output/*.json
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│      materializer        │  Reads planned scenarios, emits self-contained
│                          │  Playwright suites (other targets pluggable)
│                          │  → generated/<config>/playwright/*.spec.ts
└──────────────────────────┘
```

## Prerequisites

- **Node.js ≥ 22**
- **npm ≥ 10** (ships with Node 22+)
- **Camunda 8 server** — either via [`c8ctl`](https://github.com/camunda/c8ctl) (recommended) or Docker Compose

## Quick Start

### Starting the Camunda Server

#### Option A — [`c8ctl`](https://github.com/camunda/c8ctl) (recommended)

`c8ctl` is the Camunda 8 CLI. It manages a local cluster lifecycle for you and
is the fastest path from clone to a running server:

```bash
# One-off install (Node ≥ 22)
npm install -g @camunda8/c8ctl

# Start a cluster pinned to a specific Camunda version
c8ctl cluster start 8.9

# Stop it when you're done
c8ctl cluster stop
```

The Camunda REST API will be available at `http://localhost:8080`.

#### Option B — Docker Compose

If you prefer to run Compose directly:

```bash
cd docker
docker compose up -d
docker compose logs camunda          # health check
docker compose down                  # stop
```

Override the REST port with `CAMUNDA_REST_PORT`:

```bash
CAMUNDA_REST_PORT=9080 docker compose up -d
```

### Starting Camunda Hub (Web Modeler) — Self-Managed

> First-time setup required — see `LOCAL_SETUP_NOTES.md` in the camunda-hub repo.
> Expects `camunda-hub` to be cloned as a sibling directory alongside this repo.

```bash
# Start (Docker infrastructure + restapi + frontend)
./docker/start-hub.sh

# Stop
./docker/start-hub.sh stop
```

The Hub UI will be available at `http://localhost:${HUB_UI_PORT:-8088}`. Log in with `demo` / `demo`.

#### Generating and running Hub request-validation tests

```bash
# Generate hub request-validation tests
CONFIG=camunda-hub npm run generate:request-validation

# Get an OAuth token from Keycloak (hub uses Bearer auth, not Basic)
TOKEN=$(curl -s -X POST "http://localhost:${KEYCLOAK_PORT:-18080}/auth/realms/camunda-platform/protocol/openid-connect/token" \
  -d "client_id=c8-client&client_secret=c8-secret&grant_type=client_credentials" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

# Run the generated tests
# Unset Basic auth vars — if set, they take precedence over BEARER_TOKEN and hub tests will fail
unset CAMUNDA_BASIC_AUTH_USER CAMUNDA_BASIC_AUTH_PASSWORD
BEARER_TOKEN=$TOKEN \
CORE_APPLICATION_URL=http://localhost:${HUB_UI_PORT:-8088}/api \
CONFIG=camunda-hub npm run test:pw:request-validation
```

The default profile runs the 400s. To run the 401 (`secured`) or 403 (`rbac`) negatives, set `RV_PROFILE`:

```bash
# 401 — auth-absent / auth-invalid. The secured profile also includes 400
# body-validation scenarios, which require admin auth to get past authentication.
# BEARER_TOKEN is therefore still needed; the auth-absent/invalid tests send
# no credentials / a bad one on their own.
BEARER_TOKEN=$TOKEN \
RV_PROFILE=secured \
CORE_APPLICATION_URL=http://localhost:${HUB_UI_PORT:-8088}/api \
CONFIG=camunda-hub npm run test:pw:request-validation

# 403 — auth-deny. Mint a token from the reduced-permission deny client and pass it
# as RBAC_DENY_PROBE_BEARER_TOKEN. It authenticates (audience mapper added by
# start-hub.sh) but holds no public-api authority, so keyless, no-required-body,
# no-required-non-path-param secured ops return 403 (by-key, required-body, and
# required-query/header/cookie ops are excluded — Hub checks 400/404 before the
# authority gate).
DENY_TOKEN=$(curl -s -X POST "http://localhost:${KEYCLOAK_PORT:-18080}/auth/realms/camunda-platform/protocol/openid-connect/token" \
  -d "client_id=c8-client-deny&client_secret=c8-deny-secret&grant_type=client_credentials" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

RV_PROFILE=rbac \
RBAC_DENY_PROBE_BEARER_TOKEN=$DENY_TOKEN \
CORE_APPLICATION_URL=http://localhost:${HUB_UI_PORT:-8088}/api \
CONFIG=camunda-hub npm run test:pw:request-validation
```

> The Hub server must be running with `CAMUNDA_MODELER_FEATURE_PUBLIC_API_V2_ENABLED=true` — set this in `camunda-hub/restapi/config/config-common/src/main/resources/application-common-local.yml` before starting.

#### End-to-end drivers (generate → run → curl-compare)

`scripts/e2e/` wraps the whole flow into one command per config — generate both
suites, run them with Playwright, then re-issue each request-validation test with
an independent **curl oracle** that compares `expected` vs Playwright vs curl
status (printing the curl response body on a mismatch):

```bash
./scripts/e2e/run-hub.sh    # Hub: mints Keycloak Bearer tokens; base http://localhost:8088/api
./scripts/e2e/run-oca.sh    # OCA: HTTP Basic (demo/demo); base http://localhost:8080
```

Both are env-configurable (no edits needed):

- `STEPS="generate run curl"` — pick which steps to run (e.g. `STEPS=curl` to re-curl only).
- `RV_PROFILES="secured rbac"` (Hub) / `"unsecured"` (OCA) — which request-validation profiles.
- `SKIP_POSITIVE=1` — skip the positive lifecycle suite (runs by default).
- `E2E_SOFT=1` — don't exit non-zero when the oracle finds mismatches.

Output lands in `test-results/e2e-<config>/`: the Playwright report (`pw-<profile>.json`)
and the curl-compare report as both text (`curl-compare-<profile>.txt`) and a
self-contained, color-coded **HTML** view (`curl-compare-<profile>.html`, with a
"show only mismatches" toggle and expandable request/response detail). The positive
suite's base URL is baked in per config (`configs/<config>/codegen/playwright/config.json`),
so `API_BASE_URL` only needs setting to override it.

### Running the Test Generator

```bash
# Install all workspace dependencies (runs in all sub-packages)
npm install

# Fetch the upstream OpenAPI spec and bundle it
npm run fetch-spec

# Run the positive pipeline: extract graph → generate scenarios → emit Playwright tests
npm run pipeline

# Generate the negative request-validation suite (HTTP 400 tests, all supported scenario kinds)
npm run generate:request-validation

# Run the generated tests against a local OCA instance
# (omit CAMUNDA_BASIC_AUTH_* if your instance has no auth enabled)
CORE_APPLICATION_URL=http://localhost:8080 \
CAMUNDA_BASIC_AUTH_USER=demo \
CAMUNDA_BASIC_AUTH_PASSWORD=demo \
npm run test:pw:request-validation    # negative request-validation only

npm run test:pw                       # both suites (path-analyser + request-validation)
npm run test:pw:path-analyser         # positive scenarios only
```

## Project Structure

This is an **npm workspaces** monorepo with five packages:

```
api-test-generator/
├── package.json              ← root workspace orchestrator
├── spec/                     ← (gitignored) bundled OpenAPI spec output
│   └── <config>/bundled/
│       ├── rest-api.bundle.json
│       └── spec-metadata.json
├── semantic-graph-extractor/ ← workspace: graph extraction from OpenAPI
├── path-analyser/            ← workspace: positive scenario planner (writes JSON only)
├── materializer/             ← workspace: emits runnable Playwright suites from planned scenarios
├── request-validation/       ← workspace: negative request-validation test generator (HTTP 400)
└── optional-responses/       ← workspace: optional response field analyser
```

## npm Workspaces

All five sub-packages are registered as [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces).
A single `npm install` at the root installs dependencies for every package.

### Managing Dependencies

```bash
# Add a dependency to a specific workspace
npm install <pkg> -w semantic-graph-extractor

# Add a dev dependency to a specific workspace
npm install -D <pkg> -w path-analyser

# Add a dependency to the root
npm install -D <pkg> -w .

# Remove a dependency
npm uninstall <pkg> -w semantic-graph-extractor
```

### Running Scripts in Workspaces

```bash
# Run a script in a specific workspace
npm run build -w semantic-graph-extractor
npm run build -w path-analyser

# Run a script in all workspaces that define it
npm run build --workspaces --if-present
```

## Available Root Scripts

| Script | Description |
|--------|-------------|
| `npm run fetch-spec` | Fetch and bundle the upstream OpenAPI spec (from `main` branch) |
| `npm run fetch-spec:ref` | Fetch a specific branch/tag: `SPEC_REF=stable/8.8 npm run fetch-spec:ref` |
| `npm run bump-spec-pin` | Re-pin a config's spec: `npm run bump-spec-pin -- --config <name> [--ref <sha>] [--dry-run]` (see Spec pin → Bumping the spec pin) |
| `npm run extract-graph` | Build the semantic graph extractor and extract the dependency graph |
| `npm run generate:scenarios` | Build the path analyser and generate scenario JSON files |
| `npm run codegen:playwright` | Build and emit a Playwright test for a single endpoint |
| `npm run codegen:playwright:all` | Build and emit Playwright tests for all endpoints |
| `npm run build:request-validation` | Build the request-validation generator |
| `npm run generate:request-validation` | Emit negative request-validation tests with all supported scenario kinds (deep coverage by default) |
| `npm run generate:request-validation:shallow` | Emit only the core kinds (`missing-required`, `type-mismatch`, `union`) — fast iteration |
| `npm run test:pw` | Run both generated Playwright suites (path-analyser + request-validation) |
| `npm run test:pw:path-analyser` | Run only the positive path-analyser suite |
| `npm run test:pw:request-validation` | Run only the negative request-validation suite |
| `npm run testsuite:generate` | Full positive-generation pipeline: extract graph → scenarios → Playwright tests |
| `npm run testsuite:observe:run` | Generate tests, run them, and aggregate runtime observations |
| `npm run observe:aggregate` | Aggregate runtime observation data |
| `npm run optional-responses` | Run the optional response field analyser |
| `npm run pipeline` | End-to-end: fetch spec + generate entire test suite |
| `npm run lint` | Lint all workspaces with Biome |
| `npm run lint:fix` | Lint and apply safe Biome fixes |
| `npm run format` | Format all workspaces with Biome |
| `npm test` | Run the regression test suite (extractor + planner fixtures, bundled-spec invariants) |
| `npm run build:ontology` | Regenerate `ontology/vocabulary/*.schema.json` from their TypeScript source of truth. Run whenever you edit a schema const under `path-analyser/src/ontology/` (e.g. `edgeSchema.ts`). A drift-detector invariant fails if the committed JSON is stale. |

## Code Quality Tooling

This repo uses [Biome](https://biomejs.dev/) for both linting and formatting,
configured at the root in `biome.json`. The `recommended` ruleset is enabled
with three additional escalations to `error`:

- `suspicious/noExplicitAny`
- `suspicious/noImplicitAnyLet`
- `suspicious/noEvolvingTypes`

A custom GritQL plugin (`plugins/no-unsafe-type-assertion.grit`) bans `as T`
type assertions outside of imports and `as const`. Use type guards,
narrowing, or `satisfies` instead — and only suppress with
`// biome-ignore lint/plugin: <reason>` when genuinely unavoidable.

## Regression Testing

The pipeline emits hundreds of generated files (semantic graph, scenario JSON,
Playwright tests, validation tests). The regression strategy is **layered**
(see #36):

- **Layer 1 — extractor construct fixtures** ([tests/fixtures/extractor/](tests/fixtures/extractor)).
  Hand-curated minimal OpenAPI snippets paired with property assertions.
  Each `it` block is one regression statement; failures point at one
  construct, not at hundreds of hashed files.
- **Layer 2 — planner contract fixtures** ([tests/fixtures/planner/](tests/fixtures/planner)).
  Tiny dependency-graph fixtures paired with chain-shape assertions on
  `generateScenariosForEndpoint`.
- **Layer 3 — bundled-spec invariants** ([configs/camunda-oca/regression-invariants.test.ts](configs/camunda-oca/regression-invariants.test.ts)).
  Named, human-readable invariants over the real bundled spec output.
  Per-config (#128 PR 3): each named config under `configs/<name>/`
  owns its own `regression-invariants.test.ts`; vitest's `describe.skipIf`
  scopes each file to its config so a CI matrix leg only runs the
  invariants for the active CONFIG.

There is no Layer 4 end-to-end snapshot. The previous SHA-256 manifest
guard was retired in favour of the layered strategy: a 412-file diff is
not a useful signal, whereas a fixture or invariant failure names the
broken property directly.

**Standing rule:** every bug fix to the extractor or planner should land
with (a) a fixture demonstrating the bug BEFORE the fix, and (b) an
invariant if the property is observable at the chain or graph level. See
[CONTRIBUTING.md](CONTRIBUTING.md).

### Determinism

Generator output is byte-reproducible **by default**. The seeding module
(`materializer/src/playwright/support/seeding.ts`) uses `TEST_SEED` to seed all
`deterministicSuffix(...)` calls; if unset, it falls back to the constant
`'snapshot-baseline'`, so `npm run pipeline` produces identical output across
runs and machines without needing `TEST_SEED` to be set explicitly.

To opt out (for example, when generating a one-off suite for live-broker
exploration where unique-per-run identifiers are useful), set:

```bash
TEST_SEED=random npm run pipeline
```

Any other non-empty value is treated as a custom deterministic seed.

### Spec pin

The bundled-spec invariants test the real upstream spec output, so it is
only meaningful against a fixed upstream spec content.
[configs/camunda-oca/spec-pin.json](configs/camunda-oca/spec-pin.json) records
the `expectedSpecHash` plus the `specRef` CI fetches. A vitest
`globalSetup` ([tests/regression/spec-pin.setup.ts](tests/regression/spec-pin.setup.ts))
aborts the entire run with a single actionable error if the bundled spec
drifts from that hash, so reviewers don't have to debug a confusing
invariant failure when the real cause is upstream drift.

Each config has its own pin at `configs/<config>/spec-pin.json`.

#### Bumping the spec pin

Use the `bump-spec-pin` script — it resolves the target ref, fetches + bundles
the spec, and rewrites `configs/<config>/spec-pin.json` (`specRef` as a resolved
40-char commit SHA + the new `expectedSpecHash`, preserving the `$comment`). It
does **not** commit — you review the diff, verify, then commit.

```bash
# camunda-oca — public, fetched from camunda/camunda. Defaults to the main tip;
# pass --ref <sha|branch|tag> for a specific one (resolved to a SHA).
npm run bump-spec-pin -- --config camunda-oca
npm run bump-spec-pin -- --config camunda-oca --ref stable/8.10

# camunda-hub — private, bundled in "local mode" from the sibling clone
# ../camunda-hub (SPEC_REF is ignored). Bumps to that clone's checked-out HEAD;
# pass --ref <sha> to check that out first. Requires camunda-hub cloned as a
# sibling: <parent>/{api-test-generator, camunda-hub}.
npm run bump-spec-pin -- --config camunda-hub

# Preview any bump without writing:
npm run bump-spec-pin -- --config <name> --dry-run
```

Then verify the new spec flows through cleanly, update any invariants whose
values legitimately changed, and commit `spec-pin.json` + the invariant updates
together:

```bash
CONFIG=<name> npm run testsuite:generate \
  && CONFIG=<name> npm run generate:request-validation \
  && CONFIG=<name> npm test
```

> **specRef is always a resolved commit SHA** (branches drift). For camunda-oca
> that's a `camunda/camunda` SHA; for camunda-hub, a `camunda/camunda-hub` SHA.
> See [AGENTS.md → Spec pin](AGENTS.md) for the OCA (network-fetch) vs hub
> (local-bundle) modes in detail.

### Continuous integration

`.github/workflows/ci.yml` runs on every PR to `main` (and on pushes to
`main`). It executes:

1. `npm run lint` — Biome
2. `tsc --noEmit` against each workspace tsconfig
3. Builds for downstream consumers (`build:analyser`, `build -w @camunda8/emitter-sdk`) — needed so the materializer typecheck can resolve `.d.ts` for the subpath `exports`
4. `npm run fetch-spec:ref` at the pinned `specRef`
5. Full pipeline regeneration with `TEST_SEED=snapshot-baseline`
6. `npm test` — spec-pin guard, layered regression, and unit tests

On failure the generated outputs are uploaded as the
`pipeline-outputs` artifact for inspection.

## Fetching the OpenAPI Spec

The bundled spec is produced by [`camunda-schema-bundler`](https://github.com/camunda/camunda-schema-bundler),
installed as a dev dependency. It fetches the multi-file upstream spec from
[camunda/camunda](https://github.com/camunda/camunda) and produces a single
normalised JSON file.

```bash
# Fetch from main (default)
npm run fetch-spec

# Fetch a specific branch or tag
SPEC_REF=stable/8.9 npm run fetch-spec:ref

# Or use the CLI directly for more options
npx camunda-schema-bundler --help
```

The output lands in `spec/<config>/bundled/` (gitignored).

### Using a Custom Spec

All spec-reading code supports the `OPENAPI_SPEC_PATH` environment variable:

```bash
OPENAPI_SPEC_PATH=/path/to/my-spec.yaml npm run testsuite:generate
```

## Workspace Package Details

### semantic-graph-extractor

Analyses the OpenAPI spec and builds an operation dependency graph based on
`x-semantic-type` annotations. The graph captures which operations produce and
consume which semantic types, enabling dependency-aware test ordering.

```bash
npm run build -w semantic-graph-extractor
npm run extract-graph              # build + extract
npm run analyze-graph -w semantic-graph-extractor   # human-readable analysis report
```

### path-analyser

Reads the dependency graph and the OpenAPI spec to **plan positive
scenarios** for every endpoint — happy paths, oneOf variant selection,
dependency chaining, response-shape assertions, and artifact deployment
coverage. Writes scenario JSON to `generated/<config>/feature-output/`.
Emission of runnable suites is handled downstream by
[`materializer`](#materializer). Negative-request scenarios (missing
required fields, wrong types, etc.) are owned exclusively by
[`request-validation`](#request-validation).

```bash
npm run build -w path-analyser
npm run generate:scenarios         # build + plan scenarios into JSON
```

See [path-analyser/README.md](path-analyser/README.md) for the public
subpath-exports surface consumed by the materializer.

### materializer

Reads planned scenarios from `generated/<config>/feature-output/` and
emits a self-contained, runnable Playwright project under
`generated/<config>/playwright/` — `*.feature.spec.ts` files plus
`package.json`, `playwright.config.ts`, `tsconfig.json`, vendored
runtime helpers (`support/`), fixtures, and a README.

Template-derived suites (`#268` Phase 2 / `#270`) land under
`generated/<config>/playwright/templates/EdgeLifecycle/<EdgeName>.lifecycle.spec.ts` —
one per ABox-declared edge. Each suite runs the full lifecycle
(establish → present-observe → revoke → absent-observe) and is sourced
from `generated/<config>/scenarios/templates/EdgeLifecycle/<EdgeName>.json`,
which the planner instantiates from the EdgeLifecycle TBox template
(see `ontology/README.md`).

```bash
npm run codegen:playwright -- <operationId>
npm run codegen:playwright:all
npm run test:pw                    # run the generated tests
npm run observe:aggregate          # aggregate runtime observations
```

#### Pluggable test emitters

Suite generation is layered behind a small `Emitter` strategy
interface (`materializer/src/emitter.ts`). The CLI selects an emitter
via `--target=<id>` and falls back to `playwright` when omitted:

```bash
tsx materializer/src/index.ts --target=playwright createWidget
tsx materializer/src/index.ts --target=playwright --all
```

The codegen scripts (`npm run codegen:playwright`, `npm run codegen:playwright:all`) invoke the materializer via `tsx` so config-side role hooks (`configs/<config>/codegen/playwright/roles/<role>/hook.ts`, Lift 19 / #261) load transparently alongside the materializer source.

The current built-in is `playwright`. Additional targets (e.g. SDK-based
suites — see [#8](https://github.com/camunda/api-test-generator/issues/8))
register themselves through `registerEmitter()` and are listed in
`--help`. The emitter contract is **experimental** and is being formalised
in [#233](https://github.com/camunda/api-test-generator/issues/233).

See [materializer/README.md](materializer/README.md) for the workspace
boundary, role-bundle layout, and emitter contract details.

### request-validation

A spec-driven generator that synthesizes **negative** Playwright tests targeting
request-validation surfaces — every test sends a deliberately malformed request
and asserts the server responds with HTTP 400. Covers ~24 scenario kinds
including missing required fields (single + combinations), wrong primitive
types, root-body type mismatches, `oneOf` ambiguity / no-match / cross-bleed,
discriminator mismatches, enum / format / `multipleOf` / `uniqueItems` /
length / pattern violations, `allOf` conflicts, additional-property rejection
and multipart-only adaptation.

```bash
npm run build:request-validation             # compile the generator
npm run generate:request-validation          # all supported scenario kinds (deep coverage by default)
npm run generate:request-validation:shallow  # only missing-required, type-mismatch, union
```

Output lands in `generated/<config>/request-validation/`:

| File | Description |
|------|-------------|
| `<resource>-validation-api-tests.spec.ts` | Playwright specs grouped by resource |
| `MANIFEST.json` | Global counts per scenario kind + generation options |
| `COVERAGE.json` / `COVERAGE.md` | Per-operation coverage matrix and missing-kind list |

The generator consumes the bundled spec produced by `npm run fetch-spec`. To
point it at a different OpenAPI document, set `REQUEST_VALIDATION_SPEC` to the
absolute or repo-relative path.

### optional-responses

A lightweight utility that scans the OpenAPI spec for response schemas with
optional fields — useful for understanding which response fields may be absent.

```bash
npm run optional-responses
```

## Configuration Files (per active config)

These live under `configs/<active-config>/`:

| File | Purpose |
|------|---------|
| `domain-semantics.json` | Domain-level semantic requirements, runtime states, and value bindings |
| `filter-providers.json` | Maps fields to value providers (`ctx`, `const`, `enumFirst`, etc.) |
| `request-defaults.json` | Default values for request body fields per operation |
| `fixtures/` | BPMN, DMN, and form files used by deployment tests, plus `deployment-artifacts.json` registry |
| `codegen/playwright/roles/<role>/` | Per-role bundles consumed by the materializer (`call-site.tmpl`, optional `imports.tmpl`, `support.<ext>` or `support.<ext>.tmpl`, `match.json`) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAPI_SPEC_PATH` | Override the path to the OpenAPI spec file (consumed by `semantic-graph-extractor` / `path-analyser`) |
| `OPERATION_GRAPH_PATH` | Override the path to the dependency graph JSON |
| `SPEC_REF` | Git ref for `fetch-spec:ref` (branch, tag, or SHA) |
| `CAMUNDA_BASE_URL` | Base URL of the Camunda instance for Playwright tests |
| `REQUEST_VALIDATION_SPEC` | Override the spec path consumed by the `request-validation` generator |
