# Materializer

Reads planned scenarios (produced by [`path-analyser`](../path-analyser)) and
emits self-contained, runnable test suites. The first and currently only
target is Playwright; additional emitters (e.g. SDK-based — see
[#8](https://github.com/camunda/api-test-generator/issues/8)) plug in
through a small `Emitter` strategy interface.

This workspace exists because suite emission grew into a sibling-sized
concern alongside the planner. Keeping them in one package made it hard
to reason about either in isolation. See
[#235](https://github.com/camunda/api-test-generator/issues/235) for the
split rationale.

## Boundary

```
semantic-graph-extractor → path-analyser → materializer
```

- **Input (on-disk artifacts only)** — scenario JSON under
  `generated/<config>/feature-output/`, scenario index under
  `generated/<config>/scenarios/`, ABox JSON under
  `configs/<config>/ontology/`. Plus the active config tree
  (`configs/<config>/{domain-semantics,filter-providers,request-defaults}.json`,
  `configs/<config>/codegen/...`, fixtures).
- **Input (typed subpath imports)** — a narrow surface from
  `path-analyser`: `configResolver`, `graphLoader`, `ontology/loader`,
  `ontology/operationRoles`, `types`. These are published as subpath
  `exports` from `path-analyser/package.json`; materializer imports
  them as `from 'path-analyser/configResolver'` etc. **No planner
  functions are called from here.**
- **Output** — a Playwright project under
  `generated/<config>/playwright/` containing `*.feature.spec.ts`
  files, vendored runtime helpers, fixtures, and the scaffolding to
  run the suite in place (`package.json`, `playwright.config.ts`,
  `tsconfig.json`, `README.md`, `.env.example`).

## Layout

```
materializer/
├── src/
│   ├── index.ts                  ← CLI entry (codegen:playwright[:all])
│   ├── cli-args.ts               ← argv parser
│   ├── orchestrator.ts           ← per-operation emission driver
│   ├── emitter.ts                ← Emitter strategy interface + registry
│   ├── registry.ts               ← built-in emitter registration
│   ├── roles.ts                  ← role-rendering type surface (operation
│   │                                role *classification* lives in
│   │                                path-analyser/ontology/operationRoles)
│   ├── deploymentExtracts.ts     ← deployment-role extras (transitional;
│   │                                will move behind the bundle interface
│   │                                in #233)
│   ├── playwright/
│   │   ├── emitter.ts            ← Playwright spec emitter
│   │   ├── roleRenderer.ts       ← Mustache role-template renderer
│   │   └── materialize-support.ts← vendors support/ + scaffolds project
│   └── support/                  ← runtime helpers vendored into every
│                                    emitted suite (env, seeding, fixtures,
│                                    await-eventually, recorder, seed-rules)
├── templates/                    ← scaffolding for the emitted suite
│                                    (package.json, playwright.config.ts,
│                                     tsconfig.json, README.md, .env.example)
├── scripts/copy-support-templates.js
├── package.json
└── tsconfig.json
```

## Build & run

The materializer is invoked through root scripts; it is rarely run
in isolation.

```bash
# From the repo root — these run path-analyser then materializer:
npm run codegen:playwright -- <operationId>
npm run codegen:playwright:all

# Or, manually, inside this workspace (after path-analyser has emitted
# scenarios into generated/<config>/feature-output/):
npm run build
node dist/src/index.js --all
```

## Pluggable emitters

Suite generation is layered behind the `Emitter` strategy interface in
[`src/emitter.ts`](src/emitter.ts). The CLI selects an emitter via
`--target=<id>` and falls back to `playwright` when omitted:

```bash
node materializer/dist/src/index.js --target=playwright createWidget
node materializer/dist/src/index.js --target=playwright --all
```

The current built-in is `playwright`. Additional targets register
themselves through `registerEmitter()` and are listed in `--help`. The
emitter contract is **experimental** and is being formalised in
[#233](https://github.com/camunda/api-test-generator/issues/233).

## Role bundles

Per-config role bundles live under
`configs/<config>/codegen/playwright/roles/<role>/`:

| File | Required | Purpose |
|------|----------|---------|
| `call-site.tmpl` | yes | Mustache template rendered into the spec |
| `imports.tmpl` | no | Additional imports prepended to the spec |
| `support.<ext>` | no | Helper file vendored into the emitted suite as `support/<role>.<ext>` and imported by the call-site template |
| `match.json` | no | Match rules selecting which operations resolve to this role |

See [`src/ROLES.md`](src/ROLES.md) for the resolution algorithm and
[`materializer/src/playwright/roleRenderer.ts`](src/playwright/roleRenderer.ts)
for the rendering pipeline. A role + a `support.<ext>` file is the
override hook for replacing the generic per-step emission with a
config-specific helper (e.g. the OCA deployment helper).

## Determinism

Suites are byte-reproducible. The runtime helper
`src/support/seeding.ts` seeds all `deterministicSuffix(...)` calls
with `TEST_SEED`, defaulting to the constant `'snapshot-baseline'`
when unset. This file is shipped **verbatim** into every emitted suite
and must stay self-contained — including its own copy of
`deterministicSuffix`, intentionally duplicated with
`path-analyser/src/deterministicSuffix.ts`. Both files document the
duplication.

## Tests

Tests live under [`tests/codegen/`](../tests/codegen/) (relative paths
import from `../../materializer/src/...`). Run them from the repo root
with `npm test`.

## See also

- [path-analyser/README.md](../path-analyser/README.md) — upstream planner
- [AGENTS.md](../AGENTS.md) — repo-wide operational guide
- [#233](https://github.com/camunda/api-test-generator/issues/233) — stable `EmitterStrategy` contract (in progress)
- [#235](https://github.com/camunda/api-test-generator/issues/235) — workspace split rationale
