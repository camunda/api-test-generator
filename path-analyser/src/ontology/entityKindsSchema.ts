// Source of truth for the entity-kinds ABox TBox (api-test-generator
// ontology, v1).
//
// Mirrors the pattern established by `edgeSchema.ts` (Lift 3 / #208):
// this TypeScript module is the authoritative declaration; the matching
// `ontology/vocabulary/entity-kinds.schema.json` file is generated from
// it by `scripts/build-ontology.ts` and committed solely so external
// SPARQL/SHACL/OWL consumers can fetch a plain JSON Schema by URL. A
// regression invariant in `configs/<config>/regression-invariants.test.ts`
// asserts the two are in sync.
//
// What this ABox encodes (Lift 4 / #210): the inventory of entity kinds
// for an API. Each kind is one of two shapes:
//
//   - `entity`            — a server-minted (or client-minted) singleton
//                           identified by one or more semantic identifier
//                           types. Lifecycle is fully observable via the
//                           same API (create/get/delete operations).
//
//   - `external-entity`   — an identifier minted *outside* the API
//                           (e.g. an OAuth ClientId minted by Console or
//                           an external IdP). Treated by the planner as
//                           "client-mintable, no upstream producer
//                           required" (graph.externalEntityIdentifiers).
//
// `identifiers[]` lists the semantic identifier-type names that identify
// the entity. For `external-entity` kinds, these are the types the
// planner short-circuits as `externalBoundary`. For `entity` kinds the
// list is currently inert at runtime (catalogue only) but is migrated
// for completeness so `x-semantic-kind` can eventually be retired
// upstream and so the coverage gates have a complete inventory.
//
// JSON-LD (`@context`, `@type`) is accepted and preserved verbatim but
// not interpreted by the loader — same convention as `edgeSchema.ts`.

export const entityKindsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://camunda.github.io/api-test-generator/ns/v1/entity-kinds.schema.json',
  title: 'Entity-kinds ABox (api-test-generator ontology, v1)',
  description:
    'TBox JSON Schema for an ABox file describing the entity kinds (the domain nouns) of a single API. Each entry asserts: an entity kind exists; it has one of two shapes (`entity` for in-API-managed, `external-entity` for identifiers minted outside the API); and (for both shapes) a list of semantic identifier-type names that identify it. The schema is intentionally agnostic to which API ships the kinds — instance-data lives in the per-config ABox file (e.g. configs/camunda-oca/ontology/entity-kinds.json). The optional top-level `@context` and per-entry `@type` are JSON-LD metadata only; no runtime in this repo interprets them, but they are reserved so an external SPARQL/SHACL consumer can ingest the file unchanged. Cross-references against the bundled spec (kind names appearing in operation `produces[]`/`requires[]`, identifier types being live, etc.) are enforced as L3 invariants in configs/<name>/regression-invariants.test.ts rather than being re-encoded here, because Draft-07 cannot express them.',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'kinds'],
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
    kinds: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/definitions/EntityKind' },
    },
  },
  definitions: {
    EntityKind: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'shape', 'identifiers', 'description'],
      properties: {
        '@type': {
          description: 'Optional JSON-LD type IRI. Ignored by the loader.',
          type: 'string',
        },
        name: {
          type: 'string',
          pattern: '^[A-Z][A-Za-z0-9]+$',
          description: 'PascalCase singular noun naming the entity kind (e.g. `Role`, `Client`).',
        },
        shape: {
          type: 'string',
          enum: ['entity', 'external-entity'],
          description:
            '`entity`: in-API-managed (producer + consumer ops both inside the API). `external-entity`: identifier minted outside the API; planner treats `identifiers[]` as `externalBoundary` (client-mintable, no upstream producer required).',
        },
        identifiers: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
            minLength: 1,
            description:
              'Semantic identifier-type name (matching the `semanticType` values used in `x-semantic-establishes.identifiedBy` upstream).',
          },
        },
        description: {
          type: 'string',
          minLength: 1,
        },
      },
    },
  },
} as const;
