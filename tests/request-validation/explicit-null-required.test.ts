import { describe, expect, it } from 'vitest';
import { generateExplicitNullRequired } from '../../request-validation/src/analysis/explicitNullRequired.js';
import type { OperationModel } from '../../request-validation/src/model/types.js';

/**
 * #500 — explicit `null` for a required field, distinct from omitting it
 * entirely (`missing-required`). Verified live against a running camunda-oca
 * cluster (4 required fields across 3 operations): uniformly 400 with the
 * SAME ProblemDetail detail message as the omitted-key case — see
 * explicitNullRequired.ts's header comment for the full verification detail.
 */

function op(
  over: Partial<OperationModel> & Pick<OperationModel, 'operationId' | 'path'>,
): OperationModel {
  return {
    method: 'POST',
    tags: [],
    parameters: [],
    mediaTypes: ['application/json'],
    ...over,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

describe('request-validation: explicit-null-required generation (#500)', () => {
  it('emits one scenario per required field, setting it to null (not omitting)', () => {
    const ops = [
      op({
        operationId: 'createGlobalClusterVariable',
        path: '/cluster-variables/global',
        requiredProps: ['name', 'value'],
        requestBodySchema: {
          type: 'object',
          properties: { name: { type: 'string' }, value: { type: 'string' } },
        },
      }),
    ];
    const out = generateExplicitNullRequired(ops, {});
    expect(out).toHaveLength(2);
    const byTarget = new Map(out.map((s) => [s.target, s]));
    for (const target of ['name', 'value']) {
      const s = byTarget.get(target);
      expect(s?.type).toBe('explicit-null-required');
      expect(s?.expectedStatus).toBe(400);
      const body = isPlainObject(s?.requestBody) ? s.requestBody : {};
      // The mutated field is explicitly null...
      expect(body[target]).toBeNull();
      // ...while every OTHER required field is still present (unlike
      // missing-required, which omits the target and keeps the rest).
      for (const other of ['name', 'value']) {
        if (other === target) continue;
        expect(other in body).toBe(true);
        expect(body[other]).not.toBeNull();
      }
    }
  });

  it('skips a required field whose schema explicitly allows null (OAS 3.1 type array)', () => {
    const ops = [
      op({
        operationId: 'createThing',
        path: '/things',
        requiredProps: ['name', 'nullableField'],
        requestBodySchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            nullableField: { type: ['string', 'null'] },
          },
        },
      }),
    ];
    const out = generateExplicitNullRequired(ops, {});
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe('name');
  });

  it('skips a required field whose schema allows null via a oneOf/anyOf branch', () => {
    // The other common way JSON Schema/OAS 3.1 expresses nullability —
    // typically when the nullable side is a $ref, which can't sit inside a
    // `type` array directly.
    const ops = [
      op({
        operationId: 'createThing',
        path: '/things',
        requiredProps: ['name', 'nullableRef'],
        requestBodySchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            nullableRef: { oneOf: [{ type: 'object' }, { type: 'null' }] },
          },
        },
      }),
    ];
    const out = generateExplicitNullRequired(ops, {});
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe('name');
  });

  it('emits nothing for an operation with no top-level required fields', () => {
    const ops = [
      op({
        operationId: 'createOptionalThing',
        path: '/optional-things',
        requestBodySchema: { type: 'object', properties: { name: { type: 'string' } } },
      }),
    ];
    expect(generateExplicitNullRequired(ops, {})).toHaveLength(0);
  });

  it('emits nothing for a multipart-only operation', () => {
    const ops = [
      op({
        operationId: 'createDocument',
        path: '/documents',
        mediaTypes: ['multipart/form-data'],
        requiredProps: ['file'],
        requestBodySchema: { type: 'object', properties: { file: { type: 'string' } } },
      }),
    ];
    expect(generateExplicitNullRequired(ops, {})).toHaveLength(0);
  });

  it('respects onlyOperations and capPerOperation', () => {
    const ops = [
      op({
        operationId: 'createA',
        path: '/a',
        requiredProps: ['x', 'y'],
        requestBodySchema: {
          type: 'object',
          properties: { x: { type: 'string' }, y: { type: 'string' } },
        },
      }),
      op({
        operationId: 'createB',
        path: '/b',
        requiredProps: ['x', 'y'],
        requestBodySchema: {
          type: 'object',
          properties: { x: { type: 'string' }, y: { type: 'string' } },
        },
      }),
    ];
    const out = generateExplicitNullRequired(ops, {
      onlyOperations: new Set(['createB']),
      capPerOperation: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0].operationId).toBe('createB');
  });
});
