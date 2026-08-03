import { describe, expect, it } from 'vitest';
import {
  findPaginationLimitField,
  generatePaginationLimitInvalid,
} from '../../request-validation/src/analysis/paginationLimit.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';

/**
 * #501 — `page.limit` bounds. `page` is `{ allOf: [<oneOf of pagination
 * modes>] }`, two hops below the request body root, so it's invisible to
 * the generic oneof-* kinds (root-oneOf only) and to the walker-based
 * constraint-violation kind (mergeAllOf bails on an allOf branch that has
 * `oneOf` and no `type`) even though `limit` carries a real
 * minimum/maximum. Matched by shape (a branch whose only property is
 * `limit`), not by schema title, since the wrapper is named
 * `SearchQueryPageRequest` in camunda-oca but `SearchQueryPage` in
 * camunda-hub.
 */

function op(
  over: Partial<OperationModel> & Pick<OperationModel, 'operationId' | 'path'>,
): OperationModel {
  return {
    method: 'POST',
    tags: [],
    parameters: [],
    ...over,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function pageLimit(body: unknown): number | undefined {
  if (!isPlainObject(body) || !isPlainObject(body.page)) return undefined;
  const { limit } = body.page;
  return typeof limit === 'number' ? limit : undefined;
}

// camunda-hub shape: page's oneOf has only 2 branches (no cursor pagination).
const hubPageSchema: SchemaFragment = {
  allOf: [
    {
      oneOf: [
        { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10000 } } },
        {
          type: 'object',
          properties: {
            from: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1 },
          },
        },
      ],
    },
  ],
};

// camunda-oca shape: page's oneOf has all 4 branches, including cursor pagination.
const ocaPageSchema: SchemaFragment = {
  allOf: [
    {
      oneOf: [
        { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10000 } } },
        {
          type: 'object',
          properties: {
            from: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1 },
          },
        },
        {
          type: 'object',
          properties: {
            after: { type: 'string', format: 'base64' },
            limit: { type: 'integer', minimum: 1, maximum: 10000 },
          },
        },
        {
          type: 'object',
          properties: {
            before: { type: 'string', format: 'base64' },
            limit: { type: 'integer', minimum: 1, maximum: 10000 },
          },
        },
      ],
    },
  ],
};

describe('request-validation: pagination limit field detection (#501)', () => {
  it('finds the {limit}-only branch in a 2-branch (hub) page oneOf', () => {
    const o = op({
      operationId: 'searchFiles',
      path: '/files/search',
      requestBodySchema: { type: 'object', properties: { page: hubPageSchema } },
    });
    expect(findPaginationLimitField(o)).toEqual({ pageProp: 'page', minimum: 1, maximum: 10000 });
  });

  it('finds the {limit}-only branch in a 4-branch (oca) page oneOf, ignoring from/after/before branches', () => {
    const o = op({
      operationId: 'searchProcessInstances',
      path: '/process-instances/search',
      requestBodySchema: { type: 'object', properties: { page: ocaPageSchema } },
    });
    expect(findPaginationLimitField(o)).toEqual({ pageProp: 'page', minimum: 1, maximum: 10000 });
  });

  it("finds `page` when it sits inside the ROOT schema's own allOf branch (real-spec shape)", () => {
    // Every concrete search body in the real bundled spec is
    // `{ allOf: [{ properties: { page, sort } }, { properties: { filter } }] }`
    // — `page` is never a direct `root.properties` key. A detector that only
    // checked `root.properties` directly would silently find nothing here.
    const o = op({
      operationId: 'searchProcessInstances',
      path: '/process-instances/search',
      requestBodySchema: {
        type: 'object',
        allOf: [
          { type: 'object', properties: { page: hubPageSchema, sort: { type: 'array' } } },
          { type: 'object', properties: { filter: { type: 'object' } } },
        ],
      },
    });
    expect(findPaginationLimitField(o)).toEqual({ pageProp: 'page', minimum: 1, maximum: 10000 });
  });

  it('returns undefined when there is no page property', () => {
    const o = op({
      operationId: 'createThing',
      path: '/things',
      requestBodySchema: { type: 'object', properties: { name: { type: 'string' } } },
    });
    expect(findPaginationLimitField(o)).toBeUndefined();
  });

  it('returns undefined when page has no oneOf wrapper', () => {
    const o = op({
      operationId: 'weirdSearch',
      path: '/weird/search',
      requestBodySchema: {
        type: 'object',
        properties: { page: { type: 'object', properties: { limit: { type: 'integer' } } } },
      },
    });
    expect(findPaginationLimitField(o)).toBeUndefined();
  });

  it('returns undefined when no oneOf branch is a {limit}-only shape', () => {
    const o = op({
      operationId: 'notPagination',
      path: '/not-pagination',
      requestBodySchema: {
        type: 'object',
        properties: {
          page: {
            allOf: [
              {
                oneOf: [
                  { type: 'object', properties: { a: { type: 'string' } } },
                  { type: 'object', properties: { b: { type: 'string' } } },
                ],
              },
            ],
          },
        },
      },
    });
    expect(findPaginationLimitField(o)).toBeUndefined();
  });

  it('returns undefined for a {limit}-only branch with no minimum/maximum declared', () => {
    const o = op({
      operationId: 'unconstrainedLimit',
      path: '/unconstrained/search',
      requestBodySchema: {
        type: 'object',
        properties: {
          page: {
            allOf: [{ oneOf: [{ type: 'object', properties: { limit: { type: 'integer' } } }] }],
          },
        },
      },
    });
    expect(findPaginationLimitField(o)).toBeUndefined();
  });
});

describe('request-validation: pagination-limit-invalid generation (#501)', () => {
  it('emits below/way-below-minimum and above/way-above-maximum scenarios for a hub-style page', () => {
    const ops = [
      op({
        operationId: 'searchFiles',
        path: '/files/search',
        requestBodySchema: { type: 'object', properties: { page: hubPageSchema } },
      }),
    ];
    const out = generatePaginationLimitInvalid(ops, {});
    expect(out).toHaveLength(4);
    for (const s of out) {
      expect(s.type).toBe('pagination-limit-invalid');
      expect(s.expectedStatus).toBe(400);
      expect(s.target).toBe('page.limit');
      expect(s.operationId).toBe('searchFiles');
      // The mutated body carries ONLY `page.limit` — no leftover baseline
      // pagination fields from a different branch.
      expect(isPlainObject(s.requestBody) && Object.keys(s.requestBody)).toEqual(['page']);
      const { page } = isPlainObject(s.requestBody) ? s.requestBody : { page: undefined };
      expect(isPlainObject(page) && Object.keys(page)).toEqual(['limit']);
    }
    const values = out.map((s) => pageLimit(s.requestBody)).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(values).toEqual([-99, 0, 10001, 10100]);
  });

  it('emits the same 4 scenarios for an oca-style page (cursor branches ignored)', () => {
    const ops = [
      op({
        operationId: 'searchProcessInstances',
        path: '/process-instances/search',
        requestBodySchema: { type: 'object', properties: { page: ocaPageSchema } },
      }),
    ];
    const out = generatePaginationLimitInvalid(ops, {});
    expect(out).toHaveLength(4);
    const values = out.map((s) => pageLimit(s.requestBody)).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(values).toEqual([-99, 0, 10001, 10100]);
  });

  it('emits nothing for an operation with no pagination page field', () => {
    const ops = [
      op({
        operationId: 'createThing',
        path: '/things',
        requestBodySchema: { type: 'object', properties: { name: { type: 'string' } } },
      }),
    ];
    expect(generatePaginationLimitInvalid(ops, {})).toHaveLength(0);
  });

  it('respects onlyOperations', () => {
    const ops = [
      op({
        operationId: 'searchFiles',
        path: '/files/search',
        requestBodySchema: { type: 'object', properties: { page: hubPageSchema } },
      }),
      op({
        operationId: 'searchProjects',
        path: '/projects/search',
        requestBodySchema: { type: 'object', properties: { page: hubPageSchema } },
      }),
    ];
    const out = generatePaginationLimitInvalid(ops, {
      onlyOperations: new Set(['searchProjects']),
    });
    expect(out).toHaveLength(4);
    expect(out.every((s) => s.operationId === 'searchProjects')).toBe(true);
  });

  it('respects capPerOperation', () => {
    const ops = [
      op({
        operationId: 'searchFiles',
        path: '/files/search',
        requestBodySchema: { type: 'object', properties: { page: hubPageSchema } },
      }),
    ];
    const out = generatePaginationLimitInvalid(ops, { capPerOperation: 2 });
    expect(out).toHaveLength(2);
  });
});
