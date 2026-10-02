import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyConflictReplay,
  loadConflictReplay,
} from '../../../path-analyser/src/conflictReplay.ts';
import { generateFeatureCoverageForEndpoint } from '../../../path-analyser/src/featureCoverageGenerator.ts';
import type { OperationGraph, OperationNode } from '../../../path-analyser/src/types.ts';

const dirs: string[] = [];
function configDir(content?: string): string {
  const d = mkdtempSync(join(tmpdir(), 'conflict-replay-'));
  dirs.push(d);
  if (content !== undefined) writeFileSync(join(d, 'conflict-replay.json'), content);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function node(operationId: string, extra: Partial<OperationNode> = {}): OperationNode {
  return {
    operationId,
    method: 'PATCH',
    path: `/${operationId}/{key}`,
    requires: { required: [], optional: [] },
    produces: [],
    ...extra,
  };
}

function graphOf(...ops: OperationNode[]): OperationGraph {
  // biome-ignore lint/plugin: the fixture only populates the field under test
  return { operations: Object.fromEntries(ops.map((o) => [o.operationId, o])) } as OperationGraph;
}

describe('conflict-replay.json', () => {
  it('is optional', () => {
    expect(loadConflictReplay(configDir())).toEqual([]);
  });

  it('loads entries with an optional changeBody', () => {
    const d = configDir(
      JSON.stringify({
        replay: [
          { operationId: 'a', reason: 'r' },
          { operationId: 'b', reason: 'r', changeBody: { name: 'x' } },
        ],
      }),
    );
    expect(loadConflictReplay(d)).toEqual([
      { operationId: 'a', reason: 'r' },
      { operationId: 'b', reason: 'r', changeBody: { name: 'x' } },
    ]);
  });

  it.each([
    ['not an object', '[]'],
    ['no replay array', '{}'],
    ['missing reason', '{"replay":[{"operationId":"a"}]}'],
    ['empty operationId', '{"replay":[{"operationId":"","reason":"r"}]}'],
    ['non-object changeBody', '{"replay":[{"operationId":"a","reason":"r","changeBody":[1]}]}'],
    ['invalid JSON', '{'],
  ])('rejects a malformed file: %s', (_name, content) => {
    expect(() => loadConflictReplay(configDir(content))).toThrow();
  });

  it('marks operations as conflicting and keeps existing metadata', () => {
    const g = graphOf(node('a', { operationMetadata: { kind: 'command' } }), node('b'));
    applyConflictReplay(g, [{ operationId: 'a', reason: 'r', changeBody: { name: 'x' } }]);
    expect(g.operations.a.operationMetadata).toEqual({
      kind: 'command',
      duplicatePolicy: 'conflict',
    });
    expect(g.operations.a.conflictReplay).toEqual({ changeBody: { name: 'x' } });
    expect(g.operations.b.operationMetadata).toBeUndefined();
  });

  it('fails loudly for an operation that is not in the spec', () => {
    const g = graphOf(node('a'));
    expect(() => applyConflictReplay(g, [{ operationId: 'gone', reason: 'r' }])).toThrow(/gone/);
  });

  it('yields a duplicate-conflict feature scenario that expects 409 and carries changeBody', () => {
    const op = node('a');
    const g = graphOf(op);
    applyConflictReplay(g, [{ operationId: 'a', reason: 'r', changeBody: { name: 'x' } }]);
    const scenarios = generateFeatureCoverageForEndpoint(g, 'a').scenarios.filter(
      (s) => s.duplicateTest,
    );
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].duplicateTest).toMatchObject({
      mode: 'conflict',
      secondStatus: 409,
      changeBody: { name: 'x' },
    });
  });
});
