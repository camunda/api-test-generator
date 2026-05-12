#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Stages the runtime support templates that the Playwright and JS SDK
// emitters vendor into every generated test suite.
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
//     fixtures.ts
//     seed-rules.json
//     await-eventually.ts
//   dist/src/codegen/js-sdk/support-templates/
//     seeding.ts
//     seed-rules.json
//   dist/src/codegen/js-sdk/project-templates/
//     package.json
//     tsconfig.json
//     vitest.config.ts
//     .env.example
//     README.md
// ---------------------------------------------------------------------------
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PLAYWRIGHT_SUPPORT_FILES = [
  'env.ts',
  'recorder.ts',
  'seeding.ts',
  'fixtures.ts',
  'seed-rules.json',
  'await-eventually.ts',
];

const SDK_SUPPORT_FILES = ['seeding.ts', 'seed-rules.json'];

const SDK_PROJECT_FILES = [
  'package.json',
  'tsconfig.json',
  'vitest.config.ts',
  '.env.example',
  'README.md',
];

const CSHARP_PROJECT_FILES = [
  'CamundaIntegrationTests.csproj',
  'TestFixtureBase.cs',
  'README.md',
];

async function main() {
  const root = process.cwd();
  const supportSrcDir = path.join(root, 'src/codegen/support');

  // Playwright support templates
  const playwrightDestDir = path.join(root, 'dist/src/codegen/playwright/support-templates');
  await fs.mkdir(playwrightDestDir, { recursive: true });
  for (const name of PLAYWRIGHT_SUPPORT_FILES) {
    const src = path.join(supportSrcDir, name);
    const dest = path.join(playwrightDestDir, name);
    try {
      await fs.access(src);
    } catch {
      console.error('[copy-support-templates] source not found:', src);
      process.exit(1);
    }
    await fs.copyFile(src, dest);
  }
  console.log(
    `[copy-support-templates] staged ${PLAYWRIGHT_SUPPORT_FILES.length} playwright templates -> ${path.relative(root, playwrightDestDir)}`,
  );

  // JS SDK support templates (subset of Playwright support)
  const sdkSupportDestDir = path.join(root, 'dist/src/codegen/js-sdk/support-templates');
  await fs.mkdir(sdkSupportDestDir, { recursive: true });
  for (const name of SDK_SUPPORT_FILES) {
    const src = path.join(supportSrcDir, name);
    const dest = path.join(sdkSupportDestDir, name);
    await fs.copyFile(src, dest);
  }
  console.log(
    `[copy-support-templates] staged ${SDK_SUPPORT_FILES.length} js-sdk support templates -> ${path.relative(root, sdkSupportDestDir)}`,
  );

  // JS SDK project templates (package.json, tsconfig, vitest.config, etc.)
  const sdkProjSrcDir = path.join(root, 'src/codegen/js-sdk/project-templates');
  const sdkProjDestDir = path.join(root, 'dist/src/codegen/js-sdk/project-templates');
  await fs.mkdir(sdkProjDestDir, { recursive: true });
  for (const name of SDK_PROJECT_FILES) {
    const src = path.join(sdkProjSrcDir, name);
    const dest = path.join(sdkProjDestDir, name);
    try {
      await fs.access(src);
    } catch {
      console.error('[copy-support-templates] source not found:', src);
      process.exit(1);
    }
    await fs.copyFile(src, dest);
  }
  console.log(
    `[copy-support-templates] staged ${SDK_PROJECT_FILES.length} js-sdk project templates -> ${path.relative(root, sdkProjDestDir)}`,
  );

  // C# SDK project templates
  const csharpProjSrcDir = path.join(root, 'src/codegen/csharp-sdk/project-templates');
  const csharpProjDestDir = path.join(root, 'dist/src/codegen/csharp-sdk/project-templates');
  await fs.mkdir(csharpProjDestDir, { recursive: true });
  for (const name of CSHARP_PROJECT_FILES) {
    const src = path.join(csharpProjSrcDir, name);
    const dest = path.join(csharpProjDestDir, name);
    try {
      await fs.access(src);
    } catch {
      console.error('[copy-support-templates] source not found:', src);
      process.exit(1);
    }
    await fs.copyFile(src, dest);
  }
  console.log(
    `[copy-support-templates] staged ${CSHARP_PROJECT_FILES.length} csharp-sdk project templates -> ${path.relative(root, csharpProjDestDir)}`,
  );
}

main().catch((e) => {
  console.error('[copy-support-templates] error', e);
  process.exit(1);
});
