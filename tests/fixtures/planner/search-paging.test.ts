import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildSearchPagingScenarios,
  loadSearchPaging,
  type SearchPagingEntry,
  validateSearchPaging,
} from '../../../path-analyser/src/searchPaging.ts';
import type { EndpointScenario, OperationGraph } from '../../../path-analyser/src/types.ts';

const dirs: string[] = [];
function configDir(content?: unknown): string {
  const d = mkdtempSync(join(tmpdir(), 'search-paging-'));
  dirs.push(d);
  if (content !== undefined) writeFileSync(join(d, 'search-paging.json'), JSON.stringify(content));
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const entry: SearchPagingEntry = {
  operationId: 'searchA',
  sort: { field: 'created', order: 'DESC' },
  checkOrder: true,
};

describe('search-paging.json', () => {
  it('is optional', () => {
    expect(loadSearchPaging(configDir())).toBeNull();
  });

  it('loads a valid file', () => {
    const f = {
      limit: 2,
      searches: [entry, { ...entry, operationId: 'searchB', filter: { x: 1 } }],
    };
    expect(loadSearchPaging(configDir(f))).toEqual(f);
  });

  it.each([
    ['no searches array', { limit: 2 }],
    ['limit missing', { searches: [] }],
    ['limit not positive', { limit: 0, searches: [] }],
    ['missing sort field', { limit: 2, searches: [{ ...entry, sort: { order: 'ASC' } }] }],
    ['bad sort order', { limit: 2, searches: [{ ...entry, sort: { field: 'a', order: 'UP' } }] }],
    ['checkOrder not boolean', { limit: 2, searches: [{ ...entry, checkOrder: 'yes' }] }],
    ['filter not an object', { limit: 2, searches: [{ ...entry, filter: [] }] }],
    ['repeated operation', { limit: 2, searches: [entry, entry] }],
  ])('rejects: %s', (_label, content) => {
    expect(() => loadSearchPaging(configDir(content))).toThrow();
  });

  it('fails for an operation the spec does not have', () => {
    // biome-ignore lint/plugin: the fixture only populates the field under test
    const graph = { operations: { searchA: {} } } as unknown as OperationGraph;
    const config = { limit: 2, searches: [entry] };
    expect(() => validateSearchPaging(graph, config)).not.toThrow();
    expect(() =>
      validateSearchPaging(graph, {
        limit: 2,
        searches: [{ ...entry, operationId: 'gone' }],
      }),
    ).toThrow(/gone/);
  });

  it('builds one variant for the target with page, sort, filter and checks', () => {
    const ref = (id: string) => ({ operationId: id, method: 'POST', path: `/${id}` });
    const chain: EndpointScenario = {
      id: 'scenario-1',
      operations: [ref('createX'), ref('searchA')],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      bindings: { aVar: 'a' },
    };
    const config = loadSearchPaging(
      configDir({
        limit: 3,
        searches: [
          { ...entry, filter: { name: { $exists: true } } },
          { ...entry, operationId: 'other' },
        ],
      }),
    );
    expect(config).not.toBeNull();
    if (!config) return;
    const [v, ...rest] = buildSearchPagingScenarios(chain, config);
    expect(rest).toEqual([]);
    expect(v.searchPaging).toEqual({
      body: {
        page: { limit: 3 },
        sort: [{ field: 'created', order: 'DESC' }],
        filter: { name: { $exists: true } },
      },
      checks: { limit: 3, order: { field: 'created', direction: 'DESC' } },
    });
    expect(v.operations.map((o) => o.operationId)).toEqual(['createX', 'searchA']);
    expect(v.bindings).not.toBe(chain.bindings);
  });

  it('asserts no order when the sort field is not comparable', () => {
    const chain: EndpointScenario = {
      id: 's',
      operations: [{ operationId: 'searchA', method: 'POST', path: '/a' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
    };
    const [v] = buildSearchPagingScenarios(chain, {
      limit: 2,
      searches: [{ ...entry, checkOrder: false }],
    });
    expect(v.searchPaging?.checks).toEqual({ limit: 2 });
  });
});
