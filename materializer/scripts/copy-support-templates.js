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
// It also stages src/js-sdk/known-sdk-methods.json next to the compiled
// js-sdk emitter output: the emitter/materialize-support modules load it
// via a runtime `require()` (not a static `import`), so `resolveJsonModule`
// never causes tsc to copy it into dist on its own -- `node
// materializer/dist/src/index.js --target=js-sdk` would otherwise fail to
// resolve the module (Copilot PR #575 review).
//
// SDK emitters (js-sdk, python-sdk, csharp-sdk) handle their own
// scaffolding via SDK-specific materialize<Sdk>Support() functions;
// they do not use the Playwright template-staging infrastructure below.
//
// Output layout:
//   dist/src/playwright/support-templates/
//     env.ts
//     recorder.ts
//     seeding.ts
//     fixtures.ts
//     seed-rules.json
//     await-eventually.ts
//     evidence.ts
//   dist/src/js-sdk/
//     known-sdk-methods.json
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
  'evidence.ts',
];

async function copyFile(src, dest, label) {
  try {
    await fs.access(src);
  } catch {
    console.error(`[copy-support-templates] ${label} source not found:`, src);
    process.exit(1);
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

async function main() {
  const root = process.cwd();
  const srcDir = path.join(root, 'src/playwright/support');
  const destDir = path.join(root, 'dist/src/playwright/support-templates');
  await fs.mkdir(destDir, { recursive: true });
  for (const name of SUPPORT_FILES) {
    await copyFile(path.join(srcDir, name), path.join(destDir, name), 'playwright support');
  }
  console.log(
    `[copy-support-templates] staged ${SUPPORT_FILES.length} templates -> ${path.relative(root, destDir)}`,
  );

  const jsSdkJsonName = 'known-sdk-methods.json';
  await copyFile(
    path.join(root, 'src/js-sdk', jsSdkJsonName),
    path.join(root, 'dist/src/js-sdk', jsSdkJsonName),
    'js-sdk known-methods',
  );
  console.log(`[copy-support-templates] staged dist/src/js-sdk/${jsSdkJsonName}`);
}

main().catch((e) => {
  console.error('[copy-support-templates] error', e);
  process.exit(1);
});
