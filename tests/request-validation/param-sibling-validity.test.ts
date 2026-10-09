import { describe, expect, it } from 'vitest';
import { generateParamConstraintViolations } from '../../request-validation/src/analysis/paramConstraintViolations.js';
import {
  generateParamMissing,
  generateParamTypeMismatch,
} from '../../request-validation/src/analysis/parameters.js';
import type {
  OperationModel,
  ParameterModel,
  ValidationScenario,
} from '../../request-validation/src/model/types.js';

/**
 * A param scenario puts one bad value on its target parameter and fills every other parameter with a
 * placeholder. If a placeholder is itself invalid (`startTime=x` for a `date-time`), the server
 * rejects that first and the test passes without checking the parameter it names.
 *
 * Property: in every param scenario, each parameter other than the target satisfies its own schema.
 */
const param = (
  name: string,
  required: boolean,
  schema: ParameterModel['schema'],
): ParameterModel => ({ name, in: 'query', required, schema });

// Shaped like GET /system/usage-metrics.
const usageMetrics: OperationModel = {
  operationId: 'getUsageMetrics',
  method: 'GET',
  path: '/system/usage-metrics',
  tags: [],
  parameters: [
    param('startTime', true, { type: 'string', format: 'date-time' }),
    param('endTime', true, { type: 'string', format: 'date-time' }),
    param('tenantId', false, {
      type: 'string',
      format: 'TenantId',
      minLength: 1,
      maxLength: 31,
      pattern: '^(<default>|[\\w\\.\\-]{1,31})$',
    }),
    param('withTenants', false, { type: 'boolean' }),
  ],
};

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function violation(p: ParameterModel, value: string): string | undefined {
  const s = p.schema ?? {};
  if (s.type === 'boolean' && value !== 'true' && value !== 'false') return 'not a boolean';
  if ((s.type === 'integer' || s.type === 'number') && Number.isNaN(Number(value)))
    return 'not a number';
  if (s.format === 'date-time' && !DATE_TIME.test(value)) return 'not an RFC 3339 date-time';
  if (typeof s.minLength === 'number' && value.length < s.minLength) return 'too short';
  if (typeof s.maxLength === 'number' && value.length > s.maxLength) return 'too long';
  if (typeof s.pattern === 'string' && !new RegExp(s.pattern).test(value)) return 'pattern';
  return undefined;
}

function invalidSiblings(op: OperationModel, s: ValidationScenario): string[] {
  const target = s.target?.split('.')[1];
  const bad: string[] = [];
  for (const p of op.parameters) {
    if (p.name === target) continue;
    const value = s.params?.[p.name];
    if (value === undefined) continue; // an omitted optional sibling is valid
    const why = violation(p, String(value));
    if (why) bad.push(`${p.name}=${String(value)} (${why})`);
  }
  return bad;
}

describe('param scenarios: parameters other than the target are valid', () => {
  const kinds: Record<string, ValidationScenario[]> = {
    'param-type-mismatch': generateParamTypeMismatch([usageMetrics], {}),
    'param-missing': generateParamMissing([usageMetrics], {}),
    'param-constraint-violation': generateParamConstraintViolations([usageMetrics], {}),
  };

  for (const [kind, scenarios] of Object.entries(kinds)) {
    it(`${kind} emits at least one scenario for the usage-metrics shape`, () => {
      expect(scenarios.length).toBeGreaterThan(0);
    });
    for (const s of scenarios) {
      it(`${kind}: ${s.target} ${s.constraintKind ?? ''}`.trim(), () => {
        expect(invalidSiblings(usageMetrics, s)).toEqual([]);
      });
    }
  }

  it('keeps endTime after startTime whenever neither is the target', () => {
    // The server rejects an equal or reversed pair with "The endTime must be after startTime",
    // so two valid-looking date placeholders can still fail on each other.
    for (const [kind, scenarios] of Object.entries(kinds)) {
      for (const s of scenarios) {
        const start = s.params?.startTime;
        const end = s.params?.endTime;
        if (start === undefined || end === undefined) continue;
        if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) continue;
        expect(Date.parse(end), `${kind}: ${s.target}`).toBeGreaterThan(Date.parse(start));
      }
    }
  });

  it('does not emit a type-mismatch scenario for a string whose format cannot be checked', () => {
    // `TenantId` is a custom format. A query value is always a string, so any valid TenantId
    // would be accepted and the test would get 200, not 400.
    const targets = generateParamTypeMismatch([usageMetrics], {}).map((s) => s.target);
    expect(targets).not.toContain('query.tenantId');
  });
});
