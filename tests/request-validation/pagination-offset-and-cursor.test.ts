import { describe, expect, it } from 'vitest';
import { generatePaginationCursorInvalid } from '../../request-validation/src/analysis/paginationCursor.js';
import { generatePaginationOffsetPastTotal } from '../../request-validation/src/analysis/paginationOffset.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';

/**
 * #501 — `page.from` past the real result count, and an undecodable
 * `page.after`/`page.before`. Both expected statuses were verified live
 * against a running camunda-oca cluster (not guessed):
 *   - `from` past total            -> 200, empty `items`
 *   - undecodable cursor content   -> 400, ProblemDetail (INVALID_ARGUMENT)
 * See paginationOffset.ts / paginationCursor.ts header comments for the full
 * verification detail, including why an out-of-ES-window 500 and a
 * well-formed-but-past-the-end cursor are deliberately NOT modeled here.
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

// oca-style: all 4 branches, including both cursor directions.
const fourBranchPageSchema: SchemaFragment = {
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

// hub-style: only limit + offset, no cursor pagination at all.
const twoBranchPageSchema: SchemaFragment = {
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

describe('request-validation: pagination-offset-past-total generation (#501)', () => {
  it('emits one 200-expecting scenario with a large `from` for a 4-branch (oca) page', () => {
    const ops = [
      op({
        operationId: 'searchProcessInstances',
        path: '/process-instances/search',
        requestBodySchema: { type: 'object', properties: { page: fourBranchPageSchema } },
      }),
    ];
    const out = generatePaginationOffsetPastTotal(ops, {});
    expect(out).toHaveLength(1);
    const [s] = out;
    expect(s.type).toBe('pagination-offset-past-total');
    expect(s.expectedStatus).toBe(200);
    expect(s.target).toBe('page.from');
    const body = isPlainObject(s.requestBody) ? s.requestBody : {};
    const page = isPlainObject(body.page) ? body.page : {};
    const { from } = page;
    expect(typeof from).toBe('number');
    expect(from).toBeGreaterThan(1000);
  });

  it('also fires for a 2-branch (hub) page — offset pagination has no cursor branches', () => {
    const ops = [
      op({
        operationId: 'searchFiles',
        path: '/files/search',
        requestBodySchema: { type: 'object', properties: { page: twoBranchPageSchema } },
      }),
    ];
    expect(generatePaginationOffsetPastTotal(ops, {})).toHaveLength(1);
  });

  it('emits nothing for an operation with no offset branch (e.g. limit-only pagination)', () => {
    const limitOnlyPage: SchemaFragment = {
      allOf: [
        { oneOf: [{ type: 'object', properties: { limit: { type: 'integer', minimum: 1 } } }] },
      ],
    };
    const ops = [
      op({
        operationId: 'searchSomething',
        path: '/something/search',
        requestBodySchema: { type: 'object', properties: { page: limitOnlyPage } },
      }),
    ];
    expect(generatePaginationOffsetPastTotal(ops, {})).toHaveLength(0);
  });

  it('respects onlyOperations', () => {
    const ops = [
      op({
        operationId: 'searchFiles',
        path: '/files/search',
        requestBodySchema: { type: 'object', properties: { page: twoBranchPageSchema } },
      }),
      op({
        operationId: 'searchProjects',
        path: '/projects/search',
        requestBodySchema: { type: 'object', properties: { page: twoBranchPageSchema } },
      }),
    ];
    const out = generatePaginationOffsetPastTotal(ops, {
      onlyOperations: new Set(['searchProjects']),
    });
    expect(out).toHaveLength(1);
    expect(out[0].operationId).toBe('searchProjects');
  });
});

describe('request-validation: pagination-cursor-invalid generation (#501)', () => {
  it('emits one 400-expecting scenario per cursor field (after AND before) for a 4-branch (oca) page', () => {
    const ops = [
      op({
        operationId: 'searchProcessInstances',
        path: '/process-instances/search',
        requestBodySchema: { type: 'object', properties: { page: fourBranchPageSchema } },
      }),
    ];
    const out = generatePaginationCursorInvalid(ops, {});
    expect(out).toHaveLength(2);
    const targets = out.map((s) => s.target).sort();
    expect(targets).toEqual(['page.after', 'page.before']);
    for (const s of out) {
      expect(s.type).toBe('pagination-cursor-invalid');
      expect(s.expectedStatus).toBe(400);
    }
  });

  it('emits nothing for a 2-branch (hub) page — no cursor pagination at all', () => {
    const ops = [
      op({
        operationId: 'searchFiles',
        path: '/files/search',
        requestBodySchema: { type: 'object', properties: { page: twoBranchPageSchema } },
      }),
    ];
    expect(generatePaginationCursorInvalid(ops, {})).toHaveLength(0);
  });

  it('respects onlyOperations', () => {
    const ops = [
      op({
        operationId: 'searchProcessInstances',
        path: '/process-instances/search',
        requestBodySchema: { type: 'object', properties: { page: fourBranchPageSchema } },
      }),
      op({
        operationId: 'searchDecisionInstances',
        path: '/decision-instances/search',
        requestBodySchema: { type: 'object', properties: { page: fourBranchPageSchema } },
      }),
    ];
    const out = generatePaginationCursorInvalid(ops, {
      onlyOperations: new Set(['searchDecisionInstances']),
    });
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.operationId === 'searchDecisionInstances')).toBe(true);
  });
});
