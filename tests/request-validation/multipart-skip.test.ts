import { describe, expect, it } from 'vitest';
import type {
  OperationModel,
  ValidationScenario,
} from '../../request-validation/src/model/types.js';
import { shouldSkipForMultipart } from '../../request-validation/src/util/multipartSkip.js';

/**
 * Layer-2 fixture for issue #135.
 *
 * Three negative-test mutation classes are meaningless on multipart-only
 * endpoints (createDeployment, createDocument, createDocuments):
 *
 *   1. body-top-type-mismatch — no JSON top-level type to invert.
 *   2. type-mismatch on a `format: binary` part — any bytes satisfy
 *      the schema; mutation produces 201, not 400.
 *   3. constraint-violation on an array-typed part — array-cardinality
 *      mutations don't translate to multipart `files=...` repetition.
 *
 * `shouldSkipForMultipart` is the planner-side authority on whether
 * the multipart-adaptation pass should drop a scenario instead of
 * wrapping it as form data. These tests pin the contract directly so
 * future analyses can call the helper without re-deriving the rule.
 *
 * Class-scoped: each `it` asserts ONE rule against synthetic operations
 * standing in for the three real-world offenders, plus negative cases
 * confirming we don't over-skip JSON operations or scalar multipart
 * parts that can carry valid type-mismatch mutations.
 */

function multipartOnlyOp(partial: Partial<OperationModel> = {}): OperationModel {
  return {
    operationId: partial.operationId ?? 'createThing',
    method: partial.method ?? 'POST',
    path: partial.path ?? '/things',
    tags: [],
    parameters: [],
    mediaTypes: ['multipart/form-data'],
    ...partial,
  };
}

function jsonOp(partial: Partial<OperationModel> = {}): OperationModel {
  return {
    operationId: partial.operationId ?? 'createJsonThing',
    method: partial.method ?? 'POST',
    path: partial.path ?? '/json-things',
    tags: [],
    parameters: [],
    mediaTypes: ['application/json'],
    ...partial,
  };
}

function scenario(partial: Partial<ValidationScenario>): ValidationScenario {
  return {
    id: partial.id ?? 's1',
    operationId: partial.operationId ?? 'createThing',
    method: partial.method ?? 'POST',
    path: partial.path ?? '/things',
    type: partial.type ?? 'type-mismatch',
    expectedStatus: partial.expectedStatus ?? 400,
    description: partial.description ?? 'test scenario',
    headersAuth: partial.headersAuth ?? true,
    ...partial,
  };
}

describe('shouldSkipForMultipart (#135)', () => {
  it('skips body-top-type-mismatch on multipart-only ops (createDeployment / createDocument / createDocuments)', () => {
    const op = multipartOnlyOp({
      multipartSchema: { type: 'object', properties: { resources: { type: 'array' } } },
    });
    const s = scenario({ type: 'body-top-type-mismatch', requestBody: [] });
    expect(shouldSkipForMultipart(s, op)).toBe(true);
  });

  it('skips type-mismatch on a top-level format:binary multipart part (createDocument file)', () => {
    const op = multipartOnlyOp({
      operationId: 'createDocument',
      multipartSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary' },
        },
      },
    });
    const s = scenario({ type: 'type-mismatch', target: 'file', requestBody: { file: 123 } });
    expect(shouldSkipForMultipart(s, op)).toBe(true);
  });

  it('skips constraint-violation on a top-level array multipart part (createDocuments files)', () => {
    const op = multipartOnlyOp({
      operationId: 'createDocuments',
      multipartSchema: {
        type: 'object',
        properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
      },
    });
    const s = scenario({
      type: 'constraint-violation',
      target: 'files',
      requestBody: { files: [] },
    });
    expect(shouldSkipForMultipart(s, op)).toBe(true);
  });

  it('does NOT skip on JSON-only ops even when the scenario kind matches', () => {
    const op = jsonOp({
      requestBodySchema: { type: 'object', properties: { file: { type: 'string' } } },
    });
    const cases: ValidationScenario[] = [
      scenario({ type: 'body-top-type-mismatch', requestBody: [] }),
      scenario({ type: 'type-mismatch', target: 'file', requestBody: { file: 123 } }),
      scenario({ type: 'constraint-violation', target: 'files', requestBody: { files: [] } }),
    ];
    for (const s of cases) {
      expect(shouldSkipForMultipart(s, op)).toBe(false);
    }
  });

  it('does NOT skip type-mismatch on a non-binary scalar multipart part', () => {
    // E.g. a multipart endpoint with a stringy metadata field — wrapping
    // the mutation as form data still produces a meaningful 400.
    const op = multipartOnlyOp({
      multipartSchema: {
        type: 'object',
        properties: { tenantId: { type: 'string' } },
      },
    });
    const s = scenario({
      type: 'type-mismatch',
      target: 'tenantId',
      requestBody: { tenantId: 123 },
    });
    expect(shouldSkipForMultipart(s, op)).toBe(false);
  });

  it('does NOT skip constraint-violation on a non-array scalar multipart part', () => {
    const op = multipartOnlyOp({
      multipartSchema: {
        type: 'object',
        properties: { tenantId: { type: 'string', maxLength: 32 } },
      },
    });
    const s = scenario({
      type: 'constraint-violation',
      target: 'tenantId',
      requestBody: { tenantId: 'x'.repeat(64) },
    });
    expect(shouldSkipForMultipart(s, op)).toBe(false);
  });

  it('does NOT skip nested-target type-mismatch / constraint-violation', () => {
    // Only top-level multipart parts are governed by this rule. Anything
    // nested (e.g. type-mismatch on metadata.foo where metadata is a
    // JSON-string part) is left to the existing adapter to wrap.
    const op = multipartOnlyOp({
      multipartSchema: {
        type: 'object',
        properties: { metadata: { type: 'object', properties: { foo: { type: 'string' } } } },
      },
    });
    const s = scenario({
      type: 'type-mismatch',
      target: 'metadata.foo',
      requestBody: { metadata: { foo: 1 } },
    });
    expect(shouldSkipForMultipart(s, op)).toBe(false);
  });

  it('skips additional-prop / additional-prop-general on multipart-only ops (#364 — unknown form parts ignored → 201)', () => {
    const op = multipartOnlyOp({
      multipartSchema: {
        type: 'object',
        properties: { file: { type: 'string', format: 'binary' } },
      },
    });
    const cases: ValidationScenario[] = [
      scenario({ type: 'additional-prop', requestBody: { file: 'x', __extra__: 1 } }),
      scenario({ type: 'additional-prop-general', requestBody: { file: 'x', __extra__: 1 } }),
    ];
    for (const s of cases) {
      expect(shouldSkipForMultipart(s, op)).toBe(true);
    }
  });

  it('still passes through scenario kinds the adapter can wrap meaningfully (missing-required, missing-body)', () => {
    const op = multipartOnlyOp({
      multipartSchema: {
        type: 'object',
        properties: { file: { type: 'string', format: 'binary' } },
      },
    });
    const cases: ValidationScenario[] = [
      scenario({ type: 'missing-required', target: 'file', requestBody: {} }),
      scenario({ type: 'missing-body' }),
    ];
    for (const s of cases) {
      expect(shouldSkipForMultipart(s, op)).toBe(false);
    }
  });

  it('does NOT skip additional-prop on JSON-body ops (additionalProperties:false is enforced → 400)', () => {
    const op = jsonOp();
    const s = scenario({ type: 'additional-prop', requestBody: { name: 'x', __extra__: 1 } });
    expect(shouldSkipForMultipart(s, op)).toBe(false);
  });
});
