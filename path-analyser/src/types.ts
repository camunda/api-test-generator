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
  // #162 PR 2: every semantic-typed request-body leaf, regardless of
  // nesting or required flag. Surfaced separately from `optionalSubShapes`
  // (which filters to nested-object-only) so the requestSettersByType
  // index and the clientMintedAttribute planner helper can iterate
  // scalar arrays (`tags[]`) and top-level scalars (`businessId`)
  // alongside nested-object leaves. Empty/undefined when the operation
  // has no semantic-typed request-body fields.
  requestBodySemantics?: Array<{
    semantic: string;
    fieldPath: string;
    required: boolean;
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
    // Narrowed to the literal `'edge'` to match the extractor's
    // strict shape gate and `graphLoader.normalizeEstablishes`
    // (which drops any other shape wholesale). Downstream code
    // (`scenarioGenerator`, the L3 invariants) compares `shape ===
    // 'edge'` directly and can rely on this contract.
    shape?: 'edge';
    identifiedBy: Array<{
      in: 'body' | 'path';
      name: string;
      semanticType: string;
      // Issue #134: bimodal entity sources. When `true`, the planner
      // is permitted to fall back to a client-minted ID for this
      // component if no in-API producer is reachable. Default
      // (omitted) preserves the existing strict-chain behaviour.
      acceptsExternal?: boolean;
    }>;
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
  // Issue #134 / camunda/camunda#52320: identifiers (semantic types)
  // owned by a kind whose registry shape is `external-entity` — e.g.
  // `ClientId` is owned by `Client { shape: "external-entity" }` so
  // it is minted outside the Camunda REST API (Console / OIDC IdP)
  // and has no in-API producer by design. The planner treats every
  // entry here as automatically client-mintable on ANY endpoint that
  // would otherwise classify it as missing (not edges-only): the
  // fallback resolves the binding name via the endpoint's own
  // `pathParameters` when no `identifiedBy` entry matches. This is
  // the kind-scoped sibling of the per-tuple `acceptsExternal: true`
  // flag. Empty/undefined means no registry was loaded.
  externalEntityIdentifiers?: Set<string>;
  /**
   * Map of semantic type → operations that ACCEPT this semantic in their
   * request body (#162 PR 2). Parallel to `producersByType` (response
   * body) and `establishersByType` (request body, identifier-shaped).
   * Used by the planner to find setter sites for client-minted attribute
   * semantics — e.g. `createProcessInstance` is the only setter for
   * `Tag` in the camunda-oca spec, accepting `tags[]` in its body.
   *
   * Includes every semantic-typed request-body leaf regardless of nesting
   * or `required` flag, so the planner can discover both top-level
   * (`tags[]`) and nested (`filter.tags[]`) setter locations. The
   * setter-chain reuse pass (a follow-up to PR 2) will consume this
   * to insert a setter step before a downstream consumer step that
   * requires the same minted value.
   */
  requestSettersByType?: Record<string, string[]>;
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
  // Issue #134: semantic types whose value was client-minted at scenario-
  // construction time because the endpoint's `x-semantic-establishes`
  // identifiedBy member carried `acceptsExternal: true` (per-tuple
  // bimodality, e.g. `assignGroupToRole.groupId`) OR because the
  // member's semantic type is owned by a kind whose registry shape is
  // `external-entity` (kind-scoped fallback, e.g. `ClientId` is owned
  // by `Client { shape: "external-entity" }`). In both cases no
  // in-API producer exists by design and the planner seeds a
  // client-minted value into the scenario bindings. Empty/undefined
  // means every required semantic was satisfied by an in-graph
  // producer or establisher.
  // Downstream consumers (e.g. negative-suite) read this to skip
  // "unknown identifier ⇒ 404" assertions for the listed semantics.
  externalEntitySites?: string[];
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
  // Issue #136: ordered list of binding names that the scenario must seed
  // (via a `seedBinding(name)` call) at scenario start, before step 0
  // runs. Computed by the planner from `requestPlan` + `bindings` so every
  // emitter renders the same prologue and no emitter has to re-derive
  // "which inputs are unsatisfied at step N" from the bindings/extracts
  // heuristic. Empty/absent means no PENDING bindings need seeding (all
  // inputs are either literal in `bindings` or supplied by an extract
  // before their first use).
  seedBindings?: string[];
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
  /**
   * Eventual-state waits the emitter must render immediately after this
   * step's request/expect block, before moving to the next step. Populated
   * by the planner when this step produces an eventual state (one with
   * `runtimeStates.<state>.eventual === true`) that a later step requires
   * (#159 PR B). Each entry carries everything the emitter needs to
   * render one `awaitEventually(...)` block without re-consulting the
   * graph or the domain sidecar.
   */
  eventualWaitsAfter?: EventualWaitSpec[];
}

/**
 * Single planner-annotated wait for an eventual state transition.
 * Self-contained: includes the witness's resolved HTTP method and
 * pathTemplate so the emitter doesn't need to look the witness operation
 * up in the graph at emission time.
 */
export interface EventualWaitSpec {
  /** The eventual state being waited for (used in the emitted comment). */
  state: string;
  /** Witness fetch details, resolved against the graph at plan time. */
  witness: {
    operationId: string;
    /** HTTP method of the witness op (PR B: 'GET' only). */
    method: string;
    /** Path template of the witness op, with `{paramName}` placeholders
     *  the emitter substitutes via the same ctx-binding rewrite used for
     *  request URLs. */
    pathTemplate: string;
    predicate: WitnessPredicate;
    waitUpToMs?: number;
    pollIntervalMs?: number;
  };
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
  /**
   * How the planner obtains a value for this semantic type (#162). Two
   * classifications land so far; the issue envisions five in total.
   *
   *   - `modelDerived` (#162 PR 1): the value is read out-of-band from a
   *     deployment artifact in the same chain. The planner looks the
   *     value up in the `providesValues` entry of the fixture chosen for
   *     the chain's `createDeployment` step. Examples: `ElementId`,
   *     `JobType` — values come from the BPMN model itself, not from a
   *     Camunda API response.
   *
   *   - `attribute` (#162 PR 2): the value is a free-form label attached
   *     to another entity, with no first-order entity retrievable by it
   *     and no producer in the API. The planner mints a deterministic
   *     value and binds it; setter-chain reuse threads the same value
   *     between a setter site and any downstream consumer in the same
   *     scenario. Requires `clientMinted: true` on the same entry —
   *     `attribute` is a structural shape, `clientMinted` says where the
   *     value originates. Examples: `Tag`, `BusinessId`.
   *
   * Absent `kind` means the planner falls back to its existing
   * classification chain (producersByType / establishersByType /
   * external-entity / synthetic).
   *
   * `serverEmergent` (#162 PR 5): server-minted lifecycle identifiers
   * that no client API directly mints with a returned value (e.g.
   * `IncidentKey`, `AuditLogKey`, `MessageSubscriptionKey`). The planner
   * binds a deterministic placeholder so search-filter request shapes
   * validate; an empty search result is acceptable because the value is
   * a fabricated placeholder for a key the client could not have known.
   */
  kind?: 'modelDerived' | 'attribute' | 'serverEmergent';
  /**
   * Whether values of this semantic are minted by the planner / client
   * rather than returned by a producer endpoint (#162 PR 2). Only
   * meaningful with `kind: 'attribute'`. Future PRs may extend
   * client-minted semantics to identifier-shaped types as well.
   */
  clientMinted?: boolean;
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
  /**
   * When true, the state's external observability LAGS behind its producer's
   * response — the broker accepts the write at 200 but the projected state
   * (e.g. ProcessInstanceCompleted) only lands after asynchronous engine
   * progression. The planner inserts an `awaitEventually(witness)` wait
   * between the producer step and any consumer step that requires this state
   * (#159 PR B). Requires `witness` to be set.
   */
  eventual?: boolean;
  /**
   * Witness used by the awaitEventually wait when `eventual === true`.
   * The witness invokes a read-shape operation (today: GET-by-key only) and
   * polls until the predicate holds against the response body.
   */
  witness?: WitnessSpec;
}

export interface WitnessSpec {
  /** Operation invoked to observe the state. Must reference a real
   *  operationId in the graph. PR B constrains this to GET-shape ops. */
  operationId: string;
  /** Predicate over the parsed response body that holds when the state is
   *  observable. */
  predicate: WitnessPredicate;
  /** Optional total wait budget in ms; defaults to the awaitEventually
   *  helper's built-in default (10_000). */
  waitUpToMs?: number;
  /** Optional poll interval in ms; defaults to the helper's built-in
   *  default (500). */
  pollIntervalMs?: number;
}

/**
 * Structured predicate — the emitter generates a typed arrow function from
 * this rather than interpolating a user-supplied string, so the on-disk
 * config can't smuggle arbitrary code into the emitted suite. PR B only
 * supports single-segment `path` (the response body's top-level field).
 * Nested-path support can be added later as a separate field shape.
 */
export interface WitnessPredicate {
  /** Top-level field on the response body. Must match
   *  `/^[A-Za-z_$][A-Za-z0-9_$]*$/` so it can be safely emitted as a
   *  bracket-access key (`b['<path>']`). */
  path: string;
  /** Expected scalar compared with `===`. */
  equals: string | number | boolean;
}

export interface OperationDomainRequirements {
  requires?: string[]; // states that must be present
  disjunctions?: string[][]; // sets where one of each required
  implicitAdds?: string[]; // states produced implicitly on success
  produces?: string[]; // produced states (override)
  valueBindings?: Record<string, string>; // request field -> state.parameter mapping
}

export interface ArtifactKindSpec {
  /**
   * States that EVERY fixture of this kind deploys, regardless of fixture
   * contents (e.g. `ProcessDefinitionDeployed` for `bpmnProcess`). Both the
   * planner and the selector treat these as unconditional outputs of a
   * successful `createDeployment` step.
   */
  producesStates?: string[];
  /**
   * States that some fixture of this kind CAN provide, depending on which
   * specific file the selector picks (#159). The planner reads this for
   * chain-feasibility BFS — a chain is satisfiable if requires can be
   * covered by `producesStates ∪ producibleStates`. The selector then
   * matches the chain's required states against per-entry `providesStates`
   * in `path-analyser/fixtures/deployment-artifacts.json` to choose the
   * fitting file. Example: bpmnProcess can produce `ModelHasServiceTaskType`
   * (via `service-task.bpmn`) or `ProcessInstanceCompleted` (via
   * `simple.bpmn`), but neither is unconditional.
   */
  producibleStates?: string[];
  producesSemantics?: string[];
  identifierType?: string;
  deploymentSlices?: string[]; // e.g., ["processDefinition"] or ["decisionDefinition","decisionRequirements"]
}

/**
 * Single entry in the deployment artifact registry
 * (`path-analyser/fixtures/deployment-artifacts.json`). One entry per
 * checked-in BPMN/DMN/Form file the planner can deploy via
 * `createDeployment`. Loaded lazily and cached at module scope by
 * `getArtifactsRegistry()` in `path-analyser/src/index.ts`.
 *
 * Exported from `types.ts` (rather than kept private to `index.ts`) so
 * the unified classification dispatch in `bindSemanticInput.ts` can
 * accept a fixture parameter without having to import from `index.ts`
 * (which would create a circular dependency once `index.ts` re-imports
 * the chokepoint helper).
 */
export interface ArtifactRegistryEntry {
  kind: string;
  path: string;
  description?: string;
  /**
   * Runtime characteristics this specific fixture provides BEYOND what
   * `artifactKinds.<kind>.producesStates` declares for the kind. The
   * selector picks the entry whose effective providesStates (entry ∪
   * kind) covers the chain's required states (#159).
   */
  providesStates?: string[];
  /**
   * Concrete values this fixture supplies for semantic types whose
   * `semanticTypes.<X>.kind === 'modelDerived'` (#162 PR 1). The planner
   * reads these out-of-band at plan time — no Camunda API round-trip is
   * needed to learn the values, because the BPMN/DMN/Form file already
   * encodes them (element IDs, job types, form IDs, …).
   *
   * Per-semantic the value is an array so a future per-consumer-site
   * preference vocabulary can pick a specific entry; PR 1's planner
   * takes index 0 unconditionally.
   *
   * After #164: this is the SOLE source of fixture-derived values. The
   * pre-#162 ad-hoc `parameters: { jobType: ... }` field was the
   * embryonic form of this idea and has been retired; any new
   * fixture-derived value must be declared here.
   */
  providesValues?: Record<string, string[]>;
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
