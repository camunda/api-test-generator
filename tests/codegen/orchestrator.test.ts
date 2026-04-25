import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { EmitContext, EmittedFile, Emitter } from '../../path-analyser/src/codegen/emitter.ts';
import { writeEmitted } from '../../path-analyser/src/codegen/orchestrator.ts';
import type { EndpointScenarioCollection } from '../../path-analyser/src/types.ts';

const FIXTURE: EndpointScenarioCollection = {
  endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [],
};

function buildEmitter(files: EmittedFile[]): Emitter {
  return {
    id: 'stub',
    name: 'stub',
    async emit() {
      return files;
    },
  };
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'emitter-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const ctx = (): EmitContext => ({
  outDir: tmp,
  suiteName: 'createWidget',
  mode: 'feature',
});

describe('orchestrator.writeEmitted', () => {
  test('writes a single top-level file', async () => {
    const e = buildEmitter([{ relativePath: 'createWidget.spec.ts', content: '// hello' }]);
    const written = await writeEmitted(e, FIXTURE, ctx());
    expect(written).toHaveLength(1);
    expect(readFileSync(path.join(tmp, 'createWidget.spec.ts'), 'utf8')).toBe('// hello');
  });

  test('creates nested directories on demand', async () => {
    const e = buildEmitter([{ relativePath: 'support/env.ts', content: '// env' }]);
    await writeEmitted(e, FIXTURE, ctx());
    expect(readFileSync(path.join(tmp, 'support/env.ts'), 'utf8')).toBe('// env');
  });

  test('writes multiple files in emit order', async () => {
    const e = buildEmitter([
      { relativePath: 'a.ts', content: '1' },
      { relativePath: 'b.ts', content: '2' },
    ]);
    const written = await writeEmitted(e, FIXTURE, ctx());
    expect(written.map((p) => path.basename(p))).toEqual(['a.ts', 'b.ts']);
    expect(readdirSync(tmp).sort()).toEqual(['a.ts', 'b.ts']);
  });

  test('rejects absolute paths returned by an emitter', async () => {
    const e = buildEmitter([{ relativePath: '/etc/passwd', content: 'oops' }]);
    await expect(writeEmitted(e, FIXTURE, ctx())).rejects.toThrowError(/returned absolute path/);
  });

  test('rejects paths that escape outDir via ..', async () => {
    const e = buildEmitter([{ relativePath: '../escape.ts', content: 'oops' }]);
    await expect(writeEmitted(e, FIXTURE, ctx())).rejects.toThrowError(/escapes ctx.outDir/);
  });

  test('rejects paths that escape outDir via a deeper .. segment', async () => {
    const e = buildEmitter([{ relativePath: 'a/b/../../../escape.ts', content: 'oops' }]);
    await expect(writeEmitted(e, FIXTURE, ctx())).rejects.toThrowError(/escapes ctx.outDir/);
  });

  test('allows a filename that contains .. as a substring (not a parent-dir segment)', async () => {
    const e = buildEmitter([{ relativePath: 'foo..bar.spec.ts', content: '// ok' }]);
    const written = await writeEmitted(e, FIXTURE, ctx());
    expect(written).toHaveLength(1);
    expect(readFileSync(path.join(tmp, 'foo..bar.spec.ts'), 'utf8')).toBe('// ok');
  });

  test('allows nested .. segments that resolve to a path inside outDir', async () => {
    const e = buildEmitter([{ relativePath: 'a/b/../inside.ts', content: '// ok' }]);
    const written = await writeEmitted(e, FIXTURE, ctx());
    expect(written).toHaveLength(1);
    expect(readFileSync(path.join(tmp, 'a/inside.ts'), 'utf8')).toBe('// ok');
  });
});
