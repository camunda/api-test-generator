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
const head = { limit: 2, offsetFrom: 1 };

function chainFor(...ids: string[]): EndpointScenario {
  return {
    id: 'scenario-1',
    operations: ids.map((operationId) => ({
      operationId,
      method: 'POST',
      path: `/${operationId}`,
    })),
    producedSemanticTypes: [],
    satisfiedSemanticTypes: [],
    bindings: { aVar: 'a' },
  };
}

describe('search-paging.json', () => {
  it('is optional', () => {
    expect(loadSearchPaging(configDir())).toBeNull();
  });

  it('loads a valid file', () => {
    const f = {
      ...head,
      searches: [entry, { ...entry, operationId: 'searchB', filter: { x: 1 } }],
    };
    expect(loadSearchPaging(configDir(f))).toEqual(f);
  });

  it.each([
    ['no searches array', head],
    ['limit missing', { offsetFrom: 1, searches: [] }],
    ['limit not positive', { limit: 0, offsetFrom: 1, searches: [] }],
    ['offsetFrom missing', { limit: 2, searches: [] }],
    ['offsetFrom not positive', { limit: 2, offsetFrom: 0, searches: [] }],
    ['missing sort field', { ...head, searches: [{ ...entry, sort: { order: 'ASC' } }] }],
    ['bad sort order', { ...head, searches: [{ ...entry, sort: { field: 'a', order: 'UP' } }] }],
    ['checkOrder not boolean', { ...head, searches: [{ ...entry, checkOrder: 'yes' }] }],
    ['filter not an object', { ...head, searches: [{ ...entry, filter: [] }] }],
    ['repeated operation', { ...head, searches: [entry, entry] }],
  ])('rejects: %s', (_label, content) => {
    expect(() => loadSearchPaging(configDir(content))).toThrow();
  });

  it('fails for an operation the spec does not have', () => {
    // biome-ignore lint/plugin: the fixture only populates the field under test
    const graph = { operations: { searchA: {} } } as unknown as OperationGraph;
    expect(() => validateSearchPaging(graph, { ...head, searches: [entry] })).not.toThrow();
    expect(() =>
      validateSearchPaging(graph, { ...head, searches: [{ ...entry, operationId: 'gone' }] }),
    ).toThrow(/gone/);
  });

  it('builds the limit/sort variant and the offset variant for the target only', () => {
    const chain = chainFor('createX', 'searchA');
    const config = {
      limit: 3,
      offsetFrom: 2,
      searches: [
        { ...entry, filter: { name: { $exists: true } } },
        { ...entry, operationId: 'other' },
      ],
    };
    const [paging, offset, ...rest] = buildSearchPagingScenarios(chain, config);
    expect(rest).toEqual([]);
    expect(paging.searchPaging).toEqual({
      body: {
        page: { limit: 3 },
        sort: [{ field: 'created', order: 'DESC' }],
        filter: { name: { $exists: true } },
      },
      checks: { limit: 3, order: { field: 'created', direction: 'DESC' } },
    });
    // Ascending: an item created between the two compared queries lands after the slice.
    expect(offset.searchPaging).toEqual({
      body: {
        page: { from: 2, limit: 3 },
        sort: [{ field: 'created', order: 'ASC' }],
        filter: { name: { $exists: true } },
      },
      checks: { limit: 3, order: { field: 'created', direction: 'ASC' }, offset: { from: 2 } },
    });
    expect(paging.id).not.toBe(offset.id);
    expect(paging.operations.map((o) => o.operationId)).toEqual(['createX', 'searchA']);
    expect(paging.bindings).not.toBe(chain.bindings);
  });

  it('asserts no order, and keeps the configured sort, when the field is not comparable', () => {
    const [paging, offset] = buildSearchPagingScenarios(chainFor('searchA'), {
      ...head,
      searches: [{ ...entry, sort: { field: 'name', order: 'DESC' }, checkOrder: false }],
    });
    expect(paging.searchPaging?.checks).toEqual({ limit: 2 });
    expect(offset.searchPaging?.checks).toEqual({ limit: 2, offset: { from: 1 } });
    expect(offset.searchPaging?.body.sort).toEqual([{ field: 'name', order: 'DESC' }]);
  });
});
