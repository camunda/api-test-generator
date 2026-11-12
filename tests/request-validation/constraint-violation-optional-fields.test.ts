import { describe, expect, it } from 'vitest';
import { generateConstraintViolations } from '../../request-validation/src/analysis/constraintViolations.js';
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
});
