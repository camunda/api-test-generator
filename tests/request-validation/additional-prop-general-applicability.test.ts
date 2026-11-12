import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateAdditionalPropsViolations } from '../../request-validation/src/analysis/additionalProps.js';
import { generateUniversalAdditionalProp } from '../../request-validation/src/analysis/additionalPropUniversal.js';
import type { OperationModel } from '../../request-validation/src/model/types.js';

/**
 * On a body that declares `additionalProperties: false`, the strict and the universal generators would
 * build the same request (baseline plus one unexpected key). The universal generator leaves a closed body
 * to `additional-prop`, so the coverage report must count only that one as applicable, or every strict
 * Hub body shows an `additional-prop-general` gap.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

const strict: OperationModel = {
  operationId: 'op',
  method: 'POST',
  path: '/things',
  tags: [],
  requestBodySchema: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: { name: { type: 'string' } },
  },
  parameters: [],
  requiredProps: ['name'],
  bodyRequired: true,
};

describe('additional-prop-general applicability on strict bodies', () => {
  it('leaves a closed body to additional-prop instead of building a duplicate request', () => {
    expect(generateAdditionalPropsViolations([strict], {})).toHaveLength(1);
    expect(generateUniversalAdditionalProp([strict], {})).toEqual([]);
  });

  it('generate.ts counts additional-prop-general only when additional-prop does not apply', () => {
    const src = readFileSync(
      join(__dirname, '../../request-validation/scripts/generate.ts'),
      'utf8',
    );
    expect(src).toMatch(
      /additionalProperties === false\) \{\s*applicable\.add\('additional-prop'\);\s*\} else if \(isUniversalAdditionalPropEligible\(op, capabilityGates\)\) \{\s*applicable\.add\('additional-prop-general'\);/,
    );
  });
});
