#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Stages the runtime support templates that emitters vendor into generated
// test suites.
//
// The Playwright emitter vendors runtime support files from
// src/playwright/support/. This script copies them into a templates
// directory under dist/ where materializeSupport() resolves them at
// codegen time.
//
// SDK emitters (js-sdk, python-sdk, csharp-sdk) handle their own
// scaffolding via SDK-specific materialize<Sdk>Support() functions;
// they do not use this template-staging infrastructure.
//
// Output layout:
//   dist/src/playwright/support-templates/
//     env.ts
//     recorder.ts
//     seeding.ts
//     fixtures.ts
//     seed-rules.json
//     await-eventually.ts
// ---------------------------------------------------------------------------
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SUPPORT_FILES = [
  'env.ts',
  'recorder.ts',
  'seeding.ts',
  'fixtures.ts',
  'seed-rules.json',
  'await-eventually.ts',
];

async function main() {
  const root = process.cwd();
  const srcDir = path.join(root, 'src/playwright/support');
  const destDir = path.join(root, 'dist/src/playwright/support-templates');
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
