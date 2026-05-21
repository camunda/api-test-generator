#!/usr/bin/env node
/**
 * Fetches `examples/operation-map.json` from the
 * `camunda/orchestration-cluster-api-js` repository via a git sparse clone.
 *
 * Usage:
 *   npm run fetch-js-sdk-map
 *   JS_SDK_REF=main npm run fetch-js-sdk-map
 *
 * Output: spec/js-sdk/operation-map.json (gitignored alongside spec/bundled/).
 *
 * Analogous to the OpenAPI spec fetch via `camunda-schema-bundler`:
 * - `JS_SDK_REF` controls which branch / tag / SHA is fetched (default: main).
 * - The file is never committed; CI fetches it fresh each run.
 * - A future pin file (analogous to spec-pin.json) can lock the SHA for
 *   determinism across runs.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_URL = 'https://github.com/camunda/orchestration-cluster-api-js.git';
const FILE_PATH = 'examples/operation-map.json';
const SDK_REF = process.env.JS_SDK_REF || 'main';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'spec', 'js-sdk');
const outFile = path.join(outDir, 'operation-map.json');
const tmpDir = path.join(tmpdir(), `js-sdk-map-${Date.now()}`);

console.log(`[fetch-js-sdk-map] Fetching ${FILE_PATH} from ${REPO_URL} @ ${SDK_REF}`);

try {
  mkdirSync(tmpDir, { recursive: true });

  // Sparse clone: fetch only the single file to keep it fast.
  execFileSync('git', ['init', '--quiet', tmpDir], { stdio: 'inherit' });
  execFileSync('git', ['-C', tmpDir, 'remote', 'add', 'origin', REPO_URL], {
    stdio: 'inherit',
  });
  execFileSync(
    'git',
    ['-C', tmpDir, 'config', 'core.sparseCheckout', 'true'],
    { stdio: 'inherit' },
  );
  // Write sparse-checkout pattern before fetch
  const sparseFile = path.join(tmpDir, '.git', 'info', 'sparse-checkout');
  writeFileSync(sparseFile, `${FILE_PATH}\n`, 'utf8');
  execFileSync(
    'git',
    ['-C', tmpDir, 'fetch', '--depth', '1', 'origin', SDK_REF],
    { stdio: 'inherit' },
  );
  execFileSync(
    'git',
    ['-C', tmpDir, 'checkout', 'FETCH_HEAD', '--', FILE_PATH],
    { stdio: 'inherit' },
  );

  mkdirSync(outDir, { recursive: true });
  copyFileSync(path.join(tmpDir, FILE_PATH), outFile);

  console.log(`[fetch-js-sdk-map] Written to ${path.relative(repoRoot, outFile)}`);
} catch (err) {
  console.error('[fetch-js-sdk-map] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Non-fatal cleanup failure.
  }
}
