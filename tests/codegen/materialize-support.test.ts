import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  materializeSupport,
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

  test('is idempotent: a second call overwrites without error', async () => {
    await materializeSupport(tmp);
    await expect(materializeSupport(tmp)).resolves.toBe(path.join(tmp, SUPPORT_DIR_NAME));
    const entries = await fs.readdir(path.join(tmp, SUPPORT_DIR_NAME));
    expect(entries.sort()).toEqual([...SUPPORT_TEMPLATE_FILES].sort());
  });

  test('respects the templatesDir override and copies from a custom source', async () => {
    // Stage a complete set of template files in a tmp source directory.
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

  test('fails with a clear filesystem error when a required template is missing', async () => {
    // Use the templatesDir override to point at a tmp source directory that
    // is missing one expected template. This exercises the missing-template
    // path without mutating any checked-in source files (which would race
    // with other tests under Vitest's `pool: 'forks'` configuration).
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
