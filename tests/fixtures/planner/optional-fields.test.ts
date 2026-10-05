import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildOptionalFieldsScenarios,
  loadOptionalFields,
  type OptionalFieldsEntry,
  validateOptionalFields,
} from '../../../path-analyser/src/optionalFields.ts';
import type { EndpointScenario, OperationGraph } from '../../../path-analyser/src/types.ts';

const dirs: string[] = [];
function configDir(content?: unknown): string {
  const d = mkdtempSync(join(tmpdir(), 'optional-fields-'));
  dirs.push(d);
  if (content !== undefined)
    writeFileSync(join(d, 'optional-fields.json'), JSON.stringify(content));
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const v: OptionalFieldsEntry = {
  operationId: 'createX',
  name: 'description',
  body: { description: 'd' },
  echo: { description: 'd' },
  before: [],
};

describe('optional-fields.json', () => {
  it('is optional, and loads valid variants', () => {
    expect(loadOptionalFields(configDir())).toBeNull();
    const { before: _omitted, ...written } = v;
    expect(loadOptionalFields(configDir({ variants: [written] }))).toEqual({ variants: [v] });
  });

  it.each([
    ['no variants array', {}],
    ['missing name', { variants: [{ ...v, name: '' }] }],
    ['name with an apostrophe', { variants: [{ ...v, name: "owner's description" }] }],
    ['name with a backslash', { variants: [{ ...v, name: 'a\\b' }] }],
    ['empty body', { variants: [{ ...v, body: {} }] }],
    ['empty echo', { variants: [{ ...v, echo: {} }] }],
    ['body not an object', { variants: [{ ...v, body: [1] }] }],
    ['repeated variant', { variants: [v, v] }],
    ['before not an array', { variants: [{ ...v, before: {} }] }],
    ['before entry without an operation', { variants: [{ ...v, before: [{ body: {} }] }] }],
    [
      'before body not an object',
      { variants: [{ ...v, before: [{ operationId: 'a', body: [] }] }] },
    ],
    [
      'extractAs not a map',
      { variants: [{ ...v, before: [{ operationId: 'a', extractAs: 'x' }] }] },
    ],
    [
      'extractAs with an unsafe variable',
      { variants: [{ ...v, before: [{ operationId: 'a', extractAs: { f: "x'y" } }] }] },
    ],
  ])('rejects: %s', (_label, content) => {
    expect(() => loadOptionalFields(configDir(content))).toThrow();
  });

  it('fails for an operation the spec does not have', () => {
    // biome-ignore lint/plugin: the fixture only populates the field under test
    const graph = { operations: { createX: {} } } as unknown as OperationGraph;
    expect(() => validateOptionalFields(graph, { variants: [v] })).not.toThrow();
    expect(() =>
      validateOptionalFields(graph, { variants: [{ ...v, operationId: 'gone' }] }),
    ).toThrow(/gone/);
  });

  it('builds one variant for the target operation only', () => {
    const chain: EndpointScenario = {
      id: 'scenario-1',
      operations: [
        { operationId: 'setup', method: 'POST', path: '/s' },
        { operationId: 'createX', method: 'POST', path: '/x' },
      ],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      bindings: { aVar: 'a' },
    };
    // biome-ignore lint/plugin: the fixture only populates the field under test
    const graph = { operations: {} } as unknown as OperationGraph;
    const out = buildOptionalFieldsScenarios(
      chain,
      { variants: [v, { ...v, operationId: 'other' }] },
      graph,
    );
    expect(out).toHaveLength(1);
    expect(out[0].optionalFields).toEqual({ body: v.body, echo: v.echo, targetIndex: 1 });
    expect(out[0].operations.map((o) => o.operationId)).toEqual(['setup', 'createX']);
    expect(out[0].bindings).not.toBe(chain.bindings);
  });

  it('loads setup calls with a body override and a renamed extract', () => {
    const f = {
      variants: [
        {
          ...v,
          before: [
            { operationId: 'a', body: { k: 1 }, extractAs: { folderKey: 'otherVar' } },
            { operationId: 'b' },
          ],
        },
      ],
    };
    expect(loadOptionalFields(configDir(f))?.variants[0].before).toEqual([
      { operationId: 'a', body: { k: 1 }, extractAs: { folderKey: 'otherVar' } },
      { operationId: 'b' },
    ]);
  });

  it('rejects a setup call to the target operation itself', () => {
    // biome-ignore lint/plugin: the fixture only populates the field under test
    const graph = { operations: { createX: {} } } as unknown as OperationGraph;
    expect(() =>
      validateOptionalFields(graph, { variants: [{ ...v, before: [{ operationId: 'createX' }] }] }),
    ).toThrow(/target operation itself/);
  });

  it('validates setup operations against the spec too', () => {
    // biome-ignore lint/plugin: the fixture only populates the field under test
    const graph = { operations: { createX: {}, a: {} } } as unknown as OperationGraph;
    const ok = { ...v, before: [{ operationId: 'a' }] };
    expect(() => validateOptionalFields(graph, { variants: [ok] })).not.toThrow();
    expect(() =>
      validateOptionalFields(graph, { variants: [{ ...v, before: [{ operationId: 'nope' }] }] }),
    ).toThrow(/nope/);
  });

  it('puts setup calls before the target and keys their overrides by chain position', () => {
    const ref = (id: string) => ({ operationId: id, method: 'POST', path: `/${id}` });
    // biome-ignore lint/plugin: the fixture only populates the fields under test
    const graph = {
      operations: { createX: ref('createX'), a: ref('a'), b: ref('b') },
    } as unknown as OperationGraph;
    const chain: EndpointScenario = {
      id: 's',
      operations: [ref('setup'), ref('createX')],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
    };
    const [out] = buildOptionalFieldsScenarios(
      chain,
      {
        variants: [
          {
            ...v,
            before: [
              { operationId: 'a', body: { k: 1 } },
              { operationId: 'b', extractAs: { id: 'otherVar' } },
            ],
          },
        ],
      },
      graph,
    );
    expect(out.operations.map((o) => o.operationId)).toEqual(['setup', 'a', 'b', 'createX']);
    expect(out.stepBodies).toEqual({ 1: { k: 1 } });
    expect(out.stepExtractAs).toEqual({ 2: { id: 'otherVar' } });
  });

  it.each([
    ['readBack not an object', { variants: [{ ...v, readBack: 'x' }] }],
    ['readBack without an operation', { variants: [{ ...v, readBack: { echo: { a: 1 } } }] }],
    [
      'readBack with an empty echo',
      { variants: [{ ...v, readBack: { operationId: 'g', echo: {} } }] },
    ],
  ])('rejects: %s', (_label, content) => {
    expect(() => loadOptionalFields(configDir(content))).toThrow();
  });

  it('rejects a read-back that repeats the target or a setup call', () => {
    // biome-ignore lint/plugin: the fixture only populates the field under test
    const graph = { operations: { createX: {}, a: {}, g: {} } } as unknown as OperationGraph;
    const echo = { d: 1 };
    expect(() =>
      validateOptionalFields(graph, {
        variants: [{ ...v, readBack: { operationId: 'createX', echo } }],
      }),
    ).toThrow(/read-back must differ/);
    expect(() =>
      validateOptionalFields(graph, {
        variants: [{ ...v, before: [{ operationId: 'a' }], readBack: { operationId: 'a', echo } }],
      }),
    ).toThrow(/read-back must differ/);
    expect(() =>
      validateOptionalFields(graph, { variants: [{ ...v, readBack: { operationId: 'g', echo } }] }),
    ).not.toThrow();
    expect(() =>
      validateOptionalFields(graph, {
        variants: [{ ...v, readBack: { operationId: 'nope', echo } }],
      }),
    ).toThrow(/nope/);
  });

  it('appends the read-back after the target and marks the target by position', () => {
    const ref = (id: string) => ({ operationId: id, method: 'GET', path: `/${id}` });
    // biome-ignore lint/plugin: the fixture only populates the fields under test
    const graph = {
      operations: { createX: ref('createX'), a: ref('a'), g: ref('g') },
    } as unknown as OperationGraph;
    const chain: EndpointScenario = {
      id: 's',
      operations: [ref('setup'), ref('createX')],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
    };
    const [out] = buildOptionalFieldsScenarios(
      chain,
      {
        variants: [
          { ...v, before: [{ operationId: 'a' }], readBack: { operationId: 'g', echo: { d: 2 } } },
        ],
      },
      graph,
    );
    expect(out.operations.map((o) => o.operationId)).toEqual(['setup', 'a', 'createX', 'g']);
    expect(out.optionalFields).toMatchObject({ targetIndex: 2, readBackEcho: { d: 2 } });
    const [plain] = buildOptionalFieldsScenarios(chain, { variants: [v] }, graph);
    expect(plain.optionalFields?.targetIndex).toBe(1);
    expect(plain.optionalFields?.readBackEcho).toBeUndefined();
  });
});
