/**
 * Sidecar audit script.
 *
 * Cross-references the operation dependency graph against domain-semantics.json
 * and reports every operation that has no `operationRequirements` entry but
 * has non-trivial semantic dependencies — i.e., the operations where a human
 * must decide whether domain state preconditions need encoding in the sidecar.
 *
 * Run via:
 *   npm run audit:sidecar -w path-analyser
 *
 * Output sections:
 *   [GAP]  — has required semantic types in graph but no sidecar entry
 *   [OK]   — either has a sidecar entry, or has no required semantic types
 *   [ENTRY]— entry-point operation (no required semantics, no sidecar needed)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGraph } from '../src/graphLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DomainSemantics {
  operationRequirements?: Record<string, unknown>;
}

async function main() {
  const baseDir = process.cwd().endsWith('path-analyser')
    ? process.cwd()
    : path.resolve(process.cwd(), 'path-analyser');

  const graph = await loadGraph(baseDir);
  const sidecarPath = path.resolve(baseDir, 'domain-semantics.json');
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as DomainSemantics;
  const covered = new Set(Object.keys(sidecar.operationRequirements ?? {}));

  const ops = Object.values(graph.operations);

  const gaps: string[] = [];
  const entryPoints: string[] = [];
  const ok: string[] = [];

  for (const op of ops) {
    const hasRequired = op.requires.required.length > 0;
    const hasSidecar = covered.has(op.operationId);
    const hasDomainRequired = (op.domainRequiresAll ?? []).length > 0;

    if (hasSidecar) {
      ok.push(op.operationId);
    } else if (!hasRequired && !hasDomainRequired) {
      entryPoints.push(op.operationId);
    } else {
      gaps.push(`${op.operationId}  [requires: ${op.requires.required.join(', ')}]`);
    }
  }

  gaps.sort();
  entryPoints.sort();
  ok.sort();

  console.log('=== Sidecar Audit ===\n');
  console.log(`Total operations in graph : ${ops.length}`);
  console.log(`Covered by sidecar        : ${ok.length}`);
  console.log(`Entry points (no needs)   : ${entryPoints.length}`);
  console.log(`GAPS (missing sidecar)    : ${gaps.length}\n`);

  if (gaps.length > 0) {
    console.log('--- GAP: operations with required semantics but no sidecar entry ---');
    for (const g of gaps) console.log(`  [GAP]   ${g}`);
    console.log('');
  }

  console.log('--- OK: operations covered by sidecar ---');
  for (const o of ok) console.log(`  [OK]    ${o}`);
  console.log('');

  console.log('--- ENTRY: entry-point operations (no sidecar entry needed) ---');
  for (const e of entryPoints) console.log(`  [ENTRY] ${e}`);
  console.log('');

  if (gaps.length > 0) {
    console.log(
      `Action required: add operationRequirements entries for the ${gaps.length} GAP operation(s) above.`,
    );
    console.log(
      'For each GAP, determine whether it requires a domain state precondition (encode in sidecar)',
    );
    console.log('or whether the semantic type dependency from the graph is sufficient on its own.');
    process.exit(1);
  } else {
    console.log('All operations with semantic dependencies are covered by the sidecar.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
