import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for authHeaders() precedence rules in the env template.
 *
 * The module reads CAMUNDA_BASIC_AUTH_* at import time (credentials object),
 * so vi.resetModules() + dynamic import is required to isolate each case.
 */

const ENV_KEYS = [
  'CAMUNDA_BASIC_AUTH_USER',
  'CAMUNDA_BASIC_AUTH_PASSWORD',
  'BEARER_TOKEN',
  'RV_PROFILE',
] as const;

beforeEach(() => {
  vi.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.restoreAllMocks();
});

async function loadAuthHeaders() {
  const mod = await import('../../request-validation/templates/support/env.js');
  return mod.authHeaders;
}

describe('authHeaders() precedence', () => {
  it('returns Basic when both CAMUNDA_BASIC_AUTH_* are set', async () => {
    process.env.CAMUNDA_BASIC_AUTH_USER = 'alice';
    process.env.CAMUNDA_BASIC_AUTH_PASSWORD = 'secret';
    const authHeaders = await loadAuthHeaders();
    const encoded = Buffer.from('alice:secret').toString('base64');
    expect(authHeaders()).toEqual({ Authorization: `Basic ${encoded}` });
  });

  it('returns Bearer when only BEARER_TOKEN is set and RV_PROFILE is not rbac', async () => {
    process.env.BEARER_TOKEN = 'tok123';
    const authHeaders = await loadAuthHeaders();
    expect(authHeaders()).toEqual({ Authorization: 'Bearer tok123' });
  });

  it('returns {} when RV_PROFILE=rbac even if BEARER_TOKEN is set', async () => {
    process.env.BEARER_TOKEN = 'tok123';
    process.env.RV_PROFILE = 'rbac';
    const authHeaders = await loadAuthHeaders();
    expect(authHeaders()).toEqual({});
  });

  it('returns {} and warns exactly once when only one Basic auth var is set', async () => {
    process.env.CAMUNDA_BASIC_AUTH_USER = 'alice';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const authHeaders = await loadAuthHeaders();
    expect(authHeaders()).toEqual({});
    expect(authHeaders()).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('partial credential is ignored');
  });
});
