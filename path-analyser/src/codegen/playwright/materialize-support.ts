// ---------------------------------------------------------------------------
// Vendors the Playwright runtime support files into an emitted test suite.
//
// The emitter produces standalone test suites: every generated `.spec.ts`
// imports its helpers from `./support/...` (a sibling directory), so the
// emitted suite has no compile-time or runtime dependency on this generator
// project. The four template files (env.ts, recorder.ts, seeding.ts,
// seed-rules.json) are copied verbatim from a build-time staging directory
// (path-analyser/dist/src/codegen/playwright/support-templates/) into
// `<outDir>/support/`.
//
// Keep this list in sync with path-analyser/scripts/copy-support-templates.js.
// ---------------------------------------------------------------------------
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORT_TEMPLATE_FILES = [
  'env.ts',
  'recorder.ts',
  'seeding.ts',
  'seed-rules.json',
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
 * Copy the runtime support templates into `<outDir>/support/` so the
 * emitted Playwright suite is self-contained.
 *
 * Idempotent: safe to call multiple times per emit run; later calls just
 * overwrite the previous copies.
 *
 * @param outDir       Directory to materialize the support files into.
 * @param templatesDir Optional override for the templates source directory.
 *                     Production callers should omit this; it exists so tests
 *                     can exercise the missing-template path without mutating
 *                     checked-in source files (which would race with other
 *                     tests under Vitest's `pool: 'forks'` configuration).
 */
export async function materializeSupport(outDir: string, templatesDir?: string): Promise<string> {
  const srcDir = templatesDir ?? defaultTemplatesDir();
  const destDir = path.join(outDir, SUPPORT_DIR_NAME);
  await fs.mkdir(destDir, { recursive: true });
  for (const name of SUPPORT_TEMPLATE_FILES) {
    await fs.copyFile(path.join(srcDir, name), path.join(destDir, name));
  }
  return destDir;
}
