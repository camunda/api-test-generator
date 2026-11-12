import { describe, expect, it } from 'vitest';
import {
  generateFormatInvalid,
  isFormatInvalidEligible,
} from '../../request-validation/src/analysis/advancedSchema.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';

/**
 * The weekly coverage report counts `format-invalid` as applicable and reports it missing when no
 * scenario of that kind exists. Any `format` in the body used to make it applicable, but the generator
 * only breaks string formats it has an invalid value for, so Hub's `int32` pagination fields and its
 * own key formats (`ProjectKey`, `WorkspaceKey`) showed as a gap nothing could close.
 */
function op(body: Record<string, SchemaFragment>, required: string[] = []): OperationModel {
  return {
    operationId: 'op',
    method: 'POST',
    path: '/things',
    tags: [],
    requestBodySchema: { type: 'object', properties: body, required },
    parameters: [],
    requiredProps: required,
    bodyRequired: true,
  };
}

const CASES: [string, OperationModel, string[]][] = [
  ['an int32 pagination field', op({ limit: { type: 'integer', format: 'int32' } }), []],
  [
    'a semantic key format',
    op({ projectKey: { type: 'string', format: 'ProjectKey' } }, ['projectKey']),
    [],
  ],
  [
    'an unenforced date-time',
    op({ at: { type: 'string', format: 'date-time' } }, ['at']),
    ['date-time'],
  ],
  ['a required uuid string', op({ id: { type: 'string', format: 'uuid' } }, ['id']), []],
];

describe('format-invalid applicability matches what the generator builds', () => {
  it.each(CASES)('%s', (_name, o, unenforced) => {
    const opts = { unenforcedStringFormats: unenforced };
    expect(isFormatInvalidEligible(o, opts)).toBe(generateFormatInvalid([o], opts).length > 0);
  });

  it('does not flag Hub key or int32 formats the generator cannot break', () => {
    expect(isFormatInvalidEligible(CASES[0][1], {})).toBe(false);
    expect(isFormatInvalidEligible(CASES[1][1], {})).toBe(false);
    expect(isFormatInvalidEligible(CASES[2][1], { unenforcedStringFormats: ['date-time'] })).toBe(
      false,
    );
  });
});
