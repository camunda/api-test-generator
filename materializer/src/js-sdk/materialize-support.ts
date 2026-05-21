// ---------------------------------------------------------------------------
// Vendors the JS SDK runtime support files AND project scaffolding into an
// emitted test suite so the suite is runnable in place:
//
//   cd <outDir>
//   npm install
//   npm test
//
// Two sets of files are materialised:
//   * support/ — runtime helpers (seeding.ts, seed-rules.json).
//     Sources: path-analyser/src/codegen/support/ (shared with the
//     Playwright emitter). Staged to
//     dist/src/codegen/js-sdk/support-templates/ at build time.
//   * project root — package.json, tsconfig.json, vitest.config.ts,
//     .env.example, README.md.
//     Sources: path-analyser/src/codegen/js-sdk/project-templates/.
//     Staged to dist/src/codegen/js-sdk/project-templates/ at build time.
// ---------------------------------------------------------------------------
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Support files vendored into `<outDir>/support/`.
 *
 * The JS SDK emitter only needs the seeding utilities — it does not use
 * Playwright fixtures, the HTTP recorder, or the `awaitEventually` helper
 * (the SDK has built-in eventual-consistency polling).
 */
export const SDK_SUPPORT_TEMPLATE_FILES = ['seeding.ts', 'seed-rules.json'] as const;

/** Files copied directly into `<outDir>/` (project root scaffolding). */
export const SDK_PROJECT_TEMPLATE_FILES = [
  'package.json',
  'tsconfig.json',
  'vitest.config.ts',
  '.env.example',
  'README.md',
] as const;

/** Subdirectory created under the emitter's outDir to hold vendored helpers. */
export const SDK_SUPPORT_DIR_NAME = 'support';

function defaultSupportTemplatesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (here.includes(`${path.sep}dist${path.sep}`)) {
    return path.join(here, 'support-templates');
  }
  // Source mode: support templates live in the Playwright emitter's support/
  // directory, which is co-located at materializer/src/playwright/support/.
  return path.resolve(here, '..', 'playwright', 'support');
}

function defaultProjectTemplatesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (here.includes(`${path.sep}dist${path.sep}`)) {
    return path.join(here, 'project-templates');
  }
  // Source mode: templates are co-located in src/codegen/js-sdk/project-templates/.
  return path.resolve(here, 'project-templates');
}

/**
 * Copy the runtime support helpers AND project-root scaffolding into
 * `<outDir>/` so the emitted JS SDK suite is self-contained and runnable
 * in place (`cd <outDir> && npm install && npm test`).
 *
 * Idempotent: safe to call multiple times per emit run.
 *
 * @param outDir               Directory to materialise into (created if missing).
 * @param supportTemplatesDir  Optional override for the support-templates
 *                             source directory (seeding.ts, seed-rules.json).
 *                             Production callers should omit this.
 * @param projectTemplatesDir  Optional override for the project-root templates
 *                             (package.json, vitest.config.ts, …).
 *                             Production callers should omit this.
 * @param overwriteRoot        When false, root scaffolding files are only
 *                             written if they don't already exist. Support
 *                             files are always overwritten regardless.
 *                             Default: true.
 * @returns                    Path to the support directory under `outDir`.
 */
export async function materializeSdkSupport(
  outDir: string,
  supportTemplatesDir?: string,
  projectTemplatesDir?: string,
  overwriteRoot: boolean = true,
): Promise<string> {
  const srcDir = supportTemplatesDir ?? defaultSupportTemplatesDir();
  const destDir = path.join(outDir, SDK_SUPPORT_DIR_NAME);
  await fs.mkdir(destDir, { recursive: true });

  // Always overwrite support/ — these are part of the generator's contract.
  for (const name of SDK_SUPPORT_TEMPLATE_FILES) {
    await fs.copyFile(path.join(srcDir, name), path.join(destDir, name));
  }

  // Project root scaffolding: overwrite by default; opt-out preserves edits.
  const projSrcDir = projectTemplatesDir ?? defaultProjectTemplatesDir();
  for (const name of SDK_PROJECT_TEMPLATE_FILES) {
    const dest = path.join(outDir, name);
    if (!overwriteRoot && existsSync(dest)) continue;
    await fs.copyFile(path.join(projSrcDir, name), dest);
  }

  return destDir;
}
