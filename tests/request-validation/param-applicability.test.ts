import { describe, expect, it } from 'vitest';
import {
  generateParamEnumViolation,
  generateParamMissing,
  generateParamTypeMismatch,
  isParamEnumViolationEligible,
  isParamMissingEligible,
  isParamTypeMismatchEligible,
} from '../../request-validation/src/analysis/parameters.js';
import type { OperationModel, ParameterModel } from '../../request-validation/src/model/types.js';

/**
 * COVERAGE.json's `missingApplicableKinds` is measured against the per-operation applicability
 * rules in generate.ts. For the three simple parameter kinds those rules used to read the parameters
 * more loosely than the generators (a required path parameter counted for param-missing although a
 * path parameter cannot be omitted, a plain string counted for param-type-mismatch), so most keyed
 * endpoints were reported as missing checks the generator cannot build, and the weekly hub
 * response-coverage report repeated that as real gaps.
 *
 * The rules now live next to the generators and both use them. The strongest guard is the property
 * "an operation is eligible exactly when its generator emits a scenario for it", checked across
 * parameter shapes that differ in location, requiredness, type and enum.
 */
const param = (
  name: string,
  where: ParameterModel['in'],
  required: boolean,
  schema?: ParameterModel['schema'],
): ParameterModel => ({ name, in: where, required, schema });

function op(parameters: ParameterModel[]): OperationModel {
  return {
    operationId: 'probe',
    method: 'GET',
    path: '/things/{id}',
    tags: [],
    parameters,
  };
}

const FIXTURES: Record<string, ParameterModel[]> = {
  'no parameters': [],
  'required path param only': [param('id', 'path', true, { type: 'string' })],
  'required path param with an enum': [param('id', 'path', true, { type: 'string', enum: ['a'] })],
  'optional query string': [param('q', 'query', false, { type: 'string' })],
  'required query string': [param('q', 'query', true, { type: 'string' })],
  'optional query integer': [param('n', 'query', false, { type: 'integer' })],
  'optional query boolean': [param('b', 'query', false, { type: 'boolean' })],
  'query string with a format': [param('d', 'query', false, { type: 'string', format: 'date' })],
  'query string with an enum': [param('s', 'query', false, { type: 'string', enum: ['x', 'y'] })],
  'header with an enum': [param('h', 'header', false, { type: 'string', enum: ['x'] })],
  'required header': [param('h', 'header', true, { type: 'string' })],
  'path param plus optional query integer': [
    param('id', 'path', true, { type: 'string' }),
    param('n', 'query', false, { type: 'integer' }),
  ],
  'query param with no schema type': [param('x', 'query', false, {})],
  'query param with an unmappable type': [param('x', 'query', false, { type: 'null' })],
};

describe('parameter kinds: applicability matches what the generator can build', () => {
  for (const [label, parameters] of Object.entries(FIXTURES)) {
    it(`${label}`, () => {
      const o = op(parameters);
      expect(isParamMissingEligible(o), 'param-missing').toBe(
        generateParamMissing([o], {}).length > 0,
      );
      expect(isParamTypeMismatchEligible(o), 'param-type-mismatch').toBe(
        generateParamTypeMismatch([o], {}).length > 0,
      );
      expect(isParamEnumViolationEligible(o), 'param-enum-violation').toBe(
        generateParamEnumViolation([o], {}).length > 0,
      );
    });
  }

  it('does not count a required path parameter as an omittable one', () => {
    const o = op([param('id', 'path', true, { type: 'string' })]);
    expect(isParamMissingEligible(o)).toBe(false);
    expect(isParamTypeMismatchEligible(o)).toBe(false);
  });

  it('counts a required query parameter, and a typed or enum query parameter', () => {
    expect(isParamMissingEligible(op([param('q', 'query', true, { type: 'string' })]))).toBe(true);
    expect(isParamTypeMismatchEligible(op([param('n', 'query', false, { type: 'integer' })]))).toBe(
      true,
    );
    expect(
      isParamEnumViolationEligible(
        op([param('s', 'query', false, { type: 'string', enum: ['x'] })]),
      ),
    ).toBe(true);
  });
});
