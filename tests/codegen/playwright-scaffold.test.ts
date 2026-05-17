// #233 Step 7: lock in PlaywrightEmitter.scaffold() and the orchestrator's
// generic writeScaffolded() write path. The scaffold method is the SDK
// boundary for project-root framing files (package.json, playwright.config.ts,
// tsconfig.json, .env.example, README.md); the orchestrator vendors the
// returned EmittedFile[] into <ctx.outDir>/ via the same path-safety checks
// used by writeEmitted().

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EmitContext } from '@camunda8/emitter-sdk';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { writeScaffolded } from '../../materializer/src/orchestrator.ts';
import { PlaywrightEmitter } from '../../materializer/src/playwright/emitter.ts';
import { PROJECT_TEMPLATE_FILES } from '../../materializer/src/playwright/materialize-support.ts';

function minimalCtx(outDir: string): EmitContext {
  return {
    outDir,
    suiteName: '',
    mode: 'feature',
    configName: 'camunda-oca',
    emitterConfig: {},
    resolveConfigPath: (...parts: string[]) => path.join(outDir, ...parts),
  };
}

describe('PlaywrightEmitter.scaffold', () => {
  test('returns the five project-root templates as EmittedFiles in declaration order', async () => {
    if (!PlaywrightEmitter.scaffold) throw new Error('scaffold must be defined');
    const outDir = path.join(
      os.tmpdir(),
      `ignored-scaffold-pure-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    await expect(fs.stat(outDir)).rejects.toThrow(/ENOENT/);
    const ctx = minimalCtx(outDir);
    const files = await PlaywrightEmitter.scaffold(ctx);
    expect(files.map((f) => f.relativePath)).toEqual([...PROJECT_TEMPLATE_FILES]);
    // Pure: no fs writes; verify nothing was created under the generated
    // outDir before or after calling scaffold().
    await expect(fs.stat(outDir)).rejects.toThrow(/ENOENT/);
    for (const f of files) {
      expect(f.content.length).toBeGreaterThan(0);
    }
  });
});

describe('writeScaffolded (orchestrator generic scaffold-write path)', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-write-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('writes every file returned by scaffold() into ctx.outDir', async () => {
    const written = await writeScaffolded(PlaywrightEmitter, minimalCtx(tmp));
    expect(written.length).toBe(PROJECT_TEMPLATE_FILES.length);
    for (const name of PROJECT_TEMPLATE_FILES) {
      const stat = await fs.stat(path.join(tmp, name));
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  test('is a no-op for emitters that omit scaffold', async () => {
    const noopEmitter = {
      ...PlaywrightEmitter,
      scaffold: undefined,
    };
    const written = await writeScaffolded(noopEmitter, minimalCtx(tmp));
    expect(written).toEqual([]);
    const entries = await fs.readdir(tmp);
    expect(entries).toEqual([]);
  });

  test('rejects scaffold files that escape ctx.outDir', async () => {
    const evilEmitter = {
      ...PlaywrightEmitter,
      async scaffold() {
        return [{ relativePath: '../escaped.txt', content: 'pwn' }];
      },
    };
    await expect(writeScaffolded(evilEmitter, minimalCtx(tmp))).rejects.toThrow(
      /escapes ctx.outDir/,
    );
  });

  test('rejects absolute paths returned by scaffold', async () => {
    const evilEmitter = {
      ...PlaywrightEmitter,
      async scaffold() {
        return [{ relativePath: '/etc/passwd', content: 'pwn' }];
      },
    };
    await expect(writeScaffolded(evilEmitter, minimalCtx(tmp))).rejects.toThrow(
      /returned absolute path/,
    );
  });
});
