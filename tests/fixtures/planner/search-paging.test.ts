import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildSearchPagingScenarios,
  deriveSearchPaging,
  findSearchOperations,
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
// The loader fills in the optional keys; spread this where a full SearchPagingConfig is needed.
const full = { ...head, auto: false, exclude: [] };

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
    expect(loadSearchPaging(configDir(f))).toEqual({ ...f, auto: false, exclude: [] });
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
    expect(() => validateSearchPaging(graph, { ...full, searches: [entry] })).not.toThrow();
    expect(() =>
      validateSearchPaging(graph, { ...full, searches: [{ ...entry, operationId: 'gone' }] }),
    ).toThrow(/gone/);
  });

  it('builds the limit/sort variant and the offset variant for the target only', () => {
    const chain = chainFor('createX', 'searchA');
    const config = {
      limit: 3,
      offsetFrom: 2,
      auto: false,
      exclude: [],
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
      ...full,
      searches: [{ ...entry, sort: { field: 'name', order: 'DESC' }, checkOrder: false }],
    });
    expect(paging.searchPaging?.checks).toEqual({ limit: 2 });
    expect(offset.searchPaging?.checks).toEqual({ limit: 2, offset: { from: 1 } });
    expect(offset.searchPaging?.body.sort).toEqual([{ field: 'name', order: 'DESC' }]);
  });
});

// A tiny bundled spec: two search operations (with a $ref'd body and sort item), one with a
// timestamp sort field and one without, plus operations that are not searches.
function specWith(ops: Record<string, string[] | null | 'not-search'>): unknown {
  const schemas: Record<string, unknown> = {};
  const paths: Record<string, unknown> = {};
  for (const [id, sortFields] of Object.entries(ops)) {
    if (sortFields === 'not-search') {
      schemas[`${id}Body`] = { type: 'object', properties: { name: { type: 'string' } } };
    } else {
      schemas[`${id}Item`] = {
        type: 'object',
        properties: {
          field: sortFields ? { type: 'string', enum: sortFields } : { type: 'string' },
        },
      };
      schemas[`${id}Body`] = {
        type: 'object',
        properties: {
          page: { type: 'object' },
          sort: { type: 'array', items: { $ref: `#/components/schemas/${id}Item` } },
        },
      };
    }
    paths[`/${id}`] = {
      post: {
        operationId: id,
        requestBody: {
          content: { 'application/json': { schema: { $ref: `#/components/schemas/${id}Body` } } },
        },
      },
    };
  }
  return { paths, components: { schemas } };
}

describe('deriving search paging entries from the spec', () => {
  const spec = specWith({
    searchA: ['name', 'updated', 'created'],
    searchB: ['name', 'email'],
    createThing: 'not-search',
  });
  const base = { ...head, auto: true, exclude: [], searches: [] };

  it('finds the operations whose body takes page and sort, and reads the sort enum through $refs', () => {
    expect(findSearchOperations(spec)).toEqual([
      { operationId: 'searchA', sortFields: ['name', 'updated', 'created'] },
      { operationId: 'searchB', sortFields: ['name', 'email'] },
    ]);
  });

  it('picks created (else updated, else deleted) descending with its order checked, else the first field ascending unchecked', () => {
    const { searches } = deriveSearchPaging(base, spec);
    expect(searches).toEqual([
      { operationId: 'searchA', sort: { field: 'created', order: 'DESC' }, checkOrder: true },
      { operationId: 'searchB', sort: { field: 'name', order: 'ASC' }, checkOrder: false },
    ]);
  });

  it('keeps an explicit entry as it is and derives only the others', () => {
    const own: SearchPagingEntry = { ...entry, operationId: 'searchA', filter: { x: 1 } };
    const { searches } = deriveSearchPaging({ ...base, searches: [own] }, spec);
    expect(searches.map((e) => e.operationId)).toEqual(['searchA', 'searchB']);
    expect(searches[0]).toBe(own);
  });

  it('skips an excluded operation, and fails for an exclusion that is not a search operation', () => {
    const { searches } = deriveSearchPaging(
      { ...base, exclude: [{ operationId: 'searchB', reason: 'r' }] },
      spec,
    );
    expect(searches.map((e) => e.operationId)).toEqual(['searchA']);
    expect(() =>
      deriveSearchPaging({ ...base, exclude: [{ operationId: 'createThing', reason: 'r' }] }, spec),
    ).toThrow(/createThing/);
    expect(() =>
      deriveSearchPaging({ ...base, exclude: [{ operationId: 'gone', reason: 'r' }] }, spec),
    ).toThrow(/gone/);
  });

  it('fails, naming the operation, when a search has no sort enum to choose from', () => {
    expect(() => deriveSearchPaging(base, specWith({ searchC: null }))).toThrow(/searchC/);
  });

  it('does nothing without auto', () => {
    const config = { ...base, auto: false };
    expect(deriveSearchPaging(config, spec)).toBe(config);
  });
});

describe('auto and exclude in search-paging.json', () => {
  it('loads them, and defaults to no auto and no exclusions', () => {
    const f = { ...head, auto: true, exclude: [{ operationId: 'a', reason: 'r' }], searches: [] };
    expect(loadSearchPaging(configDir(f))).toEqual(f);
    expect(loadSearchPaging(configDir({ ...head, searches: [] }))).toMatchObject({
      auto: false,
      exclude: [],
    });
  });

  it.each([
    ['auto not a boolean', { ...head, auto: 'yes', searches: [] }],
    ['exclude not an array', { ...head, exclude: {}, searches: [] }],
    ['exclude without a reason', { ...head, exclude: [{ operationId: 'a' }], searches: [] }],
  ])('rejects: %s', (_label, content) => {
    expect(() => loadSearchPaging(configDir(content))).toThrow();
  });
});
