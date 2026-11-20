import { describe, expect, it } from 'vitest';
import {
  generateConstraintViolations,
  isConstraintViolationEligible,
} from '../../request-validation/src/analysis/constraintViolations.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';

/**
 * The baseline body leaves out optional fields that carry only array constraints (`minItems`/`maxItems`), and the
 * mutation step used to refuse a field that was not in the baseline and could not step into an array. A body whose
 * only constrained field is such an array (Hub's `replaceWorkspaceEnvironments`, `{ environmentIds: string[] }`)
 * therefore got no constraint-violation test at all, while the coverage report counted the kind as applicable.
 */
function op(body: SchemaFragment): OperationModel {
  return {
    operationId: 'replaceThings',
    method: 'PUT',
    path: '/things/{thingKey}/ids',
    tags: [],
    requestBodySchema: body,
    parameters: [],
  };
}

const optionalIdArray: SchemaFragment = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ids: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string', minLength: 1, maxLength: 5 },
    },
  },
};

function byKind(o: OperationModel): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const s of generateConstraintViolations([o], {})) {
    out.set(`${s.target}:${s.constraintKind}`, s.requestBody);
  }
  return out;
}

describe('constraint-violation on an optional field that the baseline body leaves out', () => {
  it('adds the optional array to the body to break its maxItems', () => {
    const scenarios = byKind(op(optionalIdArray));
    expect(scenarios.get('ids:aboveMaxItems')).toEqual({ ids: ['x', 'x', 'x', 'x'] });
    expect(scenarios.has('ids:wayAboveMaxItems')).toBe(true);
  });

  it('fills an oversized array with valid items, so only the item count is wrong', () => {
    for (const [key, body] of byKind(op(optionalIdArray))) {
      if (!key.endsWith('MaxItems')) continue;
      const ids = body && typeof body === 'object' && 'ids' in body ? body.ids : undefined;
      expect(Array.isArray(ids) && ids.every((v) => v === 'x')).toBe(true);
    }
  });

  it('breaks an item constraint inside the array', () => {
    const scenarios = byKind(op(optionalIdArray));
    expect(scenarios.get('ids.0:emptyString')).toEqual({ ids: [''] });
    expect(scenarios.get('ids.0:aboveMaxLength')).toEqual({ ids: ['aaaaaa'] });
  });

  it('builds an optional parent object with its own required fields before breaking a nested constraint', () => {
    const o = op({
      type: 'object',
      properties: {
        settings: {
          type: 'object',
          required: ['mode'],
          properties: {
            mode: { type: 'string' },
            tags: { type: 'array', maxItems: 1, items: { type: 'string' } },
          },
        },
      },
    });
    expect(byKind(o).get('settings.tags:aboveMaxItems')).toEqual({
      settings: { mode: 'x', tags: ['x', 'x'] },
    });
  });

  it('leaves the optional siblings out of a parent it builds, so only the target field is invalid', () => {
    // A placeholder 'x' in an optional pattern field (a search filter's `decisionDefinitionKey`) is itself invalid,
    // and live OCA rejected the request for that field instead of judging the targeted one.
    const o = op({
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: {
            someKey: { type: 'string', pattern: '^-?[0-9]+$' },
            tags: { type: 'array', maxItems: 1, items: { type: 'string', pattern: '^[a-z]+$' } },
          },
        },
      },
    });
    const scenarios = byKind(o);
    expect(scenarios.get('filter.tags:aboveMaxItems')).toEqual({ filter: { tags: ['x', 'x'] } });
    expect(scenarios.get('filter.someKey:patternMismatch')).toBeDefined();
  });
});

describe('values built to reach the target satisfy their own constraints', () => {
  const arrayOf = (array: SchemaFragment): OperationModel =>
    op({ type: 'object', properties: { ids: array } });

  it('fills an oversized array with items that meet the item minLength', () => {
    const o = arrayOf({ type: 'array', maxItems: 3, items: { type: 'string', minLength: 2 } });
    expect(byKind(o).get('ids:aboveMaxItems')).toEqual({ ids: ['aa', 'aa', 'aa', 'aa'] });
  });

  it('fills an oversized uniqueItems array with distinct items', () => {
    const o = arrayOf({
      type: 'array',
      maxItems: 2,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[a-z]+$' },
    });
    const body = byKind(o).get('ids:aboveMaxItems');
    const ids = body && typeof body === 'object' && 'ids' in body ? body.ids : undefined;
    expect(Array.isArray(ids) && ids.length === 3 && new Set(ids).size === 3).toBe(true);
  });

  it('builds a missing array with minItems items before breaking one of them', () => {
    const o = arrayOf({
      type: 'array',
      minItems: 2,
      items: { type: 'integer', minimum: 5, maximum: 9 },
    });
    expect(byKind(o).get('ids.0:aboveMaximum')).toEqual({ ids: [10, 5] });
  });

  it('skips a mutation when no valid value can be built for the rest of the array', () => {
    const o = arrayOf({ type: 'array', maxItems: 1, items: { type: 'string', pattern: '^Z{3}$' } });
    expect(byKind(o).has('ids:aboveMaxItems')).toBe(false);
  });

  const itemsOf = (body: unknown): unknown[] => {
    const ids = body && typeof body === 'object' && 'ids' in body ? body.ids : undefined;
    return Array.isArray(ids) ? ids : [];
  };

  it('fills an oversized array with integers above an OpenAPI 3.0 exclusive minimum', () => {
    const o = arrayOf({
      type: 'array',
      maxItems: 2,
      items: { type: 'integer', minimum: 1, exclusiveMinimum: true },
    });
    expect(byKind(o).get('ids:aboveMaxItems')).toEqual({ ids: [2, 2, 2] });
  });

  it('fills an oversized array with integers that meet multipleOf, distinct under uniqueItems', () => {
    const plain = arrayOf({
      type: 'array',
      maxItems: 2,
      items: { type: 'integer', multipleOf: 5 },
    });
    expect(byKind(plain).get('ids:aboveMaxItems')).toEqual({ ids: [5, 5, 5] });
    const unique = arrayOf({
      type: 'array',
      maxItems: 2,
      uniqueItems: true,
      items: { type: 'integer', multipleOf: 5 },
    });
    const ids = itemsOf(byKind(unique).get('ids:aboveMaxItems'));
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((v) => typeof v === 'number' && v % 5 === 0)).toBe(true);
  });

  it('fills an oversized array with numbers inside a fractional range', () => {
    const o = arrayOf({
      type: 'array',
      maxItems: 2,
      uniqueItems: true,
      items: { type: 'number', exclusiveMinimum: 0.1, exclusiveMaximum: 0.9 },
    });
    const ids = itemsOf(byKind(o).get('ids:aboveMaxItems'));
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((v) => typeof v === 'number' && v > 0.1 && v < 0.9)).toBe(true);
  });

  it('meets an item pattern declared in an allOf part', () => {
    const o = arrayOf({
      type: 'array',
      maxItems: 1,
      items: { type: 'string', allOf: [{ pattern: '^[0-9]+$' }] },
    });
    expect(
      itemsOf(byKind(o).get('ids:aboveMaxItems')).every((v) => /^[0-9]+$/.test(String(v))),
    ).toBe(true);
  });

  it('does not reach into an array that cannot hold an item (maxItems: 0)', () => {
    const o = arrayOf({ type: 'array', maxItems: 0, items: { type: 'string', minLength: 1 } });
    expect([...byKind(o).keys()].filter((k) => k.startsWith('ids.0:'))).toEqual([]);
    const objects = arrayOf({
      type: 'array',
      maxItems: 0,
      items: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', maxLength: 3 } },
      },
    });
    expect([...byKind(objects).keys()].filter((k) => k.startsWith('ids.0.'))).toEqual([]);
  });
});

describe('constraint-violation applicability on multipart-only operations', () => {
  const part: SchemaFragment = {
    type: 'object',
    properties: {
      metadata: {
        type: 'object',
        properties: { processDefinitionId: { type: 'string', maxLength: 5 } },
      },
    },
  };

  it('is not applicable when every constraint sits inside a part, which the multipart skip drops', () => {
    const o: OperationModel = {
      ...op(part),
      mediaTypes: ['multipart/form-data'],
      multipartSchema: part,
    };
    expect(generateConstraintViolations([o], {}).length).toBeGreaterThan(0);
    expect(isConstraintViolationEligible(o, {})).toBe(false);
  });

  it('stays applicable for the same body sent as JSON', () => {
    expect(isConstraintViolationEligible(op(part), {})).toBe(true);
  });
});
