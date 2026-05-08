import { describe, expect, it } from 'vitest';
import { generateEnumViolations } from '../../request-validation/src/analysis/enumViolations.js';
import type { OperationModel } from '../../request-validation/src/model/types.js';

/**
 * Layer-2 fixture for issue #129.
 *
 * The negative-test generator emits, for every string-enum field, three
 * mutations: a `${value}_INVALID` suffix variant, an UPPER variant, and a
 * lower variant. The latter two are case-only mutations (they differ from a
 * valid enum member only by ASCII case) and are false 400-expecting tests
 * for any API whose parser accepts enums case-insensitively (the upstream
 * Camunda 8 OCA parser does — see camunda/camunda#52409).
 *
 * The new `enumCaseInsensitive` request-validation config lets the
 * generator skip those case-only mutations. This file pins both directions:
 *
 *   - default (false)  → at least one case-only mutation per
 *                        mixed/lower-case enum value is emitted.
 *   - explicit (true)  → zero case-only mutations across the entire
 *                        emitted scenario set, but suffix mutations and
 *                        non-string `__INVALID_ENUM__` mutations remain.
 *
 * The "true" assertion is class-scoped: it scans every emitted scenario
 * (any ScenarioKind that runs through generateEnumViolations) and rejects
 * any value that case-collides with the source enum. This guards against
 * regressions where a sibling code path (e.g. the oneOf fallback walker)
 * grows its own case mutation in the future.
 */

function buildOp(enumMembers: readonly string[]): OperationModel {
  return {
    operationId: 'enumCaseProbe',
    method: 'POST',
    path: '/probe',
    tags: [],
    bodyRequired: true,
    requiredProps: ['flag'],
    requestBodySchema: {
      type: 'object',
      required: ['flag'],
      properties: {
        flag: { type: 'string', enum: [...enumMembers] },
      },
    },
    parameters: [],
  };
}

function isCaseOnly(value: unknown, members: readonly string[]): boolean {
  if (typeof value !== 'string') return false;
  if (members.includes(value)) return false;
  const lower = value.toLowerCase();
  return members.some((m) => m.toLowerCase() === lower);
}

function isSuffixMutation(value: unknown, members: readonly string[]): boolean {
  return typeof value === 'string' && members.some((m) => value === `${m}_INVALID`);
}

function extractFlag(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  if (!('flag' in body)) return undefined;
  return body.flag;
}

describe('request-validation: enumCaseInsensitive flag (#129)', () => {
  // `Foo` is mixed-case so both upper (`FOO`) and lower (`foo`) variants
  // are case-only mutations the generator currently emits as 400-expecting
  // tests against `enum[0]`.
  const MEMBERS = ['Foo', 'bar'] as const;

  it('emits >=2 case-only mutations when enumCaseInsensitive is false (default)', () => {
    const op = buildOp(MEMBERS);
    const scenarios = generateEnumViolations([op], {});
    const offendingValues = scenarios
      .map((s) => extractFlag(s.requestBody))
      .filter((v) => isCaseOnly(v, [...MEMBERS]));
    expect(offendingValues.length).toBeGreaterThanOrEqual(2);
  });

  it('emits 0 case-only mutations when enumCaseInsensitive is true', () => {
    const op = buildOp(MEMBERS);
    const scenarios = generateEnumViolations([op], { enumCaseInsensitive: true });
    const offendingValues = scenarios
      .map((s) => extractFlag(s.requestBody))
      .filter((v) => isCaseOnly(v, [...MEMBERS]));
    expect(offendingValues).toEqual([]);
  });

  it('still emits suffix mutations when enumCaseInsensitive is true', () => {
    const op = buildOp(MEMBERS);
    const scenarios = generateEnumViolations([op], { enumCaseInsensitive: true });
    const suffixValues = scenarios
      .map((s) => extractFlag(s.requestBody))
      .filter((v) => isSuffixMutation(v, [...MEMBERS]));
    expect(suffixValues.length).toBeGreaterThan(0);
  });

  it('does not skip non-case mutations of non-string enums', () => {
    // Numeric enums fall through buildInvalidVariants's else-branch and
    // emit `__INVALID_ENUM__` regardless of the flag.
    const op: OperationModel = {
      operationId: 'numericEnumProbe',
      method: 'POST',
      path: '/probe',
      tags: [],
      bodyRequired: true,
      requiredProps: ['n'],
      requestBodySchema: {
        type: 'object',
        required: ['n'],
        properties: { n: { type: 'integer', enum: [1, 2, 3] } },
      },
      parameters: [],
    };
    const scenarios = generateEnumViolations([op], { enumCaseInsensitive: true });
    expect(scenarios.length).toBeGreaterThan(0);
  });
});
