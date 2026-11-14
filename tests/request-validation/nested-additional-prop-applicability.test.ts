import { describe, expect, it } from 'vitest';
import {
  generateNestedAdditionalProps,
  isNestedAdditionalPropEligible,
} from '../../request-validation/src/analysis/advancedSchema.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';

/**
 * The weekly coverage report counts `nested-additional-prop` as applicable and reports it missing when no
 * scenario of that kind exists. Any nested object used to make it applicable, but the generator only
 * injects into a nested object that declares `additionalProperties: false`. Hub's search `page` and
 * `filter` objects do not, so every search endpoint showed a gap nothing could close.
 */
function op(props: Record<string, SchemaFragment>, required: string[] = []): OperationModel {
  return {
    operationId: 'op',
    method: 'POST',
    path: '/things',
    tags: [],
    requestBodySchema: { type: 'object', properties: props, required },
    parameters: [],
    requiredProps: required,
    bodyRequired: true,
  };
}

const CASES: [string, OperationModel][] = [
  [
    'an open nested filter object',
    op({ filter: { type: 'object', properties: { name: { type: 'string' } } } }),
  ],
  [
    'a required strict nested object',
    op(
      {
        meta: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
      ['meta'],
    ),
  ],
  ['a flat body', op({ name: { type: 'string' } }, ['name'])],
];

describe('nested-additional-prop applicability matches what the generator builds', () => {
  it.each(CASES)('%s', (_name, o) => {
    expect(isNestedAdditionalPropEligible(o)).toBe(
      generateNestedAdditionalProps([o], {}).length > 0,
    );
  });

  it('does not flag an open nested object', () => {
    expect(isNestedAdditionalPropEligible(CASES[0][1])).toBe(false);
  });
});
