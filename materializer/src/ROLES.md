# Operation-role rendering (Lift 12 / #231)

Status: **Phases 1–5 landed**. Phase 6 documentation (this file +
[`materializer/README.md`](../README.md)) is the current pass.

| Phase | Status | Where it landed |
|---|---|---|
| 1 — Design + types | ✅ | PR #232 |
| 2 — Materializer overlay (`materializeRoleSupportFiles`) | ✅ | PR #234 |
| 3 — Renderer (`roleRenderer.ts`) + `isDeploymentStep` removed | ✅ | PR #234 |
| 4 — `deploymentGateway` reference role | ✅ | PR #234; spec-derived extracts moved behind `DeploymentRoleHookProvider` in #237 (#233 Step 6) |
| 5 — L3 invariants | ✅ | This PR — three invariants in `configs/camunda-oca/regression-invariants.test.ts` under "role-template rendering contract (Lift 12 / #231 Phase 5)" |
| 6 — Documentation | 🟡 | This refresh + `materializer/README.md` already cover the runtime contract; the explicit "Adding a role" + "Adding an emitter" how-to guides land alongside the first contributor request that needs them (YAGNI) |

The renderer dispatches per step via `roleRenderer.findRoleForStep`, the
overlay materializes per-role helpers via
`materializeRoleSupportFiles`, and per-role compute hooks land their
output in `ctx.roleExtras[<role>]` via the
[`RoleHookProvider`](../../emitter-sdk/src/types.ts) registry — see
[`materializer/src/playwright/hooks/deployment.ts`](playwright/hooks/deployment.ts)
for the deployment-gateway reference provider.

## Principle

**ABox describes the API. The codegen tree describes the generator.** A
binding between the two is **directory existence** — never an ABox
field naming a helper or template.

- `configs/<config>/ontology/artifact-kinds.json` — ABox. Under
  `operationRules[].role`, says *"operation X plays role R."* `R` is
  an API-semantic name (`deploymentGateway`; hypothetical `longPoll`,
  `webhookPublish`, …). Free of any generator concept. **The
  directory name in the codegen tree (see below) must match this
  identifier verbatim** — the existing `deploymentGateway` role at
  `configs/camunda-oca/ontology/artifact-kinds.json:52–56` is the
  canonical example. No normalisation between ABox identifiers and
  directory names is performed; an exact-string match keeps the
  binding unambiguous.
- `configs/<config>/codegen/<emitter>/roles/<role>/` — codegen tree.
  Owns the per-emitter implementation for that role. Directory
  existence is the binding; no JSON registry references it.

Adding a role: ABox entry + a directory per emitter that supports the
role. Adding an emitter: the emitter walks `configs/<config>/codegen/
<this-emitter>/roles/` at materialise time. Neither requires touching
`materializer/src/` source.

## Dispatch

The renderer is one uniform lookup, not "default with overrides":

```
for each step:
  role = roleFor(step.operationId)     // ABox lookup; may be undefined
  if role is undefined:
    render via generic per-method path
  else if template(activeEmitter, role) exists:
    render via that role
  else:
    raise: role R is bound in the ABox for op O, but the active
           emitter+config has no roles/R/ directory
```

The generic per-method path is the dispatch entry for the
**no-role-binding** key. It is not a fallback that roles "patch"; it is
just the most-common entry in the dispatch table. Roles are
first-class. Removing a role binding from a config falls through to the
same generic entry that already serves every un-roled operation.

**A bound role with no template is always an error.** This makes typos
and missing-directory mistakes fail loudly at codegen time instead of
silently producing a generic render that nobody asked for. There is
no soft-fallback mode; if a future use case ever needs one, it must
be opt-in and explicitly named ("emitter-skips-role").

**Role resolution uses the existing ABox accessor by `operationId`.**
The scenario `RequestStep` shape is not extended with a `roleBinding`
field; roles are derived per step from
`path-analyser/src/ontology/operationRoles.ts` (e.g.
`roleFor(opId)` / `isDeploymentGatewayOp(opId)`-style accessors) so
there is exactly one source of truth for which op plays which role.
The renderer caches the lookup per step.

## Per-role directory contract

```
configs/<config>/codegen/<emitter>/roles/<role>/
  support.<ext>          # vendored verbatim into the emitted suite's support/ tree
  support.<ext>.tmpl     # OR: Mustache template rendered against the role's roleExtras
                         #     at codegen time, then written to support/<role>.<ext>
                         #     (mutually exclusive with the verbatim form)
  call-site.tmpl         # Mustache template rendered at each step bound to this role
  imports.tmpl           # optional; Mustache template producing import lines to inject
```

A role directory carries **either** `support.<ext>` (copied verbatim) **or**
`support.<ext>.tmpl` (rendered as Mustache against the role's
`roleExtras` entry before being written). The loader rejects a directory
that contains both. The templated form is the right choice when the
helper needs to bake in spec-derived constants that would otherwise have
to be threaded through every call site — the `deploymentGateway` role's
`EXTRACTS` list is the canonical example (see "Deployment-gateway
reference implementation" below).

All three files are **per emitter** because they encode emitter-specific
syntax (TypeScript helpers for Playwright; Java classes for the future
Java SDK emitter; etc.). A role may have a directory for one emitter
and not another — in that case the role is not implemented on that
emitter, and any step whose `roleFor(step.operationId)` resolves to the
role fails the same materializer/dispatch validation described in
"Dispatch" above (bound role with no template is always an error). The
emitter does not silently fall back to the generic path.

`support.<ext>` is copied into the emitted suite's vendored support tree
by the materializer overlay (Phase 2). One role ships one support file
(see "Helper materialization and imports" below for the
single-file-per-role convention); a collision between a role's emitted
filename and a built-in support file's basename is an error.

`imports.tmpl` is aggregated per spec file: rendered once per distinct
role appearing in the spec, deduplicated, injected at the top.

## Helper materialization and imports

This section spells out end-to-end how a role's helper file gets from
its config directory into the emitted Playwright suite, and how spec
files import it. Worked example: the OCA `deploymentGateway` role.

### Convention

- **One support file per role.** The role's helper code lives in a
  single file at `roles/<role>/support.<ext>`. (A role that genuinely
  needs to split its helper across multiple modules can re-export
  internal modules from `support.<ext>`; if a future role's needs
  outgrow that, the convention can be promoted to a per-role
  directory at that point — YAGNI for now.)

- **Filename in the emitted suite is the role name.** The materializer
  copies `roles/<role>/support.<ext>` to `playwright/support/<role>.
  <ext>`. No file lands at the literal name `support.<ext>`; role
  files are renamed on copy. This guarantees no collisions between
  roles (role names are already unique within a config) and no
  collisions with built-in support files (which are named after their
  concern: `seeding.ts`, `fixtures.ts`, `env.ts`, etc., never after
  a role).

- **The helper imports built-ins as siblings.** The role's
  `support.<ext>` lands in the same flat directory as the built-in
  support files, so it imports them with sibling-relative paths
  exactly like a built-in does. No `../` traversal, no path-rewriting
  on copy.

- **Collisions are a hard error.** The materializer asserts that no
  emitted support filename collides with a built-in or with another
  role's emitted filename. Built-in names are reserved; role names
  must not match a built-in's basename.

### Worked example: `deploymentGateway`

Source layout (in the repo):

```
configs/camunda-oca/codegen/playwright/roles/deploymentGateway/
  support.ts.tmpl   # Mustache template; bakes EXTRACTS in via {{{extracts}}}
  call-site.tmpl
  imports.tmpl
```

The templated helper imports built-in support as siblings and reads the
baked-in `EXTRACTS` constant directly:

```ts
// configs/camunda-oca/codegen/playwright/roles/deploymentGateway/support.ts.tmpl
import { extractInto } from './seeding.js';
import { resolveFile } from './fixtures.js';

const EXTRACTS: DeployExtract[] = {{{extracts}}};

export async function deploy(
  ctx, request, body, baseUrl, strips,
) { /* loops EXTRACTS internally */ }
```

`{{{extracts}}}` is interpolated once at codegen time from the
deployment role's `roleExtras` entry (see "Deployment-gateway reference
implementation" below). The emitted `support/deploymentGateway.ts`
contains a literal array; no template syntax leaks into the suite.

Note the `./seeding.js` and `./fixtures.js` imports — these resolve in
the emitted suite because the file lands next to those built-ins
(see below). In the source repository they do not resolve, which is
fine: the file is never imported by source code, only vendored. A
lint exclusion or `// @ts-nocheck` may be appropriate here; Phase 4
will decide.

Resolved in Phase 4: source-tree role helpers use sibling relative
imports (e.g. `import { ctx } from '../support/seeding'`) that
resolve both in the source repo and after materialization. No
`@ts-nocheck` was needed.

Materialized layout (in each emitted Playwright suite):

```
<suite>/playwright/support/
  assert-json-body.ts
  deploymentGateway.ts    ← renamed on copy from roles/deploymentGateway/support.ts
  env.ts
  fixtures.ts
  recorder.ts
  seeding.ts
```

`imports.tmpl` for the role:

```hbs
import { deploy } from '{{{supportImportPath}}}';
```

Triple-braces because the value is a path literal we want raw, not
HTML-escaped.

`call-site.tmpl` for the role:

```hbs
const {{respVar}} = await deploy({{{ctx}}}, {{{request}}}, {{{body}}}, {{{baseUrl}}}, {{{strips}}});
```

Rendered spec file (excerpt):

```ts
// Generated by codegen; do not edit.
import { test, expect } from '@playwright/test';
import { deploy } from './support/deploymentGateway';
// ... other emitter-generated imports ...

test('publish a process and start an instance', async ({ request, baseUrl }, ctx) => {
  // ... earlier steps ...
  const resp7 = await deploy(ctx, request, body7, baseUrl, STRIPS);
  // ... later steps consume ctx.processDefinitionKeyVar ...
});
```

The extracts list does not appear at the call site — it is baked into
`support/deploymentGateway.ts` once, by the templated support file.

### Scope variables for `imports.tmpl`

`imports.tmpl` is rendered **once per `(spec-file, role)` pair** —
not once per step. Per-step values like `respVar`, `body`,
`operationId`, `pathTemplate` would be ambiguous in that scope (which
step's value would they hold?) and step-dependent imports are not a
use case the contract supports: if a template's import block needs to
differ between two steps of the same role in the same spec, that is a
signal to factor the variation into the helper, not into the import
template.

To enforce this unambiguously, `imports.tmpl` receives a **strict
subset** of `call-site.tmpl`'s scope — only the role-static fields
that have the same value for every step bound to the role in a given
spec file:

| Variable | Type | Description |
|---|---|---|
| `roleName` | string | The role identifier (e.g. `deploymentGateway`). |
| `supportImportPath` | string | Renderer-computed relative path from the current spec file to `playwright/support/<role>` (no extension; Playwright/TypeScript resolves both `.ts` and `.js` per the suite's `tsconfig`). Typically `./support/<role>` for spec files at the suite root, `../support/<role>` for spec files in subdirectories. Authors should always interpolate this with triple-braces. |

Per-step variables (`respVar`, `body`, `operationId`,
`pathTemplate`, `method`, `request`, `baseUrl`, `strips`, `ctx`,
`defaultRender`) are **not** in `imports.tmpl` scope. Referencing
them is a template-render error so that mistakes fail at codegen time
rather than producing whichever step's value happened to win.

### Aggregation and deduplication

Per emitted spec file:

1. For each step whose role resolves to a role with templates under
   the active emitter+config, the renderer records the role
   identifier and the spec-file-relative `supportImportPath`.
2. After all steps are rendered, the recorded role set is
   deduplicated by role identifier.
3. For each distinct role in the set, `imports.tmpl` is rendered
   once with the role-static scope (`roleName`,
   `supportImportPath`).
4. The rendered import blocks are concatenated, deduplicated as raw
   text (so two roles importing from the same path produce a single
   line), and injected into the spec file's import block below the
   emitter-generated banner and above any other imports.

A role whose `imports.tmpl` is missing contributes nothing to the
import block — used by roles whose call-site template is fully
self-contained and needs no helper. The materializer still copies
their `support.<ext>` if present; an unused support file is a
materializer warning but not an error (a role may legitimately ship a
helper that is re-exported from elsewhere).

## Templating engine

[**Mustache**](https://mustache.github.io/mustache.5.html) (`mustache`
npm package, v4.x).

Logic-free by design. The repository convention: **if a template needs
conditionals or loops beyond Mustache sections, that is a signal to
factor variation into separate roles or into scope variables computed
in code — not to grow the template language.**

Triple-braces (`{{{var}}}`) are required for any scope variable whose
value is code. Double-braces (`{{var}}`) HTML-escape the output, which
will silently corrupt generated TypeScript.

## Scope variables

Every template receives a baseline scope from the renderer. Per-emitter
extensions are documented in this file under the per-emitter section.

### Common (all emitters)

| Variable | Type | Description |
|---|---|---|
| `respVar` | string | Response binding variable name allocated by the planner for this step (e.g. `resp42`). |
| `pathTemplate` | string | OpenAPI path template, e.g. `/deployments`. |
| `method` | string | Uppercase HTTP verb. |
| `operationId` | string | OpenAPI `operationId` of the step's operation. |
| `roleName` | string | The role bound to this step. Useful in error-message wrappers. |
| `defaultRender` | string | The string the **generic per-method path** would have emitted for this step. See "Wrap-or-replace" below. |
| `ctx` | string | The ctx variable name in scope (typically the literal `ctx`). Provided as a scope var so wrappers can reference it without hard-coding. |

### Playwright-specific

| Variable | Type | Description |
|---|---|---|
| `request` | string | Name of the Playwright `request` fixture in scope (typically `request`). |
| `baseUrl` | string | Name of the base-URL variable in scope (typically `baseUrl`). |
| `body` | string | TypeScript expression evaluating to the request body for this step. JSON literal, multipart builder call, or `undefined`. |
| `strips` | string | JSON literal expression for the strip-on-sentinel rules derived from `globalContextSeeds`. |

`roleExtras` populated by registered `RoleHookProvider`s is also spread
into both the call-site scope and the support-file template scope (see
"Deployment-gateway reference implementation" for the canonical
example: `extracts` is consumed by the support-file template, not by
the call-site template).

The exact scope contract for the Java SDK and any future emitter is
defined when that emitter lands; this file is the canonical reference
once they exist.

## Wrap-or-replace

Templates choose between two patterns:

### Replace

The template emits its own call site, ignoring `{{{defaultRender}}}`.
Used when the role's call shape diverges meaningfully from the generic
one — e.g. the OCA `deploymentGateway` role wraps a multipart upload
with response-field extraction and an OCA-specific error envelope.

```hbs
const {{respVar}} = await deploy({{{ctx}}}, {{{request}}}, {{{body}}}, {{{baseUrl}}}, {{{strips}}});
```

### Wrap

The template interpolates `{{{defaultRender}}}` inside its own
scaffolding. Used when the role decorates the request without changing
its shape — e.g. a hypothetical `longPoll` role wraps the generic call
in a retry-with-timeout loop.

```hbs
await retry({ timeoutMs: 30000 }, async () => {
  {{{defaultRender}}}
});
```

The renderer **always materialises `defaultRender` eagerly**. The cost
is negligible (codegen is offline; the generic path is cheap) and a
lazy/lambda contract would complicate the template scope without
buying anything observable.

### Indentation

Mustache does not re-indent multi-line interpolated values. Templates
that wrap multi-line `{{{defaultRender}}}` are responsible for placing
the interpolation at the column they want, and the codegen
post-formatter (Biome — decision resolved in Phase 3)
normalises the result.

If a role finds itself needing indent-sensitive interpolation in
multiple places, that is a signal to add an indented-render helper
(`{{{defaultRenderIndented2}}}` etc.) rather than push indentation
logic into the template.

## Materializer overlay (Phase 2, landed)

The Playwright materializer copies the built-in support tree from
`materializer/src/playwright/support/` into each emitted suite's
`playwright/support/`, then overlays per-role helpers via
[`materializeRoleSupportFiles`](playwright/materialize-support.ts):

1. The built-in support tree is copied as documented in
   [`materializer/README.md`](../README.md).
2. For every role bundle loaded via
   [`loadRoleBundlesForActiveConfig`](playwright/roleRenderer.ts)
   whose directory carries a support file, that file lands at
   `playwright/support/<role>.<ext>` — **renamed on copy** so role
   names (not the literal `support`) become the emitted filenames.
   - A bundle whose source is `support.<ext>` is copied byte-for-byte.
   - A bundle whose source is `support.<ext>.tmpl` is rendered with
     Mustache against `ctx.roleExtras.get(<role>) ?? {}` and the
     result is written under the stripped basename. The orchestrator
     defers this materialisation until **after** all
     `RoleHookProvider`s have run, so spec-derived extras are visible
     to the template.
3. Collisions error. A role name that matches a built-in support file's
   stem (`env`, `seeding`, `fixtures`, `recorder`, `await-eventually`)
   raises with the colliding name surfaced in the error message.

`configs/camunda-oca/codegen/playwright/roles/deploymentGateway/
support.ts.tmpl` materialises as `playwright/support/deploymentGateway.ts`
(the `.tmpl` suffix is stripped on render).
The built-in support tree retains only files that are generic across
configs (`env.ts`, `fixtures.ts`, `seeding.ts`, `recorder.ts`,
`await-eventually.ts`, `seed-rules.json`).

## Renderer (Phase 3, landed)

[`materializer/src/playwright/roleRenderer.ts`](playwright/roleRenderer.ts)
owns role dispatch and rendering. Per step the renderer:

1. Asks `getRoleForOperation(step.operationId)` (sourced from the active
   config's artifact-kinds ABox) whether the step has a role binding.
2. If a role bundle exists for that role under the active emitter+config
   and its optional `match.json` gates accept the step's shape, renders
   `call-site.tmpl` with the per-step scope and returns the result.
3. If no role binding exists, the step takes the generic per-method path.
4. If the step has a role binding but no bundle is loaded under the
   active emitter, `findRoleForStep` raises — bound role with no
   template is always an error, never a silent fallback.

All `isDeploymentStep`-style branches were deleted in Phase 3.

## Deployment-gateway reference implementation (Phase 4, landed)

The `deploymentGateway` role at
`configs/camunda-oca/codegen/playwright/roles/deploymentGateway/`
exercises every phase end-to-end:

- `support.ts.tmpl` ships the `deploy()` helper that all
  `createDeployment` call sites invoke. The Mustache template bakes a
  module-level `const EXTRACTS: DeployExtract[] = {{{extracts}}};` at
  codegen time; `deploy()` reads `EXTRACTS` directly so call sites
  don't carry the list.
- `call-site.tmpl` renders the `deploy(...)` call with the per-step
  scope (no `extracts` argument).
- `imports.tmpl` injects `import { deploy } from '<supportImportPath>'`
  at the top of each spec that contains a deployment step.
- `match.json` constrains the role to multipart-body `createDeployment`
  calls with the expected response status set.

The `extracts` value interpolated into `support.ts.tmpl` is computed
once per CLI invocation by
[`DeploymentRoleHookProvider`](playwright/hooks/deployment.ts)
(`#233` Step 6 / #237). The provider walks
`graph.operations[createDeployment].responseSemanticLeaves`, filters by
provider/depth rules, dedupes, and writes the JSON literal into
`ctx.roleExtras['deploymentGateway'].extracts`. The materializer reads
it back when rendering the templated support file. No per-field
knowledge lives in the emitter, and no per-field literal leaks into the
call site (#243).

## L3 invariants (Phase 5, landed)

Three invariants in
[`configs/camunda-oca/regression-invariants.test.ts`](../../configs/camunda-oca/regression-invariants.test.ts)
under the describe block **"role-template rendering contract (Lift 12 /
#231 Phase 5)"**:

1. **Every ABox-bound role has a renderable role directory.** A role
   appearing in any `operationRules[].role` must have a
   `configs/<config>/codegen/playwright/roles/<role>/call-site.tmpl`
   present. Catches an ABox entry pointing at a deleted role directory.
2. **Every active role bundle is imported by at least one emitted spec.**
   Every role with a `support.<ext>` file must be `import`ed by at
   least one emitted `.spec.ts`. Catches both dead role directories
   (delete them) and unwired role dispatch (the planner is no longer
   binding any operation to the role).
3. **Spec-derived deploymentGateway extracts cover every downstream
   binding consumer.** Three checks against the materialised
   `support/deploymentGateway.ts` and the emitted specs: (a) a drift
   detector that the helper's baked `EXTRACTS` constant's varName set
   equals `computeDeploymentExtracts(createDeployment)`; (b) a
   no-leakage assertion that no emitted spec contains a `varName:`
   literal inside a `deploy(` argument list (catches a regression that
   re-introduces the inlining — see #243); (c) a coverage check that
   every `ctx.<...>Var` reference in a deployment-using spec has a
   producer (deploy extract, `seedBinding`, `extractInto`, or direct
   `ctx.<...>Var = …` assignment).

The originally-drafted fourth invariant (a grep-ban over emitter source
for deployment-specific identifiers) was retired in favour of invariant
2: invariant 2 phrases the property as a positive coverage statement
(every role's helper is used) rather than as a name-blacklist, which
keeps the legitimate uses of `deployment` as an identifier in the
registered hook provider intact while still failing closed if the role
falls out of use.

## Documentation (Phase 6, ongoing)

[`materializer/README.md`](../README.md) is the runtime contract
reference (how to register a new emitter, the role-bundle directory
layout, the SDK `EmitterStrategy` / `RoleHookProvider` contracts). This
file is the design reference; together they cover everything a
contributor needs to add a new role on the existing Playwright emitter
or stand up a new emitter that consumes the same role tree.

The explicit "Adding a role" / "Adding an emitter" walk-throughs land
alongside the first contributor request that needs them rather than
pre-emptively (YAGNI).

## Out of scope

- Generalising other vendored support files (`env.ts`, `fixtures.ts`)
  beyond what Lift 11's CONFIG-env-driven approach already does.
  Addressed reactively, not as part of this initiative.
- Adding new roles beyond `deploymentGateway`. New roles motivate
  themselves once we see them; this initiative is the infrastructure.
- SDK emitter implementation. This initiative gives SDK emitters a
  place to land; the emitters themselves are tracked separately.
