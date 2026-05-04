import { describe, expect, it } from 'vitest';
import { generateBodyTypeMismatch } from '../../request-validation/src/analysis/bodyTypeMismatch.js';
import { generateConstraintViolations } from '../../request-validation/src/analysis/constraintViolations.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';
import { buildWalk } from '../../request-validation/src/schema/walker.js';

/**
 * Class-scoped regression guard for camunda/api-test-generator#110.
 *
 * Defect class: when a body property's schema is an `allOf` whose branches
 * resolve to a single primitive type (e.g. `allOf: [{$ref: TenantId}, {description: '…'}]`
 * dereferences to `allOf: [{type: 'string', minLength: 22}, {description: '…'}]`),
 * the schema walker must treat the wrapper as transparent and surface:
 *   - the resolved primitive `type`
 *   - the merged primitive constraints (minLength/maxLength/pattern/format/enum/min/max/...)
 *
 * If the walker fails this, the per-field mutation analysers
 * (`bodyTypeMismatch`, `constraintViolations`, `enumViolations`) silently
 * stop emitting scenarios for the wrapped field, and every typed-identifier
 * promotion in the upstream Camunda spec drops the absolute scenario count
 * in `request-validation/generated/COVERAGE.md`.
 *
 * The test is class-scoped: any allOf-wrapped primitive field must be
 * walked transparently, regardless of which operation or property carries it.
 */
describe('request-validation: walker treats allOf-wrapped primitives as transparent (#110)', () => {
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

  it('walker surfaces type for allOf-wrapped string field', () => {
    const op = makeOp(
      {
        tenantId: {
          allOf: [
            { type: 'string', minLength: 1, maxLength: 32 },
            { description: 'The tenant identifier.' },
          ],
        },
      },
      ['tenantId'],
    );
    const walk = buildWalk(op);
    const node = walk?.root?.properties?.tenantId;
    expect(node).toBeDefined();
    expect(node?.type).toBe('string');
  });

  it('walker surfaces merged primitive constraints for allOf-wrapped string field', () => {
    const op = makeOp(
      {
        tenantId: {
          allOf: [
            { type: 'string', minLength: 1, maxLength: 32, pattern: '^[a-z]+$' },
            { description: 'The tenant identifier.' },
          ],
        },
      },
      ['tenantId'],
    );
    const walk = buildWalk(op);
    const node = walk?.root?.properties?.tenantId;
    expect(node?.constraints).toMatchObject({
      minLength: 1,
      maxLength: 32,
      pattern: '^[a-z]+$',
    });
  });

  it('walker merges constraints scattered across allOf branches', () => {
    const op = makeOp(
      {
        amount: {
          allOf: [
            { type: 'integer', minimum: 0 },
            { maximum: 1000, description: 'capped' },
          ],
        },
      },
      ['amount'],
    );
    const walk = buildWalk(op);
    const node = walk?.root?.properties?.amount;
    expect(node?.type).toBe('integer');
    expect(node?.constraints).toMatchObject({ minimum: 0, maximum: 1000 });
  });

  it('bodyTypeMismatch emits scenarios for allOf-wrapped primitive fields', () => {
    const op = makeOp(
      {
        tenantId: {
          allOf: [
            { type: 'string', minLength: 1, maxLength: 32 },
            { description: 'The tenant identifier.' },
          ],
        },
      },
      ['tenantId'],
    );
    const scenarios = generateBodyTypeMismatch([op], { maxPerField: 4 });
    const tenantIdScenarios = scenarios.filter((s) => s.target === 'tenantId');
    expect(tenantIdScenarios.length).toBeGreaterThan(0);
  });

  it('constraintViolations emits scenarios for allOf-wrapped primitive fields', () => {
    const op = makeOp(
      {
        tenantId: {
          allOf: [
            { type: 'string', minLength: 1, maxLength: 32 },
            { description: 'The tenant identifier.' },
          ],
        },
      },
      ['tenantId'],
    );
    const scenarios = generateConstraintViolations([op], {});
    const tenantIdScenarios = scenarios.filter((s) => s.target === 'tenantId');
    expect(tenantIdScenarios.length).toBeGreaterThan(0);
  });
});
