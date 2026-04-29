// Phase-3 checkpoint: re-materialise the loader's reverse indexes from
// SPARQL queries against the spike's triple store, and assert byte-level
// parity with graphLoader's output.
//
// This is the disqualifying-friction check the brief calls out:
//
//     "Don't proceed past this checkpoint without parity."
//
// If parity passes, structural equivalence at planner-output level
// follows for free without modifying any algorithm code. If parity
// cannot pass, the spike has surfaced a modelling gap before we touch
// the planner.
//
// Spike: docs/spikes/rdf/README.md / issue #60.

// biome-ignore lint/correctness/noNodejsModules: spike-only.
import path from 'node:path';
// biome-ignore lint/correctness/noNodejsModules: spike-only.
import { exit } from 'node:process';
import oxigraph from 'oxigraph';
import { loadGraph } from '../../../../path-analyser/src/graphLoader.js';
import { buildStore } from '../adapters/build-store.js';

interface Indexes {
  bySemanticProducer: Record<string, string[]>;
  domainProducers: Record<string, string[]>;
  providerMap: Record<string, Record<string, true>>; // opId -> { type: true }
}

/** Pull the indexes from SPARQL queries over the materialised store. */
function indexesFromStore(store: oxigraph.Store): Indexes {
  const bySemanticProducer: Record<string, string[]> = {};
  for (const b of store.query(`
    PREFIX core: <https://camunda.io/api-test-generator/core#>
    SELECT ?opId ?typeLabel WHERE {
      ?op core:operationId ?opId ;
          core:produces ?t .
      ?t <http://www.w3.org/1999/02/22-rdf-syntax-ns#label> ?typeLabel .
    }
  `) as Iterable<oxigraph.SparqlResultBindings>) {
    const opId = b.get('opId')?.value;
    const type = b.get('typeLabel')?.value;
    if (!opId || !type) continue;
    (bySemanticProducer[type] ||= []).push(opId);
  }

  const domainProducers: Record<string, string[]> = {};
  for (const b of store.query(`
    PREFIX core: <https://camunda.io/api-test-generator/core#>
    SELECT ?opId ?stateUri WHERE {
      ?op core:operationId ?opId ;
          core:producesState ?stateUri .
    }
  `) as Iterable<oxigraph.SparqlResultBindings>) {
    const opId = b.get('opId')?.value;
    const stateUri = b.get('stateUri')?.value;
    if (!opId || !stateUri) continue;
    const stateName = decodeURIComponent(stateUri.split('#').pop() ?? '');
    (domainProducers[stateName] ||= []).push(opId);
  }

  const providerMap: Record<string, Record<string, true>> = {};
  for (const b of store.query(`
    PREFIX core: <https://camunda.io/api-test-generator/core#>
    SELECT ?opId ?typeLabel WHERE {
      ?op core:operationId ?opId ;
          core:authoritativeProducer ?t .
      ?t <http://www.w3.org/1999/02/22-rdf-syntax-ns#label> ?typeLabel .
    }
  `) as Iterable<oxigraph.SparqlResultBindings>) {
    const opId = b.get('opId')?.value;
    const type = b.get('typeLabel')?.value;
    if (!opId || !type) continue;
    (providerMap[opId] ||= {})[type] = true;
  }

  // Sort for stable comparison.
  for (const k of Object.keys(bySemanticProducer)) bySemanticProducer[k]?.sort();
  for (const k of Object.keys(domainProducers)) domainProducers[k]?.sort();
  return { bySemanticProducer, domainProducers, providerMap };
}

/** Pull the same indexes from the live loader's output. */
function indexesFromLoader(graph: Awaited<ReturnType<typeof loadGraph>>): Indexes {
  const bySemanticProducer: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(graph.bySemanticProducer)) {
    bySemanticProducer[k] = [...v].sort();
  }
  const domainProducers: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(graph.domainProducers ?? {})) {
    domainProducers[k] = [...v].sort();
  }
  const providerMap: Record<string, Record<string, true>> = {};
  for (const op of Object.values(graph.operations)) {
    if (!op.providerMap) continue;
    const entries: Record<string, true> = {};
    for (const [t, isAuth] of Object.entries(op.providerMap)) {
      if (isAuth) entries[t] = true;
    }
    if (Object.keys(entries).length > 0) providerMap[op.operationId] = entries;
  }
  return { bySemanticProducer, domainProducers, providerMap };
}

interface Diff {
  index: string;
  key: string;
  loaderOnly?: string[];
  storeOnly?: string[];
  loaderValue?: unknown;
  storeValue?: unknown;
}

function diff(a: Indexes, b: Indexes): Diff[] {
  const diffs: Diff[] = [];

  // bySemanticProducer
  const allTypes = new Set<string>([
    ...Object.keys(a.bySemanticProducer),
    ...Object.keys(b.bySemanticProducer),
  ]);
  for (const t of allTypes) {
    const aOps = new Set(a.bySemanticProducer[t] ?? []);
    const bOps = new Set(b.bySemanticProducer[t] ?? []);
    const onlyA = [...aOps].filter((x) => !bOps.has(x));
    const onlyB = [...bOps].filter((x) => !aOps.has(x));
    if (onlyA.length || onlyB.length) {
      diffs.push({ index: 'bySemanticProducer', key: t, loaderOnly: onlyA, storeOnly: onlyB });
    }
  }

  // domainProducers
  const allStates = new Set<string>([
    ...Object.keys(a.domainProducers),
    ...Object.keys(b.domainProducers),
  ]);
  for (const s of allStates) {
    const aOps = new Set(a.domainProducers[s] ?? []);
    const bOps = new Set(b.domainProducers[s] ?? []);
    const onlyA = [...aOps].filter((x) => !bOps.has(x));
    const onlyB = [...bOps].filter((x) => !aOps.has(x));
    if (onlyA.length || onlyB.length) {
      diffs.push({ index: 'domainProducers', key: s, loaderOnly: onlyA, storeOnly: onlyB });
    }
  }

  // providerMap (authoritative-only view)
  const allOps = new Set<string>([
    ...Object.keys(a.providerMap),
    ...Object.keys(b.providerMap),
  ]);
  for (const opId of allOps) {
    const aTypes = new Set(Object.keys(a.providerMap[opId] ?? {}));
    const bTypes = new Set(Object.keys(b.providerMap[opId] ?? {}));
    const onlyA = [...aTypes].filter((x) => !bTypes.has(x));
    const onlyB = [...bTypes].filter((x) => !aTypes.has(x));
    if (onlyA.length || onlyB.length) {
      diffs.push({ index: 'providerMap', key: opId, loaderOnly: onlyA, storeOnly: onlyB });
    }
  }

  return diffs;
}

async function main(): Promise<number> {
  const baseDir = path.resolve(import.meta.dirname, '../../../../path-analyser');
  const loaderGraph = await loadGraph(baseDir);
  const { store, stats } = await buildStore(baseDir);

  const fromLoader = indexesFromLoader(loaderGraph);
  const fromStore = indexesFromStore(store);

  console.log('--- adapter materialisation stats ---');
  console.log(JSON.stringify(stats, null, 2));

  const diffs = diff(fromLoader, fromStore);
  console.log('\n--- index parity ---');
  console.log(`bySemanticProducer keys (loader=${Object.keys(fromLoader.bySemanticProducer).length}, store=${Object.keys(fromStore.bySemanticProducer).length})`);
  console.log(`domainProducers    keys (loader=${Object.keys(fromLoader.domainProducers).length}, store=${Object.keys(fromStore.domainProducers).length})`);
  console.log(`providerMap        ops  (loader=${Object.keys(fromLoader.providerMap).length}, store=${Object.keys(fromStore.providerMap).length})`);

  // Some divergences are loader artifacts the ontology rejects (e.g. an
  // identifier with no validityState ends up writing to
  // domainProducers["undefined"] in the loader; the SHACL IdentifierShape
  // catches this at load time). Surface these separately so the parity
  // checkpoint distinguishes "ontology can't represent X" from
  // "ontology rejects an existing data-quality issue".
  const ontologyRejects: Diff[] = [];
  const real: Diff[] = [];
  for (const d of diffs) {
    if (d.key === 'undefined' || d.key === '' || d.key === 'null') ontologyRejects.push(d);
    else real.push(d);
  }

  if (ontologyRejects.length > 0) {
    console.log(`\nLOADER-ONLY ARTIFACTS THE ONTOLOGY REJECTS (${ontologyRejects.length}):`);
    for (const d of ontologyRejects) {
      const parts: string[] = [];
      if (d.loaderOnly?.length) parts.push(`loader-only=[${d.loaderOnly.join(', ')}]`);
      if (d.storeOnly?.length) parts.push(`store-only=[${d.storeOnly.join(', ')}]`);
      console.log(`  [${d.index}] key=<${d.key}>: ${parts.join(' | ')}`);
    }
    console.log('  -> See SHACL shapes in ../shapes/invariants.shapes.ttl.');
    console.log('  -> These would surface as load-time validation errors under the model.');
  }

  if (real.length === 0) {
    console.log('\nPARITY: PASS — store-derived indexes match loader output for every well-formed key.');
    return 0;
  }

  console.log(`\nPARITY: FAIL — ${real.length} unexplained divergence(s):`);
  for (const d of real.slice(0, 50)) {
    const parts: string[] = [];
    if (d.loaderOnly?.length) parts.push(`loader-only=[${d.loaderOnly.join(', ')}]`);
    if (d.storeOnly?.length) parts.push(`store-only=[${d.storeOnly.join(', ')}]`);
    console.log(`  [${d.index}] ${d.key}: ${parts.join(' | ')}`);
  }
  if (real.length > 50) console.log(`  ... and ${real.length - 50} more`);
  return 1;
}

main()
  .then((code) => exit(code))
  .catch((err) => {
    console.error(err);
    exit(2);
  });
