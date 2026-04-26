// ---------------------------------------------------------------------------
// Vendors the Playwright runtime support files AND project scaffolding into
// an emitted test suite so the suite is runnable in place:
//
//   cd <outDir>
//   npm install
//   API_BASE_URL=http://localhost:8080/v2 npm test
//
// Two template sets are copied:
//   * support/ — runtime helpers (env.ts, recorder.ts, seeding.ts,
//                seed-rules.json). Sources: path-analyser/src/codegen/support/,
//                staged into dist/src/codegen/playwright/support-templates/ at
//                build time.
//   * project root — package.json, playwright.config.ts, tsconfig.json,
//                    .env.example, README.md.
//                    Sources: path-analyser/templates/.
//
// Keep SUPPORT_TEMPLATE_FILES in sync with
// path-analyser/scripts/copy-support-templates.js.
// ---------------------------------------------------------------------------
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORT_TEMPLATE_FILES = [
  'env.ts',
  'recorder.ts',
  'seeding.ts',
  'seed-rules.json',
] as const;

/** Files copied directly into <outDir>/ (project root scaffolding). */
export const PROJECT_TEMPLATE_FILES = [
  'package.json',
  'playwright.config.ts',
  'tsconfig.json',
  '.env.example',
  'README.md',
] as const;

/** Subdirectory created under the emitter's outDir to hold vendored helpers. */
export const SUPPORT_DIR_NAME = 'support';

function defaultTemplatesDir(): string {
  // import.meta.url resolves to the running module location:
  //   - dist:  <pkg>/dist/src/codegen/playwright/materialize-support.js
  //   - tsx :  <pkg>/src/codegen/playwright/materialize-support.ts
  // Templates are staged next to the dist version by the build step. When
  // running from source via tsx, fall back to the canonical sources under
  // src/codegen/support/.
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (here.includes(`${path.sep}dist${path.sep}`)) {
    return path.join(here, 'support-templates');
  }
  // Source mode: walk up from src/codegen/playwright/ to src/codegen/support/.
  return path.resolve(here, '..', 'support');
}

/**
 * Locate the project-root template directory (path-analyser/templates/).
 *
 * Walks up from this module's location looking for a `templates/` directory
 * containing `package.json`. Robust across both tsx (source) and dist runtime
 * modes — the templates ship as plain checked-in files at <pkg>/templates/.
 */
function defaultProjectTemplatesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'templates');
    if (existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to a sensible relative path; copyFile will fail loudly if absent.
  return path.resolve(here, '..', '..', '..', '..', 'templates');
}

/**
 * Copy the runtime support templates AND project-root scaffolding into
 * `<outDir>/` so the emitted Playwright suite is self-contained and runnable
 * in place (`cd <outDir> && npm install && npm test`).
 *
 * Idempotent: safe to call multiple times per emit run.
 *
 * @param outDir              Directory to materialize into (created if missing).
 * @param templatesDir        Optional override for the support-templates source
 *                            directory (env.ts, recorder.ts, seeding.ts,
 *                            seed-rules.json). Production callers should omit
 *                            this; it exists so tests can exercise the
 *                            missing-template path without mutating
 *                            checked-in source files.
 * @param projectTemplatesDir Optional override for the project-root templates
 *                            (package.json, playwright.config.ts, tsconfig.json,
 *                            .env.example, README.md). Production callers
 *                            should omit this.
 * @param overwriteRoot       When false, root scaffolding files are only
 *                            written if they don't already exist. Support
 *                            files are always overwritten regardless.
 *                            Default: true.
 * @returns                   Path to the support directory under `outDir`.
 */
export async function materializeSupport(
  outDir: string,
  templatesDir?: string,
  projectTemplatesDir?: string,
  overwriteRoot: boolean = true,
): Promise<string> {
  const srcDir = templatesDir ?? defaultTemplatesDir();
  const destDir = path.join(outDir, SUPPORT_DIR_NAME);
  await fs.mkdir(destDir, { recursive: true });

  // Always overwrite support/ — these are part of the generator's contract.
  for (const name of SUPPORT_TEMPLATE_FILES) {
    await fs.copyFile(path.join(srcDir, name), path.join(destDir, name));
  }

  // Project root scaffolding: overwritten by default; opt-out preserves user edits.
  const projSrcDir = projectTemplatesDir ?? defaultProjectTemplatesDir();
  for (const name of PROJECT_TEMPLATE_FILES) {
    const dest = path.join(outDir, name);
    if (!overwriteRoot && existsSync(dest)) continue;
    await fs.copyFile(path.join(projSrcDir, name), dest);
  }

  return destDir;
}
