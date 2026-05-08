import { describe, expect, it } from 'vitest';
import { renderScenarioForTest } from '../../request-validation/src/emit/qaEmitter.js';
import type { ValidationScenario } from '../../request-validation/src/model/types.js';

/**
 * Layer-2 fixture for issue #127.
 *
 * `buildUrl(path, pathParams, queryParams)` substitutes only those entries
 * in `pathParams` whose key matches a `{token}` in `path`. Anything else
 * is silently dropped. The emitter previously rendered every value of
 * `s.params` into the second arg, so query-parameter `param-*` scenarios
 * dropped their value from the request, the server defaulted it, and the
 * test saw 200 instead of the asserted 400.
 *
 * Class of defect: any scenario where `s.params` includes keys that are
 * NOT path tokens of `s.path`. Those keys are query (or header) params
 * and must be passed as the third `buildUrl` argument.
 *
 * Reference: camunda/api-test-generator#127.
 *
 * Note: `renderScenario` emits JSON.stringify literals (double quotes);
 * Prettier rewrites those to single quotes on the file-level emission
 * pipeline, so these regexes match the pre-Prettier shape.
 */

function buildScenario(overrides: Partial<ValidationScenario> = {}): ValidationScenario {
  return {
    id: 'test',
    operationId: 'searchVariables',
    method: 'POST',
    path: '/variables/search',
    type: 'param-type-mismatch',
    target: 'query.truncateValues',
    expectedStatus: 400,
    description: 'Type mismatch for query parameter truncateValues',
    headersAuth: true,
    source: 'query',
    ...overrides,
  };
}

describe('request-validation: query-param buildUrl-slot guard (#127)', () => {
  it('reproducer: searchVariables truncateValues lands in the query slot, not the path slot', () => {
    const s = buildScenario({ params: { truncateValues: 'notBoolean' } });
    const out = renderScenarioForTest(s, 'searchVariables - Param query.truncateValues wrong type');
    const buildUrlCall = out.match(/buildUrl\([^;]+\)/)?.[0] ?? '';
    expect(buildUrlCall, 'no buildUrl call rendered').toMatch(/buildUrl\(/);
    // The path-params slot for a tokenless template must be `undefined` or
    // `{}` — never a record carrying the query key. The query key must
    // appear in the third (query) slot.
    expect(
      buildUrlCall,
      'query-param value must be in the query (3rd) slot, not the path-params (2nd) slot',
    ).toMatch(/,\s*(undefined|\{\s*\})\s*,\s*\{[^}]*"truncateValues":\s*"notBoolean"/);
  });

  it('class-scoped: mixed path-token + query-key scenario splits across slots', () => {
    // /groups/{groupId}/users/search with a tokenless query param.
    // pathParams slot must contain only `groupId`; query slot must contain
    // only `pageSize`. Catches sibling defects where any non-path key
    // accidentally lands in the path-params slot.
    const s = buildScenario({
      operationId: 'searchUsersForGroup',
      method: 'POST',
      path: '/groups/{groupId}/users/search',
      params: { groupId: 'g1', pageSize: 'NaNValue' },
      target: 'query.pageSize',
    });
    const out = renderScenarioForTest(s, 'searchUsersForGroup - Param query.pageSize wrong type');
    const buildUrlCall = out.match(/buildUrl\([^;]+\)/)?.[0] ?? '';
    // groupId stays in path-params slot (slot 2).
    expect(buildUrlCall).toMatch(
      /buildUrl\("\/groups\/\{groupId\}\/users\/search",\s*\{[^}]*"groupId":/,
    );
    // pageSize moves to query slot (slot 3).
    expect(buildUrlCall).toMatch(/,\s*\{[^}]*"pageSize":\s*"NaNValue"[^}]*\}\s*\)$/);
    // pageSize must NOT appear in the path-params slot.
    const pathParamsLiteral = buildUrlCall.match(/buildUrl\("[^"]+",\s*(\{[^}]*\})/)?.[1] ?? '';
    expect(pathParamsLiteral).not.toContain('pageSize');
  });

  it('regression guard: pure path-param scenarios still emit in the path-params slot', () => {
    // Issue #127's fix must not break path-param scenarios (the only ones
    // whose values genuinely belong in slot 2). Catches over-eager fixes
    // that move every param into slot 3.
    const s = buildScenario({
      operationId: 'getGroup',
      method: 'GET',
      path: '/groups/{groupId}',
      params: { groupId: 'aaaaaaaaa' },
      target: 'path.groupId',
      type: 'param-constraint-violation',
      source: 'path',
    });
    const out = renderScenarioForTest(s, 'getGroup - Path param groupId length-max violation');
    const buildUrlCall = out.match(/buildUrl\([^;]+\)/)?.[0] ?? '';
    expect(buildUrlCall).toMatch(
      /buildUrl\("\/groups\/\{groupId\}",\s*\{[^}]*"groupId":\s*"aaaaaaaaa"[^}]*\}/,
    );
    // groupId must not also appear in a third arg.
    expect(buildUrlCall).not.toMatch(/,\s*\{[^}]*"groupId":[^}]*\}\s*,\s*\{[^}]*"groupId"/);
  });
});
