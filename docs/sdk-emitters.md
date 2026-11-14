# Writing an SDK emitter

An SDK emitter turns the planned test scenarios into an integration suite that drives the Camunda
REST API through one SDK (JavaScript, Python, C#, Go, Rust, Java, PHP, D, …). Every emitter follows
the same pattern, so a new language means writing a renderer, not re-deriving test logic.

```
OpenAPI spec ─► semantic-graph-extractor ─► path-analyser ─► scenario JSON
                                                              │
                                     lowerScenario() ◄────────┘   (emitter-sdk, shared)
                                           │
                       ┌───────────────────┼────────────────────┐
                 Playwright             JS SDK      Python SDK   … each one only renders
```

## The contract: `lowerScenario()`

`@camunda8/emitter-sdk` exports `lowerScenario(scenario, { globalContextSeeds })`. It makes every
decision that does not depend on the target language and returns a `LoweredScenario`:

| Field | What it decides | Render it as |
|---|---|---|
| `seeds: SeedOp[]` | Which ctx bindings to set before the first step, in order: literals, seeds, unique seeds, env overrides | `literal`: `ctx[b] = env[e] or value`. `seed`: `ctx[b] = ctx[b] ?? (env[e] or seedBinding(rule, unique))` |
| `steps[].pathParams` | The ctx binding behind each `{param}` in the path | Substitute `ctx[binding]` |
| `steps[].body` | The request body as a typed tree: `literal`, `ref` (a ctx binding), `file` (a fixture path), `object`, `array`; or `multipart` fields and files | Build the language's request value. A `ref` with `omitWhenUnbound` drops its field when the binding is unset |
| `steps[].awaitEventually` | Whether to poll this read until it succeeds (eventually consistent) | Wrap the call in the runtime's await-eventually helper |
| `steps[].expect` | Expected status and, for errors, `detailContains` | Assert both |
| `steps[].extract` | Response fields to store, as `segments` (`['items', 0, 'key']`) | `ctx[binding] = response…segments` |
| `steps[].waitsAfter` | Witness reads to poll after the step | Poll the witness until its predicate holds |
| `steps[].searchChecks`, `validateResponse` | Extra response checks | Optional; see the Playwright emitter for semantics |
| `steps[].echoChecks` | Response fields that must equal a value, as `segments` plus a typed `literal`/`ref` | Assert `response…segments` equals the literal or `ctx[binding]` |
| `serverOverride` | A non-default base URL for the whole scenario | Use it as the base URL |
| `uniqueBindings` | Bindings seeded uniquely per run (409 avoidance) | Already applied in `seeds`; informational |

An adapter never parses `"${binding}"` or `"@@FILE:"` strings, never reads `x-eventually-consistent`,
and never re-implements seeding. If it needs a decision that `lowerScenario()` does not make yet,
add it there, so all emitters get it. `step.source` and `scenario.source` expose the planner's raw
data for features not lowered yet. Treat any use of them as a gap to close.

## Guarantees

The Layer-3 invariant `emitter lowering contract (#812)`, for both camunda-oca and camunda-hub,
asserts on the real generated scenarios that:

- every scenario lowers (no placeholder inside a longer string, no scenario mixing server bases);
- every binding a step reads (path parameter, or a body ref not marked `omitWhenUnbound`) is set by
  `seeds` or by an earlier step's `extract`;
- every binding a post-step witness poll reads is set by then too — the polling step's own
  `extract` counts, a later step's does not.

So an adapter can read `ctx[binding]` without guarding against undefined.

## What stays per language

- Mapping an `operationId` to the SDK method that calls it (see #812: the SDKs publish
  `examples/operation-map.json`).
- The language's test framework, project files, and runtime helpers (`seedBinding`,
  await-eventually, fixture loading).
- Rendering the value tree into the SDK's request types.

## Playwright

The Playwright emitter is the reference renderer. It uses the same functions
(`planCtxSeeding`, `stepNeedsAwaitForOp`, `computeUniqueBindings`, `resolveScenarioServerOverride`,
`camelCase`) from `emitter-sdk`, so its decisions and the SDK emitters' decisions cannot drift.
