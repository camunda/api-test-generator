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
  'header with a type': [param('h', 'header', false, { type: 'integer' })],
  'cookie with a type': [param('c', 'cookie', false, { type: 'integer' })],
  'query string-or-null with an enum': [
    param('u', 'query', false, { type: ['string', 'null'], enum: ['x'] }),
  ],
  'query array': [param('a', 'query', false, { type: 'array' })],
  'query object': [param('o', 'query', false, { type: 'object' })],
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

  it('every scenario it emits actually sends a bad value for its parameter', () => {
    // A scenario that leaves the valid value in place tests nothing and would be counted as coverage.
    const badTypeValues = new Set([
      'NaNValue',
      'notBoolean',
      '__INVALID_STRING__',
      // A checkable string format now sends a value that breaks that format (was the generic token).
      'not-a-date',
      'notArray',
      'notObject',
    ]);
    for (const [label, parameters] of Object.entries(FIXTURES)) {
      const o = op(parameters);
      for (const s of generateParamTypeMismatch([o], {})) {
        const name = s.target?.split('.')[1] ?? '';
        expect(badTypeValues.has(String(s.params?.[name])), `${label}: ${name}`).toBe(true);
      }
      for (const s of generateParamEnumViolation([o], {})) {
        const name = s.target?.split('.')[1] ?? '';
        expect(String(s.params?.[name]), `${label}: ${name}`).toMatch(/_X$|^__INVALID_ENUM__$/);
      }
    }
  });

  it('sends the bad value for a parameter typed as a union (first member decides)', () => {
    const o = op([param('u', 'query', false, { type: ['string', 'null'], enum: ['x'] })]);
    const [s] = generateParamTypeMismatch([o], {});
    expect(s?.params?.u).toBe('__INVALID_STRING__');
  });

  it('builds nothing for header or cookie parameters, whose bad value cannot be sent', () => {
    for (const where of ['header', 'cookie'] as const) {
      const o = op([param('v', where, false, { type: 'integer', enum: [1, 2] })]);
      expect(isParamTypeMismatchEligible(o), `${where} type`).toBe(false);
      expect(isParamEnumViolationEligible(o), `${where} enum`).toBe(false);
      expect(generateParamTypeMismatch([o], {})).toEqual([]);
      expect(generateParamEnumViolation([o], {})).toEqual([]);
    }
  });

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
