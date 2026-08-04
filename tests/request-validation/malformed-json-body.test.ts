import { describe, expect, it } from 'vitest';
import { generateMalformedJsonBody } from '../../request-validation/src/analysis/malformedJsonBody.js';
import type { OperationModel } from '../../request-validation/src/model/types.js';

/**
 * #499 — one raw, deliberately-unparseable JSON body per operation with a
 * JSON request body. Verified live against a running camunda-oca cluster
 * (4 distinct operations): uniformly 400 with a COMPLETE ProblemDetail — see
 * malformedJsonBody.ts's header comment for the full verification detail.
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

describe('request-validation: malformed-json-body generation (#499)', () => {
  it('emits one scenario for an operation with a JSON request body', () => {
    const ops = [
      op({
        operationId: 'createUser',
        path: '/users',
        requestBodySchema: { type: 'object', properties: { name: { type: 'string' } } },
      }),
    ];
    const out = generateMalformedJsonBody(ops, {});
    expect(out).toHaveLength(1);
    const [s] = out;
    expect(s.type).toBe('malformed-json-body');
    expect(s.expectedStatus).toBe(400);
    expect(s.operationId).toBe('createUser');
    const { requestBody } = s;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string') return;
    // Guaranteed-invalid under any JSON parser, strict or lenient.
    expect(() => JSON.parse(requestBody)).toThrow();
  });

  it('emits nothing for an operation with no JSON request body (e.g. a bare GET)', () => {
    const ops = [op({ operationId: 'getUser', path: '/users/{userKey}', method: 'GET' })];
    expect(generateMalformedJsonBody(ops, {})).toHaveLength(0);
  });

  it('fills path params with the standard filler value', () => {
    const ops = [
      op({
        operationId: 'searchUserTasks',
        path: '/user-tasks/{userTaskKey}/search',
        requestBodySchema: { type: 'object', properties: { filter: { type: 'object' } } },
      }),
    ];
    const [s] = generateMalformedJsonBody(ops, {});
    expect(s.params).toEqual({ userTaskKey: '1' });
  });

  it('respects onlyOperations', () => {
    const ops = [
      op({
        operationId: 'createUser',
        path: '/users',
        requestBodySchema: { type: 'object' },
      }),
      op({
        operationId: 'createGroup',
        path: '/groups',
        requestBodySchema: { type: 'object' },
      }),
    ];
    const out = generateMalformedJsonBody(ops, { onlyOperations: new Set(['createGroup']) });
    expect(out).toHaveLength(1);
    expect(out[0].operationId).toBe('createGroup');
  });
});
