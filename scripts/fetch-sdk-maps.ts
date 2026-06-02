#!/usr/bin/env tsx
/**
 * fetch-sdk-maps — generic upstream operation-map fetcher.
 *
 * Replaces the per-language `fetch-js-sdk-map` / `fetch-python-sdk-map`
 * scripts. Reads the emitter registry via
 * `materializer/src/index.ts list-targets`, then for every emitter
 * that declares an `sdkMap`, sparse-clones the upstream repo and copies the
 * map into place. Adding an SDK emitter no longer requires a new fetch
 * script — declare `sdkMap` on the `EmitterStrategy` and it is picked up
 * here automatically.
 *
 * For each `sdkMap = { repo, path, refEnv, out }`:
 *   - The ref is read from `process.env[refEnv]` (default `main`).
 *   - Output: `<out>` (the operation map, never committed — under spec/).
 *   - Sidecar: `<out-dir>/sdk-metadata.json` (resolved SHA + content hash).
 *
 * Mirrors the OpenAPI spec fetch via `camunda-schema-bundler`: the maps are
 * gitignored and fetched fresh; a future pin file can lock the SHA for
 * determinism (the resolved SHA is recorded in sdk-metadata.json today).
 *
 * Env vars:
 *   <refEnv>   Commit/branch/tag to fetch per emitter (default: main).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORCHESTRATOR = path.join(REPO_ROOT, 'materializer', 'src', 'index.ts');

interface SdkMap {
  repo: string;
  path: string;
  refEnv: string;
  out: string;
}

interface TargetProjection {
  id: string;
  name: string;
  supportedConfigs: string[];
  sdkMap?: SdkMap;
}

function isSdkMap(value: unknown): value is SdkMap {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof Reflect.get(value, 'repo') === 'string' &&
    typeof Reflect.get(value, 'path') === 'string' &&
    typeof Reflect.get(value, 'refEnv') === 'string' &&
    typeof Reflect.get(value, 'out') === 'string'
  );
}

function isTargetProjection(value: unknown): value is TargetProjection {
  if (typeof value !== 'object' || value === null) return false;
  if (typeof Reflect.get(value, 'id') !== 'string') return false;
  const sdkMap = Reflect.get(value, 'sdkMap');
  if (sdkMap !== undefined && !isSdkMap(sdkMap)) return false;
  return true;
}

// `npx` ships as a `.cmd` shim on Windows; Node's execFileSync (no shell) only
// auto-resolves bare `.exe` names, so the platform-correct binary is required.
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/** Read the emitter registry projection from the orchestrator's list-targets command. */
function loadTargets(): TargetProjection[] {
  // `--no-install` keeps the run offline/deterministic: use the repo's pinned
  // tsx rather than letting npx auto-install tooling.
  const raw = execFileSync(NPX, ['--no-install', 'tsx', ORCHESTRATOR, 'list-targets'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(isTargetProjection)) {
    throw new Error('list-targets did not return the expected [{ id, sdkMap? }] projection.');
  }
  return parsed;
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Sparse-clone a single file from an upstream repo at the given ref. */
function fetchMap(sdkMap: SdkMap): void {
  const repoUrl = `https://github.com/${sdkMap.repo}.git`;
  const ref = process.env[sdkMap.refEnv] ?? 'main';
  const outFile = path.join(REPO_ROOT, sdkMap.out);
  const outDir = path.dirname(outFile);
  const metadataPath = path.join(outDir, 'sdk-metadata.json');
  const tmpDir = path.join(tmpdir(), `sdk-map-${path.basename(outDir)}-${Date.now()}`);

  console.log(`[fetch-sdk-maps] Fetching ${sdkMap.path} from ${repoUrl} @ ${ref}`);
  try {
    mkdirSync(tmpDir, { recursive: true });

    // Sparse clone: fetch only the single map file to keep it fast.
    execFileSync('git', ['init', '--quiet', tmpDir], { stdio: 'inherit' });
    execFileSync('git', ['-C', tmpDir, 'remote', 'add', 'origin', repoUrl], { stdio: 'inherit' });
    execFileSync('git', ['-C', tmpDir, 'config', 'core.sparseCheckout', 'true'], {
      stdio: 'inherit',
    });
    const sparseFile = path.join(tmpDir, '.git', 'info', 'sparse-checkout');
    writeFileSync(sparseFile, `${sdkMap.path}\n`, 'utf8');
    execFileSync('git', ['-C', tmpDir, 'fetch', '--depth', '1', 'origin', ref], {
      stdio: 'inherit',
    });
    execFileSync('git', ['-C', tmpDir, 'checkout', 'FETCH_HEAD', '--', sdkMap.path], {
      stdio: 'inherit',
    });

    const resolvedRef = execFileSync('git', ['-C', tmpDir, 'rev-parse', 'FETCH_HEAD'], {
      encoding: 'utf-8',
    }).trim();

    mkdirSync(outDir, { recursive: true });
    copyFileSync(path.join(tmpDir, sdkMap.path), outFile);

    const mapContent = readFileSync(outFile, 'utf-8');
    writeFileSync(
      metadataPath,
      `${JSON.stringify(
        {
          sdkRepo: sdkMap.repo,
          sdkRef: resolvedRef,
          operationMapHash: computeHash(mapContent),
          fetchedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    console.log(
      `[fetch-sdk-maps] Wrote ${path.relative(REPO_ROOT, outFile)} (ref ${resolvedRef.slice(0, 12)})`,
    );
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Non-fatal cleanup failure.
    }
  }
}

function main(): void {
  const targets = loadTargets();
  const withMaps = targets.filter((t): t is TargetProjection & { sdkMap: SdkMap } =>
    isSdkMap(t.sdkMap),
  );
  if (withMaps.length === 0) {
    console.log('[fetch-sdk-maps] No emitters declare an sdkMap; nothing to fetch.');
    return;
  }
  for (const target of withMaps) {
    fetchMap(target.sdkMap);
  }
}

try {
  main();
} catch (err) {
  console.error('[fetch-sdk-maps] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
