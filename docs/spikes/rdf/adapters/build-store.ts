// Spike adapter: turn the normalised OperationGraph + DomainSemantics
// into RDF triples loaded into an in-process Oxigraph store.
//
// Consumes the *output* of path-analyser/src/graphLoader.ts rather than
// re-parsing the raw JSON. This is a deliberate spike shortcut:
//
//   - The loader's tolerance for 6+ key permutations is documented and
//     tested; reproducing that parsing isn't novel research.
//   - The spike claim is "the ontology faithfully captures the model",
//     not "we have ported the loader". A production move would either
//     port the loader to emit triples directly, or keep it as a
//     pre-normalisation step.
//
// Spike: docs/spikes/rdf/README.md / issue #60.

// biome-ignore lint/correctness/noNodejsModules: spike-only; not shipped to consumers.
import path from 'node:path';
// biome-ignore lint/style/useImportType: oxigraph exports values + types together.
import oxigraph from 'oxigraph';
import { loadGraph } from '../../../../path-analyser/src/graphLoader.js';
import type { OperationGraph } from '../../../../path-analyser/src/types.js';

export const NS = {
  core: 'https://camunda.io/api-test-generator/core#',
  camunda: 'https://camunda.io/api-test-generator/camunda#',
  op: 'https://camunda.io/api-test-generator/operation#',
  type: 'https://camunda.io/api-test-generator/type#',
  state: 'https://camunda.io/api-test-generator/state#',
  cap: 'https://camunda.io/api-test-generator/capability#',
  field: 'https://camunda.io/api-test-generator/field#',
  binding: 'https://camunda.io/api-test-generator/binding#',
  artifact: 'https://camunda.io/api-test-generator/artifact#',
  ident: 'https://camunda.io/api-test-generator/identifier#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
} as const;

const RDF_TYPE = `${NS.rdf}type`;

// IRIs for runtime states are built from the state name. domain-semantics
// has runtimeStates and capabilities under separate keys but they live in
// the same conceptual space (a Capability is a subclass of RuntimeState
// in core.ttl), so we mint the same IRI shape for both.
const stateIri = (name: string): string => `${NS.state}${encodeURIComponent(name)}`;
const opIri = (id: string): string => `${NS.op}${encodeURIComponent(id)}`;
const typeIri = (name: string): string => `${NS.type}${encodeURIComponent(name)}`;
const fieldIri = (opId: string, p: string): string =>
  `${NS.field}${encodeURIComponent(opId)}/${encodeURIComponent(p)}`;
const bindingIri = (opId: string, key: string): string =>
  `${NS.binding}${encodeURIComponent(opId)}/${encodeURIComponent(key)}`;
const identIri = (name: string): string => `${NS.ident}${encodeURIComponent(name)}`;
const artifactIri = (kind: string): string => `${NS.artifact}${encodeURIComponent(kind)}`;

interface AdapterStats {
  operations: number;
  semanticTypes: number;
  produces: number;
  requires: number;
  authoritativeProducers: number;
  runtimeStates: number;
  capabilities: number;
  producesState: number;
  requiresState: number;
  implicitlyAdds: number;
  disjunctions: number;
  valueBindings: number;
  identifiers: number;
  artifactKinds: number;
  fieldPaths: number;
}

export interface AdapterResult {
  store: oxigraph.Store;
  stats: AdapterStats;
}

/** Materialise the unified graph from the current pipeline state. */
export async function buildStore(baseDir: string): Promise<AdapterResult> {
  const graph = await loadGraph(baseDir);
  const store = new oxigraph.Store();
  const stats: AdapterStats = {
    operations: 0,
    semanticTypes: 0,
    produces: 0,
    requires: 0,
    authoritativeProducers: 0,
    runtimeStates: 0,
    capabilities: 0,
    producesState: 0,
    requiresState: 0,
    implicitlyAdds: 0,
    disjunctions: 0,
    valueBindings: 0,
    identifiers: 0,
    artifactKinds: 0,
    fieldPaths: 0,
  };

  emitOperations(store, graph, stats);
  emitDomain(store, graph, stats);
  return { store, stats };
}

// ---------------------------------------------------------------------------
// Operations + semantic-type production / consumption + canonical field paths
// ---------------------------------------------------------------------------

function emitOperations(store: oxigraph.Store, graph: OperationGraph, stats: AdapterStats): void {
  const semanticTypesSeen = new Set<string>();

  for (const op of Object.values(graph.operations)) {
    const subj = oxigraph.namedNode(opIri(op.operationId));
    addType(store, subj, `${NS.core}Operation`);
    addLit(store, subj, `${NS.core}operationId`, op.operationId);
    addLit(store, subj, `${NS.core}method`, op.method);
    if (op.path) addLit(store, subj, `${NS.core}path`, op.path);
    if (op.eventuallyConsistent === true) {
      addBool(store, subj, `${NS.core}eventuallyConsistent`, true);
    }
    stats.operations++;

    for (const t of op.produces) {
      const tNode = oxigraph.namedNode(typeIri(t));
      ensureSemanticType(store, tNode, t, semanticTypesSeen, stats);
      addRel(store, subj, `${NS.core}produces`, tNode);
      stats.produces++;
      if (op.providerMap?.[t]) {
        addRel(store, subj, `${NS.core}authoritativeProducer`, tNode);
        stats.authoritativeProducers++;
      }
    }
    for (const t of op.requires.required) {
      const tNode = oxigraph.namedNode(typeIri(t));
      ensureSemanticType(store, tNode, t, semanticTypesSeen, stats);
      addRel(store, subj, `${NS.core}requires`, tNode);
      stats.requires++;
    }
    for (const t of op.requires.optional) {
      const tNode = oxigraph.namedNode(typeIri(t));
      ensureSemanticType(store, tNode, t, semanticTypesSeen, stats);
      addRel(store, subj, `${NS.core}requiresOptional`, tNode);
    }

    // Canonical response field paths: each entry under
    // op.responseSemanticTypes[status][i] becomes a FieldPath node located
    // on this Operation that locates the named SemanticType.
    if (op.responseSemanticTypes) {
      for (const entries of Object.values(op.responseSemanticTypes)) {
        for (const e of entries) {
          const fp = oxigraph.namedNode(fieldIri(op.operationId, e.fieldPath));
          addType(store, fp, `${NS.core}FieldPath`);
          addLit(store, fp, `${NS.core}fieldPath`, e.fieldPath);
          addRel(store, fp, `${NS.core}onResponseOf`, subj);
          const tNode = oxigraph.namedNode(typeIri(e.semanticType));
          ensureSemanticType(store, tNode, e.semanticType, semanticTypesSeen, stats);
          addRel(store, fp, `${NS.core}locatesSemanticType`, tNode);
          if (e.required) addBool(store, fp, `${NS.core}isRequiredField`, true);
          stats.fieldPaths++;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Domain semantics: runtime states, capabilities, identifiers, value bindings,
// artifact kinds, disjunctions.
// ---------------------------------------------------------------------------

function emitDomain(store: oxigraph.Store, graph: OperationGraph, stats: AdapterStats): void {
  const dom = graph.domain;
  if (!dom) return;

  // Runtime states ---------------------------------------------------------
  for (const [name, spec] of Object.entries(dom.runtimeStates ?? {})) {
    const subj = oxigraph.namedNode(stateIri(name));
    addType(store, subj, `${NS.core}RuntimeState`);
    if (spec.parameter) addLit(store, subj, `${NS.core}hasParameter`, spec.parameter);
    if (spec.requires) {
      for (const r of spec.requires) addRel(store, subj, `${NS.core}dependsOn`, oxigraph.namedNode(stateIri(r)));
    }
    if (spec.producedBy) {
      for (const opId of spec.producedBy) {
        addRel(store, oxigraph.namedNode(opIri(opId)), `${NS.core}producesState`, subj);
        stats.producesState++;
      }
    }
    stats.runtimeStates++;
  }

  // Capabilities (subclass of RuntimeState in core.ttl) -------------------
  for (const [name, spec] of Object.entries(dom.capabilities ?? {})) {
    const subj = oxigraph.namedNode(stateIri(name));
    addType(store, subj, `${NS.core}Capability`);
    addType(store, subj, `${NS.core}RuntimeState`); // explicit; oxigraph doesn't reason subclass
    if (spec.parameter) addLit(store, subj, `${NS.core}hasParameter`, spec.parameter);
    if (spec.dependsOn) {
      for (const d of spec.dependsOn) addRel(store, subj, `${NS.core}dependsOn`, oxigraph.namedNode(stateIri(d)));
    }
    if (spec.producedBy) {
      for (const opId of spec.producedBy) {
        addRel(store, oxigraph.namedNode(opIri(opId)), `${NS.core}producesState`, subj);
        stats.producesState++;
      }
    }
    stats.capabilities++;
  }

  // Identifiers ------------------------------------------------------------
  for (const [name, spec] of Object.entries(dom.identifiers ?? {})) {
    const subj = oxigraph.namedNode(identIri(name));
    addType(store, subj, `${NS.core}Identifier`);
    addType(store, subj, `${NS.core}SemanticType`);
    if (spec.validityState) {
      addRel(store, subj, `${NS.core}validityState`, oxigraph.namedNode(stateIri(spec.validityState)));
    }
    stats.identifiers++;
  }

  // Artifact kinds --------------------------------------------------------
  for (const [name, spec] of Object.entries(dom.artifactKinds ?? {})) {
    const subj = oxigraph.namedNode(artifactIri(name));
    addType(store, subj, `${NS.core}ArtifactKind`);
    if (spec.producesStates) {
      for (const s of spec.producesStates)
        addRel(store, subj, `${NS.core}producesStateViaArtifact`, oxigraph.namedNode(stateIri(s)));
    }
    if (spec.producesSemantics) {
      for (const t of spec.producesSemantics)
        addRel(store, subj, `${NS.core}producesSemanticViaArtifact`, oxigraph.namedNode(typeIri(t)));
    }
    stats.artifactKinds++;
  }

  // Operation requirements: requires, disjunctions, implicitAdds, valueBindings.
  for (const [opId, req] of Object.entries(dom.operationRequirements ?? {})) {
    const opNode = oxigraph.namedNode(opIri(opId));
    if (req.requires) {
      for (const s of req.requires) {
        addRel(store, opNode, `${NS.core}requiresState`, oxigraph.namedNode(stateIri(s)));
        stats.requiresState++;
      }
    }
    if (req.implicitAdds) {
      for (const s of req.implicitAdds) {
        addRel(store, opNode, `${NS.core}implicitlyAdds`, oxigraph.namedNode(stateIri(s)));
        stats.implicitlyAdds++;
      }
    }
    if (req.produces) {
      for (const s of req.produces) {
        addRel(store, opNode, `${NS.core}producesState`, oxigraph.namedNode(stateIri(s)));
        stats.producesState++;
      }
    }
    if (req.disjunctions) {
      for (let i = 0; i < req.disjunctions.length; i++) {
        const d = req.disjunctions[i];
        if (!d) continue;
        const dNode = oxigraph.blankNode(`${opId}_disj_${i}`);
        addType(store, dNode, `${NS.core}Disjunction`);
        addRel(store, opNode, `${NS.core}disjunctionOf`, dNode);
        for (const s of d) addRel(store, dNode, `${NS.core}hasAlternative`, oxigraph.namedNode(stateIri(s)));
        stats.disjunctions++;
      }
    }
    if (req.valueBindings) {
      for (const [key, value] of Object.entries(req.valueBindings)) {
        const vb = oxigraph.namedNode(bindingIri(opId, key));
        addType(store, vb, `${NS.core}ValueBinding`);
        addRel(store, opNode, `${NS.core}bindingOf`, vb);
        // key looks like "request.processDefinitionId" or
        // "response.deployments[].processDefinition.processDefinitionId"
        const direction = key.startsWith('request.')
          ? 'request'
          : key.startsWith('response.')
            ? 'response'
            : 'unknown';
        addLit(store, vb, `${NS.core}bindingDirection`, direction);
        const fpStr = key.replace(/^request\.|^response\./, '');
        // Best-effort link to a known FieldPath node. May resolve to nothing
        // (this is exactly the silent-miss class SHACL surfaces — see
        // queries/value-binding-drift.ts).
        addRel(store, vb, `${NS.core}bindsFromFieldPath`, oxigraph.namedNode(fieldIri(opId, fpStr)));
        // value looks like "ProcessDefinitionDeployed.processDefinitionId"
        const dot = value.indexOf('.');
        if (dot >= 0) {
          const stateName = value.slice(0, dot);
          const param = value.slice(dot + 1);
          addRel(store, vb, `${NS.core}bindsToState`, oxigraph.namedNode(stateIri(stateName)));
          addLit(store, vb, `${NS.core}bindsToParameter`, param);
        }
        stats.valueBindings++;
      }
    }
  }

  // semanticTypeToArtifactKind: emits producesSemanticViaArtifact in
  // reverse direction so SPARQL doesn't need a join.
  for (const [type, kind] of Object.entries(dom.semanticTypeToArtifactKind ?? {})) {
    addRel(
      store,
      oxigraph.namedNode(artifactIri(kind)),
      `${NS.core}producesSemanticViaArtifact`,
      oxigraph.namedNode(typeIri(type)),
    );
  }
}

// ---------------------------------------------------------------------------
// Triple helpers
// ---------------------------------------------------------------------------

function ensureSemanticType(
  store: oxigraph.Store,
  node: oxigraph.NamedNode,
  name: string,
  seen: Set<string>,
  stats: AdapterStats,
): void {
  if (seen.has(name)) return;
  seen.add(name);
  addType(store, node, `${NS.core}SemanticType`);
  addLit(store, node, `${NS.rdf}label`, name);
  stats.semanticTypes++;
}

function addType(store: oxigraph.Store, subj: oxigraph.NamedNode | oxigraph.BlankNode, cls: string): void {
  store.add(oxigraph.triple(subj, oxigraph.namedNode(RDF_TYPE), oxigraph.namedNode(cls)));
}
function addRel(
  store: oxigraph.Store,
  subj: oxigraph.NamedNode | oxigraph.BlankNode,
  pred: string,
  obj: oxigraph.NamedNode | oxigraph.BlankNode,
): void {
  store.add(oxigraph.triple(subj, oxigraph.namedNode(pred), obj));
}
function addLit(
  store: oxigraph.Store,
  subj: oxigraph.NamedNode | oxigraph.BlankNode,
  pred: string,
  v: string,
): void {
  store.add(oxigraph.triple(subj, oxigraph.namedNode(pred), oxigraph.literal(v)));
}
function addBool(
  store: oxigraph.Store,
  subj: oxigraph.NamedNode | oxigraph.BlankNode,
  pred: string,
  v: boolean,
): void {
  store.add(
    oxigraph.triple(
      subj,
      oxigraph.namedNode(pred),
      oxigraph.literal(String(v), oxigraph.namedNode(`${NS.xsd}boolean`)),
    ),
  );
}

// ---------------------------------------------------------------------------
// CLI: print stats so a human can sanity-check the materialisation.
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseDir = path.resolve(import.meta.dirname, '../../../../path-analyser');
  buildStore(baseDir).then((res) => {
    console.log('Materialised triples from current pipeline state.');
    console.log('Stats:', JSON.stringify(res.stats, null, 2));
    console.log(`Total quads in store: ${res.store.size}`);
  });
}
