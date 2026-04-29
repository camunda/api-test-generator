// Phase 4a: value-binding drift detector
//
// Today: domain-semantics.json valueBindings are string-keyed, e.g.
//
//   "valueBindings": {
//     "request.processDefinitionId":
//        "ProcessDefinitionDeployed.processDefinitionId",
//     "response.deployments[].processDefinition.processDefinitionId":
//        "ProcessDefinitionKey.processDefinitionKey"
//   }
//
// path-analyser/src/index.ts (~L320-L340) string-splits these at
// scenario-bind time. A typo in the path or a renamed response field
// silently no-ops — the planner still runs, the scenario still emits,
// the resulting test just doesn't extract the variable it thought it
// extracted. The brief calls this the "silent-miss class".
//
// Under the model: a value binding is a ValueBinding node whose
// bindsFromFieldPath property points at a FieldPath node. A typo means
// that pointer resolves to a node with no matching FieldPath in the
// response shape — a one-line SPARQL query.
//
// We additionally check that the bindsToParameter is one the target
// RuntimeState actually declares — catches the second-half rename
// problem (renaming a state's parameter without updating its bindings).

// biome-ignore lint/correctness/noNodejsModules: spike-only.
import path from 'node:path';
// biome-ignore lint/correctness/noNodejsModules: spike-only.
import { exit } from 'node:process';
import oxigraph from 'oxigraph';
import { buildStore } from '../adapters/build-store.js';

interface DriftRow {
  binding: string;
  fieldPath: string;
  state?: string;
  parameter?: string;
  reason: string;
}

const Q_UNRESOLVED_PATH = `
PREFIX core: <https://camunda.io/api-test-generator/core#>
SELECT ?binding ?fp WHERE {
  ?binding a core:ValueBinding ;
           core:bindingDirection "response" ;
           core:bindsFromFieldPath ?fp .
  # Drift: the binding points at a FieldPath IRI that has no
  # corresponding canonical FieldPath emitted from the response shape.
  # NB: ?anyLit must be a free variable inside NOT EXISTS — using a
  # variable bound by BIND would check for a specific literal value
  # instead of the existence of any literal.
  FILTER NOT EXISTS { ?fp core:fieldPath ?anyLit }
}
`;

const Q_PARAMETER_NOT_DECLARED = `
PREFIX core: <https://camunda.io/api-test-generator/core#>
SELECT ?binding ?stateUri ?param WHERE {
  ?binding a core:ValueBinding ;
           core:bindsToState ?stateUri ;
           core:bindsToParameter ?param .
  # Drift: the value-binding refers to a parameter the target
  # RuntimeState does not expose. Catches state.parameter renames that
  # didn't propagate into bindings.
  FILTER NOT EXISTS { ?stateUri core:hasParameter ?param }
}
`;

async function main(): Promise<number> {
  const baseDir = path.resolve(import.meta.dirname, '../../../../path-analyser');
  const { store } = await buildStore(baseDir);

  const drift: DriftRow[] = [];

  for (const b of store.query(Q_UNRESOLVED_PATH) as Iterable<oxigraph.SparqlResultBindings>) {
    const bindingIri = b.get('binding')?.value ?? '';
    const fpIri = b.get('fp')?.value ?? '';
    const fpStr = decodeURIComponent(fpIri.split('/').pop() ?? '');
    drift.push({
      binding: decodeURIComponent(bindingIri.split('#').pop() ?? bindingIri),
      fieldPath: fpStr,
      reason: 'response field-path does not resolve to any canonical FieldPath',
    });
  }

  for (const b of store.query(Q_PARAMETER_NOT_DECLARED) as Iterable<oxigraph.SparqlResultBindings>) {
    const bindingIri = b.get('binding')?.value ?? '';
    const stateUri = b.get('stateUri')?.value ?? '';
    const param = b.get('param')?.value ?? '';
    drift.push({
      binding: decodeURIComponent(bindingIri.split('#').pop() ?? bindingIri),
      fieldPath: '(parameter check)',
      state: decodeURIComponent(stateUri.split('#').pop() ?? stateUri),
      parameter: param,
      reason: 'bindsToParameter is not declared by bindsToState (hasParameter)',
    });
  }

  console.log(`Value-binding drift detector — ${drift.length} finding(s).`);
  for (const d of drift) {
    console.log(`  - ${d.binding}`);
    console.log(`      ${d.reason}`);
    if (d.fieldPath !== '(parameter check)') console.log(`      fieldPath: ${d.fieldPath}`);
    if (d.state) console.log(`      target: ${d.state}.${d.parameter}`);
  }
  if (drift.length === 0) {
    console.log('  (none — all value bindings resolve cleanly against the model.)');
  }
  console.log('\nNote: today these would be silent runtime no-ops; under the model they are queryable load-time errors.');
  return 0;
}

main().then(exit).catch((e) => { console.error(e); exit(2); });
