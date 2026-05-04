import { describe, expect, it } from 'vitest';
import {
  generateFormatInvalid,
  generateMultipleOfViolations,
} from '../../request-validation/src/analysis/advancedSchema.js';
import { generateConstraintViolations } from '../../request-validation/src/analysis/constraintViolations.js';
import { generateEnumViolations } from '../../request-validation/src/analysis/enumViolations.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';
import { buildBaselineBody } from '../../request-validation/src/schema/baseline.js';
import { buildWalk } from '../../request-validation/src/schema/walker.js';

/**
 * Class-scoped regression guard for camunda/api-test-generator#113 (follow-up
 * to #110 / PR #111). Copilot's review flagged that the original walker fix
 * only covers required + type-mismatch / constraint-violation paths. The
 * underlying defect is broader: `mergePrimitiveAllOf` builds an `effective`
 * fragment with the resolved primitive `type`, `format`, `multipleOf`, etc.,
 * but `visit()` sets `raw: schema` (the original allOf wrapper). Anything
 * downstream that reads `node.raw.{format,multipleOf,enum,…}` instead of
 * `node.constraints` / `node.type` therefore sees the unmerged wrapper and
 * silently skips the field.
 *
 * These tests are RED on `main` and become GREEN when `walker.ts` exposes
 * the merged primitive fragment via `node.raw` for the primitive-flatten
 * case (object case must keep `raw: schema`).
 */
describe('request-validation: allOf-wrapped primitive raw exposure (#113)', () => {
  function makeOp(properties: Record<string, SchemaFragment>, required: string[]): OperationModel {
    return {
      operationId: 'createWidget',
      method: 'POST',
      path: '/widgets',
      tags: [],
      requestBodySchema: {
        type: 'object',
        required,
        properties,
      },
      requiredProps: required,
      parameters: [],
    };
  }

  describe('walker.node.raw exposes merged primitive metadata', () => {
    it('exposes merged format on node.raw for allOf-wrapped string', () => {
      const op = makeOp(
        {
          deploymentKey: {
            allOf: [
              { type: 'string', format: 'uuid' },
              { description: 'The deployment identifier.' },
            ],
          },
        },
        ['deploymentKey'],
      );
      const walk = buildWalk(op);
      const node = walk?.root?.properties?.deploymentKey;
      expect(node?.raw).toBeDefined();
      // Defect: raw points at the original allOf wrapper, so raw.format === undefined.
      expect(node?.raw?.format).toBe('uuid');
    });

    it('exposes merged multipleOf on node.raw for allOf-wrapped integer', () => {
      const op = makeOp(
        {
          amount: {
            allOf: [
              { type: 'integer', multipleOf: 5 },
              { description: 'A discrete amount in 5-unit steps.' },
            ],
          },
        },
        ['amount'],
      );
      const walk = buildWalk(op);
      const node = walk?.root?.properties?.amount;
      expect(node?.raw?.multipleOf).toBe(5);
    });

    it('exposes merged enum on node.raw for allOf-wrapped string', () => {
      const op = makeOp(
        {
          color: {
            allOf: [
              { type: 'string', enum: ['red', 'green', 'blue'] },
              { description: 'Allowed colours.' },
            ],
          },
        },
        ['color'],
      );
      const walk = buildWalk(op);
      const node = walk?.root?.properties?.color;
      expect(node?.raw?.enum).toEqual(['red', 'green', 'blue']);
    });
  });

  describe('baseline body materialises optional allOf-wrapped primitives with branch-only signals', () => {
    it('includes optional allOf-wrapped string with branch-only enum', () => {
      const op = makeOp(
        {
          required: { type: 'string' },
          color: {
            allOf: [
              { type: 'string', enum: ['red', 'green', 'blue'] },
              { description: 'Optional colour.' },
            ],
          },
        },
        ['required'],
      );
      const baseline = buildBaselineBody(op) as Record<string, unknown> | undefined;
      expect(baseline).toBeDefined();
      // Defect: optional materialisation reads child.raw.enum (= undefined on
      // the wrapper), so `color` is silently omitted from the baseline body.
      expect(baseline).toHaveProperty('color');
    });

    it('includes optional allOf-wrapped string with branch-only format', () => {
      const op = makeOp(
        {
          required: { type: 'string' },
          deploymentKey: {
            allOf: [
              { type: 'string', format: 'uuid' },
              { description: 'Optional deployment key.' },
            ],
          },
        },
        ['required'],
      );
      const baseline = buildBaselineBody(op) as Record<string, unknown> | undefined;
      expect(baseline).toHaveProperty('deploymentKey');
    });

    it('includes optional allOf-wrapped integer with branch-only multipleOf', () => {
      const op = makeOp(
        {
          required: { type: 'string' },
          amount: {
            allOf: [
              { type: 'integer', multipleOf: 5 },
              { description: 'Optional discrete amount.' },
            ],
          },
        },
        ['required'],
      );
      const baseline = buildBaselineBody(op) as Record<string, unknown> | undefined;
      expect(baseline).toHaveProperty('amount');
    });
  });

  describe('advanced-schema analysers emit scenarios for allOf-wrapped primitives', () => {
    it('generateFormatInvalid emits a scenario for allOf-wrapped string with format: uuid', () => {
      const op = makeOp(
        {
          deploymentKey: {
            allOf: [
              { type: 'string', format: 'uuid' },
              { description: 'The deployment identifier.' },
            ],
          },
        },
        ['deploymentKey'],
      );
      const scenarios = generateFormatInvalid([op], {});
      const targetScenarios = scenarios.filter((s) => s.target === 'deploymentKey');
      expect(targetScenarios.length).toBeGreaterThan(0);
    });

    it('generateMultipleOfViolations emits a scenario for allOf-wrapped integer with multipleOf', () => {
      const op = makeOp(
        {
          amount: {
            allOf: [
              { type: 'integer', multipleOf: 5 },
              { description: 'A discrete amount.' },
            ],
          },
        },
        ['amount'],
      );
      const scenarios = generateMultipleOfViolations([op], {});
      const targetScenarios = scenarios.filter((s) => s.target === 'amount');
      expect(targetScenarios.length).toBeGreaterThan(0);
    });
  });

  describe('mutation analysers cover OPTIONAL allOf-wrapped primitives', () => {
    it('generateConstraintViolations emits scenarios for an optional allOf-wrapped string', () => {
      const op = makeOp(
        {
          required: { type: 'string' },
          tenantId: {
            allOf: [
              { type: 'string', minLength: 1, maxLength: 32 },
              { description: 'Optional tenant identifier.' },
            ],
          },
        },
        ['required'],
      );
      const scenarios = generateConstraintViolations([op]);
      const tenantIdScenarios = scenarios.filter((s) => s.target === 'tenantId');
      expect(tenantIdScenarios.length).toBeGreaterThan(0);
    });

    it('generateEnumViolations emits scenarios for an optional allOf-wrapped enum string', () => {
      const op = makeOp(
        {
          required: { type: 'string' },
          color: {
            allOf: [
              { type: 'string', enum: ['red', 'green', 'blue'] },
              { description: 'Optional colour.' },
            ],
          },
        },
        ['required'],
      );
      const scenarios = generateEnumViolations([op], {});
      const targetScenarios = scenarios.filter((s) => s.target === 'color');
      expect(targetScenarios.length).toBeGreaterThan(0);
    });
  });
});
