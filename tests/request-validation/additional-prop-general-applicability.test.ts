import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateAdditionalPropsViolations } from '../../request-validation/src/analysis/additionalProps.js';
import { generateUniversalAdditionalProp } from '../../request-validation/src/analysis/additionalPropUniversal.js';
import type { OperationModel } from '../../request-validation/src/model/types.js';

/**
 * On a body that declares `additionalProperties: false`, the strict and the universal generators build
 * bodies of the same shape (baseline plus one `__`-prefixed string). generate.ts's structural dedupe
 * keeps the strict `additional-prop` scenario and drops `additional-prop-general`, so the coverage
 * report must count only one of them as applicable, or every strict Hub body shows a gap.
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

const shape = (body: unknown) =>
  Object.entries(body && typeof body === 'object' ? body : {})
    .map(([k, v]) => `${k.startsWith('__') ? '__X__' : k}:${typeof v}`)
    .sort()
    .join(',');

describe('additional-prop-general applicability on strict bodies', () => {
  it('builds the same body shape as additional-prop, which the structural dedupe collapses', () => {
    const [strictScenario] = generateAdditionalPropsViolations([strict], {});
    const [generalScenario] = generateUniversalAdditionalProp([strict], {});
    expect(shape(generalScenario.requestBody)).toBe(shape(strictScenario.requestBody));
  });

  it('generate.ts counts additional-prop-general only when additional-prop does not apply', () => {
    const src = readFileSync(
      join(__dirname, '../../request-validation/scripts/generate.ts'),
      'utf8',
    );
    expect(src).toMatch(
      /additionalProperties === false\) \{\s*applicable\.add\('additional-prop'\);\s*\} else \{\s*applicable\.add\('additional-prop-general'\);/,
    );
  });
});
