import { describe, expect, it } from 'vitest';
import {
  generateConstraintViolations,
  isConstraintViolationEligible,
} from '../../request-validation/src/analysis/constraintViolations.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';

/**
 * The weekly coverage report counts `constraint-violation` as applicable and reports it missing when no
 * scenario of that kind exists. Any min/max/pattern in the body used to make it applicable, but the
 * generator needs the constrained field in the baseline body. Every Hub search endpoint keeps its limits
 * inside the optional `page` oneOf, so they showed a gap nothing could close.
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

const limit = { type: 'integer', format: 'int32', minimum: 1, maximum: 10000 };

const CASES: [string, OperationModel][] = [
  [
    'a search body with limits inside the optional page oneOf',
    op({
      page: {
        allOf: [
          {
            oneOf: [
              { type: 'object', properties: { limit } },
              {
                type: 'object',
                required: ['from'],
                properties: { from: { type: 'integer', minimum: 0 }, limit },
              },
            ],
          },
        ],
      },
    }),
  ],
  ['a required string with maxLength', op({ name: { type: 'string', maxLength: 5 } }, ['name'])],
  ['an unconstrained body', op({ name: { type: 'string' } }, ['name'])],
];

describe('constraint-violation applicability matches what the generator builds', () => {
  it.each(CASES)('%s', (_name, o) => {
    expect(isConstraintViolationEligible(o, {})).toBe(
      generateConstraintViolations([o], {}).length > 0,
    );
  });

  it('does not flag a search body whose only limits sit in the page oneOf', () => {
    expect(isConstraintViolationEligible(CASES[0][1], {})).toBe(false);
  });
});
