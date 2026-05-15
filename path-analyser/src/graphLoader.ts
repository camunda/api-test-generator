import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getActiveConfigDir, getGraphDir, getSpecBundleDir } from './configResolver.js';
import {
  validateDomainSemantics,
  validateRequestBodySemanticsClassified,
  validateRuntimeStateWitnessGraphRefs,
} from './domainSemanticsValidator.js';
import {
  deriveArtifactKindsViews,
  loadArtifactKindsAbox,
  loadEdgeEstablishers,
  loadEntityKindsAbox,
  loadExternalEntityIdentifiers,
} from './ontology/loader.js';
import type { BootstrapSequence, DomainSemantics, OperationGraph, OperationNode } from './types.js';

class DomainSemanticsValidationFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainSemanticsValidationFailure';
  }
}

// Per-config layout helpers (#128 PR 2). The graph + bundled OpenAPI
// spec live under generated/<config>/graph/ and spec/<config>/bundled/
// respectively, resolved at call time so the active CONFIG env var
// takes effect even after the planner module is cached.
function graphPathFor(repoRoot: string): string {
  return path.join(getGraphDir(repoRoot), 'operation-dependency-graph.json');
}
function openApiSpecPathFor(repoRoot: string): string {
  return path.join(getSpecBundleDir(repoRoot), 'rest-api.bundle.json');
}

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
  // Issue #134 / camunda/camunda#52320: upstream `semantic-kinds.json`
  // payload, attached by the extractor. Lets the planner identify
  // semantic types owned by an `external-entity` kind without
  // reaching back to the spec source.
  kindRegistry?: {
    kinds?: Array<{ name?: string; shape?: string; identifiers?: string[] }>;
  };
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
  // Allow override via env vars (absolute path or relative to baseDir).
  // baseDir points to the path-analyser workspace; the repo root is one level up.
  const repoRoot = path.resolve(baseDir, '..');
  const overrideGraph = process.env.OPERATION_GRAPH_PATH;
  const graphPath = overrideGraph ? path.resolve(baseDir, overrideGraph) : graphPathFor(repoRoot);
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

  // Lift 3 / #208: load the per-config edges ABox up front. The set of
  // edge-establisher opIds is the authoritative source for
  // `op.establishes.shape === 'edge'` going forward; the spec
  // annotation's `shape` field is consulted only for cross-validation
  // (drift warning). When the active config has not shipped an edges
  // ABox, `edgeEstablishers` is `null` and `normalizeEstablishes` falls
  // back to the legacy spec-annotation behaviour for backward compat.
  const edgeEstablishers = loadEdgeEstablishers(repoRoot);

  const operations: Record<string, OperationNode> = {};

  // Support multiple possible root shapes
  // Prefer object map if available (operationsById) to avoid loss of operations due to large array truncation
  let candidateOps: Record<string, RawOp> | RawOp[] | null = Array.isArray(parsed)
    ? parsed
    : (parsed.operationsById ?? parsed.operations ?? parsed.nodes ?? parsed.operationNodes ?? null);

  // Track the root object that ultimately yielded `candidateOps` so
  // sibling fields like `kindRegistry` are sourced from the same
  // nesting level (top-level vs `parsed.graph` vs `parsed.data`).
  // Otherwise a graph file using the nested shape would silently lose
  // its kind registry and disable kind-scoped external-entity minting.
  let opsRoot: RawGraphRoot | null = Array.isArray(parsed)
    ? null
    : candidateOps !== null
      ? parsed
      : null;

  if (!candidateOps && !Array.isArray(parsed)) {
    const g = parsed.graph || parsed.data;
    if (g) {
      candidateOps = Array.isArray(g) ? g : (g.operations ?? g.nodes ?? null);
      if (candidateOps && !Array.isArray(g)) opsRoot = g;
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
      operations[opId] = normalizeOp(opId, op, edgeEstablishers);
    }
  } else {
    for (const [opId, op] of Object.entries(candidateOps)) {
      operations[opId] = normalizeOp(opId, op, edgeEstablishers);
    }
  }

  // Lift 3 / #208: cross-validate the edges ABox against the spec
  // annotations now that every op has been normalised. The ABox is
  // authoritative for `shape: 'edge'` at runtime, but a disagreement
  // with the spec annotation almost always signals a config error
  // (typo in `establishedBy`, ABox missing a recently-added op,
  // upstream rename) — surface it loudly so it doesn't rot.
  //
  // Strict mode (STRICT_EDGES_ABOX=1) escalates drift to a hard error;
  // default is a warning so a partially-migrated config still loads.
  if (edgeEstablishers !== null) {
    const drift = detectEdgeAnnotationDrift(candidateOps, edgeEstablishers, operations);
    if (drift.length > 0) {
      const detail = drift.map((d) => `  - ${d}`).join('\n');
      const message = `edges ABox / spec-annotation drift detected:\n${detail}`;
      if (process.env.STRICT_EDGES_ABOX === '1') {
        throw new Error(message);
      }
      console.warn(`WARNING: ${message}\n  (set STRICT_EDGES_ABOX=1 to fail-fast on drift.)`);
    }
  }

  const producersByType: Record<string, string[]> = {};
  const responseProducersByType: Record<string, string[]> = {};
  const establishersByType: Record<string, string[]> = {};
  // #162 PR 2: per-semantic index of ops that ACCEPT this semantic in
  // their request body. Parallel to producersByType (response side) and
  // establishersByType (request side, identifier-shaped). Used by the
  // planner to find setter sites for clientMintedAttribute semantics.
  const requestSettersByType: Record<string, string[]> = {};
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
    // #162 PR 2: index every semantic-typed request-body leaf so the
    // planner can ask "which ops accept this semantic in their body?"
    // Dedup at the writer — an op with multiple leaves of the same
    // semantic (e.g. `filter.tags[]` AND `filter.$or[].tags[]`) still
    // appears once.
    for (const leaf of op.requestBodySemantics ?? []) {
      const list = requestSettersByType[leaf.semantic] ?? [];
      if (!list.includes(op.operationId)) list.push(op.operationId);
      requestSettersByType[leaf.semantic] = list;
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

  // Domain sidecar load (optional). The file lives under the active
  // config directory at the repo root (see #128). `baseDir` is the
  // path-analyser workspace, so the repo root is its parent.
  let domain: DomainSemantics | undefined;
  let producersByState: Record<string, string[]> | undefined;
  try {
    const repoRoot = path.resolve(baseDir, '..');
    const domainPath = path.resolve(getActiveConfigDir(repoRoot), 'domain-semantics.json');
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

  // Lift 5 / #212: artifact-kinds ABox supersedes the legacy
  // `domain-semantics.json` keys when present. Per #198, artifact
  // dispatch is domain knowledge with no wire signature, so it lives
  // in the per-config ontology rather than in the freeform sidecar.
  // The legacy keys remain a transitional fallback so unmigrated
  // configs (and tests that exercise loadGraph against an isolated
  // tmpDir without a domain-semantics.json) keep working until Lift 8
  // retires them. When both are present, the ABox is authoritative —
  // `detectArtifactKindsDrift` surfaces dead/dangling entries (the
  // durable abox-vs-graph signal) before the override can silently
  // mask them. Placed outside the domain-semantics try/catch so a
  // shipped ABox is honoured even when the legacy sidecar is absent.
  {
    const artifactViews = deriveArtifactKindsViews(repoRoot);
    if (artifactViews !== null) {
      const baseDomain: DomainSemantics = domain ?? { version: 1 };
      domain = {
        ...baseDomain,
        artifactKinds: artifactViews.artifactKinds,
        semanticTypeToArtifactKind: artifactViews.semanticTypeToArtifactKind,
        operationArtifactRules: artifactViews.operationArtifactRules,
        artifactFileKinds: artifactViews.artifactFileKinds,
      };
    }
  }

  // Lift 4 / #210: the entity-kinds ABox is the authoritative runtime
  // source for the external-entity identifier set. Falls back to the
  // spec-emitted `kindRegistry` (Issue #134 / camunda/camunda#52320)
  // when no ABox is shipped — the legacy path stays alive so
  // unmigrated configs and tests using isolated tmpDirs still work.
  // Mirrors the Lift 3 (#208) edges-ABox pattern.
  let externalEntityIdentifiers: Set<string> | undefined;
  const aboxExternals = loadExternalEntityIdentifiers(repoRoot);
  if (aboxExternals !== null) {
    if (aboxExternals.size > 0) externalEntityIdentifiers = aboxExternals;
  } else if (opsRoot) {
    // Source the registry from the same root that yielded `candidateOps`
    // so nested-graph layouts (`parsed.graph` / `parsed.data`) are
    // handled consistently with the top-level layout.
    const registry = opsRoot.kindRegistry;
    if (registry && Array.isArray(registry.kinds)) {
      const set = new Set<string>();
      for (const k of registry.kinds) {
        if (k && k.shape === 'external-entity' && Array.isArray(k.identifiers)) {
          for (const id of k.identifiers) {
            if (typeof id === 'string' && id.length > 0) set.add(id);
          }
        }
      }
      if (set.size > 0) externalEntityIdentifiers = set;
    }
  }

  // Lift 4 / #210: cross-validate the entity-kinds ABox against both
  // the spec-emitted kindRegistry (transitional, sense 1) and the
  // bundled-graph use-sites (durable, sense 2). The two senses have
  // different lifetimes — sense 1 is migration scaffolding that
  // retires when upstream drops `x-semantic-kind`; sense 2 is the
  // permanent gate that catches "upstream added a new endpoint and
  // we forgot to update the ABox" (the locality-loss replacement
  // signal). See #210 §4b for the full rationale.
  if (aboxExternals !== null) {
    const drift = detectEntityKindsDrift(opsRoot?.kindRegistry, operations, repoRoot);
    if (drift.length > 0) {
      const detail = drift.map((d) => `  - ${d}`).join('\n');
      const message = `entity-kinds ABox drift detected:\n${detail}`;
      if (process.env.STRICT_ENTITY_KINDS_ABOX === '1') {
        throw new Error(message);
      }
      console.warn(
        `WARNING: ${message}\n  (set STRICT_ENTITY_KINDS_ABOX=1 to fail-fast on drift.)`,
      );
    }
  }

  // Lift 5 / #212: cross-validate the artifact-kinds ABox against the
  // bundled graph (durable, sense 2 only — there is no spec source for
  // these facts to disagree with). Catches: rules naming nonexistent
  // operations / artifact kinds; semantic-types mapped to nonexistent
  // kinds; file-extension entries pointing at nonexistent kinds; kinds
  // not referenced by any rule, semanticTypeMap entry, or
  // fileExtensionMap entry (dead weight). The locality-loss
  // replacement signal: surfaces drift when the upstream API adds a
  // new artifact-flavoured op and the ABox isn't updated.
  {
    const drift = detectArtifactKindsDrift(operations, repoRoot);
    if (drift.length > 0) {
      const detail = drift.map((d) => `  - ${d}`).join('\n');
      const message = `artifact-kinds ABox drift detected:\n${detail}`;
      if (process.env.STRICT_ARTIFACT_KINDS_ABOX === '1') {
        throw new Error(message);
      }
      console.warn(
        `WARNING: ${message}\n  (set STRICT_ARTIFACT_KINDS_ABOX=1 to fail-fast on drift.)`,
      );
    }
  }

  const graph: OperationGraph = {
    operations,
    producersByType,
    responseProducersByType,
    bootstrapSequences,
    domain,
    producersByState,
    establishersByType: Object.keys(establishersByType).length ? establishersByType : undefined,
    externalEntityIdentifiers,
    requestSettersByType: Object.keys(requestSettersByType).length
      ? requestSettersByType
      : undefined,
  };
  // #159 PR B (review): the structural domain-semantics validator can't
  // see the graph, so a witness operationId that doesn't resolve (typo,
  // renamed-upstream op, etc.) would slip through it and the planner
  // would silently skip the wait — reintroducing the racing-broker bug.
  // Run the graph-cross-ref check here, after the graph is fully
  // assembled, and fail fast with the same exception type as the
  // structural validator so the diagnostic surfaces with one well-known
  // shape regardless of which check fired.
  const witnessIssues = validateRuntimeStateWitnessGraphRefs(graph);
  if (witnessIssues.length > 0) {
    const detail = witnessIssues.map((i) => `  - [${i.invariant}] ${i.message}`).join('\n');
    throw new DomainSemanticsValidationFailure(
      `domain-semantics.json failed cross-reference validation against the bundled spec:\n${detail}`,
    );
  }
  // #162 PR 5: every semantic referenced by an operation's
  // requestBodySemanticTypes must classify into one of the five
  // terminal classifications (see bindSemanticInput.ts). An
  // unclassified semantic means the planner has no rule for what value
  // to bind into the request body — fail-fast here so a future spec
  // change that introduces a new semantic without an accompanying
  // domain-semantics declaration is caught at load time rather than
  // surfacing as an unexplained placeholder in the emitted suite.
  const classificationIssues = validateRequestBodySemanticsClassified(graph);
  if (classificationIssues.length > 0) {
    const detail = classificationIssues.map((i) => `  - [${i.invariant}] ${i.message}`).join('\n');
    throw new DomainSemanticsValidationFailure(
      `operation graph has unclassified requestBodySemanticTypes entries:\n${detail}`,
    );
  }
  return graph;
}

function normalizeOp(opId: string, op: RawOp, edgeEstablishers: Set<string> | null): OperationNode {
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
  const establishes = normalizeEstablishes(op.establishes, opId, edgeEstablishers);
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
    requestBodySemantics: extractRequestBodySemantics(op),
    establishes,
  };
}

/**
 * Surface every semantic-typed request-body leaf on the OperationNode
 * so downstream consumers (the requestSettersByType index, the planner's
 * clientMintedAttribute helper) can iterate without re-reading the raw
 * graph JSON. Unlike `optionalSubShapes` this list is INCLUSIVE — it
 * carries nested, top-level, scalar-array, and required leaves; the
 * consumer filters as needed (#162 PR 2).
 */
function extractRequestBodySemantics(op: RawOp): OperationNode['requestBodySemantics'] {
  if (!Array.isArray(op.requestBodySemanticTypes)) return undefined;
  const out: NonNullable<OperationNode['requestBodySemantics']> = [];
  for (const entry of op.requestBodySemanticTypes) {
    if (!entry || typeof entry.semanticType !== 'string' || typeof entry.fieldPath !== 'string') {
      continue;
    }
    out.push({
      semantic: entry.semanticType,
      fieldPath: entry.fieldPath,
      required: entry.required === true,
    });
  }
  return out.length ? out : undefined;
}

function normalizeEstablishes(
  raw: unknown,
  opId: string,
  edgeEstablishers: Set<string> | null,
): OperationNode['establishes'] {
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
    const e = id as {
      in?: unknown;
      name?: unknown;
      semanticType?: unknown;
      acceptsExternal?: unknown;
    };
    if (e.in !== 'body' && e.in !== 'path') return undefined;
    if (typeof e.name !== 'string' || e.name.length === 0) return undefined;
    if (typeof e.semanticType !== 'string' || e.semanticType.length === 0) return undefined;
    // Issue #134: `acceptsExternal` is optional; if present MUST be a
    // boolean. Mirrors the extractor's strict gate — silently coercing
    // a stringy "true" would let an upstream typo enable bimodal
    // fallback at sites that intended a hard chain.
    if (e.acceptsExternal !== undefined && typeof e.acceptsExternal !== 'boolean') {
      return undefined;
    }
    const entry: (typeof identifiedBy)[number] = {
      in: e.in,
      name: e.name,
      semanticType: e.semanticType,
    };
    if (e.acceptsExternal === true) entry.acceptsExternal = true;
    identifiedBy.push(entry);
  }
  // Lift 3 / #208: ABox is the authoritative source for `shape: 'edge'`
  // when the active config has shipped an edges ABox. The spec
  // annotation's `shape` field is consulted only as a fallback (for
  // configs without an ABox) and as a drift signal (cross-validated by
  // a separate check in loadGraph after all ops are normalised).
  //
  // When the ABox is present:
  //   - opId in `edgeEstablishers` ⇒ `shape: 'edge'` (regardless of
  //     what the spec annotation says).
  //   - opId NOT in `edgeEstablishers` ⇒ `shape: undefined` (treat as
  //     non-edge even if the spec annotation says `shape: 'edge'`; the
  //     drift is surfaced as a warning by detectEdgeAnnotationDrift).
  //
  // When the ABox is absent (`edgeEstablishers === null`), fall back to
  // the legacy spec-annotation behaviour for backward compat with
  // configs that have not yet migrated.
  const rawShape = r.shape;
  let resolvedShape: 'edge' | undefined;
  if (edgeEstablishers !== null) {
    resolvedShape = edgeEstablishers.has(opId) ? 'edge' : undefined;
  } else {
    // Legacy spec-driven behaviour: same `shape` restriction as the
    // extractor. An unknown string would silently degrade to non-edge
    // behaviour and `normalizeOp` would push the components into
    // `produces` and strip them from `requires` — the exact opposite
    // of the intended edge semantics. Reject unknown shapes wholesale.
    const shapeValid = rawShape === undefined || rawShape === 'edge';
    if (!shapeValid) return undefined;
    resolvedShape = rawShape === 'edge' ? 'edge' : undefined;
  }
  return {
    kind: r.kind,
    shape: resolvedShape,
    identifiedBy,
  };
}

/**
 * Lift 3 / #208: detect drift between the edges ABox (authoritative
 * for `shape: 'edge'`) and the per-op `x-semantic-establishes.shape`
 * annotations from the spec. Returns one human-readable line per
 * disagreement; an empty array means the two are consistent.
 *
 * Two drift kinds:
 *   - **ABox lists op X but spec annotation says non-edge** (or no
 *     annotation at all): the planner will treat X as an edge
 *     establisher, but the spec disagrees — likely an ABox typo or a
 *     stale spec annotation.
 *   - **Spec says X is `shape: 'edge'` but ABox does not list X**: the
 *     planner now treats X as a non-edge (per ABox); the spec
 *     annotation is being ignored — likely an ABox missed an op or a
 *     spec annotation is stale.
 *
 * Either condition is loud: silently letting the planner classify the
 * op the wrong way would re-introduce the partial-state hazard #112
 * was meant to close.
 */
function detectEdgeAnnotationDrift(
  candidateOps: Record<string, RawOp> | RawOp[],
  edgeEstablishers: Set<string>,
  operations: Record<string, OperationNode>,
): string[] {
  const drift: string[] = [];
  const specEdgeOps = new Set<string>();
  const iterate = (cb: (opId: string, op: RawOp) => void) => {
    if (Array.isArray(candidateOps)) {
      for (const op of candidateOps) {
        const opId = op?.operationId || op?.id || op?.name;
        if (opId) cb(opId, op);
      }
    } else {
      for (const [opId, op] of Object.entries(candidateOps)) cb(opId, op);
    }
  };
  iterate((opId, op) => {
    const est = op.establishes;
    if (est === null || typeof est !== 'object') return;
    // biome-ignore lint/plugin: drift detection inspects raw spec-annotation contract; result is narrowed by literal comparison below.
    const shape = (est as Record<string, unknown>).shape;
    if (shape === 'edge') {
      specEdgeOps.add(opId);
    }
  });
  for (const opId of edgeEstablishers) {
    if (!(opId in operations)) {
      drift.push(`ABox lists '${opId}' as an edge establisher, but the op is not in the spec`);
      continue;
    }
    if (!specEdgeOps.has(opId)) {
      drift.push(
        `ABox lists '${opId}' as an edge establisher, but the spec annotation does not have shape: 'edge' (ABox is authoritative; spec annotation will be ignored)`,
      );
    }
  }
  for (const opId of specEdgeOps) {
    if (!edgeEstablishers.has(opId)) {
      drift.push(
        `spec annotates '${opId}' with shape: 'edge', but the ABox does not list it as an edge establisher (ABox is authoritative; '${opId}' will be treated as a non-edge establisher)`,
      );
    }
  }
  return drift;
}

/**
 * Cross-validate the entity-kinds ABox against (1) the spec-emitted
 * `kindRegistry` payload and (2) the bundled-graph use-sites. Lift 4 /
 * #210 introduces two senses of drift with different lifetimes; both
 * are checked here.
 *
 *   - **Sense 1 (transitional, `spec-vs-abox`)**: cross-checks the ABox
 *     against the spec's `kindRegistry`. Useful migration scaffolding;
 *     becomes a no-op once `x-semantic-kind` retires upstream.
 *
 *       - ABox lists kind X but kindRegistry does not.
 *       - kindRegistry lists kind X but ABox does not.
 *
 *   - **Sense 2 (durable, `abox-vs-graph`)**: grounds drift in actual
 *     runtime use of the bundled graph. Permanent gate that catches
 *     "upstream added a new endpoint and we forgot to update the ABox".
 *
 *       - ABox lists kind X but no operation in the graph references
 *         any of X's identifier types in `produces[]`, `requires[]`,
 *         or `establishes.identifiedBy[]`. X is dead weight.
 *
 *   The reverse Sense-2 direction (semantic type appears in the graph
 *   but no kind classifies it) is enforced as an L3 coverage invariant
 *   in `configs/<config>/regression-invariants.test.ts` instead of
 *   here, because it depends on per-config classification of which
 *   semantic types are *identifiers* (vs ordinary value fields), which
 *   the loader does not own.
 */
function detectEntityKindsDrift(
  rawRegistry: RawGraphRoot['kindRegistry'] | undefined,
  operations: Record<string, OperationNode>,
  repoRoot: string,
): string[] {
  const drift: string[] = [];
  const abox = loadEntityKindsAbox(repoRoot);
  if (abox === null) return drift;

  const aboxByName = new Map(abox.kinds.map((k) => [k.name, k]));

  if (rawRegistry && Array.isArray(rawRegistry.kinds)) {
    const specByName = new Map<string, { name?: unknown }>();
    for (const k of rawRegistry.kinds) {
      if (k && typeof k.name === 'string') specByName.set(k.name, k);
    }
    for (const [name] of aboxByName) {
      if (!specByName.has(name)) {
        drift.push(
          `[spec-vs-abox] ABox lists kind '${name}', but spec kindRegistry does not (transitional check; safe to ignore once spec annotation retires upstream)`,
        );
      }
    }
    for (const [name] of specByName) {
      if (!aboxByName.has(name)) {
        drift.push(
          `[spec-vs-abox] spec kindRegistry lists kind '${name}', but ABox does not (ABox is authoritative; spec entry will be ignored)`,
        );
      }
    }
  }

  const referencedTypes = new Set<string>();
  for (const op of Object.values(operations)) {
    for (const t of op.produces) referencedTypes.add(t);
    for (const t of op.requires.required) referencedTypes.add(t);
    for (const t of op.requires.optional) referencedTypes.add(t);
    if (op.establishes) {
      for (const id of op.establishes.identifiedBy) referencedTypes.add(id.semanticType);
    }
  }
  for (const [name, kind] of aboxByName) {
    const used = kind.identifiers.some((t) => referencedTypes.has(t));
    if (!used) {
      drift.push(
        `[abox-vs-graph] ABox lists kind '${name}' (identifiers: ${kind.identifiers.join(', ')}), but none of those identifier types are referenced by any operation in the graph (kind is dead weight; either remove from ABox or add a consumer op)`,
      );
    }
  }

  return drift;
}

/**
 * Cross-validate the artifact-kinds ABox against the bundled-graph
 * use-sites. Lift 5 / #212. Unlike the entity-kinds detector, there is
 * no transitional `spec-vs-abox` sense — the data was never sourced
 * from the upstream OpenAPI spec, so there is no second source of
 * truth for the ABox to disagree with. Only the durable
 * `abox-vs-graph` (sense-2) checks apply:
 *
 *   - rule operationIds reference real ops in the graph;
 *   - rule artifactKind / semanticTypeMap.artifactKind /
 *     fileExtensionMap.artifactKinds entries reference real kinds;
 *   - every kind is referenced by at least one rule, semanticTypeMap
 *     entry, or fileExtensionMap entry (no dead kinds).
 *
 * Returns an empty list when no ABox is shipped, so the caller treats
 * the legacy `domain-semantics.json` fallback as drift-free.
 */
function detectArtifactKindsDrift(
  operations: Record<string, OperationNode>,
  repoRoot: string,
): string[] {
  const drift: string[] = [];
  const abox = loadArtifactKindsAbox(repoRoot);
  if (abox === null) return drift;

  const kindNames = new Set(abox.kinds.map((k) => k.name));

  for (const rule of abox.operationRules) {
    if (!operations[rule.operationId]) {
      drift.push(
        `[abox-vs-graph] operationRules entry '${rule.operationId}' references an opId that does not exist in the bundled graph (typo, renamed-upstream op, or stale entry)`,
      );
    }
    for (const r of rule.rules) {
      if (!kindNames.has(r.artifactKind)) {
        drift.push(
          `[abox-vs-graph] operationRules['${rule.operationId}'].rules['${r.id}'] references unknown artifactKind '${r.artifactKind}'`,
        );
      }
    }
  }
  for (const m of abox.semanticTypeMap) {
    if (!kindNames.has(m.artifactKind)) {
      drift.push(
        `[abox-vs-graph] semanticTypeMap entry '${m.semanticType}' → '${m.artifactKind}' references unknown artifactKind`,
      );
    }
  }
  for (const m of abox.fileExtensionMap) {
    for (const kind of m.artifactKinds) {
      if (!kindNames.has(kind)) {
        drift.push(
          `[abox-vs-graph] fileExtensionMap entry '${m.extension}' references unknown artifactKind '${kind}'`,
        );
      }
    }
  }

  // Dead-weight check: every kind must be referenced from at least one
  // of the three side-tables. A kind that nothing references can never
  // be dispatched to, and is almost certainly a stale entry from an
  // earlier API surface.
  const referencedKinds = new Set<string>();
  for (const rule of abox.operationRules) {
    for (const r of rule.rules) referencedKinds.add(r.artifactKind);
  }
  for (const m of abox.semanticTypeMap) referencedKinds.add(m.artifactKind);
  for (const m of abox.fileExtensionMap) {
    for (const k of m.artifactKinds) referencedKinds.add(k);
  }
  for (const k of abox.kinds) {
    if (!referencedKinds.has(k.name)) {
      drift.push(
        `[abox-vs-graph] ABox lists kind '${k.name}' but no operationRules / semanticTypeMap / fileExtensionMap entry references it (dead weight; either remove from ABox or add a referencing entry)`,
      );
    }
  }

  return drift;
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
    if (root === null) continue;
    const list = groups.get(root) ?? [];
    list.push({ fieldPath, semantic });
    groups.set(root, list);
  }
  return [...groups.entries()].map(([rootPath, leaves]) => ({ rootPath, leaves }));
}

// Strip the trailing leaf segment from a fieldPath to get its sub-shape
// root, or `null` if the fieldPath is an operator-object construct that
// is not a real populated-vs-omitted shape.
//
// Post-#162-PR4 the variant suite owns EVERY populated-optional path —
// nested object leaves, scalar-array leaves, and flat top-level scalars
// alike — so the previous "only count nested object sub-shapes" filters
// (`segments.length < 2`, `lastSegment.endsWith('[]')`) have been
// removed. The `$` operator-object filter is preserved because
// operator subtrees (`filter.x.$eq`, `.$in[]`, …) are pseudo-fields
// the extractor surfaces for filter expressiveness, not a settable
// shape.
//
//   "startInstructions[].elementId" -> "startInstructions[]"  (nested object)
//   "filter.processInstanceKey"      -> "filter"             (nested object)
//   "filter.tags[]"                   -> "filter"             (scalar array under filter)
//   "tags[]"                          -> ""                   (top-level scalar array)
//   "tenantId"                        -> ""                   (flat top-level scalar)
//   "filter.elementId.$eq"           -> null  (operator object)
function subShapeRootOf(fieldPath: string): string | null {
  const segments = fieldPath.split('.');
  const lastSegment = segments[segments.length - 1];
  if (lastSegment.startsWith('$')) return null;
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
  const repoRoot = path.resolve(baseDir, '..');
  const overrideSpec = process.env.OPENAPI_SPEC_PATH;
  const specPath = overrideSpec
    ? path.resolve(baseDir, overrideSpec)
    : openApiSpecPathFor(repoRoot);
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
