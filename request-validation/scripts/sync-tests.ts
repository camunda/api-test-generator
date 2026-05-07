#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getActiveConfigName } from '../src/active-config.js';

async function rmDir(dir: string) {
  if (!fs.existsSync(dir)) return;
  await fs.promises.rm(dir, { recursive: true, force: true });
}

async function ensureDir(dir: string) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function copyDir(src: string, dest: string) {
  await ensureDir(dest);
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isFile()) {
      await fs.promises.copyFile(s, d);
    }
  }
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '..', '..');
  // Per-config layout (#128 PR 2): the generated request-validation suite
  // lives at <repoRoot>/generated/<config>/request-validation. The active
  // config is validated against configs.json (allowlist + safe-name regex)
  // so a typo fails loud rather than silently copying from/to a phantom
  // directory.
  const config = getActiveConfigName(repoRoot);
  const generatedDir = path.join(repoRoot, 'generated', config, 'request-validation');
  const qaTestsDir = path.join(repoRoot, 'tests', 'api', 'v2', 'request-validation');

  if (!fs.existsSync(generatedDir)) {
    console.error('[sync-tests] No generated output found at', generatedDir);
    process.exit(2);
  }

  console.log('[sync-tests] Cleaning target tests dir:', qaTestsDir);
  await rmDir(qaTestsDir);
  await ensureDir(qaTestsDir);

  console.log('[sync-tests] Copying from', generatedDir, 'to', qaTestsDir);
  await copyDir(generatedDir, qaTestsDir);
  console.log('[sync-tests] Done');
}

main().catch((e) => {
  console.error('[sync-tests] FAILED', e);
  process.exit(1);
});
