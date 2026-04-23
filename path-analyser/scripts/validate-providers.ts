import path from 'path';
import { buildCanonicalShapes } from '../src/canonicalSchemas.js';
import { loadGraph } from '../src/graphLoader.js';

async function main() {
  const baseDir = process.cwd().endsWith('path-analyser')
    ? process.cwd()
    : path.resolve(process.cwd(), 'path-analyser');
  const graph = await loadGraph(baseDir);
  const canonical = await buildCanonicalShapes(path.resolve(baseDir, '../'));
  const requiredOps = ['createDeployment'];
  const failures: string[] = [];
  const skipSemantics = new Set(['ResourceKey']);
  for (const opId of requiredOps) {
    const op = graph.operations[opId];
    if (!op) {
      failures.push(`${opId}: operation missing in graph`);
      continue;
    }
    // Collect provider semantics from canonical response shape
    const shape = canonical[opId];
    const expectedProviders = new Set<string>();
    for (const n of shape?.response || []) {
      if ((n as any).semanticProvider) {
        // Derive semantic type name from pointer path end (Key schemas named like ProcessDefinitionKey)
        // If a semantic name was captured elsewhere you'd match it; here we fall back to field name heuristics.
        const leaf = n.path.split('.').pop() || '';
        if (/Key$/.test(leaf)) expectedProviders.add(capitalize(leaf));
      }
    }
    // Domain artifact rules may imply additional keys
    // (Simplified: rely solely on canonical providers for now)
    const produced = new Set(op.produces || []);
    for (const need of expectedProviders) {
      if (skipSemantics.has(need)) continue;
      if (!produced.has(need))
        failures.push(
          `${opId}: missing provider semantic '${need}' (expected from canonical response)`,
        );
    }
  }
  if (failures.length) {
    console.error('Provider validation failed:\n' + failures.map((f) => '  - ' + f).join('\n'));
    process.exit(1);
  } else {
    console.log('Provider validation passed for required operations.');
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
