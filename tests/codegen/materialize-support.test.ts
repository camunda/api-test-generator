import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  FIXTURES_DIR_NAME,
  materializeFixtures,
  materializeRoleSupportFiles,
  materializeSupport,
  PROJECT_TEMPLATE_FILES,
  SUPPORT_DIR_NAME,
  SUPPORT_TEMPLATE_FILES,
} from '../../path-analyser/src/codegen/playwright/materialize-support.ts';

describe('materializeSupport', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mat-support-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('copies all expected support template files into <outDir>/support/', async () => {
    const destDir = await materializeSupport(tmp);
    expect(destDir).toBe(path.join(tmp, SUPPORT_DIR_NAME));

    const entries = (await fs.readdir(destDir)).sort();
    expect(entries).toEqual([...SUPPORT_TEMPLATE_FILES].sort());

    // Each file is a non-empty verbatim copy of the canonical source.
    for (const name of SUPPORT_TEMPLATE_FILES) {
      const stat = await fs.stat(path.join(destDir, name));
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  test('writes project-root scaffolding files into <outDir>/', async () => {
    await materializeSupport(tmp);
    for (const name of PROJECT_TEMPLATE_FILES) {
      const stat = await fs.stat(path.join(tmp, name));
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  test('emitted package.json declares a "test" script and @playwright/test devDep', async () => {
    await materializeSupport(tmp);
    const pkgRaw = await fs.readFile(path.join(tmp, 'package.json'), 'utf8');
    // biome-ignore lint/plugin: test fixture parsing of known-good JSON
    const pkg = JSON.parse(pkgRaw) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.scripts?.test).toMatch(/playwright/);
    expect(pkg.devDependencies?.['@playwright/test']).toBeTruthy();
  });

  test('is idempotent: a second call overwrites without error', async () => {
    await materializeSupport(tmp);
    await expect(materializeSupport(tmp)).resolves.toBe(path.join(tmp, SUPPORT_DIR_NAME));
    const supportEntries = await fs.readdir(path.join(tmp, SUPPORT_DIR_NAME));
    expect(supportEntries.sort()).toEqual([...SUPPORT_TEMPLATE_FILES].sort());
    for (const name of PROJECT_TEMPLATE_FILES) {
      expect(existsSync(path.join(tmp, name))).toBe(true);
    }
  });

  test('overwriteRoot=false preserves user-edited root files but refreshes support/', async () => {
    await materializeSupport(tmp);
    // Simulate a user edit to a root file.
    const userPkg = '{"name":"user-edited"}';
    await fs.writeFile(path.join(tmp, 'package.json'), userPkg, 'utf8');

    await materializeSupport(tmp, undefined, undefined, false);

    expect(await fs.readFile(path.join(tmp, 'package.json'), 'utf8')).toBe(userPkg);
    // Support files are still part of the contract — refreshed regardless.
    for (const name of SUPPORT_TEMPLATE_FILES) {
      const stat = await fs.stat(path.join(tmp, SUPPORT_DIR_NAME, name));
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  test('respects the templatesDir override and copies from a custom support source', async () => {
    const fakeSrc = await fs.mkdtemp(path.join(os.tmpdir(), 'mat-support-src-'));
    try {
      for (const name of SUPPORT_TEMPLATE_FILES) {
        await fs.writeFile(path.join(fakeSrc, name), `// fake-${name}\n`, 'utf8');
      }
      const destDir = await materializeSupport(tmp, fakeSrc);
      for (const name of SUPPORT_TEMPLATE_FILES) {
        const content = await fs.readFile(path.join(destDir, name), 'utf8');
        expect(content).toBe(`// fake-${name}\n`);
      }
    } finally {
      await fs.rm(fakeSrc, { recursive: true, force: true });
    }
  });

  test('respects the projectTemplatesDir override', async () => {
    const fakeProj = await fs.mkdtemp(path.join(os.tmpdir(), 'mat-proj-src-'));
    try {
      for (const name of PROJECT_TEMPLATE_FILES) {
        await fs.writeFile(path.join(fakeProj, name), `fake-${name}`, 'utf8');
      }
      await materializeSupport(tmp, undefined, fakeProj);
      for (const name of PROJECT_TEMPLATE_FILES) {
        const content = await fs.readFile(path.join(tmp, name), 'utf8');
        expect(content).toBe(`fake-${name}`);
      }
    } finally {
      await fs.rm(fakeProj, { recursive: true, force: true });
    }
  });

  test('excludeSupportFiles skips listed files in support/ but keeps the rest', async () => {
    // Exercises the gate behind configs.json#codegen.playwright.recordResponses=false:
    // the call site drops recorder.ts when no recordResponse() call will be
    // emitted into the suite. Other support files must remain — they're part
    // of the suite's runtime contract regardless of the recorder option.
    await materializeSupport(tmp, undefined, undefined, true, ['recorder.ts']);
    const entries = (await fs.readdir(path.join(tmp, SUPPORT_DIR_NAME))).sort();
    const expected = SUPPORT_TEMPLATE_FILES.filter((f) => f !== 'recorder.ts').sort();
    expect(entries).toEqual(expected);
  });

  test('excludeSupportFiles removes a stale file left from a previous run', async () => {
    // Review-comment guard (#156 review): production pipelines wipe outDir
    // before materializing, but the legacy emitPlaywrightSuite entry point
    // does not, and a hand-call against an existing suite must not silently
    // ship a helper the caller meant to exclude. Materialize once with the
    // recorder included, then re-materialize with it excluded and assert
    // the stale recorder.ts is gone.
    await materializeSupport(tmp);
    expect(existsSync(path.join(tmp, SUPPORT_DIR_NAME, 'recorder.ts'))).toBe(true);
    await materializeSupport(tmp, undefined, undefined, true, ['recorder.ts']);
    expect(existsSync(path.join(tmp, SUPPORT_DIR_NAME, 'recorder.ts'))).toBe(false);
    // And the non-excluded files are still present.
    expect(existsSync(path.join(tmp, SUPPORT_DIR_NAME, 'seeding.ts'))).toBe(true);
  });

  test('excludeSupportFiles rejects names that are not in SUPPORT_TEMPLATE_FILES', async () => {
    // Review-comment guard (#156 review): typos in excludeSupportFiles
    // would otherwise silently no-op and the caller would keep shipping
    // the helper they thought they were excluding. The validator surfaces
    // the bad name in the error message so the fix site is obvious.
    await expect(
      materializeSupport(tmp, undefined, undefined, true, ['no-such-file.ts']),
    ).rejects.toThrow(/excludeSupportFiles contains unknown name "no-such-file\.ts"/);
  });

  test('fails with a clear filesystem error when a required support template is missing', async () => {
    const fakeSrc = await fs.mkdtemp(path.join(os.tmpdir(), 'mat-support-src-'));
    try {
      for (const name of SUPPORT_TEMPLATE_FILES.slice(1)) {
        await fs.writeFile(path.join(fakeSrc, name), 'x', 'utf8');
      }
      await expect(materializeSupport(tmp, fakeSrc)).rejects.toThrow(/ENOENT|no such file/i);
    } finally {
      await fs.rm(fakeSrc, { recursive: true, force: true });
    }
  });
});

describe('materializeFixtures', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mat-fixtures-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('copies bpmn/ dmn/ forms/ fixture files into <outDir>/fixtures/', async () => {
    const destDir = await materializeFixtures(tmp);
    expect(destDir).toBe(path.join(tmp, FIXTURES_DIR_NAME));

    for (const subdir of ['bpmn', 'dmn', 'forms']) {
      const dir = path.join(destDir, subdir);
      expect(existsSync(dir), `${subdir}/ should exist`).toBe(true);
      const files = await fs.readdir(dir);
      expect(files.length, `${subdir}/ should contain at least one file`).toBeGreaterThan(0);
      for (const f of files) {
        const stat = await fs.stat(path.join(dir, f));
        expect(stat.size, `${subdir}/${f} should be non-empty`).toBeGreaterThan(0);
      }
    }
  });

  test('is idempotent: a second call overwrites without error', async () => {
    await materializeFixtures(tmp);
    await expect(materializeFixtures(tmp)).resolves.toBe(path.join(tmp, FIXTURES_DIR_NAME));
  });

  test('here-relative candidate path resolves to a materialized file when here is <outDir>/support/', async () => {
    // Guard against regressions to the fixture resolution path used by
    // support/fixtures.ts. That file calls:
    //   path.resolve(here, '..', 'fixtures', p)
    // where `here` = fileURLToPath(import.meta.url)'s dirname = <outDir>/support/.
    // If materializeFixtures stops populating <outDir>/fixtures/ or the
    // relative traversal changes, this assertion fails.
    await materializeFixtures(tmp);
    const supportDir = path.join(tmp, 'support');
    await fs.mkdir(supportDir, { recursive: true });
    // Reproduce the exact candidate that support/fixtures.ts constructs:
    const candidate = path.resolve(supportDir, '..', 'fixtures', 'bpmn/service-task.bpmn');
    const buf = await fs.readFile(candidate);
    expect(buf.length).toBeGreaterThan(0);
  });
});

describe('materializeRoleSupportFiles', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mat-role-support-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('copies a role support file into <outDir>/support/<role>.<ext>', async () => {
    const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'role-src-'));
    try {
      const supportFile = path.join(srcDir, 'support.ts');
      await fs.writeFile(supportFile, '// role helper\n', 'utf8');
      const bundles = new Map([['myRole', { role: 'myRole', supportFilePath: supportFile }]]);
      const copied = await materializeRoleSupportFiles(tmp, bundles);
      expect(copied).toEqual(['myRole.ts']);
      const content = await fs.readFile(path.join(tmp, SUPPORT_DIR_NAME, 'myRole.ts'), 'utf8');
      expect(content).toBe('// role helper\n');
    } finally {
      await fs.rm(srcDir, { recursive: true, force: true });
    }
  });

  test('skips roles that have no support file', async () => {
    const bundles = new Map([
      ['noSupportRole', { role: 'noSupportRole', supportFilePath: undefined }],
    ]);
    const copied = await materializeRoleSupportFiles(tmp, bundles);
    expect(copied).toEqual([]);
  });

  test('returns all copied basenames for multiple roles', async () => {
    const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'role-src-'));
    try {
      const supportA = path.join(srcDir, 'supportA.ts');
      const supportB = path.join(srcDir, 'supportB.js');
      await fs.writeFile(supportA, '// A\n', 'utf8');
      await fs.writeFile(supportB, '// B\n', 'utf8');
      const bundles = new Map([
        ['roleA', { role: 'roleA', supportFilePath: supportA }],
        ['roleB', { role: 'roleB', supportFilePath: supportB }],
      ]);
      const copied = await materializeRoleSupportFiles(tmp, bundles);
      expect(copied.sort()).toEqual(['roleA.ts', 'roleB.js'].sort());
      expect(existsSync(path.join(tmp, SUPPORT_DIR_NAME, 'roleA.ts'))).toBe(true);
      expect(existsSync(path.join(tmp, SUPPORT_DIR_NAME, 'roleB.js'))).toBe(true);
    } finally {
      await fs.rm(srcDir, { recursive: true, force: true });
    }
  });

  test('throws when a role name collides with a built-in support file basename', async () => {
    const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'role-src-'));
    try {
      const supportFile = path.join(srcDir, 'support.ts');
      await fs.writeFile(supportFile, '// role helper\n', 'utf8');
      // 'env' is the stem of the built-in 'env.ts'
      const bundles = new Map([['env', { role: 'env', supportFilePath: supportFile }]]);
      await expect(materializeRoleSupportFiles(tmp, bundles)).rejects.toThrow(
        /collides with the built-in support file/,
      );
    } finally {
      await fs.rm(srcDir, { recursive: true, force: true });
    }
  });

  test('creates the support/ subdirectory when it does not exist', async () => {
    const outDir = path.join(tmp, 'fresh');
    await fs.mkdir(outDir);
    const copied = await materializeRoleSupportFiles(outDir, new Map());
    expect(existsSync(path.join(outDir, SUPPORT_DIR_NAME))).toBe(true);
    expect(copied).toEqual([]);
  });
});
