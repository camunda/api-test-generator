import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyConflictReplay,
  applyStepBody,
  buildConflictSequenceScenarios,
  type ConflictSequenceEntry,
  loadConflictReplay,
  loadConflictSequences,
  validateConflictSequences,
} from '../../../path-analyser/src/conflictReplay.ts';
import { generateFeatureCoverageForEndpoint } from '../../../path-analyser/src/featureCoverageGenerator.ts';
import type {
  EndpointScenario,
  OperationGraph,
  OperationNode,
} from '../../../path-analyser/src/types.ts';

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

  it('treats a missing replay array as empty, so a sequences-only file works', () => {
    const d = configDir(JSON.stringify({ sequences: [] }));
    expect(loadConflictReplay(d)).toEqual([]);
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
    ['replay not an array', '{"replay":{}}'],
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

describe('conflict-replay.json sequences', () => {
  const raw = { name: 'gone', operationId: 'restore', before: ['delete'], reason: 'r' };
  const seq: ConflictSequenceEntry = { ...raw, bodies: {}, expectStatus: 409 };

  it('is optional, and loads valid entries', () => {
    expect(loadConflictSequences(configDir())).toEqual([]);
    expect(loadConflictSequences(configDir(JSON.stringify({ replay: [] })))).toEqual([]);
    expect(loadConflictSequences(configDir(JSON.stringify({ sequences: [raw] })))).toEqual([seq]);
  });

  it.each([
    ['not an array', { sequences: {} }],
    ['no setup operations', { sequences: [{ ...raw, before: [] }] }],
    ['empty operation name', { sequences: [{ ...raw, before: [''] }] }],
    ['setup entry without an operation', { sequences: [{ ...raw, before: [{ body: {} }] }] }],
    [
      'setup body not an object',
      { sequences: [{ ...raw, before: [{ operationId: 'a', body: [] }] }] },
    ],
    ['setup body a string', { sequences: [{ ...raw, before: [{ operationId: 'a', body: 'x' }] }] }],
    ['unsupported status', { sequences: [{ ...raw, expectStatus: 500 }] }],
    ['missing name', { sequences: [{ ...raw, name: undefined }] }],
    ['name with an apostrophe', { sequences: [{ ...raw, name: "it's gone" }] }],
    ['missing reason', { sequences: [{ ...raw, reason: '' }] }],
    ['repeated name for one operation', { sequences: [raw, raw] }],
  ])('rejects: %s', (_label, content) => {
    expect(() => loadConflictSequences(configDir(JSON.stringify(content)))).toThrow();
  });

  it('loads a setup body override and an expected 400', () => {
    const [e] = loadConflictSequences(
      configDir(
        JSON.stringify({
          sequences: [
            {
              ...raw,
              expectStatus: 400,
              before: ['a', { operationId: 'b', body: { k: 'a value' } }],
            },
          ],
        }),
      ),
    );
    expect(e.before).toEqual(['a', 'b']);
    expect(e.bodies).toEqual({ 1: { k: 'a value' } });
    expect(e.expectStatus).toBe(400);
  });

  it('expects the configured status and keys body overrides by position in the chain', () => {
    const g = graphOf(node('createX'), node('a'), node('b'), node('restore'));
    const ref = (id: string) => ({ operationId: id, method: 'POST', path: `/${id}` });
    const chain: EndpointScenario = {
      id: 's',
      operations: [ref('createX'), ref('restore')],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
    };
    const [out] = buildConflictSequenceScenarios(
      chain,
      [{ ...seq, before: ['a', 'b'], bodies: { 1: { k: 'v' } }, expectStatus: 400 }],
      g,
    );
    expect(out.expectedResult).toEqual({ kind: 'error', code: '400' });
    // operations: createX(0), a(1), b(2), restore(3); the override targets b
    expect(out.stepBodies).toEqual({ 2: { k: 'v' } });
    expect(out.name).toContain('400 precondition');
  });

  it('merges a step override over that step only, leaving other steps and non-object bodies alone', () => {
    const overrides = { 2: { folderKey: 'a placeholder' } };
    expect(applyStepBody({ name: 'n', folderKey: null }, overrides, 2)).toEqual({
      name: 'n',
      folderKey: 'a placeholder',
    });
    expect(applyStepBody({ name: 'n' }, overrides, 1)).toEqual({ name: 'n' });
    expect(applyStepBody({ name: 'n' }, undefined, 2)).toEqual({ name: 'n' });
    expect(applyStepBody(undefined, overrides, 2)).toBeUndefined();
  });

  it('fails for an operation the spec does not have, whether target or setup', () => {
    const g = graphOf(node('restore'), node('delete'));
    expect(() => validateConflictSequences(g, [seq])).not.toThrow();
    expect(() => validateConflictSequences(g, [{ ...seq, before: ['nope'] }])).toThrow(/nope/);
    expect(() => validateConflictSequences(g, [{ ...seq, operationId: 'nope2' }])).toThrow(/nope2/);
  });

  it('puts the setup operations before the target, which must answer 409', () => {
    const g = graphOf(
      node('createX'),
      node('delete', { eventuallyConsistent: true, serverOverride: 'http://other' }),
      node('restore'),
    );
    const ref = (id: string) => ({ operationId: id, method: 'POST', path: `/${id}` });
    const chain: EndpointScenario = {
      id: 'scenario-1',
      operations: [ref('createX'), ref('restore')],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      bindings: { aVar: 'a' },
    };
    const out = buildConflictSequenceScenarios(chain, [seq, { ...seq, operationId: 'other' }], g);
    expect(out).toHaveLength(1);
    expect(out[0].operations.map((o) => o.operationId)).toEqual(['createX', 'delete', 'restore']);
    expect(out[0].operations[1]).toMatchObject({
      eventuallyConsistent: true,
      serverOverride: 'http://other',
    });
    expect(out[0].expectedResult).toEqual({ kind: 'error', code: '409' });
    expect(out[0].bindings).toEqual({ aVar: 'a' });
    expect(out[0].bindings).not.toBe(chain.bindings);
    expect(chain.operations).toHaveLength(2);
  });
});
