import { describe, expect, it } from 'vitest';
import { generateAuthDeny } from '../../request-validation/src/analysis/authDeny.js';
import { renderScenarioForTest } from '../../request-validation/src/emit/qaEmitter.js';
import type { OperationModel } from '../../request-validation/src/model/types.js';

/**
 * Guards the read-side RBAC deny (HTTP 403) feature — generic vertical slice (#359).
 *
 * Analysis: only the slice-allowlisted get-by-key read op (`getUser`) yields an
 *   `auth-deny` scenario, with a known-existing key and a 403 expectation.
 * Emitter: an auth-deny scenario authenticates as the zero-grant probe user
 *   (`denyProbeHeaders()`), never the admin (`authHeaders()`/`jsonHeaders()`),
 *   and asserts the deny status.
 */

const ops: OperationModel[] = [
  { operationId: 'getUser', method: 'GET', path: '/users/{username}', tags: [], parameters: [] },
  // A get-by-key read NOT in the slice allowlist — must be skipped for now (#373).
  { operationId: 'getGroup', method: 'GET', path: '/groups/{groupId}', tags: [], parameters: [] },
  // A write op — never an auth-deny target.
  { operationId: 'createUser', method: 'POST', path: '/users', tags: [], parameters: [] },
];

describe('request-validation: auth-deny analysis (#359)', () => {
  it('emits one auth-deny scenario for the slice-allowlisted getUser only', () => {
    const scenarios = generateAuthDeny(ops, {});
    expect(scenarios.map((s) => s.operationId)).toEqual(['getUser']);
  });

  it('the getUser scenario is a 403 deny on a known-existing key', () => {
    const [s] = generateAuthDeny(ops, {});
    expect(s.type).toBe('auth-deny');
    expect(s.expectedStatus).toBe(403);
    expect(s.method).toBe('GET');
    expect(s.params).toEqual({ username: 'demo' });
  });

  it('honours the onlyOperations filter', () => {
    expect(generateAuthDeny(ops, { onlyOperations: new Set(['getGroup']) })).toHaveLength(0);
    expect(generateAuthDeny(ops, { onlyOperations: new Set(['getUser']) })).toHaveLength(1);
  });
});

describe('request-validation: auth-deny emitter shape (#359)', () => {
  it('authenticates as the probe user (denyProbeHeaders), never the admin, and asserts the deny status', () => {
    const [s] = generateAuthDeny(ops, {});
    const rendered = renderScenarioForTest(s, 'getUser - Denied (no permission)');
    expect(rendered).toContain('headers: denyProbeHeaders()');
    expect(rendered).not.toContain('authHeaders()');
    expect(rendered).not.toContain('jsonHeaders()');
    expect(rendered).not.toContain('headers: {}');
    expect(rendered).toContain('assertResponseStatus(testInfo, res, 403');
  });
});
