// ---------------------------------------------------------------------------
// Vendors the request-validation suite's runtime support files and project
// scaffolding into an emitted test directory so the generated suite can be
// run in place with no external dependency other than a running server:
//
//   cd <outDir>
//   npm install
//   CORE_APPLICATION_URL=http://localhost:8080 npm test
//
// Templates live under <pkg>/templates/ and are copied verbatim. The
// `templatesDir` override is for tests only — production callers should
// omit it (avoids parallel-fs races on shared files under Vitest's
// `pool: 'forks'` configuration).
// ---------------------------------------------------------------------------
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Files copied directly into <outDir>/ (project root scaffolding). */
export const STANDALONE_ROOT_FILES = [
  'package.json',
  'playwright.config.ts',
  'tsconfig.json',
  '.env.example',
  'README.md',
] as const;

/** Files copied into <outDir>/support/ (runtime helpers imported by specs). */
export const STANDALONE_SUPPORT_FILES = ['env.ts', 'http.ts'] as const;

/** Files copied into <outDir>/scripts/ (post-run analyser, run via `npm run summarize`). */
export const STANDALONE_SCRIPT_FILES = ['summarize-failures.mjs'] as const;

/** Subdirectory created under outDir to hold vendored helpers. */
export const SUPPORT_DIR_NAME = 'support';

/** Subdirectory under outDir for the post-run analyser script. */
export const SCRIPTS_DIR_NAME = 'scripts';

function defaultTemplatesDir(): string {
  // import.meta.url resolves to:
  //   tsx mode:  <pkg>/src/emit/materializeStandalone.ts
  //   dist mode: <pkg>/dist/src/emit/materializeStandalone.js
  // In both cases templates live at <pkg>/templates/. Walk up looking for it
  // rather than hardcoding ../../ to be robust across both modes.
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'templates');
    if (existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback (will fail loudly at copy time with a clear ENOENT).
  return path.resolve(here, '..', '..', 'templates');
}

/**
 * Copy the support templates and project scaffolding into `<outDir>/` so the
 * emitted suite is self-contained.
 *
 * Idempotent: safe to call multiple times per emit run.
 *
 * @param outDir         Directory to materialize into (created if missing).
 * @param templatesDir   Optional override for the templates source directory.
 *                       Production callers must omit this; it exists for tests.
 * @param overwriteRoot  When false, root scaffolding files (package.json etc.)
 *                       are only written if they don't already exist. Support
 *                       files are always overwritten regardless. Default: true.
 * @returns              Path to the support directory under `outDir`.
 */
export async function materializeStandalone(
  outDir: string,
  templatesDir?: string,
  overwriteRoot: boolean = true,
): Promise<string> {
  const srcDir = templatesDir ?? defaultTemplatesDir();
  const supportSrcDir = path.join(srcDir, SUPPORT_DIR_NAME);
  const supportDestDir = path.join(outDir, SUPPORT_DIR_NAME);
  const scriptsSrcDir = path.join(srcDir, SCRIPTS_DIR_NAME);
  const scriptsDestDir = path.join(outDir, SCRIPTS_DIR_NAME);

  await fs.mkdir(supportDestDir, { recursive: true });
  await fs.mkdir(scriptsDestDir, { recursive: true });

  // Always overwrite support/ — these are part of the generator's contract.
  for (const name of STANDALONE_SUPPORT_FILES) {
    await fs.copyFile(path.join(supportSrcDir, name), path.join(supportDestDir, name));
  }

  // Always overwrite scripts/ — analyser script is part of the contract.
  for (const name of STANDALONE_SCRIPT_FILES) {
    await fs.copyFile(path.join(scriptsSrcDir, name), path.join(scriptsDestDir, name));
  }

  // Project root scaffolding: overwritten by default; opt-out preserves user edits.
  for (const name of STANDALONE_ROOT_FILES) {
    const dest = path.join(outDir, name);
    if (!overwriteRoot && existsSync(dest)) continue;
    await fs.copyFile(path.join(srcDir, name), dest);
  }

  return supportDestDir;
}
