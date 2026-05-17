// Source of truth for the runtime-states ABox TBox (api-test-generator
// ontology, v1).
//
// Mirrors the pattern established by `edgeSchema.ts` (Lift 3 / #208),
// `entityKindsSchema.ts` (Lift 4 / #210), and `artifactKindsSchema.ts`
// (Lift 5 / #212): this TypeScript module is the authoritative
// declaration; the matching
// `ontology/vocabulary/runtime-states.schema.json` file is generated
// from it by `scripts/build-ontology.ts` and committed solely so
// external SPARQL/SHACL/OWL consumers can fetch a plain JSON Schema by
// URL. A regression invariant in
// `configs/<config>/regression-invariants.test.ts` asserts the two are
// in sync.
//
// What this ABox encodes (Lift 6 / #214): the catalogue of *runtime
// states* a deployed API surfaces, plus the per-operation
// requirements that reference them. The two sub-trees co-locate in
// one ABox because `operationRequirements` cross-references state
// names declared in `states` (in `requires`/`implicitAdds`/`produces`
// and in `valueBindings` RHS). Splitting them would let one drift
// from the other; co-locating makes the cross-reference a single
// ABox-level invariant rather than an inter-file one.
//
// Like Lift 5, the data was never sourced from upstream OpenAPI
// annotations — it has always lived in per-config ontology data.
// Consequence: there is no `spec-vs-abox` (sense-1) drift to detect.
// Coverage gates check the durable `abox-vs-graph` (sense-2)
// invariants only (states reach the graph; ops reference real ops; no
// dead states).
//
// Two entry classes:
//
//   - `states`               — per-runtime-state metadata: how the
//                              state is keyed (`parameter` /
//                              `parameters`); which ops produce it
//                              (`producedBy`); which other states are
//                              prerequisites (`requires`); whether it
//                              lags asynchronously behind the
//                              producer's response (`eventual` +
//                              `witness`, see #159 PR B).
//
//   - `operationRequirements` — per-operation requirement metadata:
//                              required prerequisite states
//                              (`requires`), disjunctive alternatives
//                              (`disjunctions`), states implicitly
//                              produced on success (`implicitAdds`),
//                              explicit producer overrides
//                              (`produces`), and request/response
//                              field bindings to state parameters or
//                              semantic types (`valueBindings`).
//
// JSON-LD (`@context`, `@type`) is accepted and preserved verbatim but
// not interpreted by the loader — same convention as the other ABoxes.

export const runtimeStatesSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://camunda.github.io/api-test-generator/ns/v1/runtime-states.schema.json',
  title: 'Runtime-states ABox (api-test-generator ontology, v1)',
  description:
    'TBox JSON Schema for an ABox file describing the runtime states a deployed API surfaces, plus the per-operation requirements that reference those states. Each entry asserts: a runtime state exists with a known parameter shape and producer set; an operation requires (or produces, or binds values from) a set of states. The schema is intentionally agnostic to which API ships the states — instance-data lives in the per-config ABox file (e.g. configs/camunda-oca/ontology/runtime-states.json). The optional top-level `@context` and per-entry `@type` are JSON-LD metadata only; no runtime in this repo interprets them, but they are reserved so an external SPARQL/SHACL consumer can ingest the file unchanged. Cross-references against the bundled spec (operationIds existing, state names being internally consistent across `producedBy`, `requires`, `implicitAdds`, `produces`, `valueBindings`, `requires`-chains terminating, no orphan states) are enforced as L3 invariants in configs/<name>/regression-invariants.test.ts rather than being re-encoded here, because Draft-07 cannot express them. Cross-references against sibling ontology sub-trees (`semanticTypes` / `capabilities`) that this ABox transitively references via `valueBindings` RHS like `semantic:ProcessDefinitionKey` or via `requires`-of-capability entries are re-validated at load time by re-running `validateDomainSemantics` against `graph.domain` — see `graphLoader.ts`.',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'states', 'operationRequirements'],
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
    states: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/definitions/RuntimeState' },
    },
    operationRequirements: {
      type: 'array',
      items: { $ref: '#/definitions/OperationRequirement' },
    },
  },
  definitions: {
    RuntimeState: {
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
            'PascalCase name of the runtime state (e.g. `ProcessDefinitionDeployed`). Must be unique across `states` (checked by the loader).',
        },
        parameter: {
          type: 'string',
          minLength: 1,
          description:
            'Single-parameter name that keys this state (e.g. `processDefinitionId`). Mutually exclusive with `parameters` — exactly one of `parameter` or `parameters` should be present (the loader does not enforce the XOR; presence is documentary).',
        },
        parameters: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
          description:
            'Multi-parameter list that jointly keys this state (e.g. `["jobType", "processDefinitionId"]`). Mutually exclusive with `parameter`.',
        },
        producedBy: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'OpenAPI operationIds whose successful invocation establishes this state. Each entry must reference an op present in the bundled graph — checked as an L3 abox-vs-graph invariant.',
        },
        requires: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'Prerequisite states that must hold before this state can be produced. Each entry must reference another state in `states` or a capability declared in the semantics ABox.',
        },
        eventual: {
          type: 'boolean',
          description:
            'When true, the state is not immediately observable on the producer response — the planner inserts an `awaitEventually(witness)` wait before any consumer step (#159 PR B). Requires `witness`.',
        },
        witness: {
          $ref: '#/definitions/WitnessSpec',
          description:
            'Witness used by `awaitEventually` when `eventual === true`. The witness invokes a read-shape operation and polls until the predicate holds against the response body.',
        },
      },
    },
    WitnessSpec: {
      type: 'object',
      additionalProperties: false,
      required: ['operationId', 'predicate'],
      properties: {
        operationId: {
          type: 'string',
          minLength: 1,
          description:
            'Operation invoked to observe the state. Must reference a real operationId in the graph (PR B constrains this to GET-shape ops).',
        },
        predicate: { $ref: '#/definitions/WitnessPredicate' },
        waitUpToMs: {
          type: 'integer',
          minimum: 1,
          description:
            'Optional total wait budget in ms; defaults to the awaitEventually helper built-in.',
        },
        pollIntervalMs: {
          type: 'integer',
          minimum: 1,
          description:
            'Optional poll interval in ms; defaults to the awaitEventually helper built-in.',
        },
      },
    },
    WitnessPredicate: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'equals'],
      properties: {
        path: {
          type: 'string',
          pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$',
          description:
            'Top-level field on the response body. Constrained so the emitter can render it as a safe bracket-access key without an escape pass.',
        },
        equals: {
          description:
            'Expected scalar compared with strict equality. The emitter JSON-stringifies it directly, so it is constrained to JSON primitives.',
          type: ['string', 'number', 'boolean'],
        },
      },
    },
    OperationRequirement: {
      type: 'object',
      additionalProperties: false,
      required: ['operationId'],
      properties: {
        '@type': {
          description: 'Optional JSON-LD type IRI. Ignored by the loader.',
          type: 'string',
        },
        operationId: {
          type: 'string',
          minLength: 1,
          description:
            'OpenAPI operationId. Must reference a real op in the bundled graph — checked as an L3 abox-vs-graph invariant.',
        },
        requires: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'States that must hold before invoking this op. Each entry must reference a state in `states` or a capability in the semantics ABox.',
        },
        disjunctions: {
          type: 'array',
          items: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
          },
          description:
            'Sets of alternative prerequisites — at least one entry from each disjunction must hold. Each entry resolves the same way as `requires`.',
        },
        implicitAdds: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'States produced implicitly on success (in addition to whatever the upstream API documents). Each entry must reference a state in `states`.',
        },
        produces: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            "Explicit producer override (rare — used when a state is produced by an op that does not appear in the state's `producedBy`). Each entry must reference a state in `states`.",
        },
        chainCleanupRequires: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'Post-condition hygiene states the chain should leave in place after this op runs, but which are NOT preconditions to invoking it (#249). Distinct from `requires` because the BFS scenario planner deliberately ignores this field — it never gates feasibility, never schedules a producer op, and never filters the op out. The fixture selector unions these states into the deployment-gateway requirement set so a fixture that provides them is preferred; subsequent ops in the chain whose `produces` / `implicitAdds` cover the state discharge the hygiene requirement. Encodes \'this op creates a resource that should be driven to a terminal state by test end\' — e.g. `createProcessInstance.chainCleanupRequires: ["ProcessInstanceCompleted"]` makes the base scenario deploy a self-completing fixture instead of leaving an orphan running instance.',
        },
        valueBindings: {
          type: 'object',
          additionalProperties: { type: 'string', minLength: 1 },
          description:
            'Map from request/response field path (e.g. `request.processDefinitionId`, `response.processInstanceKey`) to either `<StateName>.<parameter>` (resolves at emission to the value bound for that parameter when the state was produced) or `semantic:<SemanticTypeName>` (resolves to the semantic-type producer chain — semanticTypes migrate in Lift 7).',
        },
      },
    },
  },
} as const;
