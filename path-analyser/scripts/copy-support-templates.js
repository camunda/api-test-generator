#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Stages the runtime support templates that the Playwright emitter vendors
// into every generated test suite.
//
// The canonical sources live in src/codegen/support/ (some are also imported
// at generation time by analyser code — e.g. deterministicSuffix). This
// script copies them as-is into a templates directory under dist/ where the
// emitter's materializeSupport() resolves them at codegen time.
//
// Output layout:
//   dist/src/codegen/playwright/support-templates/
//     env.ts
//     recorder.ts
//     seeding.ts
//     seed-rules.json
// ---------------------------------------------------------------------------
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SUPPORT_FILES = ['env.ts', 'recorder.ts', 'seeding.ts', 'seed-rules.json'];

async function main() {
  const root = process.cwd();
  const srcDir = path.join(root, 'src/codegen/support');
  const destDir = path.join(root, 'dist/src/codegen/playwright/support-templates');
  await fs.mkdir(destDir, { recursive: true });
  for (const name of SUPPORT_FILES) {
    const src = path.join(srcDir, name);
    const dest = path.join(destDir, name);
    try {
      await fs.access(src);
    } catch {
      console.error('[copy-support-templates] source not found:', src);
      process.exit(1);
    }
    await fs.copyFile(src, dest);
  }
  console.log(
    `[copy-support-templates] staged ${SUPPORT_FILES.length} templates -> ${path.relative(root, destDir)}`,
  );
}

main().catch((e) => {
  console.error('[copy-support-templates] error', e);
  process.exit(1);
});
