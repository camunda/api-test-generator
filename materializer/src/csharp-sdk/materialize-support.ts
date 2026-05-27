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

function defaultFixturesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'fixtures');
    if (existsSync(path.join(candidate, 'bpmn'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(here, '..', '..', '..', '..', 'fixtures');
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
