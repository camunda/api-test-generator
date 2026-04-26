import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  materializeStandalone,
  STANDALONE_ROOT_FILES,
  STANDALONE_SUPPORT_FILES,
  SUPPORT_DIR_NAME,
} from '../../request-validation/src/emit/materializeStandalone.ts';

describe('materializeStandalone', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mat-standalone-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('writes all support files into <outDir>/support/ and all root scaffolding files into <outDir>/', async () => {
    const supportDir = await materializeStandalone(tmp);
    expect(supportDir).toBe(path.join(tmp, SUPPORT_DIR_NAME));

    const supportEntries = (await fs.readdir(supportDir)).sort();
    expect(supportEntries).toEqual([...STANDALONE_SUPPORT_FILES].sort());

    for (const name of STANDALONE_ROOT_FILES) {
      const dest = path.join(tmp, name);
      expect(existsSync(dest)).toBe(true);
      const stat = await fs.stat(dest);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  test('is idempotent: a second call overwrites without error', async () => {
    await materializeStandalone(tmp);
    await expect(materializeStandalone(tmp)).resolves.toBe(path.join(tmp, SUPPORT_DIR_NAME));
  });

  test('respects the templatesDir override and copies from a custom source', async () => {
    const fakeSrc = await fs.mkdtemp(path.join(os.tmpdir(), 'mat-standalone-src-'));
    try {
      const fakeSupport = path.join(fakeSrc, SUPPORT_DIR_NAME);
      await fs.mkdir(fakeSupport, { recursive: true });
      for (const name of STANDALONE_SUPPORT_FILES) {
        await fs.writeFile(path.join(fakeSupport, name), `// fake-support-${name}\n`, 'utf8');
      }
      for (const name of STANDALONE_ROOT_FILES) {
        await fs.writeFile(path.join(fakeSrc, name), `// fake-root-${name}\n`, 'utf8');
      }

      await materializeStandalone(tmp, fakeSrc);

      for (const name of STANDALONE_SUPPORT_FILES) {
        const content = await fs.readFile(path.join(tmp, SUPPORT_DIR_NAME, name), 'utf8');
        expect(content).toBe(`// fake-support-${name}\n`);
      }
      for (const name of STANDALONE_ROOT_FILES) {
        const content = await fs.readFile(path.join(tmp, name), 'utf8');
        expect(content).toBe(`// fake-root-${name}\n`);
      }
    } finally {
      await fs.rm(fakeSrc, { recursive: true, force: true });
    }
  });

  test('overwriteRoot=false preserves existing root files but still refreshes support files', async () => {
    const fakeSrc = await fs.mkdtemp(path.join(os.tmpdir(), 'mat-standalone-src-'));
    try {
      const fakeSupport = path.join(fakeSrc, SUPPORT_DIR_NAME);
      await fs.mkdir(fakeSupport, { recursive: true });
      for (const name of STANDALONE_SUPPORT_FILES) {
        await fs.writeFile(path.join(fakeSupport, name), 'NEW SUPPORT', 'utf8');
      }
      for (const name of STANDALONE_ROOT_FILES) {
        await fs.writeFile(path.join(fakeSrc, name), 'NEW ROOT', 'utf8');
      }

      // Pre-populate one root file with user edits.
      await fs.writeFile(path.join(tmp, 'package.json'), 'USER EDITED', 'utf8');

      await materializeStandalone(tmp, fakeSrc, /* overwriteRoot */ false);

      // User-edited root file preserved.
      expect(await fs.readFile(path.join(tmp, 'package.json'), 'utf8')).toBe('USER EDITED');
      // Other root files materialized for the first time.
      expect(await fs.readFile(path.join(tmp, 'tsconfig.json'), 'utf8')).toBe('NEW ROOT');
      // Support files always overwritten.
      for (const name of STANDALONE_SUPPORT_FILES) {
        expect(await fs.readFile(path.join(tmp, SUPPORT_DIR_NAME, name), 'utf8')).toBe(
          'NEW SUPPORT',
        );
      }
    } finally {
      await fs.rm(fakeSrc, { recursive: true, force: true });
    }
  });

  test('fails with a clear filesystem error when a required template is missing', async () => {
    const fakeSrc = await fs.mkdtemp(path.join(os.tmpdir(), 'mat-standalone-src-'));
    try {
      // Create support/ but omit one required support file.
      const fakeSupport = path.join(fakeSrc, SUPPORT_DIR_NAME);
      await fs.mkdir(fakeSupport, { recursive: true });
      for (const name of STANDALONE_SUPPORT_FILES.slice(1)) {
        await fs.writeFile(path.join(fakeSupport, name), 'x', 'utf8');
      }
      for (const name of STANDALONE_ROOT_FILES) {
        await fs.writeFile(path.join(fakeSrc, name), 'x', 'utf8');
      }
      await expect(materializeStandalone(tmp, fakeSrc)).rejects.toThrow(/ENOENT|no such file/i);
    } finally {
      await fs.rm(fakeSrc, { recursive: true, force: true });
    }
  });
});
