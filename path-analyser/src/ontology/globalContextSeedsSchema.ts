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
// and, when `defaultSentinel` + `stripFromMultipartWhenDefault` are
// both present, a multipart-loop branch that drops `fieldName` from
// the request body when the binding equals the sentinel.
//
// Like Lifts 5/6/7, the data was never sourced from upstream OpenAPI
// annotations — it has always lived in the per-config
// `domain-semantics.json` sidecar. Consequence: there is no
// `spec-vs-abox` (sense-1) drift to detect. The ABox supersedes the
// legacy `domain-semantics.json#globalContextSeeds` when present.
//
// Identifier / sentinel safety constraints (the same constraints
// previously enforced by `domainSemanticsValidator.ts#GlobalContextSeedSchema`
// and `assertSafeGlobalContextSeeds`) are encoded in the JSON-Schema
// `pattern` so they are caught at TBox validation time. The Playwright
// emitter interpolates `binding`, `fieldName`, `seedRule`, and
// `defaultSentinel` directly into emitted TS source as identifiers and
// single-quoted string literals (#87), so the safety regex is
// load-bearing.
//
// Cross-property invariant (`stripFromMultipartWhenDefault === true`
// requires `defaultSentinel` to be present) and uniqueness
// (`binding`, `fieldName`) cannot be expressed in Draft-07 and are
// re-checked in the loader.

export const globalContextSeedsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://camunda.github.io/api-test-generator/ontology/global-context-seeds.schema.json',
  title: 'GlobalContextSeedsAbox',
  description:
    'TBox JSON Schema for an ABox file describing the universal seed bindings every emitted scenario must populate before its request plan runs (e.g. a single-tenant `tenantIdVar` default). Each entry asserts: a context binding name, the request-body / multipart field name it maps to, the seed-rules.json key invoked at runtime, and (optionally) a sentinel value that triggers multipart-field stripping. The schema is intentionally agnostic to which API ships the seeds — instance-data lives in the per-config ABox file (e.g. configs/camunda-oca/ontology/global-context-seeds.json). The optional top-level `@context` and per-entry `@type` are JSON-LD metadata only; no runtime in this repo interprets them, but they are reserved so an external SPARQL/SHACL consumer can ingest the file unchanged. Identifier safety (binding/fieldName/seedRule must match /^[A-Za-z_$][A-Za-z0-9_$]*$/) and sentinel-string safety (no single-quotes, backslashes, line terminators, or control chars) are encoded in the `pattern` constraints because the emitter interpolates these values directly into emitted TS source as identifiers and single-quoted string literals (#87).',
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
        defaultSentinel: {
          type: 'string',
          // Forbid single-quote, backslash, line terminators, and C0
          // control chars — anything that could break the emitted
          // single-quoted string literal or smuggle script.
          pattern: "^[^'\\\\\\u0000-\\u001f\\u007f]*$",
          description:
            'Magic value that, when present in ctx[<binding>], triggers field-stripping in multipart bodies. Constrained so the emitted single-quoted string literal cannot break out of its quotes or carry control characters.',
        },
        stripFromMultipartWhenDefault: {
          type: 'boolean',
          description:
            'If true, the emitter inserts a multipart-loop branch that drops `fieldName` when ctx[<binding>] equals `defaultSentinel`. Requires `defaultSentinel` to be present (checked by the loader).',
        },
        rationale: {
          type: 'string',
          description: 'Free-form documentation for maintainers.',
        },
      },
    },
  },
} as const;
