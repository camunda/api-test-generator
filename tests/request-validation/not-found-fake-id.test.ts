import { describe, expect, it } from 'vitest';
import {
  fakePathParamValue,
  generateNotFoundFakeId,
  isNotFoundEligible,
} from '../../request-validation/src/analysis/notFoundFakeId.js';
import { renderScenarioForTest } from '../../request-validation/src/emit/qaEmitter.js';
import type { OperationModel, ParameterModel } from '../../request-validation/src/model/types.js';

/**
 * Layer-2 fixtures for the 404 fake-ID emitter (issue #381, split from #279).
 *
 * The generator emits, for every singleton-resource endpoint with a path
 * parameter, a well-formed request whose path id is replaced with a
 * syntactically-valid-but-nonexistent value, asserting HTTP 404. Each `it`
 * pins one named property:
 *  - numeric LongKey path params get a big-number fake matching `^-?[0-9]+$`;
 *  - a `oneOf` of LongKey aliases (e.g. `ResourceKey`) is still numeric;
 *  - string-id path params get a pattern/length-valid fake;
 *  - params for which no valid fake can be produced are skipped (no flaky 404);
 *  - eligibility is restricted to GET (read-by-key) endpoints, and excludes
 *    endpoints that don't declare 404, that return a paginated collection
 *    (empty-200 for a missing parent, #372), or that require a request body.
 */

function pathParam(name: string, schema: ParameterModel['schema']): ParameterModel {
  return { name, in: 'path', required: true, schema };
}

function op(
  over: Partial<OperationModel> & Pick<OperationModel, 'operationId' | 'path'>,
): OperationModel {
  return {
    method: 'GET',
    tags: [],
    parameters: [],
    responseCodes: ['200', '404'],
    successIsCollection: false,
    ...over,
  };
}

// A LongKey-style numeric key: pattern lives inside an allOf branch, exactly
// as the bundled Camunda spec models `ProcessInstanceKey` etc.
const longKeySchema = {
  type: 'string',
  allOf: [{ type: 'string', pattern: '^-?[0-9]+$', minLength: 1, maxLength: 25 }],
};

describe('request-validation: 404 fake-ID value synthesis (#381)', () => {
  it('numeric LongKey path param → big-number fake matching the pattern and within maxLength', () => {
    const v = fakePathParamValue(pathParam('processInstanceKey', longKeySchema));
    expect(v).toBeDefined();
    if (!v) return;
    expect(/^-?[0-9]+$/.test(v)).toBe(true);
    expect(v.length).toBeLessThanOrEqual(25);
    // Long enough to sit well above sequentially-minted keys.
    expect(v.length).toBeGreaterThanOrEqual(10);
  });

  it('string-id path param → fake satisfying its pattern and length bounds', () => {
    const tenantIdSchema = {
      type: 'string',
      minLength: 1,
      maxLength: 31,
      pattern: '^(<default>|[\\w\\.\\-]{1,31})$',
    };
    const v = fakePathParamValue(pathParam('tenantId', tenantIdSchema));
    expect(v).toBeDefined();
    if (!v) return;
    expect(new RegExp(tenantIdSchema.pattern).test(v)).toBe(true);
    expect(v.length).toBeLessThanOrEqual(31);
  });

  it('oneOf of LongKey aliases (e.g. ResourceKey) → numeric fake, not a string id', () => {
    // `ResourceKey` is `oneOf:[ProcessDefinitionKey, ...]`, each an
    // `allOf:[LongKey]`. The numeric constraint is two levels deep; a flat
    // read would mistake it for a free string and synthesise a malformed key.
    const resourceKeySchema = {
      type: 'string',
      oneOf: [
        { type: 'string', allOf: [{ type: 'string', pattern: '^-?[0-9]+$', maxLength: 25 }] },
        { type: 'string', allOf: [{ type: 'string', pattern: '^-?[0-9]+$', maxLength: 25 }] },
      ],
    };
    const v = fakePathParamValue(pathParam('resourceKey', resourceKeySchema));
    expect(v).toBeDefined();
    if (!v) return;
    expect(/^-?[0-9]+$/.test(v)).toBe(true);
  });

  it('OAS 3.1 array-typed numeric key (e.g. type: ["integer","null"]) → numeric fake', () => {
    // OpenAPI 3.1 models nullable numeric types as a `type` array. The shared
    // resolver must not drop array-typed `type` info: a flat read that only
    // honoured `type: 'integer'` would mistake this for a free string and
    // synthesise a malformed key.
    const arrayTypeKeySchema = { type: ['integer', 'null'] };
    const v = fakePathParamValue(pathParam('someKey', arrayTypeKeySchema));
    expect(v).toBeDefined();
    if (!v) return;
    expect(/^-?[0-9]+$/.test(v)).toBe(true);
  });

  it('unsynthesisable param (pattern no candidate satisfies) → undefined (caller skips)', () => {
    // Composite key `<digits>-<digits>` — neither a plain number nor the
    // string candidates match, so no guaranteed-valid value exists.
    const compositeSchema = { type: 'string', pattern: '^[0-9]+-[0-9]+$' };
    expect(
      fakePathParamValue(pathParam('decisionEvaluationInstanceKey', compositeSchema)),
    ).toBeUndefined();
  });

  it('enum path param → undefined (a non-member would be 400, not 404)', () => {
    const enumSchema = { type: 'string', enum: ['a', 'b', 'c'] };
    expect(fakePathParamValue(pathParam('kind', enumSchema))).toBeUndefined();
  });
});

describe('request-validation: 404 fake-ID eligibility (#381)', () => {
  it('emits a 404 scenario for a singleton key endpoint that declares 404', () => {
    const ops = [
      op({
        operationId: 'getProcessInstance',
        path: '/process-instances/{processInstanceKey}',
        parameters: [pathParam('processInstanceKey', longKeySchema)],
      }),
    ];
    const out = generateNotFoundFakeId(ops, {});
    expect(out).toHaveLength(1);
    const s = out[0];
    expect(s.type).toBe('not-found-fake-id');
    expect(s.expectedStatus).toBe(404);
    expect(s.headersAuth).toBe(true);
    expect(s.requestBody).toBeUndefined();
    expect(s.params?.processInstanceKey).toMatch(/^-?[0-9]+$/);
  });

  it('does NOT emit when the contract declares no 404', () => {
    const o = op({
      operationId: 'x',
      path: '/r/{rKey}',
      parameters: [pathParam('rKey', longKeySchema)],
      responseCodes: ['200', '400'],
    });
    expect(isNotFoundEligible(o)).toBe(false);
    expect(generateNotFoundFakeId([o], {})).toHaveLength(0);
  });

  it('does NOT emit for a non-GET (mutating/command) endpoint — v1 is read-only', () => {
    const o = op({
      operationId: 'cancelProcessInstance',
      path: '/process-instances/{processInstanceKey}/cancellation',
      method: 'POST',
      parameters: [pathParam('processInstanceKey', longKeySchema)],
    });
    expect(isNotFoundEligible(o)).toBe(false);
    expect(generateNotFoundFakeId([o], {})).toHaveLength(0);
  });

  it('does NOT emit for a paginated-collection (search/list) endpoint — empty 200, not 404 (#372)', () => {
    const o = op({
      operationId: 'searchUsersForGroup',
      path: '/groups/{groupId}/users',
      parameters: [pathParam('groupId', { type: 'string', minLength: 1, maxLength: 256 })],
      successIsCollection: true,
    });
    expect(isNotFoundEligible(o)).toBe(false);
    expect(generateNotFoundFakeId([o], {})).toHaveLength(0);
  });

  it('does NOT emit for an operation that requires a request body (v1 sends no body)', () => {
    const o = op({
      operationId: 'getThingWithBody',
      path: '/things/{thingKey}',
      parameters: [pathParam('thingKey', longKeySchema)],
      bodyRequired: true,
    });
    expect(isNotFoundEligible(o)).toBe(false);
    expect(generateNotFoundFakeId([o], {})).toHaveLength(0);
  });

  it('does NOT emit for an operation with no path parameter', () => {
    const o = op({ operationId: 'listThings', path: '/things', parameters: [] });
    expect(isNotFoundEligible(o)).toBe(false);
  });
});

describe('request-validation: 404 fake-ID emitter rendering (#381)', () => {
  it('renders a 404 assertion with the fake id substituted and no request body', () => {
    const ops = [
      op({
        operationId: 'getGroup',
        path: '/groups/{groupId}',
        parameters: [pathParam('groupId', { type: 'string', minLength: 1, maxLength: 256 })],
      }),
    ];
    const [s] = generateNotFoundFakeId(ops, {});
    const code = renderScenarioForTest(s, 'getGroup - Nonexistent groupId returns 404');
    expect(code).toContain('404');
    expect(code).toContain('buildUrl("/groups/{groupId}"');
    expect(code).toContain(s.params?.groupId ?? '__missing__');
    expect(code).not.toContain('data: requestBody');
  });
});
