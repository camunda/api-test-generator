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
  'getGlobalTaskListener',
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
  {
    operationId: 'getGlobalTaskListener',
    method: 'GET',
    path: '/global-task-listeners/{id}',
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

// All-secured mode (authDenyMode: 'all-secured', e.g. Hub): 403 per keyless,
// no-required-body secured op. Hub's check order is 400 → 404 → 403, so:
//   - by-key ops (path has {param}) → 404 with dummy key → excluded
//   - required-body ops (bodyRequired: true) → 400 before @PreAuthorize → excluded
// Only search/list/info ops (keyless + optional body) can yield a clean 403.
const securedOps: OperationModel[] = [
  // keyless, no required body — the only category that reaches authz → included.
  {
    operationId: 'searchProjects',
    method: 'POST',
    path: '/projects/search',
    tags: [],
    parameters: [],
    secured: true,
  },
  // by-key op (path param) → resource lookup fires before @PreAuthorize → excluded.
  {
    operationId: 'getProject',
    method: 'GET',
    path: '/projects/{projectKey}',
    tags: [],
    parameters: [],
    secured: true,
  },
  {
    operationId: 'updateProject',
    method: 'PATCH',
    path: '/projects/{projectKey}',
    tags: [],
    parameters: [],
    secured: true,
  },
  {
    operationId: 'deleteProject',
    method: 'DELETE',
    path: '/projects/{projectKey}',
    tags: [],
    parameters: [],
    secured: true,
  },
  // required body → body-validation (400) fires before @PreAuthorize → excluded.
  {
    operationId: 'createProject',
    method: 'POST',
    path: '/projects',
    tags: [],
    parameters: [],
    secured: true,
    bodyRequired: true,
  },
  // public op (security: [] or anonymous {}) — secured:false → never a deny target.
  {
    operationId: 'getHealth',
    method: 'GET',
    path: '/health',
    tags: [],
    parameters: [],
    secured: false,
  },
  // unannotated op (no `secured` field) — excluded (only `secured === true` qualifies).
  { operationId: 'getMeta', method: 'GET', path: '/meta', tags: [], parameters: [] },
];

describe('request-validation: auth-deny all-secured mode', () => {
  it('emits one 403 scenario per keyless no-required-body secured op', () => {
    const scenarios = generateAuthDeny(securedOps, { allSecured: true });
    expect(scenarios.map((s) => s.operationId)).toEqual(['searchProjects']);
  });

  it('excludes by-key ops (path param → 404 before authz)', () => {
    const ids = generateAuthDeny(securedOps, { allSecured: true }).map((s) => s.operationId);
    expect(ids).not.toContain('getProject');
    expect(ids).not.toContain('updateProject');
    expect(ids).not.toContain('deleteProject');
  });

  it('excludes required-body ops (body validation → 400 before authz)', () => {
    const ids = generateAuthDeny(securedOps, { allSecured: true }).map((s) => s.operationId);
    expect(ids).not.toContain('createProject');
  });

  it('each scenario is a strict 403 deny with no params and no admin auth', () => {
    for (const s of generateAuthDeny(securedOps, { allSecured: true })) {
      expect(s.type).toBe('auth-deny');
      expect(s.expectedStatus).toBe(403);
      expect(s.headersAuth).toBe(false);
      expect(s.params).toBeUndefined();
    }
  });

  it('honours the onlyOperations filter', () => {
    const scenarios = generateAuthDeny(securedOps, {
      allSecured: true,
      onlyOperations: new Set(['searchProjects']),
    });
    expect(scenarios.map((s) => s.operationId)).toEqual(['searchProjects']);
  });

  it('does NOT use the OCA slice in all-secured mode (slice ops without `secured` are skipped)', () => {
    // `ops` (the slice fixtures) carry no `secured` field, so all-secured emits nothing for them.
    expect(generateAuthDeny(ops, { allSecured: true })).toHaveLength(0);
  });
});
