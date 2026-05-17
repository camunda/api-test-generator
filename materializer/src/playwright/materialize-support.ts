// ---------------------------------------------------------------------------
// Vendors the Playwright runtime support files, project scaffolding, AND
// artifact fixture files into an emitted test suite so the suite is runnable
// in place:
//
//   cd <outDir>
//   npm install
//   API_BASE_URL=http://localhost:8080/v2 npm test
//
// Three sets of assets are copied:
//   * support/ — runtime helpers (env.ts, recorder.ts, seeding.ts,
//                fixtures.ts, seed-rules.json, await-eventually.ts).
//                Sources:
//                materializer/src/support/, staged into
//                dist/src/playwright/support-templates/ at
//                build time.
//                PLUS per-role overlays from
//                configs/<config>/codegen/playwright/roles/<role>/support.<ext>
//                copied (renamed) to support/<role>.<ext>
//                — see materializeRoleSupportFiles().
//   * project root — package.json, playwright.config.ts, tsconfig.json,
//                    .env.example, README.md.
//                    Sources: materializer/templates/.
//   * fixtures/ — BPMN/DMN/form files referenced by @@FILE:<rel-path>
//                 markers in emitted tests. Sources:
//                 configs/<config>/fixtures/ (per-config; #221 / Lift 11).
//
// Keep SUPPORT_TEMPLATE_FILES in sync with
// materializer/scripts/copy-support-templates.js.
// ---------------------------------------------------------------------------
import { spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getActiveConfigDir, getSpecBundleDir } from 'path-analyser/configResolver';

export const SUPPORT_TEMPLATE_FILES = [
  'env.ts',
  'recorder.ts',
  'seeding.ts',
  'fixtures.ts',
  'seed-rules.json',
  'await-eventually.ts',
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
  //   - dist:  <pkg>/dist/src/playwright/materialize-support.js
  //   - tsx :  <pkg>/src/playwright/materialize-support.ts
  // Templates are staged next to the dist version by the build step. When
  // running from source via tsx, fall back to the canonical sources under
  // src/support/.
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (here.includes(`${path.sep}dist${path.sep}`)) {
    return path.join(here, 'support-templates');
  }
  // Source mode: walk up from src/playwright/ to src/support/.
  return path.resolve(here, '..', 'support');
}

/**
 * Locate the project-root template directory (materializer/templates/).
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
 * @param excludeSupportFiles Optional list of support-template file names to
 *                            skip when copying into `<outDir>/support/`.
 *                            Used by callers that have configured the emitter
 *                            to drop a runtime helper (e.g. `recorder.ts`
 *                            when `recordResponses=false`). Names must match
 *                            entries in {@link SUPPORT_TEMPLATE_FILES} — unknown
 *                            names throw to surface typos rather than silently
 *                            no-op. When a name is excluded, any pre-existing
 *                            file by the same name under `<outDir>/support/`
 *                            is also removed, so re-running the materializer
 *                            over an existing suite cannot leave a stale
 *                            helper behind.
 * @returns                   Path to the support directory under `outDir`.
 */
export async function materializeSupport(
  outDir: string,
  templatesDir?: string,
  projectTemplatesDir?: string,
  overwriteRoot: boolean = true,
  excludeSupportFiles?: readonly string[],
): Promise<string> {
  const srcDir = templatesDir ?? defaultTemplatesDir();
  const destDir = path.join(outDir, SUPPORT_DIR_NAME);
  await fs.mkdir(destDir, { recursive: true });

  const validNames: ReadonlySet<string> = new Set(SUPPORT_TEMPLATE_FILES);
  const exclude = new Set(excludeSupportFiles ?? []);
  for (const name of exclude) {
    if (!validNames.has(name)) {
      throw new Error(
        `materializeSupport: excludeSupportFiles contains unknown name ${JSON.stringify(name)}. ` +
          `Allowed: ${[...validNames].join(', ')}.`,
      );
    }
  }
  // Always overwrite support/ — these are part of the generator's contract.
  // For excluded names, actively remove any pre-existing destination file
  // so a previous run with the helper enabled does not leave a stale copy
  // behind. `fs.rm({ force: true })` is a no-op when the file is absent.
  for (const name of SUPPORT_TEMPLATE_FILES) {
    const dest = path.join(destDir, name);
    if (exclude.has(name)) {
      await fs.rm(dest, { force: true });
      continue;
    }
    await fs.copyFile(path.join(srcDir, name), dest);
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

/**
 * Vendor per-role helper files from the active config's role overlay
 * (Lift 12 / #231) into `<outDir>/support/<role>.<ext>`.
 *
 * Walks `configs/<config>/codegen/playwright/roles/<role>/` directories
 * via the role loader and, for each role whose directory contains a
 * `support.<ext>` file, copies that file to the suite as `<role>.<ext>`.
 * The rename collapses the per-role directory into a single suite-local
 * file so role helpers cannot collide on basename and so the emitter's
 * generated `import { ... } from './support/<role>'` line is stable.
 *
 * Raises when a role's helper basename (`<role>`) would collide with a
 * built-in support file basename (e.g. a role named `env` or `seeding`),
 * since the emitted suite imports built-ins as `./support/env`,
 * `./support/seeding`, etc. and an overwrite would silently break the
 * suite's imports. The error names both the role and the colliding
 * built-in so the operator can rename the role.
 *
 * @param outDir       Same directory passed to {@link materializeSupport}.
 * @param roleBundles  Loaded role bundles, as returned by
 *                     `loadRoleBundlesForActiveConfig`. Decoupled from
 *                     this module's loader so callers (codegen orchestrator
 *                     + tests) construct the bundle map once and share it
 *                     between the materializer and the renderer.
 * @returns            The list of vendored file basenames (e.g.
 *                     `['deploymentGateway.ts']`) for callers that want to
 *                     assert what was copied.
 */
export async function materializeRoleSupportFiles(
  outDir: string,
  roleBundles: Map<string, { role: string; supportFilePath?: string }>,
): Promise<string[]> {
  const destDir = path.join(outDir, SUPPORT_DIR_NAME);
  await fs.mkdir(destDir, { recursive: true });

  // Build a quick lookup of built-in basenames (without extension) so we
  // can detect role-vs-builtin collisions before any copy happens.
  const builtInStems = new Set(
    SUPPORT_TEMPLATE_FILES.map((f) => {
      const dot = f.lastIndexOf('.');
      return dot >= 0 ? f.slice(0, dot) : f;
    }),
  );

  const copied: string[] = [];
  for (const [roleName, bundle] of roleBundles) {
    if (!bundle.supportFilePath) continue;
    if (builtInStems.has(roleName)) {
      throw new Error(
        `materializeRoleSupportFiles: role '${roleName}' collides with the built-in support ` +
          `file '${roleName}.*'. Rename the role.`,
      );
    }
    const ext = path.extname(bundle.supportFilePath);
    const destName = `${roleName}${ext}`;
    if (copied.includes(destName)) {
      throw new Error(
        `materializeRoleSupportFiles: role '${roleName}' produced duplicate destination ${destName}.`,
      );
    }
    await fs.copyFile(bundle.supportFilePath, path.join(destDir, destName));
    copied.push(destName);
  }

  return copied;
}

/** Subdirectory created under the emitter's outDir to hold BPMN/DMN/form
 *  fixture files referenced by `@@FILE:<rel-path>` markers in emitted tests. */
export const FIXTURES_DIR_NAME = 'fixtures';

/**
 * Locate the active config's `fixtures/` directory
 * (#221 / Lift 11: `configs/<config>/fixtures/`).
 *
 * Walks up from this module's location looking for a repo root (one
 * containing `configs.json`) and then resolves the active config's
 * fixtures dir via `getActiveConfigDir`. This handles both tsx (source)
 * and dist runtime modes without a hard-coded depth.
 *
 * Throws if no `configs.json` is found in any ancestor: a hard-coded
 * fallback would silently copy the wrong fixtures whenever this module
 * was relocated or a non-default CONFIG was active.
 */
function defaultFixturesSourceDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'configs.json'))) {
      return path.join(getActiveConfigDir(dir), 'fixtures');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `defaultFixturesSourceDir: could not locate a repo root (no configs.json found in any ancestor of ${here}). ` +
      'Pass an explicit fixturesSourceDir to materializeFixtures().',
  );
}

/**
 * Copy `<fixturesSourceDir>/` recursively into `<outDir>/fixtures/` so the
 * emitted suite is self-contained: `@@FILE:<rel-path>` markers in generated
 * tests resolve via the `path.resolve(here, '..', 'fixtures', p)` candidate
 * in `support/fixtures.ts` regardless of `process.cwd()`.
 *
 * Idempotent: wipes `<outDir>/fixtures/` before copying so the vendored
 * copy stays in sync with the generator's fixture source on every codegen
 * run — including when files are deleted from the source tree.
 *
 * @param outDir          The same directory passed to {@link materializeSupport}.
 * @param fixturesSourceDir  Optional override for the fixtures source directory.
 *                           Production callers should omit this.
 * @returns               Path to the fixtures directory under `outDir`.
 */
export async function materializeFixtures(
  outDir: string,
  fixturesSourceDir?: string,
): Promise<string> {
  const srcDir = fixturesSourceDir ?? defaultFixturesSourceDir();
  const destDir = path.join(outDir, FIXTURES_DIR_NAME);

  // Wipe the destination first so deleted source files don't accumulate in
  // the vendored copy across successive codegen runs.
  await fs.rm(destDir, { recursive: true, force: true });

  async function copyDir(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    for (const entry of await fs.readdir(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  await copyDir(srcDir, destDir);
  return destDir;
}

/** Subdirectory created under the emitter's outDir to hold the
 *  assert-json-body response-schema artifact (`responses.json`). */
export const RESPONSE_SCHEMAS_DIR_NAME = 'json-body-assertions';

/**
 * Walk up from `startDir` looking for the bundled OpenAPI spec under the
 * active config's spec directory (#128 PR 2). Used so
 * `materializeResponseSchemas` works regardless of whether the codegen is
 * invoked from the repo root or from `materializer/`. Returns undefined
 * if no repo root (one containing `configs.json`) is found.
 */
function findDefaultSpecFile(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'configs.json'))) {
      const candidate = path.join(getSpecBundleDir(dir), 'rest-api.bundle.json');
      if (existsSync(candidate)) return candidate;
      return undefined;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Extract response schemas from the bundled OpenAPI spec into
 * `<outDir>/json-body-assertions/responses.json` so the emitted suite's
 * `validateResponse(...)` calls can resolve their schema source without
 * depending on the surrounding generator project.
 *
 * Spawns the `assert-json-body` CLI (a devDependency of this repo and a
 * runtime dependency declared in the standalone-suite template
 * `templates/package.json`).
 *
 * @param outDir   Same directory passed to {@link materializeSupport}.
 * @param specFile Optional explicit path to the bundled spec. Defaults to
 *                 walking up from `outDir` looking for
 *                 `spec/bundled/rest-api.bundle.json`.
 */
export async function materializeResponseSchemas(
  outDir: string,
  specFile?: string,
): Promise<string> {
  const resolvedSpec = specFile ?? findDefaultSpecFile(outDir);
  if (!resolvedSpec) {
    throw new Error(
      `materializeResponseSchemas: could not locate bundled spec. ` +
        `findDefaultSpecFile walks up from ${outDir} looking for a repo root ` +
        `(one containing configs.json) and then resolves the active config ` +
        `via $CONFIG / configs.json default to spec/<config>/bundled/rest-api.bundle.json. ` +
        `Either run from within the api-test-generator repo, or pass specFile explicitly.`,
    );
  }
  const targetDir = path.join(outDir, RESPONSE_SCHEMAS_DIR_NAME);
  await fs.mkdir(targetDir, { recursive: true });
  const result = spawnSync(
    'npx',
    [
      '--no-install',
      'assert-json-body',
      'extract',
      `--specFile=${resolvedSpec}`,
      `--outputDir=${targetDir}`,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(
      `materializeResponseSchemas: assert-json-body extract exited with status ${result.status}`,
    );
  }
  return targetDir;
}
