import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DomainSemantics, EndpointScenarioCollection, GlobalContextSeed } from '../types.js';
import { parseCliArgs } from './cli-args.js';
import { writeEmitted } from './orchestrator.js';
import { PlaywrightEmitter } from './playwright/emitter.js';
import {
  materializeResponseSchemas,
  materializeSupport,
} from './playwright/materialize-support.js';
import { getEmitter, listEmitters, registerEmitter } from './registry.js';

// Built-in emitter registration. New emitters register themselves here.
registerEmitter(PlaywrightEmitter);

// JSON.parse is a runtime contract boundary: the on-disk scenario files are
// produced by the generator and conform structurally to EndpointScenarioCollection.
// Downstream code accesses `.endpoint?.operationId` optionally and tolerates
// malformed entries via the surrounding try/catch.
function parseScenarioCollection(text: string): EndpointScenarioCollection {
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
  return JSON.parse(text) as EndpointScenarioCollection;
}

/**
 * Load `globalContextSeeds` from `domain-semantics.json`. The full sidecar
 * is validated by graphLoader during planning; here we only read the seeds
 * to feed the emitter, so a missing or malformed file is non-fatal — the
 * emitter simply won't write a universal-seed prologue.
 */
async function loadGlobalContextSeeds(baseDir: string): Promise<GlobalContextSeed[]> {
  try {
    const text = await fs.readFile(path.join(baseDir, 'domain-semantics.json'), 'utf8');
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const parsed = JSON.parse(text) as DomainSemantics;
    return parsed.globalContextSeeds ?? [];
  } catch {
    return [];
  }
}

function printUsage(): void {
  const targets = listEmitters()
    .map((e) => `${e.id} (${e.name})`)
    .join(', ');
  console.error(
    'Usage: node dist/src/codegen/index.js [--target=<id>] <operationId>|--all\n' +
      `Available targets: ${targets || '(none)'}`,
  );
}

async function run() {
  const { target, positional, help } = parseCliArgs(process.argv.slice(2));
  const baseDir = process.cwd().endsWith('path-analyser')
    ? process.cwd()
    : path.resolve(process.cwd(), 'path-analyser');
  const featureDir = path.join(baseDir, 'dist/feature-output');
  const outDir = path.join(baseDir, 'dist/generated-tests');

  if (help || !positional) {
    printUsage();
    process.exit(1);
  }

  const emitter = getEmitter(target);
  if (!emitter) {
    console.error(
      `Unknown emitter target: '${target}'. Available: ${listEmitters()
        .map((e) => e.id)
        .join(', ')}`,
    );
    process.exit(1);
  }

  // Wipe before write so emitted spec files left over from a previous spec
  // version cannot survive into the current run. Without this, local
  // pre-push validation can diverge from CI (which always sees a fresh tree).
  // The support/ tree, README.md, and responses.json are re-materialised below.
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  // Vendor the runtime support helpers into <outDir>/support/ so the
  // emitted suite is self-contained (no imports back into this generator).
  // Only the Playwright emitter currently needs these; gate on the emitter id
  // so future targets that don't depend on these helpers don't pay the cost.
  if (emitter.id === 'playwright') {
    await materializeSupport(outDir);
    // Also extract response-body schemas alongside the emitted specs so the
    // generated `validateResponse(...)` calls have a schema source. Co-located
    // here (rather than a separate npm script) so every codegen run produces
    // a runnable suite as a single artifact.
    await materializeResponseSchemas(outDir);
  }

  const files = (await fs.readdir(featureDir)).filter((f) => f.endsWith('-scenarios.json'));
  const globalContextSeeds = await loadGlobalContextSeeds(baseDir);

  if (positional === '--all') {
    let count = 0;
    for (const f of files) {
      try {
        const content = await fs.readFile(path.join(featureDir, f), 'utf8');
        const parsed = parseScenarioCollection(content);
        if (!parsed.endpoint?.operationId) continue;
        await writeEmitted(emitter, parsed, {
          outDir,
          suiteName: parsed.endpoint.operationId,
          mode: 'feature',
          globalContextSeeds,
        });
        count++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('Skipping file (parse/emission failed):', f, msg);
      }
    }
    console.log(
      `Generated test suites for ${count} endpoints in ${outDir} (target: ${emitter.id})`,
    );
    return;
  }

  const endpointOpId = positional;
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
  await writeEmitted(emitter, json, {
    outDir,
    suiteName: endpointOpId,
    mode: 'feature',
    globalContextSeeds,
  });
  console.log('Generated test suite for', endpointOpId, 'at', outDir, `(target: ${emitter.id})`);
}

function _hyphenizeOp(op: string) {
  return op.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
// removed findMethodPrefix (obsolete)

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
