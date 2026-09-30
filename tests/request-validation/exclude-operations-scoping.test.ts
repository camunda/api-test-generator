import { describe, expect, it } from 'vitest';
import { generateConstraintViolations } from '../../request-validation/src/analysis/constraintViolations.js';
import { generatePaginationLimitInvalid } from '../../request-validation/src/analysis/paginationLimit.js';
import {
  describeScopeRule,
  ruleMatchesAny,
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
 * `src/excludeScoping.ts`, applying them exactly as `generate.ts`'s
 * scoped-exclude filter does.
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

// A third minimum-constrained field (retryLimit) sharing operationReference's
// constraintKind vocabulary (belowMinimum/wayBelowMinimum/...) but on a
// different target, so a combined { targets, constraintKinds } rule can be
// checked for real AND semantics — see the "both axes" test below.
function threeConstrainedFieldsOp(): OperationModel {
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
        retryLimit: { type: 'integer', minimum: 5 },
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

  it('a combined targets+constraintKinds rule requires both to match (not target OR constraintKind)', () => {
    const scenarios = generateConstraintViolations([threeConstrainedFieldsOp()], {});
    const byTargetAndKind = (target: string, kind: string | undefined) =>
      scenarios.some((s) => s.target === target && s.constraintKind === kind);
    // sanity: the vocabulary overlap this test depends on actually exists
    expect(byTargetAndKind('operationReference', 'belowMinimum')).toBe(true);
    expect(byTargetAndKind('operationReference', 'wayBelowMinimum')).toBe(true);
    expect(byTargetAndKind('retryLimit', 'belowMinimum')).toBe(true);

    const rule = toScopeRule({
      kind: 'constraint-violation',
      targets: ['operationReference'],
      constraintKinds: ['belowMinimum'],
    });
    const kept = scenarios.filter((s) => !scopeRuleMatches(rule, s));

    // dropped: matches both axes
    expect(
      kept.some((s) => s.target === 'operationReference' && s.constraintKind === 'belowMinimum'),
    ).toBe(false);
    // kept: target matches but constraintKind doesn't — an accidental `||`
    // would wrongly drop this
    expect(
      kept.some((s) => s.target === 'operationReference' && s.constraintKind === 'wayBelowMinimum'),
    ).toBe(true);
    // kept: constraintKind matches but target doesn't — same check from the
    // other direction
    expect(kept.some((s) => s.target === 'retryLimit' && s.constraintKind === 'belowMinimum')).toBe(
      true,
    );
    // kept: neither axis matches
    expect(kept.some((s) => s.target === 'jobLeaseToken')).toBe(true);
  });

  it('a bare-string entry still drops every scenario of that kind (regression guard)', () => {
    const scenarios = generatePaginationLimitInvalid([paginationOp()], {});
    const rule = toScopeRule('pagination-limit-invalid');
    const kept = scenarios.filter((s) => !scopeRuleMatches(rule, s));
    expect(kept).toHaveLength(0);
  });

  it('describes a bare kind and a scoped kind for the generate.ts exclude-operations log line', () => {
    expect(describeScopeRule(toScopeRule('pagination-limit-invalid'))).toBe(
      'pagination-limit-invalid',
    );
    expect(
      describeScopeRule(
        toScopeRule({
          kind: 'pagination-limit-invalid',
          constraintKinds: ['aboveMaximum', 'wayAboveMaximum'],
        }),
      ),
    ).toBe('pagination-limit-invalid[constraintKinds=aboveMaximum|wayAboveMaximum]');
  });

  it('toScopeRule normalizes an empty targets/constraintKinds array to no filter on that axis', () => {
    // Not reachable through loadRequestValidationConfig (it rejects an empty
    // array before this), but toScopeRule is exported and called directly —
    // an empty array must not become a rule that matches nothing (#610).
    const rule = toScopeRule({ kind: 'constraint-violation', targets: [] });
    expect(rule.targets).toBeUndefined();
    expect(describeScopeRule(rule)).toBe('constraint-violation');
  });

  it('ruleMatchesAny detects a scoped rule that matches nothing (the generate.ts warning it drives)', () => {
    const scenarios = generateConstraintViolations([twoConstrainedFieldsOp()], {});

    // a real target with a typo'd/wrong-vocabulary constraintKind matches nothing
    const deadRule = toScopeRule({
      kind: 'constraint-violation',
      targets: ['operationReference'],
      constraintKinds: ['aboveMaximm'], // not a real mutation label
    });
    expect(ruleMatchesAny(deadRule, 'updateJob', scenarios)).toBe(false);

    // the same target without the bad constraintKind filter does match
    const liveRule = toScopeRule({
      kind: 'constraint-violation',
      targets: ['operationReference'],
    });
    expect(ruleMatchesAny(liveRule, 'updateJob', scenarios)).toBe(true);

    // a kind whose scenarios never set .target at all (e.g. auth-absent)
    // matches nothing for any targets filter, on any operation
    const auth = toScopeRule({ kind: 'auth-absent', targets: ['operationReference'] });
    expect(ruleMatchesAny(auth, 'updateJob', scenarios)).toBe(false);
  });
});
