import { describe, expect, it } from 'vitest';
import { generateParamConstraintViolations } from '../../request-validation/src/analysis/paramConstraintViolations.js';
import type { OperationModel, ParameterModel } from '../../request-validation/src/model/types.js';

/**
 * Layer-2 fixture for issue #147.
 *
 * `generateParamConstraintViolations` synthesises invalid values for path
 * parameters that are then substituted into the operation's path template
 * by the test scaffold. If the synthesised value does not survive URL
 * substitution as a single non-empty path segment (empty string, slash, dot,
 * percent-encoded slash, etc.), the resulting URL has a different shape from
 * the operation's contract — Spring's router resolves it as a different
 * route and answers 404 from a static-resource handler. The 400 expectation
 * is then unmet for a reason unrelated to validation, producing a noisy
 * false-fail.
 *
 * Concrete trigger: `minLength: 1` produces `tooShort = 'a'.repeat(0)` =
 * `''`. Substituted into `/v2/roles/{roleId}/groups/{groupId}` you get
 * `/v2/roles/x/groups/`, which Spring serves through the static-resource
 * handler with `404 No static resource v2/roles/x/groups`. (PR #148 review:
 * the synthesis was previously `''.padEnd(N, '')`, which is a no-op for
 * any `N`; it is now `'a'.repeat(N - 1)`, which still yields `''` for
 * `minLength: 1` but produces a non-empty shorter value for
 * `minLength > 1`.)
 *
 * The class-scoped guard asserts that **no** emitted path-param constraint
 * scenario carries a value that would change the URL shape after raw
 * substitution — empty, `.`, `..`, or containing any routing-significant
 * character (`/`, `\`, `?`, `#`) or already-encoded separator (`%2F`,
 * `%5C`). This protects against the four sibling causes (length, pattern,
 * enum, and any future synthesiser) with one assertion. PR #148 review:
 * the predicate must check the *raw* value as well, because `buildUrl()`
 * substitutes path params without encoding.
 */

function buildPathParam(name: string, schema: ParameterModel['schema']): ParameterModel {
  return { name, in: 'path', required: true, schema };
}

function buildOp(path: string, parameters: ParameterModel[]): OperationModel {
  return {
    operationId: 'pathParamProbe',
    method: 'DELETE',
    path,
    tags: [],
    parameters,
  };
}

function isUrlCollapsing(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length === 0) return true;
  if (value === '.' || value === '..') return true;
  // Raw routing-significant characters (no encoding by buildUrl).
  if (/[/\\?#]/.test(value)) return true;
  // Already-encoded segment splitters in the supplied value.
  if (/%2f|%5c/i.test(value)) return true;
  // Defence in depth: canonical encoding contains a separator.
  const encoded = encodeURIComponent(value);
  if (/%2f|%5c/i.test(encoded)) return true;
  return false;
}

describe('request-validation: path-param URL-collapse guard (#147)', () => {
  it('does not emit empty-string violator for minLength:1 on path params', () => {
    // Mirrors the unassignRoleFromGroup failure: `groupId` has minLength: 1.
    // The only "shorter than 1" value is the empty string, which collapses
    // the URL into a different route. The scenario must be elided.
    const op = buildOp('/v2/roles/{roleId}/groups/{groupId}', [
      buildPathParam('roleId', { type: 'string', pattern: '^[a-z]+$' }),
      buildPathParam('groupId', { type: 'string', minLength: 1, maxLength: 256 }),
    ]);

    const scenarios = generateParamConstraintViolations([op], {});

    const groupIdScenarios = scenarios.filter(
      (s) => s.type === 'param-constraint-violation' && s.target === 'path.groupId',
    );
    const offending = groupIdScenarios.filter((s) => s.params?.groupId === '');
    expect(offending).toEqual([]);
  });

  it('does not emit any URL-collapsing path-param violator across all constraint kinds', () => {
    // Class-scoped: covers length-min, length-max, pattern, and enum.
    //
    // Note that pattern-mismatch synthesis for `in: 'path'` already passes
    // `pathSegmentSafe: true` to `buildGuaranteedPatternMismatch`, which
    // filters `/` and `\` at the synthesis layer. The pattern cases here
    // therefore exercise the helper boundary (the synthesiser may still
    // legitimately pick `.` or `..` for `^[^.]+$`); the empty-string is
    // produced by `length-min`. The `accept()` filter in
    // `paramConstraintViolations` is the second line of defence and the
    // one this guard locks in: any future synthesiser (or relaxed
    // `pathSegmentSafe` setting) cannot emit a URL-collapsing value
    // without this test failing.
    const op = buildOp('/v2/a/{slashy}/b/{dotty}/c/{lengthy}/d/{enummy}/e', [
      buildPathParam('slashy', { type: 'string', pattern: '^[^.]+$' }),
      buildPathParam('dotty', { type: 'string', pattern: '^[^/]+$' }),
      buildPathParam('lengthy', { type: 'string', minLength: 1 }),
      buildPathParam('enummy', { type: 'string', enum: ['ok'] }),
    ]);

    const scenarios = generateParamConstraintViolations([op], {});

    const offending: { target?: string; value: unknown }[] = [];
    for (const s of scenarios) {
      if (s.type !== 'param-constraint-violation') continue;
      if (s.source !== 'path') continue;
      // Identify which param this scenario violates from `target`.
      const paramName = s.target?.split('.')[1];
      if (!paramName) continue;
      const value = s.params?.[paramName];
      if (isUrlCollapsing(value)) offending.push({ target: s.target, value });
    }

    expect(offending).toEqual([]);
  });

  it('does not regress: query-param empty-string violators are still emitted', () => {
    // Query params are *not* substituted into the URL path, so an empty
    // value is a legitimate validator probe (`?q=`). The guard must apply
    // to path params only.
    const op: OperationModel = {
      operationId: 'queryParamProbe',
      method: 'GET',
      path: '/v2/things',
      tags: [],
      parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 1 } },
      ],
    };

    const scenarios = generateParamConstraintViolations([op], {});
    const queryScenarios = scenarios.filter(
      (s) => s.source === 'query' && s.target === 'query.q' && s.constraintKind === 'length-min',
    );
    expect(queryScenarios.length).toBeGreaterThan(0);
  });

  it('emits genuinely-too-short values for minLength > 1 (PR #148 review)', () => {
    // Class-scoped guard: previously `tooShort = ''.padEnd(N, '')` returned
    // the empty string for ANY `minLength > 0`, because `padEnd` with an
    // empty pad string is a no-op. That meant every `length-min` path-param
    // scenario was elided by the URL-collapse filter, even when a non-empty
    // shorter value existed (e.g. `'aa'` for `minLength: 3`). The fix
    // synthesises `'a'.repeat(minLength - 1)` so we exercise the validator
    // on a real shorter-than-allowed value; only `minLength: 1` (whose
    // shorter value is `''`) remains elided.
    //
    // Assert both sides of the boundary: `minLength: 3` → `'aa'` survives;
    // `minLength: 1` → `''` is correctly elided.
    const op = buildOp('/v2/a/{three}/b/{one}', [
      buildPathParam('three', { type: 'string', minLength: 3 }),
      buildPathParam('one', { type: 'string', minLength: 1 }),
    ]);

    const scenarios = generateParamConstraintViolations([op], {});
    const lengthMin = scenarios.filter(
      (s) => s.type === 'param-constraint-violation' && s.constraintKind === 'length-min',
    );

    const threeScenarios = lengthMin.filter((s) => s.target === 'path.three');
    expect(threeScenarios).toHaveLength(1);
    expect(threeScenarios[0].params?.three).toBe('aa');

    const oneScenarios = lengthMin.filter((s) => s.target === 'path.one');
    expect(oneScenarios).toEqual([]);
  });
});
