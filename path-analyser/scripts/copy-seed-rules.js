#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

async function main() {
  const root = process.cwd();
  const src = path.join(root, 'src/codegen/support/seed-rules.json');
  const destDir = path.join(root, 'dist/src/codegen/support');
  const dest = path.join(destDir, 'seed-rules.json');
  try {
    await fs.access(src);
  } catch {
    console.error('[copy-seed-rules] source not found:', src);
    return;
  }
  await fs.mkdir(destDir, { recursive: true });
  await fs.copyFile(src, dest);
  console.log('[copy-seed-rules] copied seed-rules.json to', dest);
}

main().catch(e => { console.error('[copy-seed-rules] error', e); process.exit(1); });
