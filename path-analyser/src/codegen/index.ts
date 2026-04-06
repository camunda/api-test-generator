import { promises as fs } from 'fs';
import path from 'path';
import { emitPlaywrightSuite } from './playwright/emitter.js';
import { EndpointScenarioCollection } from '../types.js';

async function run() {
  const arg = process.argv[2];
  const baseDir = process.cwd().endsWith('path-analyser') ? process.cwd() : path.resolve(process.cwd(), 'path-analyser');
  const featureDir = path.join(baseDir, 'dist/feature-output');
  const outDir = path.join(baseDir, 'dist/generated-tests');
  await fs.mkdir(outDir, { recursive: true });
  // Ensure runtime support files are available alongside generated tests
  try {
    const envSrc = path.join(baseDir, 'dist/src/codegen/support/env.js');
    const envDstDir = path.join(outDir, 'support');
    await fs.mkdir(envDstDir, { recursive: true });
    const envDst = path.join(envDstDir, 'env.js');
    await fs.copyFile(envSrc, envDst);
  } catch {}

  if (!arg || arg === '--help' || arg === '-h') {
    console.error('Usage: node dist/codegen/index.js <operationId>|--all');
    process.exit(1);
  }

  const files = (await fs.readdir(featureDir)).filter(f => f.endsWith('-scenarios.json'));

  if (arg === '--all') {
    let count = 0;
    for (const f of files) {
      try {
        const content = await fs.readFile(path.join(featureDir, f), 'utf8');
        const parsed = JSON.parse(content) as EndpointScenarioCollection;
        if (!parsed.endpoint?.operationId) continue;
        await emitPlaywrightSuite(parsed, { outDir, suiteName: parsed.endpoint.operationId, mode: 'feature' });
        count++;
      } catch (e) {
  console.warn('Skipping file (parse/emission failed):', f, (e as Error).message);
      }
    }
  console.log(`Generated test suites for ${count} endpoints in ${outDir}`);
    return;
  }

  const endpointOpId = arg;
  let match: string | null = null;
  for (const f of files) {
    const content = await fs.readFile(path.join(featureDir, f), 'utf8');
    try {
      const parsed = JSON.parse(content) as EndpointScenarioCollection;
      if (parsed.endpoint?.operationId === endpointOpId) { match = f; break; }
    } catch { /* ignore */ }
  }
  if (!match) {
    console.error('Could not locate scenario file for operationId', endpointOpId);
    process.exit(1);
  }
  const json = JSON.parse(await fs.readFile(path.join(featureDir, match), 'utf8')) as EndpointScenarioCollection;
  await emitPlaywrightSuite(json, { outDir, suiteName: endpointOpId, mode: 'feature' });
  console.log('Generated test suite for', endpointOpId, 'at', outDir);
}

function hyphenizeOp(op: string){ return op.replace(/[A-Z]/g, m => '-' + m.toLowerCase()); }
// removed findMethodPrefix (obsolete)

run().catch(e => { console.error(e); process.exit(1); });
