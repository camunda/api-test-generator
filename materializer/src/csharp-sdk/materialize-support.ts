// ---------------------------------------------------------------------------
// Vendors the C# SDK runtime scaffolding into an emitted test suite so the
// suite is runnable in place:
//
//   cd <outDir>
//   dotnet test
// ---------------------------------------------------------------------------
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getActiveConfigDir } from 'path-analyser/configResolver';

export const CSHARP_PROJECT_TEMPLATE_FILES = [
  'CamundaIntegrationTests.csproj',
  'TestFixtureBase.cs',
  'README.md',
] as const;

function defaultProjectTemplatesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (here.includes(`${path.sep}dist${path.sep}`)) {
    return path.join(here, 'project-templates');
  }
  return path.resolve(here, 'project-templates');
}

/**
 * Locate the active config's `fixtures/` directory
 * (#221 / Lift 11: `configs/<config>/fixtures/`).
 *
 * Walks up from this module's location looking for a repo root (one
 * containing `configs.json`) and then resolves the active config's
 * fixtures dir via `getActiveConfigDir`. This handles both tsx (source)
 * and dist runtime modes without a hard-coded depth, and respects the
 * active `CONFIG`. Mirrors the canonical Playwright resolver in
 * `materializer/src/playwright/materialize-support.ts`.
 *
 * Throws if no `configs.json` is found in any ancestor: a hard-coded
 * fallback would silently copy the wrong fixtures (or a non-existent
 * top-level `fixtures/`) whenever this module was relocated or a
 * non-default CONFIG was active.
 */
function defaultFixturesDir(): string {
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
    `defaultFixturesDir: could not locate a repo root (no configs.json found in any ancestor of ${here}).`,
  );
}

export async function materializeCsharpSupport(
  outDir: string,
  projectTemplatesDir?: string,
  overwriteRoot: boolean = true,
): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  const projSrcDir = projectTemplatesDir ?? defaultProjectTemplatesDir();
  for (const name of CSHARP_PROJECT_TEMPLATE_FILES) {
    const dest = path.join(outDir, name);
    if (!overwriteRoot && existsSync(dest)) continue;
    await fs.copyFile(path.join(projSrcDir, name), dest);
  }

  const fixturesSrcDir = defaultFixturesDir();
  const fixturesDestDir = path.join(outDir, 'fixtures');
  await fs.mkdir(fixturesDestDir, { recursive: true });
  await fs.cp(fixturesSrcDir, fixturesDestDir, { recursive: true });
}
