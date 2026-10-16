import { describe, expect, it } from 'vitest';
import { generateParamConstraintViolations } from '../../request-validation/src/analysis/paramConstraintViolations.js';
import {
  generateParamEnumViolation,
  generateParamMissing,
  generateParamTypeMismatch,
} from '../../request-validation/src/analysis/parameters.js';
import type {
  OperationModel,
  ParameterModel,
  ValidationScenario,
} from '../../request-validation/src/model/types.js';
import { buildValidValue } from '../../request-validation/src/util/paramSchema.js';

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
    if (value === undefined) {
      // An omitted optional sibling is valid; an omitted required one makes the server answer 400
      // for the missing parameter instead of the target.
      if (p.required) bad.push(`${p.name} is required but missing`);
      continue;
    }
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

describe('capability-gated optional params are not sent as siblings', () => {
  // `tenantId` is gated (single-tenant mode rejects any non-blank value). Sending it as a sibling
  // makes the server answer for the gate instead of the param under test.
  const gates = new Map([['tenantId', { disabledDetailContains: 'multi-tenancy' }]]);
  const withEnumToo: OperationModel = {
    ...usageMetrics,
    parameters: [
      ...usageMetrics.parameters,
      param('status', false, { type: 'string', enum: ['OPEN', 'CLOSED'] }),
    ],
  };
  const gated: Record<string, ValidationScenario[]> = {
    'param-type-mismatch': generateParamTypeMismatch([withEnumToo], { capabilityGates: gates }),
    'param-missing': generateParamMissing([withEnumToo], { capabilityGates: gates }),
    'param-enum-violation': generateParamEnumViolation([withEnumToo], { capabilityGates: gates }),
    'param-constraint-violation': generateParamConstraintViolations([withEnumToo], {
      capabilityGates: gates,
    }),
  };

  for (const [kind, scenarios] of Object.entries(gated)) {
    it(`${kind} leaves tenantId out unless it is the target`, () => {
      expect(scenarios.length).toBeGreaterThan(0);
      for (const s of scenarios) {
        if (s.target === 'query.tenantId') continue;
        expect(s.params, `${kind}: ${s.target}`).not.toHaveProperty('tenantId');
      }
    });
  }
});

describe('mixed path, query and header params: every other param is present and valid', () => {
  const at = (
    name: string,
    where: ParameterModel['in'],
    required: boolean,
    schema: ParameterModel['schema'],
  ): ParameterModel => ({ name, in: where, required, schema });
  const mixed: OperationModel = {
    operationId: 'getThing',
    method: 'GET',
    path: '/things/{id}',
    tags: [],
    parameters: [
      at('id', 'path', true, { type: 'string', pattern: '^[0-9]+$', maxLength: 5 }),
      at('startTime', 'query', true, { type: 'string', format: 'date-time' }),
      at('trace', 'header', true, { type: 'string' }),
      // No short string can satisfy this, so the optional param is left out rather than sent invalid.
      at('code', 'query', false, { type: 'string', pattern: '^\\d{4}-[a-z]+$' }),
      at('flag', 'query', false, { type: 'boolean' }),
    ],
  };

  const byKind: Record<string, ValidationScenario[]> = {
    'param-missing': generateParamMissing([mixed], {}),
    'param-type-mismatch': generateParamTypeMismatch([mixed], {}),
    'param-constraint-violation': generateParamConstraintViolations([mixed], {}),
  };

  for (const [kind, scenarios] of Object.entries(byKind)) {
    it(`${kind} emits scenarios for the mixed shape`, () => {
      expect(scenarios.length).toBeGreaterThan(0);
    });
    for (const s of scenarios) {
      it(`${kind}: ${s.target} ${s.constraintKind ?? ''}`.trim(), () => {
        const params = s.params ?? {};
        const target = s.target?.split('.')[1];
        // A path token left out is sent as __MISSING_PARAM__, so the route fails before validation.
        if (target !== 'id') expect(params.id, 'path placeholder').toBeDefined();
        // Header params are not sent through `params`; only path and query siblings are checked.
        if (target !== 'startTime') expect(params.startTime, 'required query').toBeDefined();
        // An optional param no value can satisfy is omitted, not sent invalid.
        if (target !== 'code') expect(params, 'unsatisfiable optional').not.toHaveProperty('code');
      });
    }
  }
});

describe('an enum-constrained date sibling keeps its enum member', () => {
  // The ordered date values are synthesized, so they must not replace a value the schema restricts
  // to an enum. The plain date next to it still gets an ordered value.
  const withDates: OperationModel = {
    operationId: 'listWindows',
    method: 'GET',
    path: '/windows',
    tags: [],
    parameters: [
      param('from', true, { type: 'string', format: 'date-time' }),
      param('snapshot', false, {
        type: 'string',
        format: 'date-time',
        enum: ['2030-01-01T00:00:00Z'],
      }),
      param('limit', false, { type: 'integer' }),
    ],
  };

  it('sends an allowed member for the enum date and an ordered value for the plain one', () => {
    const scenarios = generateParamTypeMismatch([withDates], {}).filter(
      (s) => s.target === 'query.limit',
    );
    expect(scenarios.length).toBeGreaterThan(0);
    for (const s of scenarios) {
      expect(s.params?.snapshot).toBe('2030-01-01T00:00:00Z');
      expect(s.params?.from).toBe('2025-01-01T00:00:00Z');
    }
  });
});

describe('param-enum-violation: the other params are valid too', () => {
  // A required date-time next to an enum target. Without the baseline the request omits `startTime`
  // and the server answers 400 for the missing parameter, not for the enum.
  const withEnum: OperationModel = {
    operationId: 'listThings',
    method: 'GET',
    path: '/things/{id}',
    tags: [],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      param('startTime', true, { type: 'string', format: 'date-time' }),
      param('endTime', false, { type: 'string', format: 'date-time' }),
      param('status', false, { type: 'string', enum: ['OPEN', 'CLOSED'] }),
    ],
  };

  it('sends a valid value for every other query param, and keeps the path placeholder', () => {
    const scenarios = generateParamEnumViolation([withEnum], {});
    expect(scenarios.map((s) => s.target)).toEqual(['query.status']);
    for (const s of scenarios) {
      expect(invalidSiblings(withEnum, s)).toEqual([]);
      expect(s.params?.id).toBe('1');
      expect(s.params?.status).toBe('OPEN_X');
    }
  });
});

describe('buildValidValue: the value satisfies the schema pattern', () => {
  it.each([
    ['^[A-Z]+$', undefined],
    ['^[a-z]{3}$', 3],
    ['^[0-9]+-[0-9]+$', undefined],
    ['^\\d*\\*$', undefined],
  ])('pattern %s', (pattern, minLength) => {
    const value = buildValidValue({ schema: {}, type: 'string', pattern, minLength });
    expect(new RegExp(pattern).test(value), `got '${value}'`).toBe(true);
  });
});
