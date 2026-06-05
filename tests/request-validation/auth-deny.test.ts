import { describe, expect, it } from 'vitest';
import { generateAuthDeny } from '../../request-validation/src/analysis/authDeny.js';
import { renderScenarioForTest } from '../../request-validation/src/emit/qaEmitter.js';
import type { OperationModel } from '../../request-validation/src/model/types.js';

/**
 * Guards the read-side RBAC deny (HTTP 403) feature.
 *
 * Analysis: each slice-allowlisted get-by-key read yields an `auth-deny`
 *   scenario with a known-existing key and a strict 403 expectation.
 *   Non-allowlisted reads and write ops yield nothing.
 * Emitter: an auth-deny scenario authenticates as the zero-grant probe user
 *   (`denyProbeHeaders()`), never the admin (`authHeaders()`/`jsonHeaders()`),
 *   and asserts 403.
 */

const SLICE_OPS = [
  'getUser',
  'getTenant',
  'getGroup',
  'getRole',
  'getMappingRule',
  'getGlobalClusterVariable',
];

const ops: OperationModel[] = [
  { operationId: 'getUser', method: 'GET', path: '/users/{username}', tags: [], parameters: [] },
  {
    operationId: 'getTenant',
    method: 'GET',
    path: '/tenants/{tenantId}',
    tags: [],
    parameters: [],
  },
  { operationId: 'getGroup', method: 'GET', path: '/groups/{groupId}', tags: [], parameters: [] },
  { operationId: 'getRole', method: 'GET', path: '/roles/{roleId}', tags: [], parameters: [] },
  {
    operationId: 'getMappingRule',
    method: 'GET',
    path: '/mapping-rules/{mappingRuleId}',
    tags: [],
    parameters: [],
  },
  {
    operationId: 'getGlobalClusterVariable',
    method: 'GET',
    path: '/cluster-variables/global/{name}',
    tags: [],
    parameters: [],
  },
  // A get-by-key read NOT in the slice (server-minted key, deferred) — skipped.
  {
    operationId: 'getAuthorization',
    method: 'GET',
    path: '/authorizations/{authorizationKey}',
    tags: [],
    parameters: [],
  },
  // A write op — never an auth-deny target.
  { operationId: 'createUser', method: 'POST', path: '/users', tags: [], parameters: [] },
];

describe('request-validation: auth-deny analysis', () => {
  it('emits an auth-deny scenario for each slice-allowlisted get-by-key read only', () => {
    const scenarios = generateAuthDeny(ops, {});
    expect(scenarios.map((s) => s.operationId).sort()).toEqual([...SLICE_OPS].sort());
  });

  it('each scenario is a strict 403 deny on a known-existing key', () => {
    for (const s of generateAuthDeny(ops, {})) {
      expect(s.type).toBe('auth-deny');
      expect(s.expectedStatus).toBe(403);
      expect(s.method).toBe('GET');
      expect(s.headersAuth).toBe(false);
      // params resolve the single path token to a fixed, provisioned id.
      expect(Object.keys(s.params ?? {})).toHaveLength(1);
    }
  });

  it('uses the always-present demo user for getUser', () => {
    const u = generateAuthDeny(ops, { onlyOperations: new Set(['getUser']) })[0];
    expect(u.params).toEqual({ username: 'demo' });
  });

  it('skips non-allowlisted reads and honours the onlyOperations filter', () => {
    expect(generateAuthDeny(ops, { onlyOperations: new Set(['getAuthorization']) })).toHaveLength(
      0,
    );
    expect(generateAuthDeny(ops, { onlyOperations: new Set(['getTenant']) })).toHaveLength(1);
  });
});

describe('request-validation: auth-deny emitter shape', () => {
  it('authenticates as the probe user (denyProbeHeaders), never the admin, and asserts 403', () => {
    const u = generateAuthDeny(ops, { onlyOperations: new Set(['getUser']) })[0];
    const rendered = renderScenarioForTest(u, 'getUser - Denied (no permission)');
    expect(rendered).toContain('headers: denyProbeHeaders()');
    expect(rendered).not.toContain('authHeaders()');
    expect(rendered).not.toContain('jsonHeaders()');
    expect(rendered).not.toContain('headers: {}');
    expect(rendered).toContain('assertResponseStatus(testInfo, res, 403');
  });
});
