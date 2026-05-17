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
│   ├── index.ts                  ← CLI entry + registers built-in emitters
│   │                                and role-hook providers
│   ├── cli-args.ts               ← argv parser
│   ├── orchestrator.ts           ← per-operation emission driver + write
│   │                                path safety (scaffold + emit)
│   ├── roles.ts                  ← role-rendering type surface (operation
│   │                                role *classification* lives in
│   │                                path-analyser/ontology/operationRoles)
│   ├── deploymentExtracts.ts     ← computeDeploymentExtracts (consumed by
│   │                                the deployment role hook provider)
│   ├── playwright/
│   │   ├── emitter.ts            ← Playwright EmitterStrategy (emit + scaffold)
│   │   ├── roleRenderer.ts       ← Mustache role-template renderer
│   │   ├── materialize-support.ts← vendors support/ into the emitted suite
│   │   └── hooks/deployment.ts   ← DeploymentRoleHookProvider
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
# From the repo root — these invoke the materializer workflow and build its
# dependencies, but they do not emit fresh scenario JSON:
# first run the planner/generator so generated/<config>/feature-output/
# contains up-to-date scenarios.
npm run codegen:playwright -- <operationId>
npm run codegen:playwright:all

# Or, manually, inside this workspace (after generate:scenarios / the planner
# has emitted scenarios into generated/<config>/feature-output/):
npm run build
node dist/src/index.js --all
```

## Pluggable emitters

Suite generation is layered behind the `EmitterStrategy` strategy
contract published from
[`@camunda8/emitter-sdk`](../emitter-sdk/README.md). The CLI selects
an emitter via `--target=<id>` and falls back to `playwright` when
omitted:

```bash
node materializer/dist/src/index.js --target=playwright createWidget
node materializer/dist/src/index.js --target=playwright --all
```

The current built-in is `playwright`. Additional targets register
themselves through `registerEmitter()` at module load (see
[`src/index.ts`](src/index.ts)) and are listed in `--help`.

**Writing a new emitter** — see
[`emitter-sdk/README.md`](../emitter-sdk/README.md) for the
step-by-step authoring walk-through (purity / determinism / path-safety
contracts, role dispatch, scaffolding, registration, tests).

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

### Adding a new role

1. Pick a role name (camelCase by convention — e.g. `deploymentGateway`).
2. Bind operations to the role in the active config's artifact-kinds
   ABox at `configs/<config>/ontology/artifact-kinds.json`. The
   planner reads this and exposes the binding via
   `getRoleForOperation(opId)` to every emitter.
3. Create the bundle directory at
   `configs/<config>/codegen/<emitterId>/roles/<role>/` (one bundle
   per active emitter; the Playwright bundle is the canonical
   reference today).
4. Write `call-site.tmpl` — the Mustache template that renders for any
   step bound to this role. Available scope: per-step variables plus
   any `roleExtras` your role consumes (see below). The
   [`deploymentGateway` bundle](../configs/camunda-oca/codegen/playwright/roles/deploymentGateway/)
   is a complete worked example.
5. Optionally ship `support.<ext>` (vendored helper file),
   `imports.tmpl` (extra imports), and `match.json` (gating rules).
6. If your role needs spec-derived data (e.g. response-extracts
   computed from the OpenAPI graph), implement a `RoleHookProvider`
   per [`@camunda8/emitter-sdk`](../emitter-sdk/README.md), declare
   `roleHooks: ['<hook-name>']` on your emitter, and register the
   provider at materializer boot. The deployment hook at
   [`src/playwright/hooks/deployment.ts`](src/playwright/hooks/deployment.ts)
   is the reference implementation.
7. Add an L3 invariant in
   `configs/<config>/regression-invariants.test.ts` asserting that
   every operation bound to the role has the bundle present and that
   the bundle is imported by at least one emitted spec. See the
   "role-template rendering contract" describe block for the existing
   pattern.

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
- [emitter-sdk/README.md](../emitter-sdk/README.md) — stable emitter contract + authoring walk-through
- [src/ROLES.md](src/ROLES.md) — role-template rendering design + implementation reference
- [AGENTS.md](../AGENTS.md) — repo-wide operational guide
- [#235](https://github.com/camunda/api-test-generator/issues/235) — workspace split rationale
