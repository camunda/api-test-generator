import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateConstraintViolations } from '../../request-validation/src/analysis/constraintViolations.js';
import type { OperationModel } from '../../request-validation/src/model/types.js';
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

function buildNestedOp(operationId: string): OperationModel {
  return {
    operationId,
    method: 'POST',
    path: `/${operationId}`,
    tags: [],
    bodyRequired: true,
    requiredProps: ['filter'],
    requestBodySchema: {
      // `filter` is itself REQUIRED (matching the real bundled spec's
      // ProcessDefinitionInstanceVersionStatisticsQuery) so buildBaselineBody
      // always materialises it — only `tenantId` within it is optional.
      type: 'object',
      required: ['filter'],
      properties: {
        filter: {
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
      expect(tenantIdScenarios.length).toBeGreaterThan(0);
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
  });
});
