// Source of truth for the scenario-template ABox TBox
// (api-test-generator ontology, v1).
//
// Mirrors the pattern established by `edgeSchema.ts` (Lift 3 / #208) and
// the other Lift-N TBox sources: this TypeScript module is the
// authoritative declaration; the matching
// `ontology/vocabulary/scenario-template.schema.json` file is generated
// from it by `scripts/build-ontology.ts` (run via `npm run
// build:ontology`) and committed solely so external SPARQL/SHACL/OWL
// consumers can fetch a plain JSON Schema by URL. A regression
// invariant in `configs/<config>/regression-invariants.test.ts` asserts
// the two are in sync.
//
// What this ABox encodes (#268 Phase 1 / #269): scenario *templates* —
// declarative, ordered lists of test steps that the planner instantiates
// against subjects from another ABox (initially: edges, from #224 +
// #208). The dependency graph encodes which operations belong in a
// scenario and in what order (a data-flow property); templates encode
// what to assert between or after those operations (a temporal/modal
// property the graph fundamentally cannot express).
//
// Initial template surface (Phase 1, encoding only — no planner
// consumption yet, see follow-up #270):
//   - `PrereqChain { for: <edge-op-role> }`  — graph-derived; planner
//     fills this in by running its existing BFS targeted at the edge's
//     named operation role.
//   - `Invoke { op: <edge-op-role> }`        — invoke the operation
//     named by the edge role (`establishedBy` or `revokedBy`).
//   - `Observe { op: <edge-op-role>,         — invoke the observation
//        expect: present | absent }`           operation and assert the
//                                              edge instance is (still)
//                                              present in / absent from
//                                              the result set.
//
// `op` and `for` are *role* references, not raw operationIds. The role
// is a field name on the subject ABox entry (`establishedBy`,
// `revokedBy`, `observableVia` for edges). The planner resolves the
// role against the subject ABox at instantiation time. This keeps
// templates portable across edges within a config and across configs.
//
// Cross-references against the spec / other ABoxes (does the role
// resolve, does the observation op's response actually carry the
// membership semantic type inside an array, etc) are encoded as L3
// invariants in `configs/<name>/regression-invariants.test.ts` — same
// design as #224. Draft-07 cannot express them, and a generic schema
// error wouldn't point at the broken edge × template pair anyway.

export const scenarioTemplateSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://camunda.github.io/api-test-generator/ns/v1/scenario-template.schema.json',
  title: 'ScenarioTemplatesAbox',
  description:
    'TBox JSON Schema for an ABox file describing scenario templates — declarative ordered lists of test steps the planner instantiates against subjects from another ABox (currently: edges). Each template asserts: a unique name; an `appliesTo` discriminator naming the subject ABox; a non-empty step list. Steps are a tagged union of PrereqChain (graph-derived prereqs targeted at a named subject role), Invoke (invocation of an operation named by a subject role), and Observe (invocation of an observation operation + a high-level expectation that an edge instance is present in or absent from the result set). The schema is intentionally agnostic to which subjects exist — instance-data lives in the per-config ABox file (e.g. configs/camunda-oca/ontology/scenario-templates.json). The optional top-level `@context` and per-entry `@type` are JSON-LD metadata only; no runtime in this repo interprets them, but they are reserved so an external SPARQL/SHACL consumer can ingest the file unchanged. Cross-references (subject-role names actually being fields on the referenced subject ABox; observation ops actually carrying the membership semantic type inside an array of their response) are enforced as L3 invariants in configs/<name>/regression-invariants.test.ts rather than being re-encoded here, because Draft-07 cannot express them.',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'templates'],
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
    templates: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/definitions/ScenarioTemplate' },
    },
  },
  definitions: {
    ScenarioTemplate: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'appliesTo', 'steps'],
      properties: {
        '@type': {
          description: 'Optional JSON-LD type IRI. Ignored by the loader.',
          type: 'string',
        },
        name: {
          type: 'string',
          pattern: '^[A-Z][A-Za-z0-9]+$',
          description:
            'PascalCase singular noun naming the template. Must be unique within the ABox (checked by the loader; Draft-07 cannot express uniqueness).',
        },
        appliesTo: {
          $ref: '#/definitions/AppliesTo',
        },
        steps: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/definitions/Step' },
          description:
            'Ordered list of steps. Executed top-to-bottom by the planner / emitter at instantiation time.',
        },
        description: {
          type: 'string',
          minLength: 1,
          description:
            'Maintainer-facing prose explaining what behaviour this template asserts and why it is encoded as a template (vs. baked into the planner).',
        },
      },
    },
    AppliesTo: {
      description:
        'Discriminator naming the subject ABox the template is instantiated against. `Edge` instantiates against the edges ABox (#269 Phase 1). `Entity` (#280) instantiates against the entity-kinds ABox, restricted to `shape: "entity"` rows (those carry the required `establishedBy`/`observableVia`/`revokedBy` triple). `RuntimeEntity` (#305 Phase 4) also instantiates against the entity-kinds ABox, but restricted to `shape: "runtime-entity"` rows (which carry `mutators[]` + `fetcher` instead of the CRUD triple). Extending the union is how future subject ABoxes (resources, state-transitions, …) opt in to template-driven scenario emission.',
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: {
          type: 'string',
          enum: ['Edge', 'Entity', 'RuntimeEntity'],
        },
      },
    },
    Step: {
      description:
        'A single step in a scenario template. Tagged union on `kind`; each variant declares only the fields it consumes.',
      oneOf: [
        { $ref: '#/definitions/PrereqChainStep' },
        { $ref: '#/definitions/InvokeStep' },
        { $ref: '#/definitions/ObserveStep' },
      ],
    },
    PrereqChainStep: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'for'],
      properties: {
        kind: { type: 'string', const: 'PrereqChain' },
        for: {
          type: 'string',
          minLength: 1,
          description:
            "Subject-role name (e.g. `establishedBy`). At instantiation time the planner resolves this to the subject's operationId and runs its existing BFS targeted at that operation, materializing all upstream producers as preceding steps.",
        },
      },
    },
    InvokeStep: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'op'],
      properties: {
        kind: { type: 'string', const: 'Invoke' },
        op: {
          type: 'string',
          minLength: 1,
          description:
            "Subject-role name (e.g. `establishedBy` or `revokedBy`). At instantiation time the planner resolves this to the subject's operationId and emits an invocation whose inputs are drawn from the scenario binding context built up by any preceding PrereqChain step.",
        },
      },
    },
    ObserveStep: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'op', 'expect'],
      properties: {
        kind: { type: 'string', const: 'Observe' },
        op: {
          type: 'string',
          minLength: 1,
          description:
            "Subject-role name (e.g. `observableVia`, `fetcher`). At instantiation time the planner resolves this to the subject's observation operationId, invokes it, and asserts on the response per `expect`. The concrete assertion shape is chosen by `appliesTo.kind` × `expect`: for `Edge` + `present|absent` it is a projection-search membership check (`toContain` / `not.toContain` on the configured array path); for `Entity` (#280) + `present|absent` it is a get-by-id status check (`expect: 'present'` → status 200; `expect: 'absent'` → status 404); for `RuntimeEntity` (#305 Phase 4) + `fieldEquals` it is a per-field equality check on the fetcher 200 response against the values emitted by the preceding mutator request body.",
        },
        expect: {
          type: 'string',
          enum: ['present', 'absent', 'fieldEquals'],
          description:
            "High-level observation predicate. `present`/`absent` assert the subject instance is/is not visible to the observer (compiled to membership or status assertions per `appliesTo.kind`). `fieldEquals` (#305 Phase 4) asserts that every field present in the preceding mutator's emitted request body is reflected unchanged in the fetcher's 200 response; only valid for `appliesTo.kind: \"RuntimeEntity\"` templates that include an Observe-after-Invoke pattern. The concrete list of fields is derived at instantiation time by intersecting the mutator request body's semantic-typed leaves with the fetcher 200 response's semantic-typed leaves — no field selector lives in the template ABox.",
        },
      },
    },
  },
} as const;
