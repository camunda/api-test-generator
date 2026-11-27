import { describe, expect, it } from 'vitest';
import { generateNestedOneOfAmbiguous } from '../../request-validation/src/analysis/nestedOneOf.js';
import {
  generateOneOfAmbiguous,
  isAmbiguousPair,
  isOneOfAmbiguousEligible,
} from '../../request-validation/src/analysis/oneOfAmbiguous.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';

/**
 * #838: `oneof-ambiguous` merges the required sets of two variants into one body and expects 400. When one variant's
 * required set is a subset of the other's (createProcessInstance: ById `[processDefinitionId]` and ByVersionTag
 * `[processDefinitionId, processDefinitionVersionTag]`), the merged body is simply a valid body for the larger
 * variant, and the server accepts it (404 for the unknown id instead of 400).
 */

const obj = (required: string[]): SchemaFragment => ({
  type: 'object',
  properties: Object.fromEntries(required.map((r) => [r, { type: 'string' }])),
  required,
});

function op(body: SchemaFragment): OperationModel {
  return {
    operationId: 'createThing',
    method: 'POST',
    path: '/things',
    tags: [],
    requestBodySchema: body,
    parameters: [],
  };
}

function bodyKeys(body: unknown): string[] {
  return typeof body === 'object' && body !== null ? Object.keys(body).sort() : [];
}

describe('request-validation: oneof-ambiguous skips subset variant pairs (#838)', () => {
  it('is not an ambiguous pair when one required set is a subset of the other', () => {
    expect(isAmbiguousPair(obj(['id']), obj(['id', 'tag']))).toBe(false);
    expect(isAmbiguousPair(obj(['id', 'tag']), obj(['id']))).toBe(false);
  });

  it('is still an ambiguous pair when the required sets overlap without nesting, or are disjoint', () => {
    expect(isAmbiguousPair(obj(['id']), obj(['key']))).toBe(true);
    expect(isAmbiguousPair(obj(['id', 'x']), obj(['id', 'y']))).toBe(true);
  });

  it('keeps pairs whose required sets are equal, as before #838', () => {
    expect(isAmbiguousPair(obj(['k', 'x']), obj(['k', 'x']))).toBe(true);
    const scenarios = generateOneOfAmbiguous(
      [op({ oneOf: [obj(['k', 'x']), obj(['k', 'x'])] })],
      {},
    );
    expect(scenarios.map((s) => bodyKeys(s.requestBody))).toEqual([['k', 'x']]);
  });

  it('builds no root scenario for the createProcessInstance subset pair, and keeps the disjoint ones', () => {
    const byKey = obj(['processDefinitionKey']);
    const byId = obj(['processDefinitionId']);
    const byTag = obj(['processDefinitionId', 'processDefinitionVersionTag']);
    const scenarios = generateOneOfAmbiguous([op({ oneOf: [byKey, byId, byTag] })], {});
    expect(scenarios.map((s) => bodyKeys(s.requestBody))).toEqual([
      ['processDefinitionId', 'processDefinitionKey'],
      ['processDefinitionId', 'processDefinitionKey', 'processDefinitionVersionTag'],
    ]);
  });

  it('is not eligible when every pair is a subset pair', () => {
    expect(isOneOfAmbiguousEligible(op({ oneOf: [obj(['id']), obj(['id', 'tag'])] }))).toBe(false);
  });

  it('builds no nested scenario for a subset pair', () => {
    const nested = op({
      type: 'object',
      properties: { target: { oneOf: [obj(['id']), obj(['id', 'tag'])] } },
    });
    expect(generateNestedOneOfAmbiguous([nested], {})).toEqual([]);
  });

  it('class: every generated body holds the required set of at least two variants', () => {
    const variants = [
      obj(['a']),
      obj(['a', 'b']),
      obj(['c']),
      obj(['a', 'c', 'd']),
      obj(['e', 'f']),
    ];
    const scenarios = generateOneOfAmbiguous([op({ oneOf: variants })], {});
    expect(scenarios.length).toBeGreaterThan(0);
    for (const s of scenarios) {
      const keys = new Set(bodyKeys(s.requestBody));
      const holding = variants.filter((v) => (v.required ?? []).every((r) => keys.has(r)));
      expect(holding.length, `${s.id} holds ${holding.length} variants`).toBeGreaterThanOrEqual(2);
    }
  });

  it('class: no generated body is exactly the required set of one variant', () => {
    const variants = [
      obj(['a']),
      obj(['a', 'b']),
      obj(['c']),
      obj(['a', 'c', 'd']),
      obj(['e', 'f']),
    ];
    const scenarios = generateOneOfAmbiguous([op({ oneOf: variants })], {});
    expect(scenarios.length).toBeGreaterThan(0);
    for (const s of scenarios) {
      const keys = bodyKeys(s.requestBody).join(',');
      const exact = variants.filter((v) => [...(v.required ?? [])].sort().join(',') === keys);
      expect(exact.length, `${s.id} is a plain body of ${exact.length} variants`).toBe(0);
    }
  });
});
