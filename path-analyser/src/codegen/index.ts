import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EndpointScenarioCollection } from '../types.js';
import { emitPlaywrightSuite } from './playwright/emitter.js';

// JSON.parse is a runtime contract boundary: the on-disk scenario files are
// produced by the generator and conform structurally to EndpointScenarioCollection.
// Downstream code accesses `.endpoint?.operationId` optionally and tolerates
// malformed entries via the surrounding try/catch.
function parseScenarioCollection(text: string): EndpointScenarioCollection {
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
  return JSON.parse(text) as EndpointScenarioCollection;
}

async function run() {
  const arg = process.argv[2];
  const baseDir = process.cwd().endsWith('path-analyser')
    ? process.cwd()
    : path.resolve(process.cwd(), 'path-analyser');
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

  const files = (await fs.readdir(featureDir)).filter((f) => f.endsWith('-scenarios.json'));

  if (arg === '--all') {
    let count = 0;
    for (const f of files) {
      try {
        const content = await fs.readFile(path.join(featureDir, f), 'utf8');
        const parsed = parseScenarioCollection(content);
        if (!parsed.endpoint?.operationId) continue;
        await emitPlaywrightSuite(parsed, {
          outDir,
          suiteName: parsed.endpoint.operationId,
          mode: 'feature',
        });
        count++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('Skipping file (parse/emission failed):', f, msg);
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
      const parsed = parseScenarioCollection(content);
      if (parsed.endpoint?.operationId === endpointOpId) {
        match = f;
        break;
      }
    } catch {
      /* ignore */
    }
  }
  if (!match) {
    console.error('Could not locate scenario file for operationId', endpointOpId);
    process.exit(1);
  }
  const json = parseScenarioCollection(await fs.readFile(path.join(featureDir, match), 'utf8'));
  await emitPlaywrightSuite(json, { outDir, suiteName: endpointOpId, mode: 'feature' });
  console.log('Generated test suite for', endpointOpId, 'at', outDir);
}

function _hyphenizeOp(op: string) {
  return op.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
// removed findMethodPrefix (obsolete)

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
