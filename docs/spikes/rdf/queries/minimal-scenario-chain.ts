// Phase 4b: minimal scenario-chain candidate query
//
// The brief asks:
//
//   "For each operation, list the minimal scenario chains that satisfy
//    all REQUIRED semantic types and reach a target runtime state,
//    ranked by chain length."
//
// Today this is BFS in path-analyser/src/scenarioGenerator.ts. The
// brief explicitly carves out the planner: scenario synthesis (BFS,
// optional-pair combinations, artifact rule variants, duplicate
// policies) stays in TS. What SPARQL replaces is the *candidate
// selection* portion: "for this required semantic type, which
// authoritative producer can supply it?"
//
// This file demonstrates two queries that together provide everything
// the planner needs for candidate selection. The planner then orders
// and combines them combinatorially.

// biome-ignore lint/correctness/noNodejsModules: spike-only.
import path from 'node:path';
// biome-ignore lint/correctness/noNodejsModules: spike-only.
import { exit } from 'node:process';
import oxigraph from 'oxigraph';
import { buildStore } from '../adapters/build-store.js';

// Query 1: for a given operation, what required SemanticType producers exist?
// This is what bySemanticProducer + providerMap give the planner today,
// joined into one shape the planner can consume directly.
const Q_REQUIRED_PRODUCERS = `
PREFIX core: <https://camunda.io/api-test-generator/core#>
SELECT ?targetOp ?reqType ?producerOp ?authoritative WHERE {
  ?target core:operationId ?targetOp ;
          core:requires ?t .
  ?t <http://www.w3.org/1999/02/22-rdf-syntax-ns#label> ?reqType .
  OPTIONAL {
    ?producer core:produces ?t ;
              core:operationId ?producerOp .
    BIND(EXISTS { ?producer core:authoritativeProducer ?t } AS ?authoritative)
  }
}
ORDER BY ?targetOp ?reqType DESC(?authoritative)
`;

// Query 2: transitive runtime-state prerequisites — replaces
// gatherDomainPrerequisites() in scenarioGenerator.ts (~L1254-L1273).
// Today: a hand-rolled iterative DFS over runtimeStates.requires +
// capabilities.dependsOn with a visited set.
// Here: SPARQL property path "dependsOn+" walks the closure in one
// statement. The planner consumes the result; ordering / ties stay in
// TS.
const Q_TRANSITIVE_PREREQS = `
PREFIX core: <https://camunda.io/api-test-generator/core#>
SELECT ?targetOp ?goalState ?prereq WHERE {
  ?op core:operationId ?targetOp ;
      core:requiresState ?goalState .
  # Property path: every state ?goalState transitively depends on.
  ?goalState core:dependsOn+ ?prereq .
}
ORDER BY ?targetOp ?goalState
`;

// Query 3: the actual brief query — for a target operation, find the
// minimal set of operations whose produced SemanticTypes cover all of
// the target's REQUIRED semantic types. Ranked here by simple chain
// length; the planner does the real ordering.
const Q_MINIMAL_CHAIN_CANDIDATES = `
PREFIX core: <https://camunda.io/api-test-generator/core#>
SELECT ?targetOp ?producerOp (COUNT(DISTINCT ?reqType) AS ?coverage) WHERE {
  ?target core:operationId ?targetOp ;
          core:requires ?t .
  ?t <http://www.w3.org/1999/02/22-rdf-syntax-ns#label> ?reqType .
  ?producer core:produces ?t ;
            core:authoritativeProducer ?t ;
            core:operationId ?producerOp .
}
GROUP BY ?targetOp ?producerOp
ORDER BY ?targetOp DESC(?coverage)
`;

interface RequiredProducerRow {
  reqType: string;
  producers: { opId: string; authoritative: boolean }[];
}

async function main(): Promise<number> {
  const baseDir = path.resolve(import.meta.dirname, '../../../../path-analyser');
  const { store } = await buildStore(baseDir);

  // Group required-producers by (targetOp, reqType) for readability.
  const byOp = new Map<string, Map<string, RequiredProducerRow>>();
  for (const b of store.query(Q_REQUIRED_PRODUCERS) as Iterable<oxigraph.SparqlResultBindings>) {
    const targetOp = b.get('targetOp')?.value ?? '';
    const reqType = b.get('reqType')?.value ?? '';
    const producerOp = b.get('producerOp')?.value;
    const auth = b.get('authoritative')?.value === 'true';
    if (!byOp.has(targetOp)) byOp.set(targetOp, new Map());
    const inner = byOp.get(targetOp);
    if (!inner) continue;
    if (!inner.has(reqType)) inner.set(reqType, { reqType, producers: [] });
    if (producerOp) inner.get(reqType)?.producers.push({ opId: producerOp, authoritative: auth });
  }

  // Print a sample so the result is human-checkable. createProcessInstance
  // and activateJobs are good demonstrators because they have multiple
  // required types each.
  console.log('=== Required-producer candidates (sample: createProcessInstance, activateJobs) ===');
  for (const opId of ['createProcessInstance', 'activateJobs']) {
    console.log(`\n${opId}:`);
    const inner = byOp.get(opId);
    if (!inner || inner.size === 0) {
      console.log('  (no required semantic types)');
      continue;
    }
    for (const row of inner.values()) {
      console.log(`  requires ${row.reqType}:`);
      if (row.producers.length === 0) {
        console.log('    (NO PRODUCER — would fail planner)');
        continue;
      }
      for (const p of row.producers) {
        const tag = p.authoritative ? '[authoritative]' : '';
        console.log(`    ${p.opId} ${tag}`);
      }
    }
  }

  // Transitive runtime-state prereqs — the gatherDomainPrerequisites
  // replacement.
  console.log('\n=== Transitive runtime-state prerequisites (dependsOn+) ===');
  const prereqByOp = new Map<string, Map<string, Set<string>>>();
  for (const b of store.query(Q_TRANSITIVE_PREREQS) as Iterable<oxigraph.SparqlResultBindings>) {
    const targetOp = b.get('targetOp')?.value ?? '';
    const goal = decodeURIComponent(b.get('goalState')?.value.split('#').pop() ?? '');
    const prereq = decodeURIComponent(b.get('prereq')?.value.split('#').pop() ?? '');
    if (!prereqByOp.has(targetOp)) prereqByOp.set(targetOp, new Map());
    const inner = prereqByOp.get(targetOp);
    if (!inner) continue;
    if (!inner.has(goal)) inner.set(goal, new Set());
    inner.get(goal)?.add(prereq);
  }
  for (const [opId, goals] of prereqByOp) {
    console.log(`\n${opId}:`);
    for (const [goal, prereqs] of goals) {
      console.log(`  ${goal} requires: { ${[...prereqs].join(', ')} }`);
    }
  }

  // Coverage-ranked candidates — toy ordering; planner does the real
  // combinatorial work.
  console.log('\n=== Coverage-ranked authoritative producers (top per op) ===');
  const seenOps = new Set<string>();
  for (const b of store.query(Q_MINIMAL_CHAIN_CANDIDATES) as Iterable<oxigraph.SparqlResultBindings>) {
    const targetOp = b.get('targetOp')?.value ?? '';
    if (seenOps.has(targetOp)) continue;
    seenOps.add(targetOp);
    const producerOp = b.get('producerOp')?.value;
    const cov = b.get('coverage')?.value;
    if (seenOps.size <= 12) console.log(`  ${targetOp.padEnd(35)} <- ${producerOp} (covers ${cov} required types)`);
  }
  console.log(`  ... (${seenOps.size} target operations total)`);
  console.log('\nNote: planner combines these candidates with disjunctions, optional-pair coverage,');
  console.log('artifact rules, duplicate policies. SPARQL only supplies inputs.');
  return 0;
}

main().then(exit).catch((e) => { console.error(e); exit(2); });
