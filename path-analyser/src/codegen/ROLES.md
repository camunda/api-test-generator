# Operation-role rendering (Lift 12 / #231)

Status: **Phase 1 — design**. No runtime code is wired through yet. Phases
2–6 implement the materializer overlay, renderer, deployment-gateway
reference role, L3 invariants, and config-author docs.

## Principle

**ABox describes the API. The codegen tree describes the generator.** A
binding between the two is **directory existence** — never an ABox
field naming a helper or template.

- `configs/<config>/ontology/operation-roles.json` — ABox. Says
  *"operation X plays role R."* `R` is an API-semantic name
  (`deploymentGateway`; hypothetical `longPoll`, `webhookPublish`,
  …). Free of any generator concept. **The directory name in the
  codegen tree (see below) must match this identifier verbatim** —
  the existing `deploymentGateway` role is the canonical example. No
  normalisation between ABox identifiers and directory names is
  performed; an exact-string match keeps the binding unambiguous.
- `configs/<config>/codegen/<emitter>/roles/<role>/` — codegen tree.
  Owns the per-emitter implementation for that role. Directory
  existence is the binding; no JSON registry references it.

Adding a role: ABox entry + a directory per emitter that supports the
role. Adding an emitter: the emitter walks `configs/<config>/codegen/
<this-emitter>/roles/` at materialise time. Neither requires touching
`path-analyser/src/codegen/` source.

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
  support.<ext>      # vendored verbatim into the emitted suite's support/ tree
  call-site.tmpl     # Mustache template rendered at each step bound to this role
  imports.tmpl       # optional; Mustache template producing import lines to inject
```

All three files are **per emitter** because they encode emitter-specific
syntax (TypeScript helpers for Playwright; Java classes for the future
Java SDK emitter; etc.). A role may have a directory for one emitter
and not another — that simply means the emitter does not implement the
role, and steps bound to it fall through to the generic path on that
emitter (with a `--strict` flag option to error instead, TBD).

`support.<ext>` is copied into the emitted suite's vendored support tree
by the materializer overlay (Phase 2). Multiple roles may ship multiple
support files; collisions on file name are an error.

`imports.tmpl` is aggregated per spec file: rendered once per distinct
role appearing in the spec, deduplicated, injected at the top.

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
| `extracts` | string | JSON literal expression for the response-extracts list (see "Wrap-or-replace" and Phase 4 / #230). |

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
const {{respVar}} = await deploy({{{ctx}}}, {{{request}}}, {{{body}}}, {{{baseUrl}}}, {{{strips}}}, {{{extracts}}});
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
post-formatter (Phase 3 will decide between Biome and Prettier here)
normalises the result.

If a role finds itself needing indent-sensitive interpolation in
multiple places, that is a signal to add an indented-render helper
(`{{{defaultRenderIndented2}}}` etc.) rather than push indentation
logic into the template.

## Imports

`imports.tmpl` receives the same scope as `call-site.tmpl`. Most
imports are static and reference no scope variables; the template form
exists so that, e.g., a future role can conditionally import based on
emitter-specific scope.

Rendered once per `(spec-file, role)` pair, deduplicated as raw text
across roles within a spec file, injected at the top of the spec file
below any emitter-generated banner.

## Materializer overlay (Phase 2)

The Playwright materializer currently copies a fixed set of support
files from `path-analyser/src/codegen/support/` into each emitted
suite's `playwright/support/`. Phase 2 extends this to:

1. Copy the built-in support tree as today.
2. Walk `configs/<config>/codegen/playwright/roles/<role>/support.<ext>`
   for every role active in the active config. Copy each into
   `playwright/support/`.
3. Error on file-name collisions between built-in and any role's
   support, or between two roles' support. Configs are responsible for
   namespacing their helpers.

`deployment.ts` moves from `path-analyser/src/codegen/support/` into
`configs/camunda-oca/codegen/playwright/roles/deploymentGateway/
support.ts` in Phase 4. The built-in support tree retains only files
that are genuinely generic across configs (`env.ts`, `fixtures.ts`,
`seeding.ts`, `assert-json-body.ts`, `recorder.ts`).

## Renderer (Phase 3)

`path-analyser/src/codegen/playwright/emitter.ts` is restructured so
that the step-rendering loop dispatches via a single lookup. Concretely:

- A `renderStep(step, scope)` function that:
  1. Renders the generic per-method path into `scope.defaultRender`.
  2. If `roleFor(step.operationId)` returns a role and a
     `call-site.tmpl` exists for that role under the active emitter
     and config, renders the template with `scope` and returns the
     result. If the role is bound but no template exists, raises (see
     "Dispatch" above — bound role with no template is always an
     error).
  3. Otherwise returns `scope.defaultRender`.
- All current `isDeploymentStep`-style branches in `emitter.ts` are
  deleted. The deployment-gateway behaviour comes entirely from the
  role's template in Phase 4.

## Deployment-gateway reference implementation (Phase 4)

End-to-end exercise of phases 1–3 with deployment-gateway. Includes
the spec-derived extracts list (originally #230, absorbed here): the
`extracts` scope variable is computed at codegen time from
`op.responseSemanticLeaves` for the deployment-gateway operation
(filter: `provider:true` OR depth-1; skip oneOf-flattened paths;
dedup; deterministic order).

Acceptance: byte-identical pipeline output relative to the pre-Phase-4
baseline, modulo

- `deployment.ts` relocated from built-in support to the role
  directory, and
- the new `extracts` argument in each deploy() call site.

## L3 invariants (Phase 5)

Added to `configs/camunda-oca/regression-invariants.test.ts`:

1. **Role resolution.** For every scenario step in every generated
   spec file, if `roleFor(step.operationId)` returns a role, then
   `configs/<config>/codegen/playwright/roles/<role>/call-site.tmpl`
   exists. No silently-skipped role bindings.
2. **Support coverage.** Every `support.<ext>` shipped under
   `configs/camunda-oca/codegen/playwright/roles/<role>/` is referenced
   from at least one emitted spec file (import or call).
3. **Extracts cover consumers.** For the `deploymentGateway` op, the
   spec-derived extracts list contains a `varName` matching every
   binding var that any downstream step in any scenario consumes from
   a deployment response. Catches the originally-discussed
   `processDefinitionKeyVar`/`formKeyVar`/etc. coverage.
4. **Emitter is role-agnostic.** A grep invariant over
   `path-analyser/src/codegen/**/*.ts` (excluding `roles.ts` itself
   and any other type-surface files that are part of the role
   contract, but **including** all renderer/materializer/emitter
   sources) returns zero matches for `deploy|deployment|
   createDeployment|processDefinitionKey|formKey|
   decisionDefinitionKey|decisionRequirementsKey`. Markdown docs
   (notably this file) are excluded from the invariant — they
   intentionally name the canonical role to anchor the contract.
   Encodes the API-agnostic-emitter guarantee as a regression test.

## Documentation (Phase 6)

Two guides:

- **Adding a role** (`configs/README.md` addendum). Covers ABox entry,
  per-emitter directory layout, scope-variable reference, wrap-vs-replace
  pattern, naming conventions.
- **Adding an emitter** (`path-analyser/src/codegen/README.md` or
  similar). Covers how the emitter walks the per-config role tree,
  what scope it must provide, how to declare its scope contract in this
  file.

## Out of scope

- Generalising other vendored support files (`env.ts`, `fixtures.ts`)
  beyond what Lift 11's CONFIG-env-driven approach already does.
  Addressed reactively, not as part of this initiative.
- Adding new roles beyond `deploymentGateway`. New roles motivate
  themselves once we see them; this initiative is the infrastructure.
- SDK emitter implementation. This initiative gives SDK emitters a
  place to land; the emitters themselves are tracked separately.
