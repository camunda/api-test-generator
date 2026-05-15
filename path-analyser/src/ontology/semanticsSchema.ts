// Source of truth for the semantics ABox TBox (api-test-generator
// ontology, v1).
//
// Mirrors the pattern established by `edgeSchema.ts` (Lift 3 / #208),
// `entityKindsSchema.ts` (Lift 4 / #210), `artifactKindsSchema.ts`
// (Lift 5 / #212), and `runtimeStatesSchema.ts` (Lift 6 / #214): this
// TypeScript module is the authoritative declaration; the matching
// `ontology/vocabulary/semantics.schema.json` file is generated from
// it by `scripts/build-ontology.ts` and committed solely so external
// SPARQL/SHACL/OWL consumers can fetch a plain JSON Schema by URL.
// A regression invariant in
// `configs/<config>/regression-invariants.test.ts` asserts the two
// are in sync.
//
// What this ABox encodes (Lift 7 / #216): the catalogue of
// *value-source declarations* — semantic types, capabilities, and
// identifiers — that the planner reasons about when chaining
// operations and binding values. The three sub-trees co-locate in
// one ABox because they cross-reference each other:
//
//   - `semanticTypes[T].witnesses → runtimeStates | capabilities`
//   - `capabilities[C].dependsOn → runtimeStates`
//   - `identifiers[I].validityState → runtimeStates`
//   - `identifiers[I].derivedVia → capabilities`
//
// Splitting them would let one drift from the other; co-locating
// makes those cross-references single ABox-level invariants rather
// than inter-file ones.
//
// Like Lifts 5 and 6, the data was never sourced from upstream
// OpenAPI annotations — it has always lived in the per-config
// `domain-semantics.json` sidecar. Consequence: there is no
// `spec-vs-abox` (sense-1) drift to detect. The ABox supersedes the
// legacy `domain-semantics.json` keys when present; coverage gates
// check the durable `abox-vs-graph` (sense-2) invariants only
// (referenced opIds exist in the graph, witness/dependsOn/validityState/
// derivedVia targets resolve).
//
// Three entry classes:
//
//   - `semanticTypes` — per-semantic-type metadata: which runtime
//                       state or capability the value witnesses
//                       (`witnesses`); the value-source classification
//                       (`kind`: `modelDerived` | `attribute` |
//                       `serverEmergent`); whether values are minted
//                       client-side rather than returned by a producer
//                       (`clientMinted`).
//
//   - `capabilities`  — per-capability metadata: a parameter name
//                       (`parameter`); which ops produce the
//                       capability (`producedBy`); which prerequisite
//                       runtime states must hold (`dependsOn`).
//
//   - `identifiers`   — per-identifier metadata: the runtime state
//                       declared valid once the identifier is bound
//                       (`validityState`); which ops bind the
//                       identifier (`boundBy`); response field paths
//                       where the identifier appears (`fieldPaths`);
//                       the capability it is derived via, when any
//                       (`derivedVia`).
//
// Cross-property invariants (loader-enforced, since Draft-07 cannot
// express them):
//
//   - `kind: 'attribute'` ⇒ `clientMinted: true` (#162 PR 2 coupling).
//   - duplicate `name` rejected within each of the three sub-trees.
//
// JSON-LD (`@context`, `@type`) is accepted and preserved verbatim
// but not interpreted by the loader — same convention as the other
// ABoxes.

export const semanticsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://camunda.github.io/api-test-generator/ns/v1/semantics.schema.json',
  title: 'Semantics ABox (api-test-generator ontology, v1)',
  description:
    'TBox JSON Schema for an ABox file describing the value-source declarations a deployed API surfaces — semantic types, capabilities, and identifiers. The three sub-trees co-locate because they cross-reference each other (semanticTypes.witnesses → runtimeStates|capabilities; capabilities.dependsOn → runtimeStates; identifiers.validityState → runtimeStates; identifiers.derivedVia → capabilities). The schema is intentionally agnostic to which API ships the entries — instance data lives in the per-config ABox file (e.g. configs/camunda-oca/ontology/semantics.json). The optional top-level `@context` and per-entry `@type` are JSON-LD metadata only; no runtime in this repo interprets them, but they are reserved so an external SPARQL/SHACL consumer can ingest the file unchanged. Cross-references against the bundled spec (operationIds existing; witness/dependsOn/validityState/derivedVia targets resolving against runtime-states / capabilities) are enforced as L3 invariants in configs/<name>/regression-invariants.test.ts and via post-overlay re-validation in graphLoader.ts, rather than being re-encoded here, because Draft-07 cannot express them.',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'semanticTypes'],
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
    semanticTypes: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/definitions/SemanticType' },
    },
    capabilities: {
      type: 'array',
      items: { $ref: '#/definitions/Capability' },
    },
    identifiers: {
      type: 'array',
      items: { $ref: '#/definitions/Identifier' },
    },
  },
  definitions: {
    SemanticType: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        '@type': {
          description: 'Optional JSON-LD type IRI. Ignored by the loader.',
          type: 'string',
        },
        name: {
          type: 'string',
          minLength: 1,
          description:
            'Semantic-type name (e.g. `ProcessDefinitionKey`). Must be unique across `semanticTypes` (checked by the loader).',
        },
        witnesses: {
          type: 'string',
          minLength: 1,
          description:
            'Name of a runtime state (`runtimeStates`) or a capability (`capabilities`) that producing a value of this semantic type implies the existence of. The cross-reference is checked at load time against the post-overlay `domain.runtimeStates` / `domain.capabilities` views.',
        },
        kind: {
          enum: ['modelDerived', 'attribute', 'serverEmergent'],
          description:
            'How the planner obtains a value for this semantic type (#162). `modelDerived` reads from a deployment artifact in the same chain. `attribute` is a free-form label minted by the planner; requires `clientMinted: true`. `serverEmergent` is a server-minted lifecycle key the client cannot pre-mint. Absent `kind` falls back to the existing planner classification chain.',
        },
        clientMinted: {
          type: 'boolean',
          description:
            'When true, values are minted by the planner / client rather than returned by a producer endpoint. Required when `kind === "attribute"` (loader-enforced).',
        },
        $comment: {
          type: 'string',
          description:
            'Optional human-readable comment. Ignored by the loader; preserved on disk so authors can leave maintenance notes alongside the entry.',
        },
      },
    },
    Capability: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'parameter'],
      properties: {
        '@type': {
          description: 'Optional JSON-LD type IRI. Ignored by the loader.',
          type: 'string',
        },
        name: {
          type: 'string',
          minLength: 1,
          description:
            'Capability name (e.g. `ModelHasServiceTaskType`). Must be unique across `capabilities` (checked by the loader).',
        },
        parameter: {
          type: 'string',
          minLength: 1,
          description: 'Parameter variable name that keys this capability (e.g. `jobType`).',
        },
        producedBy: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'OpenAPI operationIds whose successful invocation establishes this capability. Each entry must reference an op present in the bundled graph — checked as an L3 abox-vs-graph invariant.',
        },
        dependsOn: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'Prerequisite runtime states that must hold before this capability can be produced. Each entry must reference a state in `runtimeStates` (cross-ABox check enforced at load time).',
        },
      },
    },
    Identifier: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        '@type': {
          description: 'Optional JSON-LD type IRI. Ignored by the loader.',
          type: 'string',
        },
        name: {
          type: 'string',
          minLength: 1,
          description:
            'Identifier name (e.g. `ProcessDefinitionId`). Must be unique across `identifiers` (checked by the loader).',
        },
        validityState: {
          type: 'string',
          minLength: 1,
          description:
            'Runtime-state name produced when this identifier is bound. Must reference a state in `runtimeStates`. Identifiers without a `validityState` are skipped at load (mirrors the legacy `IdentifierSpec` semantics).',
        },
        boundBy: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'OpenAPI operationIds that bind this identifier (and therefore produce its `validityState`). Each entry must reference an op present in the bundled graph — checked as an L3 abox-vs-graph invariant.',
        },
        fieldPaths: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'Response field paths where the identifier value appears (e.g. `deployments[].processDefinition.processDefinitionId`). Documentary; the planner does not currently parse these.',
        },
        derivedVia: {
          type: 'string',
          minLength: 1,
          description:
            'Capability name through which this identifier is derived. Must reference a capability in `capabilities` (cross-sub-tree check enforced at load time).',
        },
      },
    },
  },
} as const;
