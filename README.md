# API Test Generator

Generates Playwright integration test suites from the Camunda REST API OpenAPI specification.
Analyses the spec's semantic type annotations (`x-semantic-type`) to build an operation
dependency graph, then emits scenario-driven test files with full request/response synthesis.

## Architecture

```
┌──────────────────────────┐
│  camunda-schema-bundler  │  Fetches & bundles the upstream multi-file OpenAPI spec
│  (devDependency)         │  → spec/bundled/rest-api.bundle.json
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ semantic-graph-extractor │  Parses bundled spec, extracts semantic types & operations
│                          │  → semantic-graph-extractor/dist/output/operation-dependency-graph.json
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│     path-analyser        │  Reads graph + spec, generates scenarios per endpoint,
│                          │  then emits Playwright test suites
│                          │  → path-analyser/dist/generated-tests/*.spec.ts
└──────────────────────────┘
```

## Prerequisites

- **Node.js ≥ 22**
- **npm ≥ 10** (ships with Node 22+)

## Quick Start

```bash
# Install all workspace dependencies (runs in all sub-packages)
npm install

# Fetch the upstream OpenAPI spec and bundle it
npm run fetch-spec

# Run the full pipeline: fetch spec → extract graph → generate scenarios → emit Playwright tests
npm run pipeline

# Run the generated tests
npm run test:pw
```

## Project Structure

This is an **npm workspaces** monorepo with three packages:

```
api-test-generator/
├── package.json              ← root workspace orchestrator
├── spec/                     ← (gitignored) bundled OpenAPI spec output
│   └── bundled/
│       ├── rest-api.bundle.json
│       └── spec-metadata.json
├── semantic-graph-extractor/ ← workspace: graph extraction from OpenAPI
├── path-analyser/            ← workspace: scenario generation & Playwright codegen
└── optional-responses/       ← workspace: optional response field analyser
```

## npm Workspaces

All three sub-packages are registered as [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces).
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
| `npm run test:pw` | Run the generated Playwright tests |
| `npm run testsuite:generate` | Full generation pipeline: extract graph → scenarios → Playwright tests |
| `npm run testsuite:observe:run` | Generate tests, run them, and aggregate runtime observations |
| `npm run observe:aggregate` | Aggregate runtime observation data |
| `npm run optional-responses` | Run the optional response field analyser |
| `npm run pipeline` | End-to-end: fetch spec + generate entire test suite |

## Fetching the OpenAPI Spec

The bundled spec is produced by [`camunda-schema-bundler`](https://github.com/camunda/camunda-schema-bundler),
installed as a dev dependency. It fetches the multi-file upstream spec from
[camunda/camunda](https://github.com/camunda/camunda) and produces a single
normalised JSON file.

```bash
# Fetch from main (default)
npm run fetch-spec

# Fetch a specific branch or tag
SPEC_REF=stable/8.8 npm run fetch-spec:ref

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
| `OPENAPI_SPEC_PATH` | Override the path to the OpenAPI spec file |
| `OPERATION_GRAPH_PATH` | Override the path to the dependency graph JSON |
| `SPEC_REF` | Git ref for `fetch-spec:ref` (branch, tag, or SHA) |
| `CAMUNDA_BASE_URL` | Base URL of the Camunda instance for Playwright tests |
