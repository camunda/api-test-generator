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
│  (devDependency)         │  → spec/bundled/rest-api.bundle.json
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
│   graph.json             │               │ → request-validation/    │
└────────────┬─────────────┘               │   generated/*.spec.ts    │
             │                             └──────────────────────────┘
             ▼
┌──────────────────────────┐
│     path-analyser        │  Reads graph + spec, generates positive scenarios
│                          │  per endpoint, emits Playwright test suites
│                          │  → path-analyser/dist/generated-tests/*.spec.ts
└──────────────────────────┘
```

## Prerequisites

- **Node.js ≥ 22**
- **npm ≥ 10** (ships with Node 22+)
- **Docker & Docker Compose** (for running Camunda server)

## Quick Start

### Starting the Camunda Server

```bash
# Start the Camunda server using Docker Compose
cd docker
docker compose up -d

# Verify the server is running (health check)
docker compose logs camunda
```

The Camunda REST API will be available at `http://localhost:8080` by default.
You can override the port with the `CAMUNDA_REST_PORT` environment variable:

```bash
CAMUNDA_REST_PORT=9080 docker compose up -d
```

To stop the server:

```bash
docker compose down
```

### Running the Test Generator

```bash
# Install all workspace dependencies (runs in all sub-packages)
npm install

# Fetch the upstream OpenAPI spec and bundle it
npm run fetch-spec

# Run the full pipeline: fetch spec → extract graph → generate scenarios → emit Playwright tests
npm run pipeline

# Run the generated tests (requires running Camunda server)
npm run test:pw
```

## Project Structure

This is an **npm workspaces** monorepo with four packages:

```
api-test-generator/
├── package.json              ← root workspace orchestrator
├── spec/                     ← (gitignored) bundled OpenAPI spec output
│   └── bundled/
│       ├── rest-api.bundle.json
│       └── spec-metadata.json
├── semantic-graph-extractor/ ← workspace: graph extraction from OpenAPI
├── path-analyser/            ← workspace: positive scenario generation & Playwright codegen
├── request-validation/       ← workspace: negative request-validation test generator (HTTP 400)
└── optional-responses/       ← workspace: optional response field analyser
```

## npm Workspaces

All four sub-packages are registered as [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces).
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
| `npm run extract-graph` | Build the semantic graph extractor and extract the dependency graph |
| `npm run generate:scenarios` | Build the path analyser and generate scenario JSON files |
| `npm run codegen:playwright` | Build and emit a Playwright test for a single endpoint |
| `npm run codegen:playwright:all` | Build and emit Playwright tests for all endpoints |
| `npm run build:request-validation` | Build the request-validation generator |
| `npm run generate:request-validation` | Emit negative request-validation tests (default scenario kinds) |
| `npm run generate:request-validation:full` | Emit negative request-validation tests with **all** ~24 scenario kinds (`--deep`) |
| `npm run test:pw` | Run the generated Playwright tests |
| `npm run testsuite:generate` | Full positive-generation pipeline: extract graph → scenarios → Playwright tests |
| `npm run testsuite:observe:run` | Generate tests, run them, and aggregate runtime observations |
| `npm run observe:aggregate` | Aggregate runtime observation data |
| `npm run optional-responses` | Run the optional response field analyser |
| `npm run pipeline` | End-to-end: fetch spec + generate entire test suite |
| `npm run lint` | Lint all workspaces with Biome |
| `npm run lint:fix` | Lint and apply safe Biome fixes |
| `npm run format` | Format all workspaces with Biome |
| `npm test` | Run the regression test suite (snapshot guard) |
| `npm run snapshot:update` | Recapture the pipeline output snapshot after intentional generator changes |

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

The pipeline emits 396 generated files (semantic graph, scenario JSON,
Playwright tests, validation tests). To guard against accidental drift
during refactoring, `npm test` runs a SHA-256 snapshot comparison against
a captured baseline (`tests/regression/pipeline-snapshot.json`).

**Workflow:**

```bash
# 1. Regenerate the pipeline outputs
npm run testsuite:generate
npm run generate:request-validation

# 2. Run the regression test
npm test

# 3. If you intentionally changed generator behaviour and the test fails,
#    recapture the baseline and commit it alongside your production change:
npm run snapshot:update
```

This is a class-scoped guard — any drift in any analyser, planner or emitter
will fail the test, not just one specific defect path.

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

The output lands in `spec/bundled/` (gitignored).

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
npm run validate-graph -w semantic-graph-extractor  # validate graph integrity
```

### path-analyser

Reads the dependency graph and the OpenAPI spec to generate test scenarios for
every endpoint. Scenarios cover happy paths, missing required fields, wrong types,
oneOf variant selection, and more. Then emits executable Playwright test files.

```bash
npm run build -w path-analyser
npm run generate:scenarios         # build + generate scenario JSON
npm run codegen:playwright:all     # build + emit all Playwright tests
npm run test:pw                    # run the generated tests
npm run observe:aggregate          # aggregate runtime observations
```

#### Pluggable test emitters

Suite generation is layered behind a small `Emitter` strategy interface
(`path-analyser/src/codegen/emitter.ts`). The CLI selects an emitter via
`--target=<id>` and falls back to `playwright` when omitted:

```bash
node path-analyser/dist/src/codegen/index.js --target=playwright createWidget
node path-analyser/dist/src/codegen/index.js --target=playwright --all
```

The current built-in is `playwright`. Additional targets (e.g. SDK-based
suites — see [#8](https://github.com/camunda/api-test-generator/issues/8))
register themselves through `registerEmitter()` and are listed in
`--help`. The emitter contract is **experimental** and may change while
the SDK strategies land.

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
npm run build:request-validation         # compile the generator
npm run generate:request-validation      # default scenario kinds (missing-required, type-mismatch, union)
npm run generate:request-validation:full # --deep mode: all ~24 scenario kinds
```

Output lands in `request-validation/generated/`:

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

## Configuration Files (path-analyser)

| File | Purpose |
|------|---------|
| `domain-semantics.json` | Domain-level semantic requirements, runtime states, and value bindings |
| `filter-providers.json` | Maps fields to value providers (`ctx`, `const`, `enumFirst`, etc.) |
| `request-defaults.json` | Default values for request body fields per operation |
| `fixtures/` | BPMN, DMN, and form files used by deployment tests |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAPI_SPEC_PATH` | Override the path to the OpenAPI spec file (consumed by `semantic-graph-extractor` / `path-analyser`) |
| `OPERATION_GRAPH_PATH` | Override the path to the dependency graph JSON |
| `SPEC_REF` | Git ref for `fetch-spec:ref` (branch, tag, or SHA) |
| `CAMUNDA_BASE_URL` | Base URL of the Camunda instance for Playwright tests |
| `REQUEST_VALIDATION_SPEC` | Override the spec path consumed by the `request-validation` generator |
