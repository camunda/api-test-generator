/**
 * Sentinel value the planner writes into `EndpointScenario.bindings[v]`
 * when a binding is declared but not yet produced — a placeholder
 * meaning "a later step's response extraction, a seed-rule literal, or
 * a runtime-seeded value will fill this in before any step that reads
 * it is emitted".
 *
 * The sentinel IS contractual in scenario JSON: the materializer reads
 * `scenario.bindings[v] === PENDING_BINDING` to skip emitting a literal
 * `ctx.set(v, '__PENDING__')` line, and `computeSeedBindings`
 * (`path-analyser/src/seedBindings.ts`) returns exactly the still-PENDING
 * bindings as the per-scenario runtime seed list (#136). Stripping the
 * sentinel from scenario output would break both contracts.
 *
 * What MUST stay free of the sentinel is the *emitted* output (a
 * generated Playwright `.spec.ts` containing `'__PENDING__'` means the
 * materializer's skip guard or the seedBindings filter regressed and
 * the string will flow into a live API call). Lift 18 / #258 added an
 * L3 invariant that scans `generated/<config>/playwright/` for the
 * literal — see "PENDING_BINDING sentinel hygiene" in
 * `configs/<config>/regression-invariants.test.ts`.
 *
 * Imported by the materializer via the `path-analyser/types` subpath
 * export so the two workspaces share one source of truth.
 */
export const PENDING_BINDING = '__PENDING__';

export interface OperationRef {
  operationId: string;
  method: string;
  path: string;
  eventuallyConsistent?: boolean;
  /**
   * #309 Phase A — stamped by `expandRuntimeEmission` on the inserted
   * runtimeEmission discovery step (e.g. `searchUserTasks` when the
   * chain is discovering `UserTaskKey`). Carries everything the body
   * builder needs to emit the structurally-correct filter wrapper —
   * `{ filter: { [filterBy]: '${fromBinding}' } }` — bound forward
   * from the upstream producer's binding name. Absent on every other
   * step (the generic body builder handles those).
   */
  discoveryIntent?: DiscoveryIntent;
}

/**
 * #309 Phase A — describes a planner-inserted runtimeEmission
 * discovery step: the upstream producer-binding the filter must
 * forward-bind to, and the response field that surfaces the
 * runtime-emitted key. The body builder reads `filterBy` + `fromBinding`
 * to emit `{ filter: { [filterBy]: '${fromBinding}' } }`; the emitter
 * reads `extractKey` + `extractInto` (today already derived from
 * `discoveredVia.extractKey` via the producer auto-derive at
 * `path-analyser/src/index.ts` ~714, so this field is currently
 * documentary — Phase A only consumes filterBy + fromBinding).
 *
 * `fromSemantic` records which upstream semantic the filter is bound
 * to (e.g. `ProcessInstanceKey`). The planner stamps it eagerly during
 * BFS expansion and uses it at scenario finalisation to resolve the
 * actual `fromBinding` var name from the chain's allocated bindings —
 * mirroring `semanticToVarName`'s suffixing convention so chains with
 * multiple producers of the same semantic bind to the latest one
 * rather than always assuming the un-suffixed base name.
 */
export interface DiscoveryIntent {
  filterBy: string;
  fromSemantic: string;
  fromBinding: string;
  extractKey: string;
  extractInto: string;
  consistency: 'eventual' | 'strong';
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
  /**
   * #305 Phase 4: flat list of every primitive (or array-of-primitive)
   * leaf path in the response schema, per status code, irrespective of
   * `x-semantic-type` annotation. Powers the
   * UpdatedFieldVisibleOnReadBack template instantiator's name-based
   * bridge from a mutator's emitted request body to a fetcher's
   * observable response shape. Arrays appear as `prefix[].leaf`.
   */
  responseLeafPaths?: Record<string, string[]>;
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
  // #172: transient planner-internal handoff from the variant generator
  // (`generateOptionalSubShapeVariants` bare-endpoint fallback) to the
  // request-plan builder. The fallback installs a SYNTHETIC placeholder
  // for a `modelDerived` leaf because the deploy fixture is not yet chosen
  // at that stage; this records (varName, semantic, the exact placeholder)
  // so `buildRequestPlan`'s `createDeployment` step can replace the
  // placeholder with a real value selected from the chosen fixture's
  // `providesElements` (by type, via `semanticTypes.<X>.modelElementTypes`).
  // Set ONLY when a placeholder was actually installed (never in the
  // producer-chain branch), and consumed + deleted before serialization —
  // it must not leak into emitted scenario JSON.
  modelDerivedBindings?: { varName: string; semantic: string; placeholder: string }[];
  // #172: binding names the planner resolved to an AUTHORITATIVE model
  // value (a real flow-node id read out-of-band from the chosen deploy
  // fixture's `providesElements`, by type). Unlike client-minted
  // identifiers (`tenantIdVar`, `usernameVar`, …) — which the emitter
  // deliberately strips and re-seeds with `{ unique: true }` for
  // cross-run 409 avoidance (#304/#320) — a model-derived value is a
  // lookup into the deployed model and MUST be transmitted verbatim:
  // re-seeding it would re-introduce the broker-invalid placeholder the
  // fix removed. The materializer subtracts these names from its
  // `uniqueBindings` set so the literal survives. Persisted (unlike the
  // transient `modelDerivedBindings` handoff above) because the
  // distinction is only knowable at plan time.
  modelDerivedLiteralBindings?: string[];
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
  // #288 Phase 3b — opt out of the canonical chain inheritance.
  // Defaults to true (omitted ⇒ inherit). The only current consumer
  // is the search-empty-negative variant, which deliberately omits
  // prerequisites so the search returns empty at runtime. Replaces
  // the ad-hoc `isSearchLikeOp && isEmptyNeg` regex previously
  // applied to every variant in `index.ts`.
  inheritChainPrereqs?: boolean;
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
  /** Effective JSON Schema type for each field in this variant ('object', 'array', 'string', …). */
  fieldTypes: Record<string, string>;
  /**
   * Enum values for scalar fields in this variant, captured from the
   * field's resolved schema (`enum`, traversing $ref + allOf). Used by
   * `buildRequestBodyFromCanonical` to emit an enum literal instead of a
   * `${var}` placeholder for required enum-typed fields (#338).
   */
  fieldEnums?: Record<string, unknown[]>;
  /**
   * OpenAPI `format` for scalar fields in this variant (e.g. `'email'`,
   * `'uuid'`, `'date-time'`). Used by `buildRequestBodyFromCanonical` to
   * emit a format-valid value for variant-only required fields whose format
   * cannot be found in the top-level canonical nodes (#397): an inline literal
   * for most formats, or runtime seeding for `email` (so addresses vary per
   * call — see `formatSeedLiteral`).
   */
  fieldFormats?: Record<string, string>;
  /**
   * For `array` fields, enum values declared on the item schema (e.g.
   * `permissionTypes: { type: 'array', items: { enum: […] } }`). Used to
   * synthesise a one-element array containing an enum literal instead of
   * the generic `['placeholder']` element (#338).
   */
  fieldItemEnums?: Record<string, unknown[]>;
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
  /**
   * #309 Phase A — present on planner-inserted runtimeEmission
   * discovery steps. When set, `bodyTemplate` was synthesised by the
   * forward-bind branch (`{ filter: { [filterBy]: '${fromBinding}' } }`),
   * NOT by `buildRequestBodyFromCanonical`. Carried explicitly so L3
   * invariants and downstream tooling can recognise the intentional-
   * discovery shape without re-deriving it.
   */
  discoveryIntent?: DiscoveryIntent;
  /**
   * Per-step copy of `Operation.responseLeafPaths['409']` presence — true
   * when this step's operation declares an HTTP 409 (Conflict) response
   * in the OpenAPI spec. Stamped by `buildRequestPlan` so the emitter can
   * decide (together with "binding is client-minted") which seedBinding
   * calls to mark `{ unique: true }` for cross-run identifier uniqueness
   * (#304). Absent / false ⇒ no 409 declared.
   */
  declares409?: boolean;
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
  /** Per-operation multipart field-to-fixture-path mappings for non-deployment-gateway ops. */
  operationFileFixtures?: Record<string, Record<string, string>>;
}

/**
 * One entry in {@link DomainSemantics.globalContextSeeds}. Drives the
 * Playwright emitter's per-scenario seed prologue: for non-omitting
 * entries the emitter writes a `ctx['<binding>'] = ctx['<binding>'] ??
 * seedBinding('<seedRule>');` line in the universal-seed prologue.
 *
 * When {@link omitWhenUnbound} is `true`, the universal prologue does
 * NOT auto-seed the binding. The materializer additionally skips it
 * in the per-scenario `seedBindings` loop unless the scenario marks
 * the binding as needing a fresh value (currently signalled by
 * membership in the emitter's `uniqueBindings` set — populated for
 * ops that declare HTTP 409, see #320). In other words: producer
 * scenarios that must mint a value still seed; consumer-only
 * scenarios leave the binding `undefined` so the request field is
 * omitted on the wire and the server applies its own default (e.g.
 * the Camunda REST Gateway treats a missing `tenantId` as the
 * default tenant). This replaces the legacy
 * `defaultSentinel`/`stripFromMultipartWhenDefault` mechanism (#342),
 * which sent a literal sentinel value (`<default>`) on the wire and
 * relied on a runtime strip branch — that approach broke
 * re-runnability because the producer step (e.g. `createTenant`)
 * sent the same `<default>` value on every run and 409-ed.
 */
export interface GlobalContextSeed {
  /** ctx[<binding>] key the seed populates. */
  binding: string;
  /** Request-body / multipart field name this binding maps to. */
  fieldName: string;
  /** Key passed to seedBinding() at runtime; must match a rule in seed-rules.json. */
  seedRule: string;
  /**
   * If true, the materializer skips the universal-seed prologue for
   * this entry AND skips it in the per-scenario `seedBindings` loop
   * for consumer-only scenarios. The binding is seeded only when the
   * scenario must mint a fresh value to send (currently: ops that
   * declare HTTP 409, via the emitter's `uniqueBindings` set —
   * see #320). When left unseeded, the binding stays `undefined` and
   * the request field is omitted on the wire so the server applies
   * its own default (#342).
   */
  omitWhenUnbound?: boolean;
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
   *   - `serverEmergent` (#162 PR 5): server-minted lifecycle identifiers
   *     that no client API directly mints with a returned value (e.g.
   *     `IncidentKey`, `AuditLogKey`, `MessageSubscriptionKey`) AND for
   *     which the planner has no path to discover the emitted value
   *     post-hoc. The planner binds a deterministic placeholder so
   *     search-filter request shapes validate; an empty search result is
   *     acceptable because the value is a fabricated placeholder for a
   *     key the client could not have known.
   *
   *   - `runtimeEmission` (#305 Phase 1, schema-only): a server-minted
   *     lifecycle key that the planner *will be able to* discover after
   *     a known producing side-effect (e.g. `UserTaskKey` is emitted
   *     when a process instance executes a user-task element, and is
   *     discoverable via `searchUserTasks(processInstanceKey)`).
   *     Distinct from `serverEmergent` precisely because the discovery
   *     path is declarable. Requires both `emittedBy` and
   *     `discoveredVia` on the same entry — without them the entry
   *     would carry no actionable information for the future planner.
   *     The loader enforces this coupling.
   *
   *     **Phase-1 scope note:** as of #305 Phase 1 (this commit) no
   *     planner code reads `kind === 'runtimeEmission'`. The
   *     `classifySemantic` dispatch in `bindSemanticInput.ts` only
   *     special-cases `modelDerived` / `clientMintedAttribute` /
   *     `serverEmergent`; a `runtimeEmission` declaration therefore
   *     falls through to the producer/establisher/external-entity
   *     chain and most commonly classifies as `unclassified` (the
   *     keys we plan to migrate in Phase 3 — `UserTaskKey`,
   *     `JobKey`, … — have no producer or establisher today, which
   *     is exactly why they need `runtimeEmission` in the first
   *     place). The vocabulary is landed first so Phase 3's ABox
   *     edits can validate cleanly against the published TBox;
   *     classifier + chain-planner support follows in Phase 3 of
   *     #305.
   *
   * Absent `kind` means the planner falls back to its existing
   * classification chain (producersByType / establishersByType /
   * external-entity / synthetic).
   */
  kind?: 'modelDerived' | 'attribute' | 'serverEmergent' | 'runtimeEmission';
  /**
   * Whether values of this semantic are minted by the planner / client
   * rather than returned by a producer endpoint (#162 PR 2). Only
   * meaningful with `kind: 'attribute'`. Future PRs may extend
   * client-minted semantics to identifier-shaped types as well.
   */
  clientMinted?: boolean;
  /**
   * Required when `kind === 'runtimeEmission'` (#305 Phase 1). Declares
   * how a value of this type comes into existence at runtime — the
   * producing predecessor that must run, plus any capability guards the
   * predecessor's deployment artefact must satisfy. See
   * `path-analyser/src/ontology/semanticsSchema.ts` for the field-level
   * docs; this interface mirrors the ABox shape for the planner views.
   */
  emittedBy?: {
    predecessor: string;
    guardedBy?: string[];
  };
  /**
   * Required when `kind === 'runtimeEmission'` (#305 Phase 1). Declares
   * how the planner reads the emitted value back from the system after
   * the predecessor has run.
   */
  discoveredVia?: {
    operationId: string;
    filterBy?: string;
    extractKey: string;
    consistency?: 'eventual' | 'strong';
  };
  /**
   * For `kind === 'modelDerived'` semantics resolved from a deployment
   * fixture (#172): the acceptable model-element `type` values for this
   * semantic, in preference order. When a `modelDerived` variant leaf is
   * resolved at the chain's `createDeployment` step, the planner picks the
   * first element in the fixture's `providesElements` whose `type` appears
   * in this list (earliest list entry wins on ties). When omitted or
   * empty, the planner falls back to the fixture's first declared element.
   *
   * The strings are opaque to the planner — they are matched against
   * `providesElements[].type` by pure equality, so all BPMN/OCA element
   * vocabulary stays in config (the fixture registry + this list) and
   * never enters generic planner code. Example: `ElementId` lists every
   * executable / terminal flow-node type but NOT `startEvent`, encoding
   * the broker rule that a start event is not a valid
   * `startInstructions[].elementId` target regardless of how many start
   * events the deployed model contains.
   */
  modelElementTypes?: string[];
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
  /**
   * Post-condition hygiene states the chain SHOULD leave in place after
   * this op runs, but which are NOT preconditions to the op (#249). Unlike
   * `requires`, this field is invisible to the BFS scenario planner — it
   * never gates feasibility, never schedules producer ops, and never
   * filters the op out. Its sole consumer is the fixture selector
   * (`computeDeploymentRequiredStates`), which unions these states into
   * the deployment-gateway requirement set so a fixture that provides them
   * is preferred. Subsequent ops in the chain whose `produces` /
   * `implicitAdds` include the state discharge the hygiene requirement.
   *
   * Used to encode "this op creates a resource that should be driven to a
   * terminal state by the end of the test" — e.g. `createProcessInstance`
   * declares `chainCleanupRequires: ["ProcessInstanceCompleted"]` so the
   * base scenario deploys a self-completing fixture instead of leaving an
   * orphan running instance.
   */
  chainCleanupRequires?: string[];
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
   * in `configs/<config>/fixtures/deployment-artifacts.json` to choose the
   * fitting file. Example: bpmnProcess can produce `ModelHasServiceTaskType`
   * (via `service-task.bpmn`) or `ProcessInstanceCompleted` (via
   * `simple.bpmn`), but neither is unconditional.
   */
  producibleStates?: string[];
  producesSemantics?: string[];
  identifierType?: string;
  deploymentSlices?: string[]; // e.g., ["processDefinition"] or ["decisionDefinition","decisionRequirements"]
  /**
   * Optional discriminator selecting the `GeneratedModelSpec` variant the
   * planner should construct when this artifact kind is bound to a chain
   * (Lift 10 / #227). Conventional values: `'bpmn'`, `'form'`. Sourced
   * from the artifact-kinds ABox so the planner does not need to encode
   * a semantic→kind table that already exists in `semanticTypeMap`.
   */
  modelKind?: string;
}

/**
 * Single entry in the deployment artifact registry
 * (`configs/<config>/fixtures/deployment-artifacts.json`). One entry per
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
  /**
   * Structured flow-node inventory this fixture's model contains, each
   * tagged with its element `type` (#172). Unlike the flat ordered
   * `providesValues.<Semantic>` lists (index-0 selection), this lets the
   * planner pick a value by *type* via a per-semantic acceptable-types
   * selector (`semanticTypes.<X>.modelElementTypes`) rather than by
   * position — so a model with several start events (plain / message /
   * signal / timer) can never have one accidentally selected for a field
   * that rejects start events (e.g. `startInstructions[].elementId`).
   *
   * The `type` string is opaque to the planner: it matches the config's
   * own per-semantic acceptable-types list by pure string equality, so no
   * BPMN/OCA element vocabulary leaks into generic planner code.
   */
  providesElements?: { id: string; type: string }[];
}

export interface OperationArtifactRuleSpec {
  rules?: ArtifactRule[]; // optional when composable
  composable?: boolean; // if true, generator composes artifacts via set cover
  /**
   * Optional ontological role this operation plays in the API surface
   * (Lift 9 / #225, extended by Lift 14 / #254). The planner and
   * Playwright emitter consult this field via `findOpIdByRole` /
   * `isDeploymentGatewayOp` / `isJobActivatorOp` to discriminate
   * special-case behaviour against the ABox instead of a hard-coded
   * operationId. Conventional values: `deploymentGateway` (the
   * multipart deploy operation whose response surfaces deployed
   * artifact identifiers); `jobActivator` (the operation that
   * activates jobs produced by service tasks in a deployed BPMN
   * process — search-like, requires service-task wiring in the BPMN
   * model draft, has a non-existent-job-type override for empty
   * negatives).
   */
  role?: string;
  /**
   * Optional flag indicating that the declared `role` is consumed
   * only by the planner and not by the per-step Playwright emitter
   * dispatch (Lift 14 / #254). When `true`, the materializer treats
   * the role as informational and does not require a
   * `configs/<config>/codegen/playwright/roles/<role>/` bundle. When
   * `false` or omitted, the role is emitter-dispatched and the
   * bundle must exist (Lift 12 / #231 contract).
   */
  plannerOnly?: boolean;
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
  maxChainAlternatives: number;
  longChains?: LongChainConfig;
  // Issue #37: see scenarioGenerator GenerationOpts for semantics.
  allowEndpointAsProducer?: boolean;
  additionalNeeded?: string[];
}

/**
 * Options consumed by `generateOptionalSubShapeVariants` (the variant
 * suite emitter). Distinct from `ExtendedGenerationOpts` because the
 * outer cap here bounds *variant scenarios per endpoint* (one per
 * subShape × leaf pair), not chain alternatives — those are pinned to
 * `maxChainAlternatives: 1` for every inner planner call. Splitting
 * the option types (#288 Phase 3c review) keeps the two semantically
 * distinct caps from sharing a misleading name.
 */
export interface VariantGenerationOpts {
  maxVariantsPerEndpoint: number;
  longChains?: LongChainConfig;
  allowEndpointAsProducer?: boolean;
  additionalNeeded?: string[];
}

/**
 * A model-spec entry describing one synthesized model the planner needs to
 * deploy as part of a scenario.
 *
 * The shape is intentionally **open** over `kind` so any ABox-declared
 * `modelKind` value produces a structured entry, not just the hard-coded
 * `bpmn` / `form` discriminants the planner originally hand-rolled. Per-kind
 * extensions (e.g. BPMN's service-task metadata) live in `metadata`;
 * consumers that care about a specific kind narrow via the `kind` tag and
 * reach into `metadata` with their own decoder.
 *
 * Lift 13 / #253: the previous closed union `BpmnModelSpec | FormModelSpec`
 * caused the planner to silently drop any ABox `modelKind` value outside
 * those two literals (the caveat originally noted on `modelKind` in
 * `artifactKindsSchema.ts`). Removing the union closes that gap and lets a
 * new `modelKind` declared in the ABox flow end-to-end without editing
 * `scenarioGenerator.ts`.
 */
export interface GeneratedModelSpec {
  /** ABox-declared kind discriminator (e.g. `'bpmn'`, `'form'`). */
  kind: string;
  /**
   * Map of binding-role → binding variable name. Role names are
   * planner-internal conventions per kind (see
   * `path-analyser/src/modelSpecBuilders.ts`): `bpmn` uses
   * `processDefinitionId`; `form` uses `formKey`. Consumers that round-trip
   * scenario JSON should treat unknown roles as opaque pass-through data.
   */
  bindings: Record<string, string>;
  /**
   * Optional per-kind structured extension. Currently used only by the
   * `bpmn` kind to carry `serviceTasks` (id → job-type-binding pairs the
   * runtime worker needs to honour). Consumers narrow via `kind`.
   */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// #270 — Scenario template instantiation (Phase 2 of #268).
//
// Template-derived scenarios are emitted alongside (not in place of) the
// BFS-derived `EndpointScenario`s. They are written to
// `generated/<config>/scenarios/templates/<TemplateName>/<EdgeName>.json`
// and consumed by the Playwright emitter to produce
// `generated/<config>/playwright/templates/EdgeLifecycle/<EdgeName>.lifecycle.spec.ts`.
// The two output trees are independent — no field on `EndpointScenario`
// is touched here.
// ---------------------------------------------------------------------------

/**
 * A `PrereqChain` template step: a planned dependency chain that
 * establishes everything a subsequent `InvokeStep` requires before it
 * runs. Derived by delegating to `generateScenariosForEndpoint` against
 * the target operationId and dropping the target itself (which is
 * invoked by the following `InvokeStep`, not by the prereq chain).
 *
 * The `bindings`, `seedBindings` and `requestPlan` fields mirror the
 * same-named fields on `EndpointScenario` so the emitter can reuse the
 * existing per-step renderer.
 */
export interface PrereqChainStep {
  kind: 'prereqChain';
  /** OperationId the chain is intended to enable. Diagnostic only. */
  targetOperationId: string;
  /** Ordered list of prerequisite operations (target op excluded). */
  operations: OperationRef[];
  /** Same shape as `EndpointScenario.bindings`. */
  bindings: Record<string, string>;
  /** Same shape as `EndpointScenario.seedBindings`. */
  seedBindings: string[];
  /** Per-operation request plan, parallel to `operations`. */
  requestPlan: RequestStep[];
}

/**
 * A single-operation invocation. Carries the request plan for that one
 * operation and a description of which scenario bindings flow into it
 * (`inputs`) and which the response contributes back (`produces`).
 */
export interface InvokeStep {
  kind: 'invoke';
  operationId: string;
  /** semanticType → binding name consumed by this invocation. */
  inputs: Record<string, string>;
  /** semanticType → binding name produced by this invocation. */
  produces: Record<string, string>;
  /** Request plan for THIS invocation only (one step). */
  requestPlan: RequestStep;
}

/**
 * A membership assertion against an observation operation's 2xx
 * response. The assertion compiles to
 * `expect(items.map(r => r.<elementField>)).[not.]toContain(<value>)`
 * at emit time. `value` is sourced from the scenario binding table
 * keyed by `membershipSemanticType`.
 *
 * #280 — `statusOnly` covers EntityLifecycle observation: the entity is
 * looked up by id (GET-by-id), so visibility is asserted on the HTTP
 * status alone (`present` → 200, `absent` → 404). No body inspection,
 * no array walk. `expectedStatus` is materialised eagerly so the
 * emitter doesn't have to re-derive it from `expect`.
 */
export interface ObserveStep {
  kind: 'observe';
  operationId: string;
  /**
   * semanticType → binding name consumed by the observation call's
   * inputs (path params / body). The scoping/membership split:
   * `identifiedBy ∩ inputs` go here; the remaining identifiedBy
   * member is the membership identifier asserted on the response
   * (for `membership` assertions). For `statusOnly` assertions all
   * required inputs (typically a single identifier path param) appear
   * here; the assertion targets status only and consults no binding.
   */
  inputs: Record<string, string>;
  requestPlan: RequestStep;
  assertion:
    | {
        kind: 'membership';
        expect: 'present' | 'absent';
        /**
         * Path into the 2xx response body to the array carrying the
         * membership rows. Each segment is a property name; the last
         * segment names the array property itself (e.g. `['items']`).
         */
        arrayPath: string[];
        /**
         * Property name on each array element that carries the membership
         * identifier value (e.g. `'username'` for RoleUserMembership).
         */
        elementField: string;
        /**
         * Semantic type of the membership identifier. The emitter
         * resolves this against the scenario binding table to find the
         * value being asserted.
         */
        membershipSemanticType: string;
      }
    | {
        kind: 'statusOnly';
        expect: 'present' | 'absent';
        /**
         * HTTP status code the observation is expected to return.
         * `present` → 200 (entity visible). `absent` → 404 (entity gone).
         * The emitter emits `expect(resp.status()).toBe(<expectedStatus>)`.
         */
        expectedStatus: 200 | 404;
      }
    | {
        /**
         * #305 Phase 4 — read-back-after-mutate equality assertion.
         * Emitted by the `UpdatedFieldVisibleOnReadBack` template
         * compiler for `shape: "runtime-entity"` subjects. The
         * preceding `InvokeStep` is the mutator; the observation
         * fetches the entity by id and asserts each field listed
         * below equals the value the mutator request body carried
         * for the same field. The field list is derived at
         * instantiation time by intersecting the mutator request-body
         * leaves with the fetcher 200-response leaves from
         * `OperationNode.responseLeafPaths`, bridged by **last-segment
         * leaf name** (not `semanticType` — changeset fields typically
         * lack `x-semantic-type` upstream). Mutator-body leaves that
         * have no matching fetcher leaf are skipped silently; the
         * instantiator only errors if the intersection is empty
         * (a fieldEquals step with nothing to assert is a planner
         * bug, not a silent pass). The same L3 invariant enforces
         * non-empty `fields[]`.
         */
        kind: 'fieldEquals';
        fields: Array<{
          /**
           * The leaf-name segment used to bridge the mutator body to
           * the fetcher response. For name-based bridging this is the
           * final segment of `requestBodyPath` (which must equal the
           * final segment of `responseBodyPath`). Carried explicitly so
           * the emitter and L3 invariant don't have to re-derive it.
           */
          leafName: string;
          /** Path into the mutator's emitted request body where the expected value lives. */
          requestBodyPath: string[];
          /** Path into the fetcher's 200-response body where the actual value should appear. */
          responseBodyPath: string[];
        }>;
      }
    | {
        /**
         * #305 Phase 5d / #189 — state-transition read-back assertion.
         * Emitted by the `StateTransitionVisibleAfterAction` template
         * compiler for `shape: "runtime-entity"` subjects that declare
         * `transitions[]` + `stateField`. The preceding `InvokeStep`
         * is a state-transition op whose request body carries no per-
         * field update (e.g. `resolveIncident` — the post-state is
         * implicit in the op semantics). The observation fetches the
         * entity by id and asserts a single equality on the named
         * state field. Compiled to
         * `expect(body.<stateField>).toBe(<expectedState>)`.
         *
         * `fromState` is carried purely for traceability (so the
         * emitted suite's test name and the L3 invariant can mention
         * the transition direction); the assertion itself does not
         * re-witness the pre-state — the planner's chain guarantees
         * the entity is in `fromState` at invoke time (e.g.
         * `searchIncidents` only surfaces ACTIVE incidents on the
         * OCA API).
         */
        kind: 'stateEquals';
        /**
         * Top-level (or dotted) response leaf carrying the entity's
         * current state on the fetcher's 200 response. Almost always
         * a single segment (`['state']`); recorded as a path for
         * symmetry with `fieldEquals.responseBodyPath` so a future
         * nested-state response can be modelled without an emitter
         * change.
         */
        responseBodyPath: string[];
        /** Expected state value after the transition (e.g. `'RESOLVED'`). */
        expectedState: string;
        /** State the entity is expected to be in before the transition (e.g. `'ACTIVE'`). Informational; not re-asserted. */
        fromState: string;
        /** OperationId of the transition op that drove the state change. Recorded for traceability. */
        transitionOp: string;
      };
}

export type TemplateStep = PrereqChainStep | InvokeStep | ObserveStep;

/**
 * A scenario produced by instantiating a `ScenarioTemplate` against a
 * concrete subject (currently only `Edge`). The step list is a
 * discriminated union; the binding table is the union of all bindings
 * declared anywhere in the steps so consumers don't need to walk the
 * step list to learn which symbolic names exist.
 */
export interface TemplateScenario {
  /** Identifier of the template (e.g. `'EdgeLifecycle'`). */
  templateName: string;
  /** Identifier of the subject the template was instantiated against. */
  subjectName: string;
  subjectKind: 'Edge' | 'Entity' | 'RuntimeEntity';
  steps: TemplateStep[];
  /**
   * Aggregated semantic-type → binding-name map across all steps. The
   * keys are semantic-type identifiers (e.g. `'Username'`, `'RoleId'`)
   * and the values are the planner-minted binding names the runtime
   * `ctx` is keyed by (e.g. `'usernameVar'`, `'roleIdVar'`). This
   * intentionally diverges from `EndpointScenario.bindings` (whose
   * keys ARE binding names and whose values are concrete placeholders
   * like `'__PENDING__'` or literal values): the membership assertion
   * on an `ObserveStep` is expressed in semantic-type terms
   * (`assertion.membershipSemanticType`), and the emitter looks the
   * binding name up directly in this map rather than re-deriving it
   * from the semantic-type identifier — so a future change to the
   * planner's naming convention requires no emitter change. The
   * per-step `PrereqChainStep.bindings` map remains binding-name-keyed
   * (mirrors `EndpointScenario.bindings`) so the existing per-endpoint
   * emitter code paths apply unchanged.
   */
  bindings: Record<string, string>;
  /**
   * Aggregated set of `operationId`s in this template scenario whose
   * source `OperationSpec.eventuallyConsistent` flag is `true` (i.e.
   * the spec carries the `x-eventually-consistent` vendor extension).
   * Threaded through so the template emitter can wrap read-shape steps
   * in `awaitEventually(...)` exactly like the per-endpoint emitter
   * does — without re-consulting the dependency graph at emission
   * time. Empty list is permitted (and is the common case for OCA
   * edges); the field is required to make the contract explicit.
   */
  eventuallyConsistentOps: string[];
}

/**
 * Per-template, per-subject scenario file shape. One file per
 * (template × subject) pair under
 * `generated/<config>/scenarios/templates/<TemplateName>/<SubjectName>.json`.
 */
export interface TemplateScenarioFile {
  templateName: string;
  subjectName: string;
  subjectKind: 'Edge' | 'Entity' | 'RuntimeEntity';
  scenario: TemplateScenario;
}
