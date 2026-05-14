// Source of truth for the edge ABox TBox (api-test-generator ontology, v1).
//
// This TypeScript module is the authoritative declaration; the matching
// `ontology/vocabulary/edge.schema.json` file is generated from it by
// `scripts/build-ontology.ts` (run via `npm run build:ontology`) and
// committed solely so external SPARQL/SHACL/OWL consumers can fetch a
// plain JSON Schema by URL. A regression invariant in
// `configs/<config>/regression-invariants.test.ts` asserts the two are
// in sync; a drift means the build script has not been run since the
// last edit.
//
// Note on file location: the schema source lives inside the
// `path-analyser` workspace (rather than at the repo root next to the
// generated .json) so it is part of the workspace's compile graph. The
// published .json artefact under `ontology/vocabulary/` remains the
// authoritative external URL — `path-analyser` is just the workspace
// that happens to author it. If the ontology vocabulary grows enough
// to deserve its own workspace later, this module moves wholesale.
//
// The schema is exported `as const` so `json-schema-to-ts`'s
// `FromSchema` can derive the runtime TypeScript type from this single
// literal — runtime validation (ajv) and type-time inference both
// consume the same object, so neither can drift from the other.

export const edgeSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://camunda.github.io/api-test-generator/ns/v1/edge.schema.json',
  title: 'Edge ABox (api-test-generator ontology, v1)',
  description:
    'TBox JSON Schema for an ABox file describing the membership-edge instances of a single API. Each entry asserts: an edge kind exists; it is established by exactly one operation; it is observable via exactly one (projection-search) operation; it identifies its endpoints by an ordered tuple of semantic identifier types. The schema is intentionally agnostic to which API ships the operations — instance-data lives in the per-config ABox file (e.g. configs/camunda-oca/ontology/edges.json). The optional top-level `@context` and per-entry `@type` are JSON-LD metadata only; no runtime in this repo interprets them, but they are reserved so an external SPARQL/SHACL consumer can ingest the file unchanged. Cross-references against the bundled spec (operationIds and entity-kind names existing) are enforced as L3 invariants in configs/<name>/regression-invariants.test.ts rather than being re-encoded here, because Draft-07 cannot express them.',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'edges'],
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
    edges: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/definitions/Edge' },
    },
  },
  definitions: {
    Edge: {
      type: 'object',
      additionalProperties: false,
      required: [
        'name',
        'endpoints',
        'identifiedBy',
        'establishedBy',
        'observableVia',
        'description',
      ],
      properties: {
        '@type': {
          description: 'Optional JSON-LD type IRI. Ignored by the loader.',
          type: 'string',
        },
        name: {
          type: 'string',
          pattern: '^[A-Z][A-Za-z0-9]+$',
          description:
            "PascalCase singular noun naming the edge kind. Must match the corresponding `kind` in the spec's semantic-kinds registry.",
        },
        endpoints: {
          type: 'object',
          additionalProperties: false,
          required: ['from', 'to'],
          properties: {
            from: {
              type: 'string',
              minLength: 1,
              description:
                'Entity-kind name of the owning endpoint (the side the membership is relative to, e.g. Role for RoleUserMembership).',
            },
            to: {
              type: 'string',
              minLength: 1,
              description:
                'Entity-kind name of the member endpoint (e.g. User for RoleUserMembership).',
            },
          },
        },
        identifiedBy: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: {
            type: 'string',
            minLength: 1,
            description:
              'Semantic identifier-type name. Order matches [endpoints.from, endpoints.to].',
          },
        },
        establishedBy: {
          type: 'string',
          minLength: 1,
          description:
            'operationId of the (single) API operation that creates an instance of this edge.',
        },
        observableVia: {
          type: 'string',
          minLength: 1,
          description:
            'operationId of the (single) projection-search operation that lists members of one endpoint of this edge. Edges are not directly fetchable via a get-by-key operation by definition (see issue #198 axis 4f).',
        },
        description: {
          type: 'string',
          minLength: 1,
        },
      },
    },
  },
} as const;
