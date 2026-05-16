// Source of truth for the artifact-kinds ABox TBox (api-test-generator
// ontology, v1).
//
// Mirrors the pattern established by `edgeSchema.ts` (Lift 3 / #208)
// and `entityKindsSchema.ts` (Lift 4 / #210): this TypeScript module is
// the authoritative declaration; the matching
// `ontology/vocabulary/artifact-kinds.schema.json` file is generated
// from it by `scripts/build-ontology.ts` and committed solely so
// external SPARQL/SHACL/OWL consumers can fetch a plain JSON Schema by
// URL. A regression invariant in
// `configs/<config>/regression-invariants.test.ts` asserts the two are
// in sync.
//
// What this ABox encodes (Lift 5 / #212): the catalogue of *artifact
// kinds* an API can deploy and the rules that map operations and
// uploaded files to those kinds. Today (camunda-oca) this means BPMN
// processes, DMN decisions, DMN DRDs, and forms; the four sub-trees
// now live in a per-config ontology ABox.
//
// Unlike Lifts 3 and 4, the data was never sourced from upstream
// OpenAPI annotations — it has always lived in per-config data.
// Consequence: there is no `spec-vs-abox` (sense-1) drift to detect.
// Coverage gates check the durable `abox-vs-graph` (sense-2)
// invariants only (kinds reach the graph; rules reference real ops; no
// dead kinds).
//
// Four entry classes:
//
//   - `kinds`              — per-artifact-kind metadata: which runtime
//                            states every fixture of this kind delivers
//                            unconditionally (`producesStates`); which
//                            states some fixture CAN deliver
//                            (`producibleStates`, see #159); which
//                            semantic identifier-types it produces
//                            (`producesSemantics` + the singleton
//                            `identifierType`); which keys of the
//                            createDeployment response payload it
//                            populates (`deploymentSlices`).
//
//   - `semanticTypeMap`    — reverse lookup: semantic-type name →
//                            artifact-kind name. Drives "which kind
//                            produces this semantic?" lookups in the
//                            planner.
//
//   - `operationRules`     — per-operation deployment rules: which
//                            artifact kinds an op can deploy and
//                            whether they may be combined in one
//                            request (`composable: true`).
//
//   - `fileExtensionMap`   — file-extension → candidate kinds, used by
//                            the deployment-artifact selector to
//                            classify uploaded fixtures.
//
// JSON-LD (`@context`, `@type`) is accepted and preserved verbatim but
// not interpreted by the loader — same convention as the other ABoxes.

export const artifactKindsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://camunda.github.io/api-test-generator/ns/v1/artifact-kinds.schema.json',
  title: 'Artifact-kinds ABox (api-test-generator ontology, v1)',
  description:
    'TBox JSON Schema for an ABox file describing the artifact kinds an API can deploy plus the rules that classify operations and uploaded files into those kinds. Each entry asserts: an artifact kind exists with a stable identifier-type and deployment-slice list; a semantic-type maps to a single artifact kind; an operation deploys one or more artifact kinds (optionally composable); a file extension classifies as one or more candidate kinds. The schema is intentionally agnostic to which API ships the kinds — instance-data lives in the per-config ABox file (e.g. configs/camunda-oca/ontology/artifact-kinds.json). The optional top-level `@context` and per-entry `@type` are JSON-LD metadata only; no runtime in this repo interprets them, but they are reserved so an external SPARQL/SHACL consumer can ingest the file unchanged. Cross-references against the bundled spec (operationIds existing, artifact kind names being internally consistent across rules / semanticTypeMap / fileExtensionMap, kinds being referenced by some entry) are enforced as L3 invariants in configs/<name>/regression-invariants.test.ts rather than being re-encoded here, because Draft-07 cannot express them. Cross-references against sibling ontology sub-trees (`runtimeStates` / `semanticTypes`) referenced via `producesStates`, `producibleStates`, and `producesSemantics` are re-validated at load time by re-running `validateDomainSemantics` against `graph.domain` — see `graphLoader.ts`.',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'kinds', 'semanticTypeMap', 'operationRules', 'fileExtensionMap'],
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
      items: { $ref: '#/definitions/ArtifactKind' },
    },
    semanticTypeMap: {
      type: 'array',
      items: { $ref: '#/definitions/SemanticTypeMapping' },
    },
    operationRules: {
      type: 'array',
      items: { $ref: '#/definitions/OperationArtifactRule' },
    },
    fileExtensionMap: {
      type: 'array',
      items: { $ref: '#/definitions/FileExtensionMapping' },
    },
  },
  definitions: {
    ArtifactKind: {
      type: 'object',
      additionalProperties: false,
      required: [
        'name',
        'identifierType',
        'producesSemantics',
        'producesStates',
        'deploymentSlices',
        'description',
      ],
      properties: {
        '@type': {
          description: 'Optional JSON-LD type IRI. Ignored by the loader.',
          type: 'string',
        },
        name: {
          type: 'string',
          pattern: '^[a-z][A-Za-z0-9]+$',
          description: 'camelCase noun naming the artifact kind (e.g. `bpmnProcess`, `dmnDrd`).',
        },
        identifierType: {
          type: 'string',
          minLength: 1,
          description:
            'Semantic identifier-type produced by deploying this kind (e.g. `ProcessDefinitionId`).',
        },
        producesStates: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'Runtime states EVERY fixture of this kind delivers unconditionally on a successful deployment (e.g. `ProcessDefinitionDeployed`).',
        },
        producibleStates: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'Runtime states SOME fixture of this kind CAN deliver, conditional on which checked-in file the selector picks (#159). The planner reads `producesStates ∪ producibleStates` for chain-feasibility BFS; the per-fixture `providesStates` in `configs/<config>/fixtures/deployment-artifacts.json` then narrows the choice at emission time. Optional — omit when no fixture offers any optional state.',
        },
        producesSemantics: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'Semantic identifier-types this kind produces (typically a single-element list containing the canonical key type, e.g. `ProcessDefinitionKey`).',
        },
        deploymentSlices: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
          description:
            'Top-level keys of the createDeployment response payload that this kind populates (e.g. `["processDefinition"]`, or `["decisionDefinition", "decisionRequirements"]` for a kind whose deployment yields two slices).',
        },
        modelKind: {
          type: 'string',
          minLength: 1,
          description:
            'Optional discriminator naming the `GeneratedModelSpec` variant the planner should construct when this kind is selected (Lift 10 / #227). Conventional values: `bpmn`, `form`. The planner consults this field via the ABox to pick the model-spec shape, replacing hard-coded semantic→kind comparisons in `ensureArtifactBindings`. Until the `GeneratedModelSpec` discriminated union is generalised (Lift 13), only the conventional values produce model-spec entries; other values are silently ignored by the model-spec construction step.',
        },
        description: {
          type: 'string',
          minLength: 1,
        },
      },
    },
    SemanticTypeMapping: {
      type: 'object',
      additionalProperties: false,
      required: ['semanticType', 'artifactKind'],
      properties: {
        '@type': {
          description: 'Optional JSON-LD type IRI. Ignored by the loader.',
          type: 'string',
        },
        semanticType: {
          type: 'string',
          minLength: 1,
          description:
            'Semantic identifier-type name (e.g. `ProcessDefinitionKey`). Reverse-mapped to the artifact kind that produces it.',
        },
        artifactKind: {
          type: 'string',
          minLength: 1,
          description:
            'Name of the artifact kind that produces this semantic type. Must reference an entry in `kinds`.',
        },
      },
    },
    OperationArtifactRule: {
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
            'OpenAPI operationId of the deploy operation (e.g. `createDeployment`). Must reference a real op in the bundled spec — checked as an L3 abox-vs-graph invariant.',
        },
        composable: {
          type: 'boolean',
          description:
            'When true, the planner may compose multiple `rules` into a single deployment request via set-cover (e.g. `createDeployment` accepts a multi-file payload). Optional — mirrors the legacy `OperationArtifactRuleSpec.composable` contract; absence is treated as `false` by the planner.',
        },
        role: {
          type: 'string',
          minLength: 1,
          description:
            'Optional ontological role this operation plays in the API surface. Used by the planner and Playwright emitter to discriminate special-case behaviour (e.g. multipart deployment routing) against the ABox instead of against a hard-coded operationId. Conventional values include `deploymentGateway` (the multipart deploy operation whose response surfaces deployed artifact identifiers). Lift 9 / #225: introduced to retire ~20 hard-coded `=== "createDeployment"` literals across `path-analyser/src/{scenarioGenerator,index,codegen/playwright/emitter}.ts`.',
        },
        rules: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/definitions/ArtifactRule' },
          description:
            'Optional list of artifact rules for this operation. Mirrors the legacy `OperationArtifactRuleSpec.rules` contract — an entry with no `rules` is permitted so a future composable-only opcode can declare itself without listing concrete rules.',
        },
      },
    },
    ArtifactRule: {
      type: 'object',
      additionalProperties: false,
      required: ['artifactKind'],
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          description:
            'Optional stable identifier for this rule within its operation (e.g. `bpmn`, `dmn`). Used by the scenario emitter to reference a specific rule. Mirrors the legacy `ArtifactRule.id` contract — when present it must be unique within the operation (checked by the loader).',
        },
        artifactKind: {
          type: 'string',
          minLength: 1,
          description:
            'Name of the artifact kind this rule deploys. Must reference an entry in `kinds`.',
        },
        priority: {
          type: 'integer',
          description:
            'Optional priority hint for the planner: lower number = higher priority. Mirrors the legacy `ArtifactRule.priority` contract.',
        },
        producesSemantics: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'Optional explicit override of the semantic types this rule produces. When omitted, the planner derives the list from `kinds[artifactKind].producesSemantics` and `semanticTypeMap`. Mirrors the legacy `ArtifactRule.producesSemantics` contract.',
        },
        producesStates: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description:
            'Optional additional domain states this rule produces beyond the kind-level `producesStates`. Mirrors the legacy `ArtifactRule.producesStates` contract.',
        },
      },
    },
    FileExtensionMapping: {
      type: 'object',
      additionalProperties: false,
      required: ['extension', 'artifactKinds'],
      properties: {
        '@type': {
          description: 'Optional JSON-LD type IRI. Ignored by the loader.',
          type: 'string',
        },
        extension: {
          type: 'string',
          pattern: '^\\.[a-z0-9]+$',
          description: 'Lowercase file extension including the leading dot (e.g. `.bpmn`, `.dmn`).',
        },
        artifactKinds: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
          description:
            'Candidate artifact kinds for files with this extension. Multiple entries express ambiguity (e.g. `.dmn` may carry a single decision or a full DRD); the selector then disambiguates per-fixture. Each entry must reference a name in `kinds`.',
        },
      },
    },
  },
} as const;
