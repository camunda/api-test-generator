import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateDomainSemantics } from './domainSemanticsValidator.js';
import type { BootstrapSequence, DomainSemantics, OperationGraph, OperationNode } from './types.js';

class DomainSemanticsValidationFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainSemanticsValidationFailure';
  }
}

// Sibling semantic-graph-extractor package produces the operation dependency graph.
const GRAPH_RELATIVE = '../semantic-graph-extractor/dist/output/operation-dependency-graph.json';
// The bundled OpenAPI spec lives at the repo root under spec/bundled/.
const OPENAPI_SPEC = '../spec/bundled/rest-api.bundle.json';

// ---- Raw shapes for permissive JSON ingestion ----
interface RawOp {
  operationId?: string;
  id?: string;
  name?: string;
  method?: string;
  httpMethod?: string;
  verb?: string;
  path?: string;
  route?: string;
  url?: string;
  produces?: unknown;
  producesSemanticType?: string;
  producesSemanticTypes?: unknown;
  outputsSemanticTypes?: unknown;
  responseSemanticTypes?: Record<string, unknown>;
  requires?: unknown;
  requiresSemanticTypes?: unknown;
  parameters?: Array<{
    name?: string;
    location?: string;
    schema?: { semanticType?: string };
    semanticType?: string;
    required?: boolean;
  }>;
  requestBodySemanticTypes?: Array<{
    semanticType?: string;
    required?: boolean;
    fieldPath?: string;
    schema?: { type?: string; format?: string };
  }>;
  edges?: string[];
  outgoingEdges?: string[];
  dependencies?: string[];
  deps?: string[];
  eventuallyConsistent?: boolean;
  operationMetadata?: OperationNode['operationMetadata'];
  conditionalIdempotency?: OperationNode['conditionalIdempotency'];
  establishes?: OperationNode['establishes'];
  'x-eventually-consistent'?: boolean;
}

interface RawGraphRoot {
  operationsById?: Record<string, RawOp>;
  operations?: Record<string, RawOp> | RawOp[];
  nodes?: Record<string, RawOp> | RawOp[];
  operationNodes?: Record<string, RawOp> | RawOp[];
  graph?: RawGraphRoot;
  data?: RawGraphRoot;
  bootstrapSequences?: RawBootstrapSeq[];
  bootstrap_sequences?: RawBootstrapSeq[];
  sequences?: RawBootstrapSeq[];
}

interface RawBootstrapSeq {
  name?: string;
  id?: string;
  description?: string;
  desc?: string;
  operations?: unknown[];
  produces?: string[];
}

interface RawSchema {
  required?: string[];
  properties?: Record<string, RawSchema>;
  items?: RawSchema;
  allOf?: RawSchema[];
  oneOf?: RawSchema[];
  anyOf?: RawSchema[];
  'x-semantic-type'?: string;
}

interface RawOpenApiOp {
  operationId?: string;
  parameters?: Array<{ schema?: RawSchema & { 'x-semantic-type'?: string }; required?: boolean }>;
  requestBody?: { content?: Record<string, { schema?: RawSchema }> };
}

interface RawOpenApiDoc {
  paths?: Record<string, Record<string, RawOpenApiOp>>;
}

export async function loadGraph(baseDir: string): Promise<OperationGraph> {
  // Allow override via env vars (relative to baseDir or absolute)
  const overrideGraph = process.env.OPERATION_GRAPH_PATH;
  const graphPath = path.resolve(baseDir, overrideGraph || GRAPH_RELATIVE);
  const raw = await readFile(graphPath, 'utf8');
  let parsed: RawGraphRoot | RawOp[];
  try {
    // biome-ignore lint/plugin: JSON.parse returns `any`; the operation graph file is the runtime contract.
    parsed = JSON.parse(raw) as RawGraphRoot | RawOp[];
    // debug: graph JSON loaded from computed path
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse graph JSON at ${graphPath}: ${msg}`);
  }

  const operations: Record<string, OperationNode> = {};

  // Support multiple possible root shapes
  // Prefer object map if available (operationsById) to avoid loss of operations due to large array truncation
  let candidateOps: Record<string, RawOp> | RawOp[] | null = Array.isArray(parsed)
    ? parsed
    : (parsed.operationsById ?? parsed.operations ?? parsed.nodes ?? parsed.operationNodes ?? null);

  if (!candidateOps && !Array.isArray(parsed)) {
    const g = parsed.graph || parsed.data;
    if (g) {
      candidateOps = Array.isArray(g) ? g : (g.operations ?? g.nodes ?? null);
    }
  }

  if (!candidateOps) {
    throw new Error(
      `Unrecognized graph structure. Adjust loader. Keys seen: ${Object.keys(parsed).join(',')}`,
    );
  }

  if (Array.isArray(candidateOps)) {
    for (const op of candidateOps) {
      if (!op) continue;
      const opId = op.operationId || op.id || op.name;
      if (!opId) {
        // warn: skipping malformed node without identifiers
        console.warn('[graphLoader] Skipping node without operationId/id/name:', Object.keys(op));
        continue;
      }
      operations[opId] = normalizeOp(opId, op);
    }
  } else {
    for (const [opId, op] of Object.entries(candidateOps)) {
      operations[opId] = normalizeOp(opId, op);
    }
  }

  const producersByType: Record<string, string[]> = {};
  const responseProducersByType: Record<string, string[]> = {};
  const establishersByType: Record<string, string[]> = {};
  for (const op of Object.values(operations)) {
    // `producersByType` is the authoritative-producer index after #98:
    // membership means "this op returns or witnesses an authoritative
    // value for semantic T in its response (or via a sidecar produces
    // declaration)". Establishers do NOT meet that contract — they
    // register a *client-minted* value at request time, not a
    // server-authoritative one. Keep the two indexes semantically
    // distinct so variant planning, provider preference, and
    // missing-producer signals continue to mean what they say.
    //
    // The synthesised entry stays on `op.produces` so the BFS produced-
    // set propagation (many sites in scenarioGenerator) still marks
    // the establisher's identifier semantics as satisfied after the
    // op is scheduled. Skipping it only here keeps the *global* index
    // clean while preserving per-op satisfaction tracking.
    const synthesisedFromEstablishes = new Set<string>();
    if (op.establishes && op.establishes.shape !== 'edge') {
      for (const id of op.establishes.identifiedBy) {
        synthesisedFromEstablishes.add(id.semanticType);
      }
    }
    for (const st of op.produces) {
      if (synthesisedFromEstablishes.has(st)) continue;
      const list = producersByType[st] ?? [];
      list.push(op.operationId);
      producersByType[st] = list;
    }
    if (op.establishes && op.establishes.shape !== 'edge') {
      for (const id of op.establishes.identifiedBy) {
        const list = establishersByType[id.semanticType] ?? [];
        if (!list.includes(op.operationId)) list.push(op.operationId);
        establishersByType[id.semanticType] = list;
      }
    }
    // Issue #37: inclusive index — every response semantic leaf, even
    // provider:false ones, becomes a discoverable producer for variant
    // planning (where we need e.g. searchElementInstances → ElementId
    // even though that op is not authoritative for ElementId).
    //
    // Note: distinct from `producersByType` after #98. `producersByType`
    // is now `provider:true` only (authoritative producers). This index
    // intentionally includes provider:false leaves so variant planning
    // can use search-style ops as warm-up triggers without re-introducing
    // the dropped fallback into base planning.
    for (const leaf of op.responseSemanticLeaves ?? []) {
      const list = responseProducersByType[leaf.semantic] ?? [];
      if (!list.includes(op.operationId)) list.push(op.operationId);
      responseProducersByType[leaf.semantic] = list;
    }
  }

  if (Object.keys(operations).length === 0) {
    console.warn('[graphLoader] Loaded 0 operations. Check graph path / structure.');
  } else {
    // debug: normalization summary
  }

  // Bootstrap sequences (optional)
  const bootstrapSequences: BootstrapSequence[] = [];
  const rawSequences: RawBootstrapSeq[] = !Array.isArray(parsed)
    ? parsed.bootstrapSequences || parsed.bootstrap_sequences || parsed.sequences || []
    : [];
  if (Array.isArray(rawSequences)) {
    for (const seq of rawSequences) {
      if (!seq) continue;
      const name = seq.name || seq.id;
      if (!name || !Array.isArray(seq.operations)) continue;
      bootstrapSequences.push({
        name,
        description: seq.description || seq.desc,
        operations: seq.operations.filter((o): o is string => typeof o === 'string'),
        produces: Array.isArray(seq.produces) ? unique(seq.produces) : [],
      });
    }
    if (bootstrapSequences.length) {
      // debug: number of bootstrap sequences loaded
    }
  }

  // Domain sidecar load (optional)
  let domain: DomainSemantics | undefined;
  let producersByState: Record<string, string[]> | undefined;
  try {
    const domainPath = path.resolve(baseDir, 'domain-semantics.json');
    const domainRaw = await readFile(domainPath, 'utf8');
    // biome-ignore lint/plugin: JSON.parse returns `any`; domain-semantics.json is the runtime contract.
    const parsedDomain = JSON.parse(domainRaw) as DomainSemantics;
    const issues = validateDomainSemantics(parsedDomain);
    if (issues.length > 0) {
      const detail = issues.map((i) => `  - [${i.invariant}] ${i.message}`).join('\n');
      throw new DomainSemanticsValidationFailure(
        `domain-semantics.json failed validation:\n${detail}`,
      );
    }
    domain = parsedDomain;
    // debug: domain semantics sidecar loaded
    if (domain?.operationRequirements) {
      for (const [opId, req] of Object.entries(domain.operationRequirements)) {
        const node = operations[opId];
        if (!node) continue;
        if (req.requires) node.domainRequiresAll = req.requires;
        if (req.disjunctions) node.domainDisjunctions = req.disjunctions;
        if (req.produces) node.domainProduces = req.produces;
        if (req.implicitAdds) node.domainImplicitAdds = req.implicitAdds;
      }
    }
    // Build producersByState
    const producers: Record<string, string[]> = {};
    producersByState = producers;
    // Dedup at the writer: every callsite (runtimeStates.producedBy,
    // capabilities.producedBy, identifiers.boundBy, operationRequirements.
    // produces / implicitAdds, the #70 witness implication) funnels through
    // here, so guarding once prevents duplicate (state, opId) pairs from any
    // current or future caller. Without this, an opId that satisfies a state
    // through more than one channel (e.g. createDeployment producing
    // ProcessDefinitionDeployed both directly and via the
    // ProcessDefinitionKey → ProcessDefinitionDeployed witness edge) would
    // appear multiple times in producersByState[state].
    const addProducer = (state: string, opId: string) => {
      const list = producers[state] ?? [];
      if (!list.includes(opId)) list.push(opId);
      producers[state] = list;
      const node = operations[opId];
      if (node) {
        if (!node.domainProduces) node.domainProduces = [state];
        else if (!node.domainProduces.includes(state)) node.domainProduces.push(state);
      }
    };
    if (domain?.runtimeStates) {
      for (const [stateName, spec] of Object.entries(domain.runtimeStates)) {
        for (const opId of spec.producedBy ?? []) {
          if (operations[opId]) addProducer(stateName, opId);
        }
      }
    }
    if (domain?.capabilities) {
      for (const [capName, spec] of Object.entries(domain.capabilities)) {
        for (const opId of spec.producedBy ?? []) {
          if (operations[opId]) addProducer(capName, opId);
        }
      }
    }
    if (domain?.identifiers) {
      for (const [, spec] of Object.entries(domain.identifiers)) {
        const state = spec.validityState;
        // Skip identifiers whose validityState is not declared in the sidecar.
        // Empty strings are invalid data and would surface as a malformed
        // producersByState key — the regression test in
        // tests/regression/graph-loader-undefined-state-key.test.ts asserts
        // no such key is ever written. We use `state == null` per #65 review:
        // an empty string is not the same as "absent" and should not be
        // silently treated as such.
        if (state == null) continue;
        for (const opId of spec.boundBy ?? []) {
          if (operations[opId]) addProducer(state, opId);
        }
      }
    }
    if (domain?.operationRequirements) {
      for (const [opId, spec] of Object.entries(domain.operationRequirements)) {
        if (!operations[opId]) continue;
        for (const st of spec.produces ?? []) addProducer(st, opId);
        for (const st of spec.implicitAdds ?? []) addProducer(st, opId);
      }
    }
    // #56: surface sidecar-declared `produces` into the semantic-BFS-visible
    // structures (op.produces and producersByType). Without this step the
    // sidecar entry only updates `domainProduces` / `producersByState`, which
    // are used by the runtime-state planner but invisible to semantic BFS.
    if (domain?.operationRequirements) {
      for (const [opId, spec] of Object.entries(domain.operationRequirements)) {
        const node = operations[opId];
        if (!node) continue;
        for (const st of spec.produces ?? []) {
          if (!node.produces.includes(st)) node.produces.push(st);
          const list = producersByType[st] ?? [];
          if (!list.includes(opId)) list.push(opId);
          producersByType[st] = list;
        }
      }
    }
    // #70: witness implication. Producing a value of semantic type T
    // witnesses the existence of `semanticTypes[T].witnesses`. Surface
    // every operation that produces T as a producer of the witnessed
    // state. This unifies the typed-dataflow lens (producersByType)
    // with the runtime-state lens (producersByState).
    //
    // #95: gate the implication on `providerMap[T] === true`. Without
    // this gate, an op that carries T only as incidental response
    // metadata (e.g. createDocument's 201 carries
    // metadata.processInstanceKey with provider:false) is added to
    // producersByState[witnessed]. The semantic-producer expansion in
    // scenarioGenerator.ts then treats that op's `domainProduces`
    // entry as a real production claim, and rejects the candidate
    // when the witnessed state's transitive `requires` chain is unmet
    // — silently dropping otherwise-valid chains (the getDocument →
    // createDocument symptom in #95). Authoritative producers
    // (`provider: true`) are still surfaced; that is the relation #70
    // intended to capture.
    if (domain?.semanticTypes) {
      for (const [semanticType, spec] of Object.entries(domain.semanticTypes)) {
        const witnessed = spec.witnesses;
        if (typeof witnessed !== 'string' || witnessed.length === 0) continue;
        const producers = producersByType[semanticType] ?? [];
        for (const opId of producers) {
          const op = operations[opId];
          if (!op) continue;
          if (op.providerMap?.[semanticType] !== true) continue;
          addProducer(witnessed, opId);
        }
      }
    }
  } catch (err) {
    if (err instanceof DomainSemanticsValidationFailure) throw err;
    if (err instanceof SyntaxError) {
      throw new DomainSemanticsValidationFailure(
        `domain-semantics.json is not valid JSON: ${err.message}`,
      );
    }
    if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
      throw new DomainSemanticsValidationFailure(
        `Failed to load domain-semantics.json: ${err.message}`,
      );
    }
    // ENOENT or non-Error throw: sidecar absent — domain analysis disabled
  }

  return {
    operations,
    producersByType,
    responseProducersByType,
    bootstrapSequences,
    domain,
    producersByState,
    establishersByType: Object.keys(establishersByType).length ? establishersByType : undefined,
  };
}

function normalizeOp(opId: string, op: RawOp): OperationNode {
  // Extract produced semantic types.
  // Priority:
  // 1. Explicit fields (producesSemanticTypes / producesSemanticType / produces / outputsSemanticTypes)
  // 2. Derived from responseSemanticTypes entries (objects containing semanticType)
  const directProduces =
    op.producesSemanticTypes ??
    (op.producesSemanticType ? [op.producesSemanticType] : undefined) ??
    op.produces ??
    op.outputsSemanticTypes ??
    [];

  const produces: string[] = [];
  const pushProduce = (v: unknown) => {
    if (v && typeof v === 'string') produces.push(v);
  };
  if (Array.isArray(directProduces)) directProduces.forEach(pushProduce);
  else pushProduce(directProduces);

  // First pass: derive providerMap & candidate semantics from responseSemanticTypes
  const responseDerived: string[] = [];
  const providerMap: Record<string, boolean> = {};
  const responseLeaves: NonNullable<OperationNode['responseSemanticLeaves']> = [];
  if (op.responseSemanticTypes && typeof op.responseSemanticTypes === 'object') {
    for (const [status, arr] of Object.entries(op.responseSemanticTypes)) {
      if (!Array.isArray(arr)) continue;
      // Only success/redirect (2xx/3xx) responses contribute to authoritative
      // producers, the inclusive response-leaf index, and `produces` (via
      // `responseDerived`). Mirrors the extractor's `getProducedSemanticTypes`
      // filter (semantic-graph-extractor/graph-builder.ts). Without this,
      // a semantic surfaced only in a 4xx error body would (a) land in
      // `providerMap` / `producersByType` if marked `provider: true` on
      // the error envelope, and (b) land in `responseProducersByType` and
      // let the variant planner pick a producer that never satisfies the
      // semantic at runtime.
      if (!/^[23]/.test(status)) continue;
      for (const entry of arr) {
        const st: unknown = entry?.semanticType;
        if (st && typeof st === 'string') {
          responseDerived.push(st);
          if (entry?.provider) providerMap[st] = true;
          const fp = typeof entry?.fieldPath === 'string' ? entry.fieldPath : undefined;
          if (fp) {
            responseLeaves.push({
              semantic: st,
              fieldPath: fp,
              status,
              provider: !!entry?.provider,
            });
          }
        }
      }
    }
  }
  // Only `provider: true` response semantics flow into `produces`. The
  // canonical signal for "this op authoritatively produces a value of
  // semantic type T in its response" is `x-semantic-provider: true` on
  // the response field schema. Earlier, when no field on a response
  // carried `provider: true`, every response semantic was promoted into
  // `produces` as a fallback — which laundered incidental response
  // metadata (e.g. `createDocument`'s `metadata.processInstanceKey`)
  // into `producersByType[T]` and downstream into BFS candidate sets.
  // That fallback was the upstream cause of #95 and is removed in #97.
  // Operations whose specs are not yet annotated with
  // `x-semantic-provider` will stop appearing in `producersByType` for
  // their response fields; tracked upstream as camunda/camunda#52169.
  responseDerived.forEach((st) => {
    if (providerMap[st]) produces.push(st);
  });

  const { required, optional } = extractRequires(op);
  const optionalSubShapes = deriveOptionalSubShapes(op);

  // providerMap already built above; if still empty leave as undefined later

  // Pass through responseSemanticTypes (per status code -> array of
  // {semanticType, fieldPath, ...}). The path-analyser request-plan builder
  // uses these to emit per-step extracts on prerequisite producer steps so
  // grafted chains actually populate downstream URL placeholder vars.
  const normalizedResponseSemanticTypes: Record<
    string,
    { semanticType: string; fieldPath: string; required?: boolean }[]
  > = {};
  if (op.responseSemanticTypes && typeof op.responseSemanticTypes === 'object') {
    for (const [status, arr] of Object.entries(op.responseSemanticTypes)) {
      if (!Array.isArray(arr)) continue;
      const entries: { semanticType: string; fieldPath: string; required?: boolean }[] = [];
      for (const entry of arr) {
        const st: unknown = entry?.semanticType;
        const fp: unknown = entry?.fieldPath;
        if (typeof st === 'string' && typeof fp === 'string') {
          entries.push({
            semanticType: st,
            fieldPath: fp,
            required: typeof entry?.required === 'boolean' ? entry.required : undefined,
          });
        }
      }
      if (entries.length) normalizedResponseSemanticTypes[status] = entries;
    }
  }

  // Issue #104: x-semantic-establishes contributes synthetic produced
  // semantic types so BFS can schedule the establisher as a satisfier
  // for any consumer that needs the same identifier. Establishers are
  // intentionally NOT added to providerMap — they don't return an
  // authoritative server value, they register a client-minted one — so
  // the provider-preference filter in scenarioGenerator still reaches
  // for true producers first when both kinds exist.
  //
  // Edge establishers (`shape: 'edge'`) are the membership operations
  // — their `identifiedBy` entries enumerate the *components* of the
  // composite identifier (e.g. {GroupId, Username}), which are
  // *consumed* prerequisites, not values established by this op. The
  // edge itself has no semantic type the planner can chain on, so we
  // don't touch `produces` for edges.
  const establishes = normalizeEstablishes(op.establishes);
  const establishedSemantics = new Set<string>();
  if (establishes && establishes.shape !== 'edge') {
    for (const id of establishes.identifiedBy) {
      produces.push(id.semanticType);
      establishedSemantics.add(id.semanticType);
    }
  }

  return {
    operationId: op.operationId ?? op.id ?? op.name ?? opId,
    method: (op.method ?? op.httpMethod ?? op.verb ?? 'GET').toUpperCase(),
    path: op.path ?? op.route ?? op.url ?? '',
    produces: unique(produces),
    // Issue #104: a non-edge establisher self-satisfies the identifier
    // it mints, so drop the established semantic types from `requires`
    // — otherwise BFS would chase a producer for a value the endpoint
    // itself is going to mint and write into its own request body.
    // Edge establishers don't enter this branch (no entries in
    // `establishedSemantics`) because their `identifiedBy` components
    // are pre-existing inputs that legitimately need a chain.
    requires: {
      required: required.filter((s) => !establishedSemantics.has(s)),
      optional: optional.filter((s) => !establishedSemantics.has(s)),
    },
    edges: op.edges ?? op.outgoingEdges ?? op.dependencies ?? op.deps ?? [],
    providerMap: Object.keys(providerMap).length ? providerMap : undefined,
    eventuallyConsistent:
      op.eventuallyConsistent === true || op['x-eventually-consistent'] === true,
    operationMetadata: op.operationMetadata || undefined,
    conditionalIdempotency: op.conditionalIdempotency || undefined,
    responseSemanticTypes: Object.keys(normalizedResponseSemanticTypes).length
      ? normalizedResponseSemanticTypes
      : undefined,
    pathParameters: extractPathParameters(op),
    optionalSubShapes: optionalSubShapes.length ? optionalSubShapes : undefined,
    responseSemanticLeaves: responseLeaves.length ? responseLeaves : undefined,
    establishes,
  };
}

function normalizeEstablishes(raw: unknown): OperationNode['establishes'] {
  if (!raw || typeof raw !== 'object') return undefined;
  // biome-ignore lint/plugin: extractor JSON contract — fields validated below.
  const r = raw as { kind?: unknown; shape?: unknown; identifiedBy?: unknown };
  if (typeof r.kind !== 'string' || r.kind.length === 0) return undefined;
  if (!Array.isArray(r.identifiedBy) || r.identifiedBy.length === 0) return undefined;
  // Strict validation mirrors the extractor (semantic-graph-extractor/
  // schema-analyzer.ts): any invalid `identifiedBy` member rejects the
  // *whole* annotation. Silently dropping individual entries would
  // reintroduce the partial-state hazard #112 is meant to close —
  // e.g. a composite (path+body) identifier with one malformed `in`
  // value would degrade to a single-identifier establisher and start
  // producing wrong chains. This path runs against
  // OPERATION_GRAPH_PATH overrides too, so a hand-edited or
  // upstream-malformed graph JSON gets the same treatment as the spec.
  const identifiedBy: NonNullable<OperationNode['establishes']>['identifiedBy'] = [];
  for (const id of r.identifiedBy) {
    if (!id || typeof id !== 'object') return undefined;
    // biome-ignore lint/plugin: extractor JSON contract — fields validated below.
    const e = id as { in?: unknown; name?: unknown; semanticType?: unknown };
    if (e.in !== 'body' && e.in !== 'path') return undefined;
    if (typeof e.name !== 'string' || e.name.length === 0) return undefined;
    if (typeof e.semanticType !== 'string' || e.semanticType.length === 0) return undefined;
    identifiedBy.push({ in: e.in, name: e.name, semanticType: e.semanticType });
  }
  return {
    kind: r.kind,
    shape: typeof r.shape === 'string' ? r.shape : undefined,
    identifiedBy,
  };
}

function extractPathParameters(op: RawOp): { name: string; semanticType?: string }[] | undefined {
  if (!Array.isArray(op.parameters)) return undefined;
  const out: { name: string; semanticType?: string }[] = [];
  for (const p of op.parameters) {
    if (!p || p.location !== 'path' || typeof p.name !== 'string') continue;
    const semanticType =
      typeof p.semanticType === 'string'
        ? p.semanticType
        : typeof p.schema?.semanticType === 'string'
          ? p.schema.semanticType
          : undefined;
    out.push({ name: p.name, semanticType });
  }
  return out.length ? out : undefined;
}

// Issue #37: derive optional sub-shape grouping from request-body leaf
// fieldPaths. A leaf is "in an optional sub-shape" iff:
//   - it is itself optional (`required === false` upstream), AND
//   - its `fieldPath` has a deepest object/array-of-object ancestor
//     (i.e. it lives under `parent.x` or `parent[].x`, not at the top
//     level).
//
// Top-level optional scalars (e.g. `tenantId`), scalar arrays (e.g.
// `tags[]` — fieldPath ends with `[]` and has no ancestor), and
// operator-syntax keys (e.g. `filter.x.$eq`) are excluded — they don't
// correspond to a populated-vs-omitted object/array shape that warrants
// a sibling positive-coverage scenario.
function deriveOptionalSubShapes(op: RawOp): NonNullable<OperationNode['optionalSubShapes']> {
  const groups = new Map<string, Array<{ fieldPath: string; semantic: string }>>();
  if (!Array.isArray(op.requestBodySemanticTypes)) return [];
  for (const entry of op.requestBodySemanticTypes) {
    if (!entry || entry.required === true) continue;
    const semantic = entry.semanticType;
    const fieldPath = entry.fieldPath;
    if (typeof semantic !== 'string' || typeof fieldPath !== 'string') continue;
    const root = subShapeRootOf(fieldPath);
    if (!root) continue;
    const list = groups.get(root) ?? [];
    list.push({ fieldPath, semantic });
    groups.set(root, list);
  }
  return [...groups.entries()].map(([rootPath, leaves]) => ({ rootPath, leaves }));
}

// Strip the trailing leaf segment from a fieldPath to get its sub-shape
// root, or `null` if no proper object/array-of-object ancestor exists.
//   "startInstructions[].elementId" -> "startInstructions[]"
//   "filter.processInstanceKey"      -> "filter"
//   "filter.elementId.$eq"           -> null  (operator object)
//   "tags[]"                          -> null  (scalar array, no leaf segment)
//   "filter.tags[]"                   -> null  (nested scalar array)
//   "tenantId"                        -> null  (top-level scalar)
function subShapeRootOf(fieldPath: string): string | null {
  // Split into dot-separated segments.
  const segments = fieldPath.split('.');
  if (segments.length < 2) return null;
  const lastSegment = segments[segments.length - 1];
  // Operator-object syntax (filter.x.$eq, .$in[], etc.) — not a real
  // populated-vs-omitted sub-shape.
  if (lastSegment.startsWith('$')) return null;
  // Scalar-array item leaves (`tags[]`, `filter.tags[]`, etc.) — the
  // extractor surfaces array items with a trailing `[]`. A scalar-array
  // leaf is the same flavour of "set a primitive collection or omit it"
  // exclusion as the top-level `tags[]` case; grouping it under its
  // parent (`filter`) would produce a sub-shape whose only leaf is a
  // scalar collection, which is not a populated-vs-omitted object shape
  // worth a sibling positive-coverage scenario.
  if (lastSegment.endsWith('[]')) return null;
  return segments.slice(0, -1).join('.');
}

function extractRequires(op: RawOp): { required: string[]; optional: string[] } {
  // Include requestBodySemanticTypes / parameters with semanticType as input requirements.
  const accRequired: string[] = [];
  const accOptional: string[] = [];

  const mergeArray = (arr: unknown[], target: string[]) => {
    for (const v of arr) {
      if (typeof v === 'string') target.push(v);
    }
  };

  if (Array.isArray(op.requiresSemanticTypes)) mergeArray(op.requiresSemanticTypes, accRequired);
  if (Array.isArray(op.requires)) mergeArray(op.requires, accRequired);

  const reqLikeSem = asReqLike(op.requiresSemanticTypes);
  const reqLike = asReqLike(op.requires);
  const reqObjReq = reqLikeSem?.required ?? reqLike?.required;
  if (Array.isArray(reqObjReq)) mergeArray(reqObjReq, accRequired);
  const reqObjOpt = reqLikeSem?.optional ?? reqLike?.optional;
  if (Array.isArray(reqObjOpt)) mergeArray(reqObjOpt, accOptional);

  // Parameters (assume required flag indicates required vs optional)
  if (Array.isArray(op.parameters)) {
    for (const p of op.parameters) {
      const st = p?.schema?.semanticType || p?.semanticType;
      if (st) (p.required ? accRequired : accOptional).push(st);
    }
  }
  // Request body semantic types (extractor structure). The upstream extractor
  // (semantic-graph-extractor/schema-analyzer.ts) tracks the ancestor-required
  // chain when classifying leaves, so an `entry.required === true` here means
  // every ancestor on the field path was also required. See iteration 1 of
  // camunda/api-test-generator#31.
  if (Array.isArray(op.requestBodySemanticTypes)) {
    for (const entry of op.requestBodySemanticTypes) {
      const st = entry?.semanticType;
      if (st) (entry.required ? accRequired : accOptional).push(st);
    }
  }

  return { required: unique(accRequired), optional: unique(accOptional) };
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// Narrow `unknown` to a permissive `{ required?, optional? }` shape — `requires` and
// `requiresSemanticTypes` may legally be either a string[] (handled by the Array.isArray
// branches in extractRequires) or an object carrying nested required/optional arrays.
function asReqLike(v: unknown): { required?: unknown; optional?: unknown } | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const required = Reflect.get(v, 'required');
  const optional = Reflect.get(v, 'optional');
  return { required, optional };
}

export async function loadOpenApiSemanticHints(
  baseDir: string,
): Promise<Record<string, { required: string[]; optional: string[] }>> {
  const overrideSpec = process.env.OPENAPI_SPEC_PATH;
  const specPath = path.resolve(baseDir, overrideSpec || OPENAPI_SPEC);
  let raw: string;
  try {
    raw = await readFile(specPath, 'utf8');
  } catch {
    console.warn(
      `[graphLoader] OpenAPI spec not found at ${specPath}, continuing without semantic hints.`,
    );
    return {};
  }
  let doc: RawOpenApiDoc;
  try {
    // biome-ignore lint/plugin: parseYaml returns `any`; the OpenAPI spec is the runtime contract.
    doc = parseYaml(raw) as RawOpenApiDoc;
  } catch {
    return {};
  }
  const result: Record<string, { required: string[]; optional: string[] }> = {};
  if (doc.paths) {
    for (const [_p, methods] of Object.entries(doc.paths)) {
      for (const [_m, operation] of Object.entries(methods)) {
        if (!operation || typeof operation !== 'object') continue;
        const opId = operation.operationId;
        if (!opId) continue;
        const required: string[] = [];
        const optional: string[] = [];
        if (Array.isArray(operation.parameters)) {
          for (const param of operation.parameters) {
            if (param?.schema?.['x-semantic-type']) {
              const st = param.schema['x-semantic-type'];
              if (param.required) required.push(st);
              else optional.push(st);
            }
          }
        }
        const rb = operation.requestBody;
        if (rb?.content && typeof rb.content === 'object') {
          for (const media of Object.values(rb.content)) {
            collectSemanticTypesFromSchema(media?.schema, required, optional);
          }
        }
        result[opId] = { required: unique(required), optional: unique(optional) };
      }
    }
    // debug: extracted semantic hints summary
  }
  return result;
}

function collectSemanticTypesFromSchema(
  schema: RawSchema | undefined,
  required: string[],
  optional: string[],
  ancestorAllRequired = true,
) {
  if (!schema || typeof schema !== 'object') return;
  // A leaf x-semantic-type at this node inherits the requiredness of the path
  // taken to reach it. See iteration 1 of camunda/api-test-generator#31:
  // descendants under an optional object property or under array `items` are
  // treated as optional and must not force prerequisite operations. By
  // contrast, `oneOf` / `anyOf` branch selection is currently flattened
  // separately: the parent's requiredness propagates into each branch
  // unchanged, and only the per-branch `required` list affects descendants.
  if (schema['x-semantic-type']) {
    const st = schema['x-semantic-type'];
    (ancestorAllRequired ? required : optional).push(st);
  }
  if (schema.properties) {
    const propsReq: string[] = Array.isArray(schema.required) ? schema.required : [];
    for (const [prop, propSchema] of Object.entries(schema.properties)) {
      const childAllRequired = ancestorAllRequired && propsReq.includes(prop);
      if (propSchema?.['x-semantic-type']) {
        const st = propSchema['x-semantic-type'];
        (childAllRequired ? required : optional).push(st);
      }
      collectSemanticTypesFromSchema(propSchema, required, optional, childAllRequired);
    }
  }
  // allOf composes the schema; every branch contributes and inherits the
  // ancestor chain unchanged.
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((s) => {
      collectSemanticTypesFromSchema(s, required, optional, ancestorAllRequired);
    });
  }
  // oneOf/anyOf describe alternative shapes. Each branch is a complete schema
  // with its own `required` list and exactly one branch is selected per
  // request, so the parent's requiredness propagates into each branch
  // unchanged — the per-branch `required` list then drives leaf classification.
  // This mirrors `extractSemanticTypesFromSchemaReference` in
  // semantic-graph-extractor/schema-analyzer.ts; the two walkers must agree on
  // requiredness or the planner can omit prerequisites for operations whose
  // request schema is a required `oneOf`.
  for (const key of ['oneOf', 'anyOf'] as const) {
    if (Array.isArray(schema[key])) {
      schema[key]?.forEach((s) => {
        collectSemanticTypesFromSchema(s, required, optional, ancestorAllRequired);
      });
    }
  }
  // Array items are present only when the array itself is non-empty. Treat them
  // as optional for iteration 1; later iterations may use minItems > 0 to keep
  // strictly required items.
  if (schema.items) {
    collectSemanticTypesFromSchema(schema.items, required, optional, false);
  }
}
