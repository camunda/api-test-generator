import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
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
