// Source of truth for the global-context-seeds ABox TBox
// (api-test-generator ontology, v1).
//
// Mirrors the pattern established by `edgeSchema.ts` (Lift 3 / #208),
// `entityKindsSchema.ts` (Lift 4 / #210), `artifactKindsSchema.ts`
// (Lift 5 / #212), `runtimeStatesSchema.ts` (Lift 6 / #214), and
// `semanticsSchema.ts` (Lift 7 / #216): this TypeScript module is the
// authoritative declaration; the matching
// `ontology/vocabulary/global-context-seeds.schema.json` file is
// generated from it by `scripts/build-ontology.ts` and committed solely
// so external SPARQL/SHACL/OWL consumers can fetch a plain JSON Schema
// by URL. A regression invariant in
// `configs/<config>/regression-invariants.test.ts` asserts the two are
// in sync.
//
// What this ABox encodes (Lift 8 / #218): the catalogue of *universal
// seed bindings* every emitted Playwright scenario must populate before
// its request plan runs (the canonical example is the single-tenant
// `tenantIdVar` binding). Each entry drives the per-scenario seed
// prologue in the Playwright emitter:
//
//   - if (ctx['<binding>'] === undefined) { ctx['<binding>'] =
//       seedBinding('<seedRule>'); }
//
// or — when `omitWhenUnbound` is `true` (#342) — the prologue is
// skipped entirely so the binding is seeded only when the planner-
// driven `seedBindings` list names it. Unseeded `omitWhenUnbound`
// bindings stay `undefined`, so the request field is omitted on the
// wire and the server applies its own default (e.g. the Camunda REST
// Gateway treats a missing `tenantId` as the default tenant).
//
// Like Lifts 5/6/7, the data was never sourced from upstream OpenAPI
// annotations — it has always lived in per-config ontology data.
// Consequence: there is no `spec-vs-abox` (sense-1) drift to detect.
//
// Identifier safety constraints (the same constraints previously
// enforced by `domainSemanticsValidator.ts#GlobalContextSeedSchema`
// and `assertSafeGlobalContextSeeds`) are encoded in the JSON-Schema
// `pattern` so they are caught at TBox validation time. The Playwright
// emitter interpolates `binding`, `fieldName`, and `seedRule` directly
// into emitted TS source as identifiers and single-quoted string
// literals (#87), so the safety regex is load-bearing.
//
// Uniqueness (`binding`, `fieldName`) cannot be expressed in Draft-07
// and is re-checked in the loader.

export const globalContextSeedsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://camunda.github.io/api-test-generator/ns/v1/global-context-seeds.schema.json',
  title: 'GlobalContextSeedsAbox',
  description:
    'TBox JSON Schema for an ABox file describing the universal seed bindings every emitted scenario must populate before its request plan runs (e.g. a single-tenant `tenantIdVar` default). Each entry asserts: a context binding name, the request-body / multipart field name it maps to, the seed-rules.json key invoked at runtime, and (optionally) `omitWhenUnbound: true` to instruct the materializer to skip the universal-seed prologue and let the field be omitted on the wire when no per-scenario step seeds it. The schema is intentionally agnostic to which API ships the seeds — instance-data lives in the per-config ABox file (e.g. configs/camunda-oca/ontology/global-context-seeds.json). The optional top-level `@context` and per-entry `@type` are JSON-LD metadata only; no runtime in this repo interprets them, but they are reserved so an external SPARQL/SHACL consumer can ingest the file unchanged. Identifier safety (binding/fieldName/seedRule must match /^[A-Za-z_$][A-Za-z0-9_$]*$/) is encoded in the `pattern` constraints because the emitter interpolates these values directly into emitted TS source as identifiers and single-quoted string literals (#87).',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'seeds'],
  properties: {
    $schema: { type: 'string' },
    '@context': {
      description:
        'Optional JSON-LD context. Ignored by the loader; preserved verbatim so external RDF tooling can resolve term IRIs without modification.',
      type: ['object', 'string', 'array'],
    },
    version: {
      type: 'integer',
      minimum: 1,
      description:
        'Schema version of this ABox file. Bumped only when the TBox shape changes incompatibly.',
    },
    seeds: {
      type: 'array',
      items: { $ref: '#/definitions/GlobalContextSeed' },
    },
  },
  definitions: {
    GlobalContextSeed: {
      type: 'object',
      additionalProperties: false,
      required: ['binding', 'fieldName', 'seedRule'],
      properties: {
        '@type': {
          description: 'Optional JSON-LD type IRI. Ignored by the loader.',
          type: 'string',
        },
        binding: {
          type: 'string',
          minLength: 1,
          pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$',
          description:
            'ctx[<binding>] key the seed populates. Constrained to a JS identifier because the emitter interpolates it as an unquoted bracket-string in the seed prologue.',
        },
        fieldName: {
          type: 'string',
          minLength: 1,
          pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$',
          description:
            'Request-body / multipart field name this binding maps to. Constrained to a JS identifier so the emitted multipart-strip branch is a safe direct property access.',
        },
        seedRule: {
          type: 'string',
          minLength: 1,
          pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$',
          description:
            'Key passed to seedBinding() at runtime; must match a rule in seed-rules.json. Constrained to a JS identifier so the emitter renders it as a safe single-quoted string literal.',
        },
        omitWhenUnbound: {
          type: 'boolean',
          description:
            'If true, the materializer skips the universal-seed prologue for this entry — the binding is seeded only when a per-scenario step produces or consumes it (via `scenario.seedBindings`). For scenarios that do not seed it, the binding stays `undefined` and the request field is omitted on the wire (#342). Replaces the legacy `defaultSentinel`/`stripFromMultipartWhenDefault` mechanism, which sent a literal sentinel value on the wire and broke re-runnability for producer ops like `createTenant`.',
        },
        rationale: {
          type: 'string',
          description: 'Free-form documentation for maintainers.',
        },
      },
    },
  },
} as const;
