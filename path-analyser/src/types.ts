export interface OperationRef {
  operationId: string;
  method: string;
  path: string;
  eventuallyConsistent?: boolean;
}

export interface OperationNode extends OperationRef {
  requires: {
    required: string[];
    optional: string[];
  };
  produces: string[];
  edges?: string[]; // adjacency (if present in graph)
  // Map of semantic type -> whether this operation is an authoritative provider for it
  providerMap?: Record<string, boolean>;
  eventuallyConsistent?: boolean; // indicates need to await stabilization after invocation
  // Domain augmentation (optional)
  domainRequiresAll?: string[]; // additional domain state requirements (strict)
  domainDisjunctions?: string[][]; // each inner array: satisfy at least one
  domainProduces?: string[]; // domain states/capabilities produced
  domainImplicitAdds?: string[]; // implicit states added on success
  // Operation metadata vendor extension passthrough (from semantic graph extractor)
  operationMetadata?: {
    kind?: string;
    duplicatePolicy?: string; // e.g. conflict | ignore | overwrite
    idempotent?: boolean;
  };
  // Conditional idempotency spec (vendor extension x-conditional-idempotency)
  conditionalIdempotency?: {
    keyFields: string[];
    window: { field: string; unit: string };
    duplicatePolicy: string; // e.g. ignore
    appliesWhen: string; // e.g. key-present
  };
  // Response semantic-type entries keyed by status code, sourced from the
  // semantic-graph extractor. Each entry captures the field path (which may
  // be nested, e.g. `metadata.processInstanceKey`) and the semantic type
  // produced by that field on a 2xx response.
  responseSemanticTypes?: Record<
    string,
    { semanticType: string; fieldPath: string; required?: boolean }[]
  >;
  // Path parameters with their declared `x-semantic-type`. Used by
  // `buildRequestPlan` to alias producer extracts under the
  // placeholder-derived var name when an OpenAPI path-param's name differs
  // from its semanticType (issue #61). Populated in graphLoader from the
  // raw operation node.
  pathParameters?: { name: string; semanticType?: string }[];
  // Issue #37: optional sub-shape grouping for variant-scenario planning.
  // Derived from request-body semantic leaves whose `fieldPath` shares an
  // optional object/array-of-object ancestor (e.g. `startInstructions[]`
  // groups `startInstructions[].elementId`). Each entry lists the
  // semantic-typed leaves under that root. Variant planning emits one
  // positive scenario per (rootPath, leaf) pair to exercise the populated
  // shape that base scenarios skip.
  optionalSubShapes?: Array<{
    rootPath: string; // e.g. "startInstructions[]"
    leaves: Array<{ fieldPath: string; semantic: string }>;
  }>;
  // Issue #37: full response-leaf semantic catalog (success-status only).
  // Includes both authoritative (provider:true) and incidental
  // (provider:false) entries, so variant planning can route ElementId via
  // `searchElementInstances.items[].elementId` even though that op's
  // authoritative outputs are page cursors. After #98 the `produces` field
  // contains only authoritative outputs (provider:true); this catalog
  // remains the inclusive view used for variant-only planning.
  responseSemanticLeaves?: Array<{
    semantic: string;
    fieldPath: string;
    status: string;
    provider: boolean;
  }>;
  // Issue #104: x-semantic-establishes annotation passthrough. When
  // present, the operation establishes an entity whose identifiers are
  // client-minted via the listed request inputs. The planner schedules
  // this op as a satisfier for each `identifiedBy[].semanticType` with
  // a fresh shared binding written into both this step's request body /
  // path param and any downstream consumer that reads the same
  // semantic. Distinct from `producersByType` semantics: an establisher
  // does not authoritatively *return* a value, it merely registers an
  // identifier the client supplied.
  establishes?: {
    kind: string;
    shape?: string;
    identifiedBy: Array<{ in: 'body' | 'path'; name: string; semanticType: string }>;
  };
}

export interface OperationGraph {
  operations: Record<string, OperationNode>;
  producersByType: Record<string, string[]>;
  // Issue #37: parallel producer index that includes ALL response-leaf
  // semantics (provider:true and provider:false). Used by the variant
  // planner to discover non-authoritative producers (e.g.
  // searchElementInstances → ElementId via items[].elementId) without
  // affecting base-scenario planning, which still consults
  // `producersByType` (authoritative outputs only after #98).
  responseProducersByType?: Record<string, string[]>;
  bootstrapSequences?: BootstrapSequence[];
  domain?: DomainSemantics; // loaded sidecar
  producersByState?: Record<string, string[]>; // domain state -> operations
  // Issue #104: parallel index of operations that *establish* a semantic
  // type via x-semantic-establishes (i.e. the value is client-minted
  // and written into the request rather than returned in the response).
  // Establishers are intentionally KEPT OUT of `producersByType` so that
  // index continues to mean "authoritative producer only" (the contract
  // variant planning, provider preference, and missing-producer
  // diagnostics rely on after #98). Planner code that needs to schedule
  // an establisher as a satisfier consults `establishersByType` directly
  // — see `scenarioGenerator.generateScenariosForEndpoint`. Per-op
  // satisfaction tracking still works because the synthesised semantic
  // remains on `OperationNode.produces`, which BFS reads to mark the
  // identifier semantic satisfied once the establisher is scheduled.
  establishersByType?: Record<string, string[]>;
}

export interface BootstrapSequence {
  name: string;
  description?: string;
  operations: string[]; // ordered operationIds
  produces: string[]; // declared semantic types produced by the full sequence
}

export interface EndpointScenario {
  id: string;
  name?: string; // human-friendly short name
  description?: string; // human-readable description of scenario intent & composition
  operations: OperationRef[]; // ordered (final endpoint last)
  producedSemanticTypes: string[];
  satisfiedSemanticTypes: string[]; // semantic types endpoint needs
  missingSemanticTypes?: string[]; // only for unsatisfied scenario
  cycleInvolved?: boolean;
  productionMap?: Record<string, string>; // semanticType -> operationId
  providerList?: Record<string, string[]>; // semanticType -> all producing opIds encountered
  bootstrapSequencesUsed?: string[]; // names of bootstrap sequences contributing
  bootstrapFull?: boolean; // true if a single bootstrap sequence satisfied all required semantic types
  hasEventuallyConsistent?: boolean; // true if any operation in chain is eventually consistent
  eventuallyConsistentCount?: number; // count of operations in chain that are eventually consistent
  // Domain scenario augmentation
  domainStatesProduced?: string[]; // domain states realized along chain
  domainStatesRequired?: string[]; // domain states required (flattened)
  models?: GeneratedModelSpec[]; // synthesized models needed
  bindings?: Record<string, string>; // symbolic variable bindings for identifiers / types
  artifactsApplied?: string[]; // ids of artifact rules applied
  eventualConsistencyOps?: string[]; // operationIds that are eventually consistent in chain
  // Feature coverage strategy additions
  strategy?: 'integrationPath' | 'featureCoverage' | 'optionalSubShapeVariant';
  variantKey?: string; // structured key summarizing variant dimensions
  expectedResult?: { kind: 'nonEmpty' | 'empty' | 'error'; code?: string };
  coverageTags?: string[]; // dimension tags e.g. optional:FormKey, disjunction:alt-1
  // Issue #37: which optional sub-shape this variant populates and which
  // semantic-typed leaves it sets (one leaf per variant in iteration 1).
  // Codegen uses this to synthesize the populated body.
  populatesSubShape?: {
    rootPath: string; // e.g. "startInstructions[]"
    leafPaths: string[]; // semantic-typed leaves to populate
    leafSemantics: string[]; // matching semantic types in same order
  };
  filtersUsed?: string[]; // semantic / parameter filters applied
  syntheticBindings?: string[]; // variables created without a producing op
  // Request variant / filter coverage enrichments
  requestVariants?: { groupId: string; variant: string; richness: 'minimal' | 'rich' }[];
  filtersDetail?: FilterDetail[]; // structured filter dimension info
  // Response shape (for future assertion synthesis)
  responseShapeSemantics?: string[]; // semantic types inferred from response fields
  responseShapeFields?: {
    name: string;
    type: string;
    semantic?: string;
    required?: boolean;
    nullable?: boolean;
  }[];
  // Nested slice field shapes keyed by slice name for deep assertions
  responseNestedSlices?: Record<
    string,
    { name: string; type: string; required?: boolean; nullable?: boolean }[]
  >;
  // Nested array item field shapes keyed by top-level array field name (e.g., jobs -> fields on jobs[0])
  responseArrayItemFields?: Record<
    string,
    { name: string; type: string; required?: boolean; nullable?: boolean }[]
  >;
  requestPlan?: RequestStep[]; // concrete request assembly plan per operation (ordered)
  // Duplicate invocation testing (for conditional idempotency / duplicatePolicy conflict)
  duplicateTest?: {
    mode: 'conditional' | 'conflict';
    policy: string; // duplicatePolicy value
    secondStatus?: number; // expected status of second (final) call
    keyFields?: string[]; // key fields driving duplication
    windowField?: string; // name of TTL window field if conditional
  };
}

export interface EndpointScenarioCollection {
  endpoint: OperationRef;
  requiredSemanticTypes: string[];
  optionalSemanticTypes: string[];
  scenarios: EndpointScenario[];
  unsatisfied?: boolean;
}

export interface GenerationSummaryEntry {
  operationId: string;
  method: string;
  path: string;
  scenarioCount: number;
  unsatisfied: boolean;
  missingSemanticTypes?: string[];
}

// Feature coverage variant spec (internal planning structure)
export interface FeatureVariantSpec {
  endpointId: string;
  optionals: string[]; // optional semantics included
  disjunctionChoices: string[]; // chosen element per disjunction group (flattened)
  artifactSemantics: string[]; // semantics that require artifact production
  negative?: boolean; // expect empty or error
  expectedResult: 'nonEmpty' | 'empty' | 'error';
  requestVariantGroup?: string; // oneOf group id
  requestVariantName?: string; // specific variant id/name
  requestVariantRichness?: 'minimal' | 'rich';
  // Artifact deployment coverage (from domain.operationArtifactRules)
  artifactRuleId?: string; // e.g., 'bpmn' | 'form' | 'dmn' | 'drd'
  artifactKind?: string; // e.g., 'bpmnProcess' | 'form' | 'dmnDecision' | 'dmnDrd'
  // Duplicate invocation variant (adds a second call of endpoint within scenario)
  duplicateTest?: {
    mode: 'conditional' | 'conflict';
    policy: string;
    secondStatus?: number;
  };
}

export interface GenerationSummary {
  generatedAt: string;
  nodeVersion: string;
  endpoints: GenerationSummaryEntry[];
}

// -------- Response schema extraction ---------

export interface ResponseShapeField {
  name: string;
  type: string; // string|integer|boolean|object|array|unknown
  required?: boolean;
  // Whether the field is nullable per OpenAPI spec (`nullable: true`).
  // Propagated end-to-end so the emitter can guard type assertions against
  // legitimate `null` values instead of failing on them.
  nullable?: boolean;
  semantic?: string; // mapped semantic type if recognized
  elementType?: string; // for arrays
  objectRef?: string; // referenced schema name
}

export interface ResponseShapeSummary {
  operationId: string;
  contentTypes: string[];
  fields: ResponseShapeField[]; // flattened top-level fields
  producedSemantics?: string[];
  successStatus?: number; // primary success HTTP status code
  // Optional nested slice shapes, keyed by slice name
  nestedSlices?: Record<string, ResponseShapeField[]>;
  // Optional nested item shapes for top-level arrays, keyed by array field name
  nestedItems?: Record<string, ResponseShapeField[]>;
}

// -------- Request oneOf variant extraction ---------

export interface RequestOneOfVariant {
  groupId: string;
  variantName: string;
  required: string[];
  optional: string[];
  discriminator?: { field: string; value: string };
}

export interface RequestOneOfGroupSummary {
  operationId: string;
  groupId: string;
  variants: RequestOneOfVariant[];
  unionFields: string[]; // all distinct field names across variants
}

export interface ExtractedRequestVariantsIndex {
  byOperation: Record<string, RequestOneOfGroupSummary[]>;
}

export interface RequestStep {
  operationId: string;
  method: string;
  pathTemplate: string;
  pathParams?: { name: string; var: string }[];
  bodyTemplate?: unknown; // object with ${var} placeholders
  bodyKind?: 'json' | 'multipart';
  multipartTemplate?: unknown; // object suitable for Playwright multipart option
  expect: { status: number };
  extract?: { fieldPath: string; bind: string; semantic?: string; note?: string }[];
  notes?: string;
  // Optional: expected slices in deployments[] for createDeployment responses, derived from domain sidecar
  expectedDeploymentSlices?: string[];
}

// Filter dimension details for feature coverage
export interface FilterDetail {
  field: string;
  operator: string;
  valueVar: string | string[];
  negative?: boolean;
}

// -------- Domain semantics sidecar ---------

export interface DomainSemantics {
  version: number;
  identifiers?: Record<string, IdentifierSpec>;
  capabilities?: Record<string, CapabilitySpec>;
  runtimeStates?: Record<string, RuntimeStateSpec>;
  operationRequirements?: Record<string, OperationDomainRequirements>;
  artifactKinds?: Record<string, ArtifactKindSpec>;
  semanticTypeToArtifactKind?: Record<string, string>;
  operationArtifactRules?: Record<string, OperationArtifactRuleSpec>;
  artifactFileKinds?: Record<string, string[]>; // extension -> artifactKind[]
  // #70: declarative witness edges from semantic types (key-shaped values)
  // to the runtime states or capabilities they imply. Producing a value of
  // semantic type T witnesses the existence of state `semanticTypes[T].witnesses`.
  // The loader uses this to populate producersByState from producersByType.
  semanticTypes?: Record<string, SemanticTypeSpec>;
  // #87: bindings that every emitted scenario must seed before its request
  // plan runs (e.g. the default-tenant identifier under single-tenant mode).
  // The Playwright emitter consumes this list to derive its universal-seed
  // logic so the codegen layer carries no hard-coded bind names or sentinel
  // values.
  globalContextSeeds?: GlobalContextSeed[];
}

/**
 * One entry in {@link DomainSemantics.globalContextSeeds}. Drives the
 * Playwright emitter's per-scenario seed prologue: for every entry the
 * emitter writes an `if (ctx['<binding>'] === undefined) { ctx['<binding>'] =
 * seedBinding('<seedRule>'); }` guard and, when {@link defaultSentinel} +
 * {@link stripFromMultipartWhenDefault} are present, a multipart-loop branch
 * that drops {@link fieldName} when the binding equals the sentinel.
 */
export interface GlobalContextSeed {
  /** ctx[<binding>] key the seed populates. */
  binding: string;
  /** Request-body / multipart field name this binding maps to. */
  fieldName: string;
  /** Key passed to seedBinding() at runtime; must match a rule in seed-rules.json. */
  seedRule: string;
  /** Magic value that, when present in ctx[<binding>], triggers field-stripping in multipart bodies. */
  defaultSentinel?: string;
  /** If true, the emitter inserts a multipart-loop branch that drops {@link fieldName} when ctx[<binding>] equals {@link defaultSentinel}. */
  stripFromMultipartWhenDefault?: boolean;
  /** Free-form documentation for maintainers. */
  rationale?: string;
}

export interface SemanticTypeSpec {
  // Name of a runtimeStates or capabilities entry that this semantic type's
  // value implies the existence of. Required for key-shaped semantic types
  // (those listed in artifactKinds.*.producesSemantics).
  witnesses?: string;
}

export interface IdentifierSpec {
  kind: 'identifier';
  validityState?: string; // state name produced when bound; absent identifiers are skipped at load
  boundBy?: string[]; // operations producing validity state
  fieldPaths?: string[]; // where value appears in responses
  derivedVia?: string; // capability linking
}

export interface CapabilitySpec {
  kind: 'capability';
  parameter: string; // parameter variable name
  producedBy?: string[]; // operations producing capability
  dependsOn?: string[]; // prerequisite states
}

export interface RuntimeStateSpec {
  kind: 'state';
  producedBy?: string[]; // operations producing state
  parameter?: string; // single parameter name
  parameters?: string[]; // multi parameters
  requires?: string[]; // prerequisite states
}

export interface OperationDomainRequirements {
  requires?: string[]; // states that must be present
  disjunctions?: string[][]; // sets where one of each required
  implicitAdds?: string[]; // states produced implicitly on success
  produces?: string[]; // produced states (override)
  valueBindings?: Record<string, string>; // request field -> state.parameter mapping
}

export interface ArtifactKindSpec {
  producesStates?: string[];
  producesSemantics?: string[];
  identifierType?: string;
  deploymentSlices?: string[]; // e.g., ["processDefinition"] or ["decisionDefinition","decisionRequirements"]
}

export interface OperationArtifactRuleSpec {
  rules?: ArtifactRule[]; // optional when composable
  composable?: boolean; // if true, generator composes artifacts via set cover
}

export interface ArtifactRule {
  id?: string; // optional identifier for rule referencing in scenarios
  artifactKind: string; // key into artifactKinds
  priority?: number; // lower number = higher priority
  producesSemantics?: string[]; // explicit override semantics; else derive from artifactKinds + semanticTypeToArtifactKind
  producesStates?: string[]; // additional domain states produced
}

export interface LongChainConfig {
  enabled: boolean;
  maxPreOps: number; // maximum operations before endpoint (excluding endpoint)
  retainPerCluster?: {
    baseline?: number;
    longest?: number;
    highConsistency?: number;
    highDiversity?: number;
  };
  minDeltaScore?: number; // threshold for keeping further expansion
}

export interface ExtendedGenerationOpts {
  maxScenarios: number;
  longChains?: LongChainConfig;
  // Issue #37: see scenarioGenerator GenerationOpts for semantics.
  allowEndpointAsProducer?: boolean;
  additionalNeeded?: string[];
}

export type GeneratedModelSpec = BpmnModelSpec | FormModelSpec;

export interface BpmnModelSpec {
  kind: 'bpmn';
  processDefinitionIdVar: string;
  serviceTasks?: { id: string; typeVar: string }[];
}

export interface FormModelSpec {
  kind: 'form';
  formKeyVar: string;
}
