#!/usr/bin/env tsx
/**
 * fetch-python-sdk-map — sparse-clone camunda/orchestration-cluster-api-python
 * and extract examples/operation-map.json.
 *
 * Mirrors scripts/fetch-js-sdk-map.ts pattern. Outputs to spec/python-sdk/
 * per the CONFIG-partitioned layout.
 *
 * Outputs:
 *   spec/python-sdk/operation-map.json       (the SDK mapping, never committed)
 *   spec/python-sdk/sdk-metadata.json        (resolved ref SHA, content hash)
 *
 * Env vars:
 *   PYTHON_SDK_REF     Commit/branch/tag to fetch (default: main)
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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

function execCommand(cmd: string, options?: Record<string, unknown>): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', ...options }).trim();
  } catch (error) {
    // biome-ignore lint/plugin: error is caught from execSync; status/stderr/stdout are the Node.js SpawnSyncReturns fields
    const err = error as { status: number; stderr: Buffer; stdout: Buffer };
    console.error(`Command failed: ${cmd}`);
    console.error(err.stderr?.toString() || err.stdout?.toString() || String(error));
    throw error;
  }
}

async function main(): Promise<void> {
  const pythonSdkRef = process.env.PYTHON_SDK_REF ?? 'main';
  const pythonSdkDir = join(REPO_ROOT, 'spec/python-sdk');
  const tempCloneDir = join(REPO_ROOT, '.tmp-python-sdk-clone');
  const operationMapPath = join(pythonSdkDir, 'operation-map.json');
  const metadataPath = join(pythonSdkDir, 'sdk-metadata.json');

  console.error(`[fetch-python-sdk-map] ref=${pythonSdkRef}, output=${pythonSdkDir}`);

  // Clean up any prior temp directory
  if (process.platform === 'win32') {
    // Windows rmdir with recursion
    try {
      execCommand(`rmdir /s /q "${tempCloneDir}"`, { shell: true });
    } catch {
      // Directory may not exist
    }
  } else {
    try {
      rmSync(tempCloneDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }
  }

  try {
    // Sparse-clone workflow:
    // 1. Clone with --no-checkout to defer file materialization
    // 2. Configure sparse checkout cone mode
    // 3. Set sparse patterns to include only examples/
    // 4. Checkout to materialize files
    console.error('[fetch-python-sdk-map] sparse-cloning...');
    execCommand(
      `git clone --no-checkout --depth=1 https://github.com/camunda/orchestration-cluster-api-python.git "${tempCloneDir}"`,
      {
        shell: true,
        cwd: REPO_ROOT,
      },
    );

    // Fetch the specific ref if not main
    if (pythonSdkRef !== 'main') {
      execCommand(`git fetch origin "${pythonSdkRef}:refs/remotes/origin/${pythonSdkRef}"`, {
        cwd: tempCloneDir,
      });
      execCommand(`git checkout ${pythonSdkRef}`, {
        cwd: tempCloneDir,
      });
    } else {
      execCommand('git checkout main', {
        cwd: tempCloneDir,
      });
    }

    // Configure sparse checkout for cone mode
    execCommand('git config core.sparseCheckoutCone true', {
      cwd: tempCloneDir,
    });

    // Initialize sparse checkout
    execCommand('git sparse-checkout init --cone', {
      cwd: tempCloneDir,
    });

    // Set sparse patterns: only examples/
    execCommand('git sparse-checkout set examples', {
      cwd: tempCloneDir,
    });

    // Resolve the ref to a full commit SHA
    const resolvedRef = execCommand('git rev-parse HEAD', {
      cwd: tempCloneDir,
    });
    console.error(`[fetch-python-sdk-map] resolved ref: ${resolvedRef}`);

    // Read the operation-map.json
    const sourceMapPath = join(tempCloneDir, 'examples/operation-map.json');
    let operationMapContent: string;
    try {
      operationMapContent = readFileSync(sourceMapPath, 'utf-8');
    } catch (_error) {
      throw new Error(`Failed to read operation-map.json from cloned repo at ${sourceMapPath}`);
    }

    // Ensure output directory exists
    mkdirSync(pythonSdkDir, { recursive: true });

    // Write operation-map.json
    writeFileSync(operationMapPath, operationMapContent, 'utf-8');
    console.error(`[fetch-python-sdk-map] wrote ${operationMapPath}`);

    // Write metadata
    const metadata: SdkMetadata = {
      sdkRef: resolvedRef,
      operationMapHash: computeHash(operationMapContent),
      fetchedAt: new Date().toISOString(),
    };
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    console.error(`[fetch-python-sdk-map] wrote ${metadataPath}`);
  } finally {
    // Clean up temp clone
    if (process.platform === 'win32') {
      try {
        execCommand(`rmdir /s /q "${tempCloneDir}"`, { shell: true });
      } catch {
        // May fail; best effort
      }
    } else {
      try {
        rmSync(tempCloneDir, { recursive: true, force: true });
      } catch {
        // May fail; best effort
      }
    }
  }

  console.error('[fetch-python-sdk-map] done');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
