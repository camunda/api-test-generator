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

// All-secured mode (authDenyMode: 'all-secured', e.g. Hub): one 403 per secured
// op with dummy keys, no SLICE, no fixtures. Targets the same `secured` field the
// 401 generators use, so the 403 surface lines up with the 401 surface.
const securedOps: OperationModel[] = [
  // secured reads/writes across methods — all targeted.
  {
    operationId: 'getProject',
    method: 'GET',
    path: '/projects/{projectKey}',
    tags: [],
    parameters: [],
    secured: true,
  },
  {
    operationId: 'searchProjects',
    method: 'POST',
    path: '/projects/search',
    tags: [],
    parameters: [],
    secured: true,
  },
  {
    operationId: 'createProject',
    method: 'POST',
    path: '/projects',
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
  it('emits one 403 scenario per secured op (any method), excluding public/unannotated ops', () => {
    const scenarios = generateAuthDeny(securedOps, { allSecured: true });
    expect(scenarios.map((s) => s.operationId).sort()).toEqual(
      ['createProject', 'deleteProject', 'getProject', 'searchProjects', 'updateProject'].sort(),
    );
  });

  it('each scenario is a strict 403 deny with dummy keys and no admin auth', () => {
    for (const s of generateAuthDeny(securedOps, { allSecured: true })) {
      expect(s.type).toBe('auth-deny');
      expect(s.expectedStatus).toBe(403);
      expect(s.headersAuth).toBe(false);
      // path tokens resolve to the fixed dummy value; tokenless paths get none.
      for (const v of Object.values(s.params ?? {})) expect(v).toBe('x');
    }
  });

  it('substitutes a dummy value for each path token; tokenless ops get no params', () => {
    const byId = Object.fromEntries(
      generateAuthDeny(securedOps, { allSecured: true }).map((s) => [s.operationId, s]),
    );
    expect(byId.getProject.params).toEqual({ projectKey: 'x' });
    expect(byId.createProject.params).toBeUndefined();
  });

  it('honours the onlyOperations filter', () => {
    const scenarios = generateAuthDeny(securedOps, {
      allSecured: true,
      onlyOperations: new Set(['deleteProject']),
    });
    expect(scenarios.map((s) => s.operationId)).toEqual(['deleteProject']);
  });

  it('does NOT use the OCA slice in all-secured mode (slice ops without `secured` are skipped)', () => {
    // `ops` (the slice fixtures) carry no `secured` field, so all-secured emits nothing for them.
    expect(generateAuthDeny(ops, { allSecured: true })).toHaveLength(0);
  });
});
