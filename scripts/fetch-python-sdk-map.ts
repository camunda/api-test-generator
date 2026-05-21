#!/usr/bin/env tsx
/**
 * fetch-python-sdk-map — sparse-clone camunda/orchestration-cluster-api-python
 * and extract examples/operation-map.json.
 *
 * Mirrors scripts/fetch-js-sdk-map.js pattern. Outputs to spec/python-sdk/
 * per the CONFIG-partitioned layout.
 *
 * Outputs:
 *   spec/python-sdk/operation-map.json       (the SDK mapping, never committed)
 *   spec/python-sdk/sdk-metadata.json        (resolved ref SHA, content hash)
 *
 * Env vars:
 *   PYTHON_SDK_REF     Commit/branch/tag to fetch (default: main)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_URL = 'https://github.com/camunda/orchestration-cluster-api-python.git';
const FILE_PATH = 'examples/operation-map.json';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, '../..');

interface SdkMetadata {
  /** Resolved 40-char commit SHA from camunda/orchestration-cluster-api-python */
  sdkRef: string;
  /** SHA-256 hash of operation-map.json content */
  operationMapHash: string;
  /** Timestamp of fetch */
  fetchedAt: string;
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const pythonSdkRef = process.env.PYTHON_SDK_REF ?? 'main';
const pythonSdkDir = join(REPO_ROOT, 'spec/python-sdk');
const operationMapPath = join(pythonSdkDir, 'operation-map.json');
const metadataPath = join(pythonSdkDir, 'sdk-metadata.json');
const tmpDir = join(tmpdir(), `python-sdk-map-${Date.now()}`);

console.log(`[fetch-python-sdk-map] Fetching ${FILE_PATH} from ${REPO_URL} @ ${pythonSdkRef}`);

try {
  mkdirSync(tmpDir, { recursive: true });

  // Sparse clone: fetch only examples/operation-map.json to keep it fast.
  execFileSync('git', ['init', '--quiet', tmpDir], { stdio: 'inherit' });
  execFileSync('git', ['-C', tmpDir, 'remote', 'add', 'origin', REPO_URL], { stdio: 'inherit' });
  execFileSync('git', ['-C', tmpDir, 'config', 'core.sparseCheckout', 'true'], {
    stdio: 'inherit',
  });

  // Write sparse-checkout pattern before fetch
  const sparseFile = join(tmpDir, '.git', 'info', 'sparse-checkout');
  writeFileSync(sparseFile, `${FILE_PATH}\n`, 'utf8');

  execFileSync('git', ['-C', tmpDir, 'fetch', '--depth', '1', 'origin', pythonSdkRef], {
    stdio: 'inherit',
  });
  execFileSync('git', ['-C', tmpDir, 'checkout', 'FETCH_HEAD', '--', FILE_PATH], {
    stdio: 'inherit',
  });

  // Resolve the ref to a full commit SHA
  const resolvedRef = execFileSync('git', ['-C', tmpDir, 'rev-parse', 'FETCH_HEAD'], {
    encoding: 'utf-8',
  }).trim();
  console.log(`[fetch-python-sdk-map] resolved ref: ${resolvedRef}`);

  // Ensure output directory exists and move the file into place
  mkdirSync(pythonSdkDir, { recursive: true });
  copyFileSync(join(tmpDir, FILE_PATH), operationMapPath);
  console.log(`[fetch-python-sdk-map] Written to ${operationMapPath}`);

  // Write metadata
  const operationMapContent = readFileSync(operationMapPath, 'utf-8');
  const metadata: SdkMetadata = {
    sdkRef: resolvedRef,
    operationMapHash: computeHash(operationMapContent),
    fetchedAt: new Date().toISOString(),
  };
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  console.log(`[fetch-python-sdk-map] Written metadata to ${metadataPath}`);
} catch (err) {
  console.error('[fetch-python-sdk-map] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Non-fatal cleanup failure.
  }
}
