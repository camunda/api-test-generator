import { describe, expect, it } from 'vitest';
import { generateConstraintViolations } from '../../request-validation/src/analysis/constraintViolations.js';
import { generatePaginationLimitInvalid } from '../../request-validation/src/analysis/paginationLimit.js';
import {
  describeScenarioKindEntry,
  scopeRuleMatches,
  toScopeRule,
} from '../../request-validation/src/excludeScoping.js';
import type { OperationModel } from '../../request-validation/src/model/types.js';

/**
 * Layer-2 fixture: `excludeOperations`' scoped `scenarioKinds` entries
 * (api-test-generator#609).
 *
 * A bare `scenarioKinds` entry drops every scenario of that kind for an
 * operation. That's too coarse for two real cases: `pagination-limit-invalid`
 * generates four mutations (belowMinimum/wayBelowMinimum/aboveMaximum/
 * wayAboveMaximum) sharing one `target` (`page.limit`), so only some of them
 * may be broken upstream; and `constraint-violation` can hit several distinct
 * `target` fields on the same operation, only one of which may be broken.
 * A scoped object entry (`{ kind, targets?, constraintKinds? }`) narrows by
 * `ValidationScenario.target` and/or `.constraintKind` instead of dropping
 * the whole kind. This exercises the real generators (not a reimplementation
 * of their mutation logic) plus the real filter helpers exported from
 * `generate.ts`, applying them exactly as `main()`'s scoped-exclude filter
 * does.
 */

function paginationOp(): OperationModel {
  return {
    operationId: 'searchThings',
    method: 'POST',
    path: '/things/search',
    tags: [],
    parameters: [],
    requestBodySchema: {
      type: 'object',
      properties: {
        page: {
          oneOf: [
            {
              properties: {
                limit: { type: 'integer', minimum: 1, maximum: 10000 },
              },
            },
          ],
        },
      },
    },
  };
}

function twoConstrainedFieldsOp(): OperationModel {
  return {
    operationId: 'updateJob',
    method: 'PATCH',
    path: '/jobs/{jobKey}',
    tags: [],
    parameters: [],
    requestBodySchema: {
      type: 'object',
      properties: {
        operationReference: { type: 'integer', minimum: 1 },
        jobLeaseToken: { type: 'string', minLength: 1 },
      },
    },
  };
}

describe('excludeOperations: scoped scenarioKinds filtering (#609)', () => {
  it('drops only the listed constraintKinds, keeping the rest of the same kind/target', () => {
    const scenarios = generatePaginationLimitInvalid([paginationOp()], {});
    expect(scenarios).toHaveLength(4);
    expect(new Set(scenarios.map((s) => s.constraintKind))).toEqual(
      new Set(['belowMinimum', 'wayBelowMinimum', 'aboveMaximum', 'wayAboveMaximum']),
    );
    // every mutation shares the same target — constraintKind is the only axis
    // that can tell them apart
    expect(new Set(scenarios.map((s) => s.target))).toEqual(new Set(['page.limit']));

    const rule = toScopeRule({
      kind: 'pagination-limit-invalid',
      constraintKinds: ['aboveMaximum', 'wayAboveMaximum'],
    });
    const kept = scenarios.filter((s) => !scopeRuleMatches(rule, s));
    expect(kept.map((s) => s.constraintKind).sort()).toEqual(['belowMinimum', 'wayBelowMinimum']);
  });

  it('drops only the listed target, keeping an unrelated field on the same operation', () => {
    const scenarios = generateConstraintViolations([twoConstrainedFieldsOp()], {});
    const targets = new Set(scenarios.map((s) => s.target));
    expect(targets.has('operationReference')).toBe(true);
    expect(targets.has('jobLeaseToken')).toBe(true);

    const rule = toScopeRule({ kind: 'constraint-violation', targets: ['operationReference'] });
    const kept = scenarios.filter((s) => !scopeRuleMatches(rule, s));
    expect(kept.some((s) => s.target === 'operationReference')).toBe(false);
    expect(kept.some((s) => s.target === 'jobLeaseToken')).toBe(true);
  });

  it('a bare-string entry still drops every scenario of that kind (regression guard)', () => {
    const scenarios = generatePaginationLimitInvalid([paginationOp()], {});
    const rule = toScopeRule('pagination-limit-invalid');
    const kept = scenarios.filter((s) => !scopeRuleMatches(rule, s));
    expect(kept).toHaveLength(0);
  });

  it('describes a bare kind and a scoped kind for the generate.ts exclude-operations log line', () => {
    expect(describeScenarioKindEntry('pagination-limit-invalid')).toBe('pagination-limit-invalid');
    expect(
      describeScenarioKindEntry({
        kind: 'pagination-limit-invalid',
        constraintKinds: ['aboveMaximum', 'wayAboveMaximum'],
      }),
    ).toBe('pagination-limit-invalid[constraintKinds=aboveMaximum|wayAboveMaximum]');
  });
});
