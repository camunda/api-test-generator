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
 * Concrete trigger: `minLength: 1` produces `tooShort = ''.padEnd(0)` = `''`.
 * Substituted into `/v2/roles/{roleId}/groups/{groupId}` you get
 * `/v2/roles/x/groups/`, which Spring serves through the static-resource
 * handler with `404 No static resource v2/roles/x/groups`.
 *
 * The class-scoped guard asserts that **no** emitted path-param constraint
 * scenario carries a value that collapses the URL — empty, `.`, `..`, or
 * containing a `/` (or `%2F`/`%2f`) after percent-encoding. This protects
 * against four sibling causes (length, slash-permitting pattern,
 * dot-permitting pattern, and encoded slash) with one assertion.
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
  const encoded = encodeURIComponent(value);
  if (encoded.includes('%2F') || encoded.includes('%2f')) return true;
  if (encoded.includes('%5C') || encoded.includes('%5c')) return true;
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
    // The pattern below admits `/` (the inverted character class is a
    // single non-`.` character; the pattern-mismatch helper is free to pick
    // a slash). Likewise the enum is open-ended. The guard must filter any
    // emitted invalid that, post-substitution, would not be a single
    // non-empty path segment.
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
});
