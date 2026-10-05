import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildOptionalFieldsScenarios,
  loadOptionalFields,
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

const v = {
  operationId: 'createX',
  name: 'description',
  body: { description: 'd' },
  echo: { description: 'd' },
};

describe('optional-fields.json', () => {
  it('is optional, and loads valid variants', () => {
    expect(loadOptionalFields(configDir())).toBeNull();
    expect(loadOptionalFields(configDir({ variants: [v] }))).toEqual({ variants: [v] });
  });

  it.each([
    ['no variants array', {}],
    ['missing name', { variants: [{ ...v, name: '' }] }],
    ['empty body', { variants: [{ ...v, body: {} }] }],
    ['empty echo', { variants: [{ ...v, echo: {} }] }],
    ['body not an object', { variants: [{ ...v, body: [1] }] }],
    ['repeated variant', { variants: [v, v] }],
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
    const out = buildOptionalFieldsScenarios(chain, {
      variants: [v, { ...v, operationId: 'other' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].optionalFields).toEqual({ body: v.body, echo: v.echo });
    expect(out[0].operations.map((o) => o.operationId)).toEqual(['setup', 'createX']);
    expect(out[0].bindings).not.toBe(chain.bindings);
  });
});
