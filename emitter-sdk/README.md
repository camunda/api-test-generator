# @camunda8/emitter-sdk

Stable contract package for materialization emitters in
[api-test-generator](https://github.com/camunda/api-test-generator).
Implement [`EmitterStrategy`](src/types.ts) and register the
implementation through this SDK to plug a new output target into the
materialization pipeline — a Playwright spec suite, a TypeScript / Python
/ C# SDK suite, a curl script, anything that consumes the planner's
scenario JSON.

This README is the authoritative walk-through for writing a new emitter.
For the runtime that **invokes** emitters (CLI, orchestrator, role
dispatch), see [`materializer/README.md`](../materializer/README.md).
For the role-template subsystem, see
[`materializer/src/ROLES.md`](../materializer/src/ROLES.md).

> **Stability.** The exported types in this package are the stable
> contract surface. Any breaking change to them requires a package
> version bump (see [`package.json`](package.json) `version`). Adding
> new **optional** fields to `EmitContext` / `EmitterStrategy` is
> non-breaking; making existing optional fields required, or removing
> any field, is breaking.

## Where the emitter sits

```
semantic-graph-extractor  →  path-analyser  →  materializer (orchestrator)
                                                      │
                                                      ├─ load EmitContext from configs/<config>/
                                                      ├─ run RoleHookProviders → roleExtras
                                                      ├─ call EmitterStrategy.scaffold()  (once)
                                                      └─ call EmitterStrategy.emit()      (per endpoint)
```

The emitter is invoked **per endpoint** with one
`EndpointScenarioCollection` (the planner's per-endpoint output) plus an
`EmitContext`. It returns an array of `EmittedFile { relativePath,
content }`. The orchestrator handles the filesystem write, escape
checks, and mkdir.

Emitters are **pure**: no filesystem, no network, no global state. All
inputs come through `EmitContext` and the scenario collection; all
outputs come back as `EmittedFile[]`.

## Quick start

```ts
// my-emitter/src/index.ts
import {
  type EmitterStrategy,
  type EmitContext,
  type EmittedFile,
  type EndpointScenarioCollection,
  registerEmitter,
} from '@camunda8/emitter-sdk';

export const MyEmitter: EmitterStrategy = {
  id: 'my-sdk',
  name: 'My SDK suite',
  supportedConfigs: ['camunda-oca'],

  async emit(
    collection: EndpointScenarioCollection,
    ctx: EmitContext,
  ): Promise<EmittedFile[]> {
    const lines: string[] = [];
    lines.push(`// Suite for ${collection.endpoint.operationId}`);
    for (const scenario of collection.scenarios) {
      lines.push(`// ${scenario.name}`);
      // ... lower scenario.requestPlan onto your SDK's surface ...
    }
    return [
      {
        relativePath: `${collection.endpoint.operationId}.spec.ts`,
        content: lines.join('\n'),
      },
    ];
  },
};

registerEmitter(MyEmitter);
```

Wire your emitter package so its `import` (or `require`) side-effects
run during materializer startup, and the registry will pick it up.
The CLI selects via `--target=my-sdk`.

## The contract

### `EmitterStrategy`

| Field | Required | Purpose |
|---|---|---|
| `id` | yes | Stable identifier used by `--target=<id>`. Unique per registry. |
| `name` | yes | Human-readable name for logs / `--help`. |
| `supportedConfigs` | yes | Which named configs this emitter targets. Use `['*']` for config-agnostic emitters; use specific names (`['camunda-oca']`) for config-specific output shapes. |
| `configSchema` | no | JSON Schema for `configs/<configName>/codegen/<id>/config.json`. When present, the orchestrator validates the file against this schema before invoking `emit`. When absent, `emitterConfig` arrives as `{}`. |
| `roleHooks` | no | Per-role hook names this emitter consumes (e.g. `['deployment']`). The orchestrator matches against registered `RoleHookProvider`s and populates `ctx.roleExtras`. |
| `scaffold` | no | One-shot per-suite scaffolding. Returns the framing files for the emitted project (`package.json`, `tsconfig.json`, `README.md`, etc.). Called once per CLI invocation, before any `emit` call. Omit if your emitter writes loose specs into an existing project. |
| `emit` | yes | Lowers one scenario collection into output files. Pure. |

### `EmitContext`

| Field | Notes |
|---|---|
| `outDir` | Absolute path where output files land. Returned paths are relative to this. |
| `suiteName` | Use for `describe()` / class names / file headers. |
| `mode` | `'feature'` for path-analyser feature scenarios (default), `'integration'`, or `'variant'` for sub-shape variant suites (#37 / #105). |
| `configName` | Active config (`'camunda-oca'` today). Sourced from `CONFIG` env var; defaults to `configs.json` `default`. |
| `emitterConfig` | Validated per-emitter knobs from `configs/<configName>/codegen/<id>/config.json` (or `{}`). |
| `resolveConfigPath` | Helper to resolve paths relative to `configs/<configName>/`. Prefer this over building config paths from scratch. |
| `globalContextSeeds` | Bindings every scenario must seed before its request plan runs (e.g. default tenant under single-tenant mode). Sourced from the ABox. |
| `getRoleForOperation` | Returns the ontological role bound to `opId` per the active config's artifact-kinds ABox, or `undefined`. Use for role dispatch (see below). |
| `roleBundles` | `Map<roleName, LoadedRoleBundle>` — eagerly loaded role templates. |
| `roleExtras` | `Map<roleName, Record<string, unknown>>` — extras computed by registered hook providers. Spread into the role-template scope when rendering. |

### `EmittedFile`

```ts
interface EmittedFile {
  relativePath: string; // forward slashes; must resolve inside ctx.outDir
  content: string;      // UTF-8
}
```

Absolute paths or paths that escape `ctx.outDir` are rejected by the
orchestrator with a hard error.

## Step-by-step authoring walk-through

This section builds a runnable emitter end-to-end. The Playwright
emitter at
[`materializer/src/playwright/emitter.ts`](../materializer/src/playwright/emitter.ts)
is the canonical reference; treat the steps below as a tour that
points at the corresponding code.

### Step 1 — Create the package

A new emitter is its own npm workspace under
`<repoRoot>/<emitter-name>-emitter/` (or wherever; the location is not
prescribed). Minimum scaffolding:

```jsonc
// package.json
{
  "name": "@camunda8/my-sdk-emitter",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "main": "./dist/src/index.js",
  "types": "./dist/src/index.d.ts",
  "dependencies": {
    "@camunda8/emitter-sdk": "*"
  },
  "scripts": { "build": "tsc -p tsconfig.json" }
}
```

```jsonc
// tsconfig.json — use module=nodenext and emit .js extensions in source
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

> **Internal imports use `.js` specifiers** under `module=nodenext`, even
> in `.ts` source. The repo convention is `import { x } from './y.js'`.

### Step 2 — Implement `EmitterStrategy.emit`

`emit()` receives an `EndpointScenarioCollection` plus `EmitContext`. The
collection contains everything needed to lower the scenarios onto your
target. The key fields:

```ts
collection.endpoint.operationId  // upstream OpenAPI operationId
collection.scenarios[]           // EndpointScenario[]

scenario.id                      // unique per scenario
scenario.name                    // human-readable
scenario.description             // for test docstring/comment
scenario.bindings                // Record<string, string|undefined>
scenario.seedBindings            // string[] — vars to seed before requestPlan
scenario.requestPlan[]           // RequestStep[] — the actual HTTP/SDK calls
scenario.coverageTags            // string[]
scenario.expectedResult          // { kind: 'success' | 'empty' | 'error', ... }
scenario.strategy                // 'happy' | 'variant' | ...
```

Each `RequestStep` describes one operation in the chain:

```ts
step.operationId        // OpenAPI operationId for this step
step.method             // 'GET' | 'POST' | ...
step.pathTemplate       // '/process-instances/{processInstanceKey}'
step.bodyKind           // 'json' | 'multipart' | undefined
step.bodyTemplate       // unknown — JSON object with ${varName} placeholders
step.multipartTemplate  // multipart-form structure when bodyKind='multipart'
step.queryParams        // Record<string, string>
step.expect.status      // expected HTTP status (200 / 201 / 204 / ...)
step.extract            // [{ fieldPath, bind, semantic? }] — response → ctx
step.awaitEventually    // boolean — wrap in eventual-consistency poll
```

`${varName}` placeholders in `pathTemplate`, `bodyTemplate`,
`multipartTemplate`, and `queryParams` resolve against the runtime
`ctx` map (populated by `scenario.seedBindings`, prior steps'
`extract` clauses, and any role hooks). Your emitter is responsible
for rendering the substitution syntax appropriate to its target
language — see `materializer/src/playwright/emitter.ts` for the
template-literal rendering used in the Playwright suite.

### Step 3 — Handle `seedBindings`

Before `requestPlan` runs, every binding name in `scenario.seedBindings`
must be present on `ctx`. The Playwright emitter emits a prologue that
calls the runtime `seedBinding(ctx, name)` helper for each entry, which
either reads an env var or generates a deterministic suffix via the
shared `seeding.ts` runtime. Your emitter's equivalent prologue should
do the same — the seed inputs are config-agnostic, so the runtime
helpers in [`materializer/src/playwright/support/`](../materializer/src/playwright/support/)
are good references for the algorithm even if you re-implement them
in another language.

### Step 4 — Implement role dispatch (if your target consumes roles)

If the active config carries operation roles (see
[`materializer/src/ROLES.md`](../materializer/src/ROLES.md)) **and**
you've shipped a role-bundle directory for your emitter under
`configs/<config>/codegen/<emitterId>/roles/<role>/`, the orchestrator
will pre-load those bundles into `ctx.roleBundles`. Per step:

1. `const role = ctx.getRoleForOperation?.(step.operationId);`
2. If `role` is defined and `ctx.roleBundles?.get(role)` is present **and** the bundle's `match` rules accept this step's shape, render the bundle's `call-site.tmpl` with a Mustache-compatible scope and return the rendered output verbatim.
3. If `role` is defined but no bundle exists for it under this emitter, **raise a hard error** — bound role with no template is always a contract violation, never a silent fallback.
4. Otherwise, render the generic per-method path.

Role bundles let config-specific behaviour (e.g. the OCA `deploy()`
helper) live in the config tree instead of in emitter source. The
Playwright emitter's role-dispatch loop is at
`materializer/src/playwright/emitter.ts`, search for
`findRoleForStep`.

### Step 5 — Consume `roleExtras` (if you declared `roleHooks`)

If your emitter declares `roleHooks: ['deployment']` (etc.), the
orchestrator will invoke registered `RoleHookProvider`s before any
`emit` call and populate `ctx.roleExtras.get('<role>')` with the
provider's output. Two places can consume the extras:

1. **Call-site template scope.** Spread the extras into your
   `call-site.tmpl` Mustache scope so per-step rendering can read them:

   ```ts
   const extras = ctx.roleExtras?.get(role) ?? {};
   const rendered = mustache.render(bundle.callSiteTemplate, {
     ...stepScope,
     ...extras,
   });
   ```

2. **Templated support file (`support.<ext>.tmpl`).** If the extras are
   constant across the whole CLI run (e.g. derived from the OpenAPI
   graph, not from the individual step), prefer baking them into the
   support file once instead of threading them through every call site.
   The materializer renders the role's `support.<ext>.tmpl` against the
   same extras map and writes the result to `support/<role>.<ext>`.

   This is what the deployment role does: `extracts` is a spec-derived
   constant, so `support.ts.tmpl` interpolates it as
   `const EXTRACTS = {{{extracts}}};` and the call-site template never
   sees it. See
   [`materializer/src/playwright/hooks/deployment.ts`](../materializer/src/playwright/hooks/deployment.ts)
   for the provider and #243 for the rationale.

### Step 6 — Implement `scaffold` (optional)

If your emitter targets a self-contained project (Playwright spec,
pytest module, dotnet test project), implement `scaffold(ctx)` to
return the framing files. The orchestrator invokes `scaffold` once
per CLI run **before** any `emit` call:

```ts
async scaffold(ctx: EmitContext): Promise<EmittedFile[]> {
  return [
    { relativePath: 'package.json', content: renderPackageJson(ctx) },
    { relativePath: 'tsconfig.json', content: renderTsconfig(ctx) },
    { relativePath: 'README.md', content: renderReadme(ctx) },
    { relativePath: '.env.example', content: renderEnvExample(ctx) },
  ];
}
```

The Playwright emitter's `scaffold` implementation lives alongside its
`emit` in
[`materializer/src/playwright/emitter.ts`](../materializer/src/playwright/emitter.ts).

Omit `scaffold` entirely when the emitted output is loose source files
intended to land in an existing project (e.g. a curl-script emitter).

### Step 7 — Register the emitter

Side-effecting import inside the package's entry file:

```ts
// my-sdk-emitter/src/index.ts
import { registerEmitter } from '@camunda8/emitter-sdk';
import { MySdkEmitter } from './emitter.js';

registerEmitter(MySdkEmitter);

export { MySdkEmitter };
```

Then ensure the materializer loads your package. Today this is done by
adding an import to
[`materializer/src/index.ts`](../materializer/src/index.ts) (alongside
`registerEmitter(PlaywrightEmitter)`). A future iteration may switch
to discovery via `configs.json` — track
[#233](https://github.com/camunda/api-test-generator/issues/233)
follow-ups for discovery-related changes.

### Step 8 — Per-emitter config (optional)

If your emitter has knobs, declare a `configSchema` on the strategy and
ship `configs/<config>/codegen/<emitterId>/config.json` per active
config. The orchestrator validates the file against the schema at
boot and surfaces it on `ctx.emitterConfig`.

### Step 9 — Tests and L3 invariants

Two layers of regression:

- **Emitter unit tests** under
  [`tests/codegen/<your-emitter>/`](../tests/codegen/) — golden-file
  comparisons for a representative set of scenarios. Use the layered
  fixture strategy from [AGENTS.md](../AGENTS.md) — one fixture =
  one named property.
- **L3 invariants** under
  [`configs/<config>/regression-invariants.test.ts`](../configs/camunda-oca/regression-invariants.test.ts) —
  named human-readable invariants over your emitted suite. Mirror the
  Playwright invariants (URL placeholders resolve, every `ctx.xVar`
  read has a producer, role bundles are imported, etc.) where they
  translate to your target.

For SDK emitters specifically, the cross-check pattern from
[#8](https://github.com/camunda/api-test-generator/issues/8) — comparing
your `operationId → method` table against the SDK's published
`examples/operation-map.json` — is the high-signal class-scoped
invariant.

## Constraints and contracts

### Purity

Emitters **must not** touch the filesystem, the network, or any global
state inside `emit` / `scaffold`. Everything they read must come
through `EmitContext` or the scenario collection; everything they
produce comes back as `EmittedFile[]`. The orchestrator owns the write.

### Determinism

Output must be byte-reproducible. `TEST_SEED` (defaulting to
`'snapshot-baseline'`) is the only entropy source for any randomised
content (suffixes, IDs). The runtime helper
[`materializer/src/playwright/support/seeding.ts`](../materializer/src/playwright/support/seeding.ts)
documents the algorithm.

### Path safety

`EmittedFile.relativePath` must be a forward-slash relative path that
resolves inside `ctx.outDir`. Absolute paths and `..` escapes throw at
the orchestrator boundary; do not try to write outside `outDir`.

### Versioning

Adding a new optional field to `EmitContext` or `EmitterStrategy` is
non-breaking. Making an existing field required, removing a field, or
changing a field's shape is breaking and requires bumping the package
`version`. Third-party emitters that pin a specific minor version
should compile-fail on any breaking shape change.

## See also

- [`materializer/README.md`](../materializer/README.md) — the runtime
  that invokes emitters (CLI, orchestrator, role dispatch).
- [`materializer/src/ROLES.md`](../materializer/src/ROLES.md) — role
  template subsystem.
- [`path-analyser/README.md`](../path-analyser/README.md) — the
  upstream that produces `EndpointScenarioCollection`.
- [AGENTS.md](../AGENTS.md) — repo-wide operational guide.
- Issues:
  [#233](https://github.com/camunda/api-test-generator/issues/233)
  (stable contract — merged),
  [#231](https://github.com/camunda/api-test-generator/issues/231)
  (role templating),
  [#8](https://github.com/camunda/api-test-generator/issues/8) (SDK
  emitter sub-issues).
