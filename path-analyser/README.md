# Path Analyser

Generates endpoint scenario chains that satisfy semantic-type requirements,
using the operation dependency graph emitted by
[`semantic-graph-extractor`](../semantic-graph-extractor) plus the bundled
OpenAPI spec and the active config's domain rules.

This workspace **plans only**. It writes scenario JSON to disk; emission
of runnable test suites is handled downstream by
[`materializer`](../materializer). The split is described in
[#235](https://github.com/camunda/api-test-generator/issues/235).

## Pipeline position

```
semantic-graph-extractor → path-analyser → materializer
                                ▲ (this workspace)
```

Inputs:
- `generated/<config>/operation-dependency-graph.json` (from extractor)
- `spec/<config>/bundled/rest-api.bundle.json` (from `camunda-schema-bundler`)
- `configs/<config>/{domain-semantics,filter-providers,request-defaults}.json`
- `configs/<config>/ontology/*.json` (ABoxes)
- `configs/<config>/fixtures/deployment-artifacts.json`

Outputs (all gitignored):
- `generated/<config>/feature-output/<method>--<path>-scenarios.json` —
  one scenario collection per endpoint
- `generated/<config>/scenarios/index.json` — summary index
- `generated/<config>/scenarios/deployment-artifacts.manifest.json` —
  machine-readable artifact list referenced by generated scenarios

## What it does

Per endpoint, the planner derives a bounded feature-coverage scenario
set, including:

- **Dependency chains** — BFS from semantic-type requirements through
  producers/establishers to the target operation.
- **`requestPlan` sequences** — ordered steps with status expectations,
  body/multipart templates, and `extract` bindings.
- **Duplicate-invocation scenarios** —
  - `duplicatePolicy=conflict` — second call expects 409.
  - `x-conditional-idempotency` with `duplicatePolicy=ignore` —
    second call expects the same success status.
- **OneOf variants** and **negative union** variants.
- **Deployment-artifact selection** for `createDeployment` (BPMN, Form,
  DMN Decision, DMN DRD) via the per-config artifact registry, with
  artifact-state matching against `producibleStates` /
  `providesStates`.
- **Default tenant-id injection** via a centralized seeding rule
  (`tenantIdVar -> <default>`).

Scenario JSON key fields:

- `endpoint` — operation metadata.
- `requestPlan` — ordered steps; each carries status, body/multipart,
  optional `extract` bindings, and `seedBindings` for pre-step seeding
  ([#136](https://github.com/camunda/api-test-generator/issues/136)).
- `duplicateTest` — `{ mode, policy, secondStatus, keyFields?, windowField? }`.
- `responseShapeFields` / `responseShapeSemantics` — drive final-step
  assertions.

Examples (after running the pipeline):
`generated/<config>/feature-output/post--messages--publication-scenarios.json`
(conditional idempotent duplicate) and `post--tenants-scenarios.json`
(conflict duplicate).

## Build & run

The planner is invoked through root scripts; it is rarely run in isolation.

```bash
# From the repo root:
npm run extract-graph          # build extractor + emit dependency graph
npm run generate:scenarios     # build planner + emit scenario JSON
npm run testsuite:generate     # extract-graph + scenarios + Playwright codegen
npm run pipeline               # fetch-spec + testsuite:generate + request-validation
```

Or, manually inside this workspace:

```bash
npm run build
node dist/src/index.js
```

Constraints / heuristics:
- Max 20 scenarios per endpoint (feature-coverage generator trims beyond this).
- Cycles in the dependency graph: one extra traversal iteration is allowed
  to satisfy semantic dependencies before pruning, avoiding infinite loops.

## Determinism

Scenarios are byte-reproducible. Any randomness during planning routes
through the same `deterministicSuffix` helper used by the emitted
runtime, seeded from `TEST_SEED` (default `'snapshot-baseline'`).

> `path-analyser/src/deterministicSuffix.ts` is intentionally
> duplicated with `materializer/src/support/seeding.ts`'s vendored
> copy. The materializer copy is shipped verbatim into every emitted
> suite and must stay self-contained; the algorithms must be kept
> aligned. Both files carry headers documenting the duplication.

## Public surface (for `materializer`)

The following subpaths are published via `exports` in `package.json`
so the [`materializer`](../materializer) workspace can typecheck against
them with `NodeNext` resolution:

| Subpath | Module |
|---|---|
| `path-analyser/configResolver` | active-config discovery |
| `path-analyser/graphLoader` | parsed-graph loader + indexes |
| `path-analyser/ontology/loader` | ABox loaders |
| `path-analyser/ontology/operationRoles` | operation-role classification |
| `path-analyser/types` | shared scenario / plan / graph types |

`declaration: true` is enabled in `tsconfig.json` so these subpaths
ship `.d.ts` files. **Nothing else is part of the public contract** —
internal modules may move or change freely.

## Configuration files (active config)

| File | Purpose |
|---|---|
| `configs/<config>/domain-semantics.json` | Domain-level semantic requirements, runtime states, value bindings |
| `configs/<config>/filter-providers.json` | Maps fields to value providers (`ctx`, `const`, `enumFirst`, etc.) |
| `configs/<config>/request-defaults.json` | Default values for request body fields per operation |
| `configs/<config>/fixtures/deployment-artifacts.json` | Per-config deployment artifact registry (BPMN/DMN/Form) |
| `configs/<config>/ontology/*.json` | ABoxes consumed by the planner |

## See also

- [materializer/README.md](../materializer/README.md) — downstream suite emitter
- [semantic-graph-extractor/README.md](../semantic-graph-extractor/README.md) — upstream graph extractor
- [README.md](../README.md) — repo-wide overview and architecture diagram
- [AGENTS.md](../AGENTS.md) — operational guide for contributors
