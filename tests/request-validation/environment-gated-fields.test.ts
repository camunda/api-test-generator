import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateConstraintViolations } from '../../request-validation/src/analysis/constraintViolations.js';
import {
  generateParamConstraintViolations,
  isParamConstraintEligible,
} from '../../request-validation/src/analysis/paramConstraintViolations.js';
import type { OperationModel, ParameterModel } from '../../request-validation/src/model/types.js';
import {
  isBlankValue,
  loadCapabilityGates,
} from '../../request-validation/src/util/capabilityGate.js';

/**
 * Layer-1/2 fixture: capability-gated field handling (#404).
 *
 * `constraintViolations.ts` walks every schema-constrained body field with no
 * awareness of the target environment. For a field like `tenantId` on a
 * single-tenant broker, confirmed live (and directly by the Camunda team):
 *
 *  - a FLAT optional occurrence with a non-blank mutation value is always
 *    rejected while the capability is off (400, detail contains the gate's
 *    text), independent of the value's own shape — flip the expectation.
 *  - a FLAT optional occurrence with a blank/whitespace-only mutation value
 *    is silently normalized and the request proceeds to whatever that
 *    operation's own outcome is — not generalizable, so excluded entirely.
 *  - a NESTED occurrence (e.g. a search filter field) is never validated
 *    regardless of value — flip to 200 + empty search results.
 *  - a REQUIRED occurrence of the field name is unaffected by any of this.
 */

const GATE = new Map([['tenantId', { disabledDetailContains: 'multi-tenancy is disabled' }]]);
const GATE_WITH_STATUS = new Map([
  ['tenantId', { disabledDetailContains: 'tenant scoping is unavailable', disabledStatus: '403' }],
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function buildOp(opts: {
  operationId: string;
  required: string[];
  properties: Record<
    string,
    { type: string; minLength?: number; maxLength?: number; pattern?: string }
  >;
}): OperationModel {
  return {
    operationId: opts.operationId,
    method: 'POST',
    path: `/${opts.operationId}`,
    tags: [],
    bodyRequired: true,
    requiredProps: opts.required,
    requestBodySchema: {
      type: 'object',
      required: opts.required,
      properties: opts.properties,
    },
    parameters: [],
  };
}

function buildNestedOp(operationId: string, rootKey = 'filter'): OperationModel {
  return {
    operationId,
    method: 'POST',
    path: `/${operationId}`,
    tags: [],
    bodyRequired: true,
    requiredProps: [rootKey],
    requestBodySchema: {
      // The nested root is itself REQUIRED (matching the real bundled
      // spec's ProcessDefinitionInstanceVersionStatisticsQuery) so
      // buildBaselineBody always materialises it — only `tenantId` within
      // it is optional.
      type: 'object',
      required: [rootKey],
      properties: {
        [rootKey]: {
          type: 'object',
          required: [],
          properties: {
            tenantId: { type: 'string', minLength: 1, maxLength: 31, pattern: '^[a-z]+$' },
          },
        },
      },
    },
    parameters: [],
  };
}

// createTenant-like: tenantId is REQUIRED (the resource's own identifier) —
// must remain fully exercised regardless of the environment gate.
const opRequiredTenantId = buildOp({
  operationId: 'createTenant',
  required: ['tenantId'],
  properties: {
    tenantId: { type: 'string', minLength: 1, maxLength: 31, pattern: '^[a-z]+$' },
  },
});

// correlateMessage-like: tenantId is an OPTIONAL scoping field, alongside
// another optional, genuinely-constrained sibling field (businessId) that
// must remain exercised untouched — the gate is scoped to the named field.
const opOptionalTenantId = buildOp({
  operationId: 'correlateMessage',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    tenantId: { type: 'string', minLength: 1, maxLength: 31, pattern: '^[a-z]+$' },
    businessId: { type: 'string', minLength: 1, maxLength: 50 },
  },
});

// getProcessDefinitionInstanceVersionStatistics-like: tenantId nested under
// a search filter object.
const opNestedTenantId = buildNestedOp('getProcessDefinitionInstanceVersionStatistics');

// A gated field nested under a root OTHER than `filter` — no confirmed
// behaviour either way, must be left ungated entirely (#404 code-review
// finding: "nested" must not be conflated with "search filter").
const opNonFilterNestedTenantId = buildNestedOp('hypotheticalNonSearchOp', 'metadata');

function buildQueryParamOp(opts: { operationId: string; param: ParameterModel }): OperationModel {
  return {
    operationId: opts.operationId,
    method: 'GET',
    // No path params — matches the real getUsageMetrics shape
    // (GET /system/usage-metrics) this fixture is modeled on, and exercises
    // buildParams's path-param-less case directly (see the dedicated test
    // below).
    path: `/${opts.operationId}`,
    tags: [],
    bodyRequired: false,
    requiredProps: [],
    parameters: [opts.param],
  };
}

// getUsageMetrics-like: tenantId is an OPTIONAL query parameter with its own
// length/pattern constraints, on an operation with NO path params at all.
const opOptionalQueryTenantId = buildQueryParamOp({
  operationId: 'getUsageMetrics',
  param: {
    name: 'tenantId',
    in: 'query',
    required: false,
    schema: { type: 'string', minLength: 1, maxLength: 5, pattern: '^[a-z]+$' },
  },
});

// A query parameter whose only producible violation is blank (minLength:1,
// nothing else) — exercises the eligibility/generator-agreement edge case.
const opBlankOnlyQueryTenantId = buildQueryParamOp({
  operationId: 'blankOnlyTenantIdOp',
  param: {
    name: 'tenantId',
    in: 'query',
    required: false,
    schema: { type: 'string', minLength: 1 },
  },
});

describe('request-validation: capability-gated fields (#404)', () => {
  describe('generateConstraintViolations', () => {
    it('still exercises a REQUIRED occurrence of a gated field name, untouched', () => {
      const scenarios = generateConstraintViolations([opRequiredTenantId], {
        capabilityGates: GATE,
      });
      const tenantIdScenarios = scenarios.filter((s) => s.target === 'tenantId');
      expect(tenantIdScenarios.length).toBeGreaterThan(0);
      for (const s of tenantIdScenarios) {
        expect(s.expectedStatus).toBe(400);
        expect(s.expectDetailContains).toBeUndefined();
        expect(s.expectEmptyItems).toBeUndefined();
      }
    });

    it('excludes a FLAT optional blank-value mutation, flips non-blank ones, leaves the sibling untouched', () => {
      const scenarios = generateConstraintViolations([opOptionalTenantId], {
        capabilityGates: GATE,
      });
      const tenantIdScenarios = scenarios.filter((s) => s.target === 'tenantId');
      // Pin the exact surviving set: the fixture's schema
      // (minLength:1, maxLength:31, pattern:'^[a-z]+$') produces 5 raw
      // mutations — belowMinLength, emptyString, and patternMismatch are
      // blank-like and excluded; only aboveMaxLength and wayAboveMaxLength
      // survive. A `toBeGreaterThan(0)` count alone can't tell correct
      // exclusion apart from a regression that ALSO wrongly excludes one of
      // the two non-blank survivors.
      expect(tenantIdScenarios.map((s) => s.constraintKind).sort()).toEqual([
        'aboveMaxLength',
        'wayAboveMaxLength',
      ]);
      for (const s of tenantIdScenarios) {
        // No blank-value mutation survives.
        const body = s.requestBody;
        expect(isRecord(body) && isBlankValue(body.tenantId)).toBe(false);
        // Every surviving mutation is flipped to the capability rejection.
        expect(s.expectedStatus).toBe(400);
        expect(s.expectDetailContains).toBe('multi-tenancy is disabled');
        expect(s.expectEmptyItems).toBeUndefined();
      }
      // The sibling optional constrained field is completely unaffected.
      const businessIdScenarios = scenarios.filter((s) => s.target === 'businessId');
      expect(businessIdScenarios.length).toBeGreaterThan(0);
      for (const s of businessIdScenarios) {
        expect(s.expectedStatus).toBe(400);
        expect(s.expectDetailContains).toBeUndefined();
      }
    });

    it('emits both blank and non-blank mutations when no gate is configured (regression guard for the gate itself)', () => {
      const scenarios = generateConstraintViolations([opOptionalTenantId], {});
      const tenantIdScenarios = scenarios.filter((s) => s.target === 'tenantId');
      const hasBlank = tenantIdScenarios.some(
        (s) => isRecord(s.requestBody) && isBlankValue(s.requestBody.tenantId),
      );
      expect(hasBlank).toBe(true);
      for (const s of tenantIdScenarios) expect(s.expectDetailContains).toBeUndefined();
    });

    it('flips a NESTED occurrence to 200 + empty-items for every mutation, including blank ones', () => {
      const scenarios = generateConstraintViolations([opNestedTenantId], {
        capabilityGates: GATE,
      });
      const tenantIdScenarios = scenarios.filter((s) => s.target === 'filter.tenantId');
      expect(tenantIdScenarios.length).toBeGreaterThan(0);
      // Nested occurrences are NOT excluded even when blank — confirmed
      // uniform behaviour regardless of value.
      const hasBlank = tenantIdScenarios.some(
        (s) =>
          isRecord(s.requestBody) &&
          isRecord(s.requestBody.filter) &&
          isBlankValue(s.requestBody.filter.tenantId),
      );
      expect(hasBlank).toBe(true);
      for (const s of tenantIdScenarios) {
        expect(s.expectedStatus).toBe(200);
        expect(s.expectEmptyItems).toBe(true);
        expect(s.expectDetailContains).toBeUndefined();
      }
    });

    it('honors a gate-declared disabledStatus instead of the 400 default', () => {
      const scenarios = generateConstraintViolations([opOptionalTenantId], {
        capabilityGates: GATE_WITH_STATUS,
      });
      const tenantIdScenarios = scenarios.filter((s) => s.target === 'tenantId');
      expect(tenantIdScenarios.length).toBeGreaterThan(0);
      for (const s of tenantIdScenarios) {
        expect(s.expectedStatus).toBe(403);
        expect(s.expectDetailContains).toBe('tenant scoping is unavailable');
      }
    });

    it('leaves a gated field nested under a root OTHER than `filter` entirely ungated', () => {
      const scenarios = generateConstraintViolations([opNonFilterNestedTenantId], {
        capabilityGates: GATE,
      });
      const tenantIdScenarios = scenarios.filter((s) => s.target === 'metadata.tenantId');
      // No confirmed behaviour for this shape — skipped rather than guessed,
      // not flipped to the filter-specific 200/empty-items outcome.
      expect(tenantIdScenarios).toEqual([]);
    });
  });

  describe('generateParamConstraintViolations', () => {
    it('excludes a blank mutation, flips non-blank ones, for an OPTIONAL gated query parameter', () => {
      const scenarios = generateParamConstraintViolations([opOptionalQueryTenantId], {
        capabilityGates: GATE,
      });
      // Pin the exact surviving set: the fixture's schema
      // (minLength:1, maxLength:5, pattern:'^[a-z]+$') produces 3 raw
      // mutations — pattern ('\n') and length-min ('') are blank-like and
      // excluded; only length-max survives. A count-only assertion can't
      // tell correct exclusion apart from a regression that also wrongly
      // excludes the one non-blank survivor.
      expect(scenarios.map((s) => s.constraintKind)).toEqual(['length-max']);
      for (const s of scenarios) {
        expect(s.params?.tenantId).not.toBe('');
        expect(s.expectedStatus).toBe(400);
        expect(s.expectDetailContains).toBe('multi-tenancy is disabled');
      }
    });

    it('sends the violating value for a query param on a path with NO path params (buildParams regression guard)', () => {
      // Pre-existing bug: buildParams returned undefined whenever the
      // operation's path carried zero `{...}` tokens, silently dropping
      // every query-param override — a getUsageMetrics-shaped op's
      // generated test never actually sent its malformed tenantId.
      const scenarios = generateParamConstraintViolations([opOptionalQueryTenantId], {});
      expect(scenarios.length).toBeGreaterThan(0);
      for (const s of scenarios) {
        expect(s.params).toBeDefined();
        expect('tenantId' in (s.params ?? {})).toBe(true);
        expect(typeof s.params?.tenantId).toBe('string');
      }
    });

    it('emits the blank mutation untouched when no gate is configured', () => {
      const scenarios = generateParamConstraintViolations([opOptionalQueryTenantId], {});
      const hasBlank = scenarios.some((s) => s.params?.tenantId === '');
      expect(hasBlank).toBe(true);
      for (const s of scenarios) expect(s.expectDetailContains).toBeUndefined();
    });

    it('marks a parameter whose only violation is blank-and-gated as ineligible, matching the generator', () => {
      expect(isParamConstraintEligible(opBlankOnlyQueryTenantId, GATE)).toBe(false);
      expect(
        generateParamConstraintViolations([opBlankOnlyQueryTenantId], { capabilityGates: GATE })
          .length,
      ).toBe(0);
    });

    it('still flips a REQUIRED gated query parameter’s own occurrence untouched (gate only applies to optional)', () => {
      const requiredOp = buildQueryParamOp({
        operationId: 'requiredTenantIdOp',
        param: {
          name: 'tenantId',
          in: 'query',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 5, pattern: '^[a-z]+$' },
        },
      });
      const scenarios = generateParamConstraintViolations([requiredOp], { capabilityGates: GATE });
      expect(scenarios.length).toBeGreaterThan(0);
      for (const s of scenarios) {
        expect(s.expectedStatus).toBe(400);
        expect(s.expectDetailContains).toBeUndefined();
      }
    });

    it('honors a gate-declared disabledStatus instead of the 400 default', () => {
      const scenarios = generateParamConstraintViolations([opOptionalQueryTenantId], {
        capabilityGates: GATE_WITH_STATUS,
      });
      expect(scenarios.length).toBeGreaterThan(0);
      for (const s of scenarios) {
        expect(s.expectedStatus).toBe(403);
        expect(s.expectDetailContains).toBe('tenant scoping is unavailable');
      }
    });
  });

  describe('isBlankValue', () => {
    it('matches empty and whitespace-only strings, nothing else', () => {
      expect(isBlankValue('')).toBe(true);
      expect(isBlankValue('\n')).toBe(true);
      expect(isBlankValue('   ')).toBe(true);
      expect(isBlankValue('x')).toBe(false);
      expect(isBlankValue(123)).toBe(false);
      expect(isBlankValue(undefined)).toBe(false);
    });
  });

  describe('loadCapabilityGates', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-cap-gate-'));
    const ontologyDir = path.join(tmpRoot, 'configs', 'probe', 'ontology');
    fs.mkdirSync(ontologyDir, { recursive: true });

    afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

    it('returns an empty map when the file is absent (no-op)', () => {
      expect(loadCapabilityGates(tmpRoot, 'probe')).toEqual(new Map());
    });

    it('collects only fields with a capabilityGate entry', () => {
      fs.writeFileSync(
        path.join(ontologyDir, 'global-context-seeds.json'),
        JSON.stringify({
          version: 1,
          seeds: [
            {
              binding: 'tenantIdVar',
              fieldName: 'tenantId',
              seedRule: 'tenantIdVar',
              omitWhenUnbound: true,
              capabilityGate: { disabledDetailContains: 'multi-tenancy is disabled' },
            },
            {
              binding: 'otherVar',
              fieldName: 'otherField',
              seedRule: 'otherVar',
            },
          ],
        }),
      );
      const gates = loadCapabilityGates(tmpRoot, 'probe');
      expect(gates.get('tenantId')).toEqual({
        disabledDetailContains: 'multi-tenancy is disabled',
      });
      expect(gates.has('otherField')).toBe(false);
    });

    it('throws on malformed JSON rather than silently ignoring it', () => {
      fs.writeFileSync(path.join(ontologyDir, 'global-context-seeds.json'), '{not json');
      expect(() => loadCapabilityGates(tmpRoot, 'probe')).toThrow(/Failed to parse/);
    });

    it('throws when "seeds" is not an array, rather than silently disabling gating', () => {
      fs.writeFileSync(
        path.join(ontologyDir, 'global-context-seeds.json'),
        JSON.stringify({ version: 1, seeds: {} }),
      );
      expect(() => loadCapabilityGates(tmpRoot, 'probe')).toThrow(/"seeds" to be an array/);
    });

    it('throws when a capabilityGate entry is structurally malformed, rather than silently skipping it', () => {
      fs.writeFileSync(
        path.join(ontologyDir, 'global-context-seeds.json'),
        JSON.stringify({
          version: 1,
          seeds: [
            {
              binding: 'tenantIdVar',
              fieldName: 'tenantId',
              seedRule: 'tenantIdVar',
              // Typo: the real key is `disabledDetailContains`.
              capabilityGate: { disabledDetail: 'multi-tenancy is disabled' },
            },
          ],
        }),
      );
      expect(() => loadCapabilityGates(tmpRoot, 'probe')).toThrow(
        /capabilityGate\.disabledDetailContains must be a non-empty string/,
      );
    });

    it('collects an optional disabledStatus alongside disabledDetailContains', () => {
      fs.writeFileSync(
        path.join(ontologyDir, 'global-context-seeds.json'),
        JSON.stringify({
          version: 1,
          seeds: [
            {
              binding: 'tenantIdVar',
              fieldName: 'tenantId',
              seedRule: 'tenantIdVar',
              capabilityGate: {
                disabledDetailContains: 'tenant scoping is unavailable',
                disabledStatus: '403',
              },
            },
          ],
        }),
      );
      const gates = loadCapabilityGates(tmpRoot, 'probe');
      expect(gates.get('tenantId')).toEqual({
        disabledDetailContains: 'tenant scoping is unavailable',
        disabledStatus: '403',
      });
    });

    it('throws when disabledStatus is not a 4xx/5xx status string', () => {
      fs.writeFileSync(
        path.join(ontologyDir, 'global-context-seeds.json'),
        JSON.stringify({
          version: 1,
          seeds: [
            {
              binding: 'tenantIdVar',
              fieldName: 'tenantId',
              seedRule: 'tenantIdVar',
              capabilityGate: { disabledDetailContains: 'x', disabledStatus: 'nope' },
            },
          ],
        }),
      );
      expect(() => loadCapabilityGates(tmpRoot, 'probe')).toThrow(
        /capabilityGate\.disabledStatus must be a 4xx\/5xx status string/,
      );
    });

    // Copilot review (#642): a schema-valid but non-error disabledStatus
    // (e.g. "200") would silently defeat the rejection contract this field
    // exists to encode.
    it('throws when disabledStatus is a non-error status like 200', () => {
      fs.writeFileSync(
        path.join(ontologyDir, 'global-context-seeds.json'),
        JSON.stringify({
          version: 1,
          seeds: [
            {
              binding: 'tenantIdVar',
              fieldName: 'tenantId',
              seedRule: 'tenantIdVar',
              capabilityGate: { disabledDetailContains: 'x', disabledStatus: '200' },
            },
          ],
        }),
      );
      expect(() => loadCapabilityGates(tmpRoot, 'probe')).toThrow(
        /capabilityGate\.disabledStatus must be a 4xx\/5xx status string/,
      );
    });

    it('throws when a seed entry is missing fieldName', () => {
      fs.writeFileSync(
        path.join(ontologyDir, 'global-context-seeds.json'),
        JSON.stringify({ version: 1, seeds: [{ binding: 'x', seedRule: 'x' }] }),
      );
      expect(() => loadCapabilityGates(tmpRoot, 'probe')).toThrow(
        /fieldName must be a non-empty string/,
      );
    });

    it('throws on a duplicate fieldName instead of silently keeping only the last entry', () => {
      fs.writeFileSync(
        path.join(ontologyDir, 'global-context-seeds.json'),
        JSON.stringify({
          version: 1,
          seeds: [
            {
              binding: 'tenantIdVar',
              fieldName: 'tenantId',
              seedRule: 'tenantIdVar',
              capabilityGate: { disabledDetailContains: 'multi-tenancy is disabled' },
            },
            {
              binding: 'tenantIdVar2',
              fieldName: 'tenantId',
              seedRule: 'tenantIdVar2',
              capabilityGate: { disabledDetailContains: 'a different, shadowing message' },
            },
          ],
        }),
      );
      expect(() => loadCapabilityGates(tmpRoot, 'probe')).toThrow(
        /duplicate fieldName\(s\): tenantId/,
      );
    });
  });
});
