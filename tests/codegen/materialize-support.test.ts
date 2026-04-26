import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  materializeSupport,
  SUPPORT_DIR_NAME,
  SUPPORT_TEMPLATE_FILES,
} from '../../path-analyser/src/codegen/playwright/materialize-support.ts';

// In source-mode (running tests via vitest), materializeSupport reads
// templates from path-analyser/src/codegen/support/. Resolve that directory
// the same way the implementation does so the missing-template test can
// hide a file there temporarily without depending on dist artifacts.
const SOURCE_TEMPLATES_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  '..',
  'path-analyser',
  'src',
  'codegen',
  'support',
);

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

  test('fails with a clear filesystem error when a required template is missing', async () => {
    // Temporarily hide one canonical source template so materializeSupport's
    // copy step cannot find it. The error must be a recognisable filesystem
    // error (ENOENT) so an operator can act on it.
    const hidden = path.join(SOURCE_TEMPLATES_DIR, SUPPORT_TEMPLATE_FILES[0]);
    const stash = `${hidden}.stash-${process.pid}`;
    await fs.rename(hidden, stash);
    try {
      await expect(materializeSupport(tmp)).rejects.toThrow(/ENOENT|no such file/i);
    } finally {
      await fs.rename(stash, hidden);
    }
  });
});
