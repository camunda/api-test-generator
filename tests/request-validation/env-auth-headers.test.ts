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
  'RBAC_DENY_PROBE_BEARER_TOKEN',
  'RBAC_DENY_PROBE_USER',
  'RBAC_DENY_PROBE_PASSWORD',
  'CLUSTER_ADMIN_BASIC_AUTH_USER',
  'CLUSTER_ADMIN_BASIC_AUTH_PASSWORD',
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

async function loadDenyProbeHeaders() {
  const mod = await import('../../request-validation/templates/support/env.js');
  return mod.denyProbeHeaders;
}

async function loadClusterAdminAuthHeaders() {
  const mod = await import('../../request-validation/templates/support/env.js');
  return mod.clusterAdminAuthHeaders;
}

async function loadClusterAdminJsonHeaders() {
  const mod = await import('../../request-validation/templates/support/env.js');
  return mod.clusterAdminJsonHeaders;
}

describe('authHeaders() precedence', () => {
  it('returns Basic when both CAMUNDA_BASIC_AUTH_* are set', async () => {
    process.env.CAMUNDA_BASIC_AUTH_USER = 'alice';
    process.env.CAMUNDA_BASIC_AUTH_PASSWORD = 'secret';
    const authHeaders = await loadAuthHeaders();
    const encoded = Buffer.from('alice:secret').toString('base64');
    expect(authHeaders()).toEqual({ Authorization: `Basic ${encoded}` });
  });

  it('prefers Basic over BEARER_TOKEN when both Basic creds and a bearer token are set', async () => {
    process.env.CAMUNDA_BASIC_AUTH_USER = 'alice';
    process.env.CAMUNDA_BASIC_AUTH_PASSWORD = 'secret';
    process.env.BEARER_TOKEN = 'tok123';
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

describe('denyProbeHeaders() scheme selection', () => {
  it('returns Bearer from RBAC_DENY_PROBE_BEARER_TOKEN when set (all-secured / Hub mode)', async () => {
    process.env.RBAC_DENY_PROBE_BEARER_TOKEN = 'deny-tok';
    const denyProbeHeaders = await loadDenyProbeHeaders();
    expect(denyProbeHeaders()).toEqual({ Authorization: 'Bearer deny-tok' });
  });

  it('falls back to the Basic zero-grant probe user when no bearer token is set (OCA slice mode)', async () => {
    process.env.RBAC_DENY_PROBE_USER = 'probe';
    process.env.RBAC_DENY_PROBE_PASSWORD = 'pw';
    const denyProbeHeaders = await loadDenyProbeHeaders();
    const encoded = Buffer.from('probe:pw').toString('base64');
    expect(denyProbeHeaders()).toEqual({ Authorization: `Basic ${encoded}` });
  });
});

describe('clusterAdminAuthHeaders()/clusterAdminJsonHeaders() precedence', () => {
  it('returns Basic when both CLUSTER_ADMIN_BASIC_AUTH_* are set', async () => {
    process.env.CLUSTER_ADMIN_BASIC_AUTH_USER = 'cluster';
    process.env.CLUSTER_ADMIN_BASIC_AUTH_PASSWORD = 'secret';
    const clusterAdminAuthHeaders = await loadClusterAdminAuthHeaders();
    const encoded = Buffer.from('cluster:secret').toString('base64');
    expect(clusterAdminAuthHeaders()).toEqual({ Authorization: `Basic ${encoded}` });
  });

  it('returns {} when neither CLUSTER_ADMIN_BASIC_AUTH_* var is set — no Bearer fallback', async () => {
    process.env.BEARER_TOKEN = 'tok123'; // must NOT leak into the cluster-admin chain
    const clusterAdminAuthHeaders = await loadClusterAdminAuthHeaders();
    expect(clusterAdminAuthHeaders()).toEqual({});
  });

  it('returns {} and warns exactly once when only one CLUSTER_ADMIN_BASIC_AUTH_* var is set', async () => {
    process.env.CLUSTER_ADMIN_BASIC_AUTH_USER = 'cluster';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clusterAdminAuthHeaders = await loadClusterAdminAuthHeaders();
    expect(clusterAdminAuthHeaders()).toEqual({});
    expect(clusterAdminAuthHeaders()).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('partial credential is ignored');
  });

  it('does not share its partial-credential warning latch with authHeaders()', async () => {
    process.env.CAMUNDA_BASIC_AUTH_USER = 'alice'; // partial regular-admin creds
    process.env.CLUSTER_ADMIN_BASIC_AUTH_USER = 'cluster'; // partial cluster-admin creds
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('../../request-validation/templates/support/env.js');
    expect(mod.authHeaders()).toEqual({});
    expect(mod.clusterAdminAuthHeaders()).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('clusterAdminJsonHeaders adds Content-Type and reuses clusterAdminAuthHeaders', async () => {
    process.env.CLUSTER_ADMIN_BASIC_AUTH_USER = 'cluster';
    process.env.CLUSTER_ADMIN_BASIC_AUTH_PASSWORD = 'secret';
    const clusterAdminJsonHeaders = await loadClusterAdminJsonHeaders();
    const encoded = Buffer.from('cluster:secret').toString('base64');
    expect(clusterAdminJsonHeaders()).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Basic ${encoded}`,
    });
  });

  it('clusterAdminJsonHeaders is Content-Type-only when no credentials are set', async () => {
    const clusterAdminJsonHeaders = await loadClusterAdminJsonHeaders();
    expect(clusterAdminJsonHeaders()).toEqual({ 'Content-Type': 'application/json' });
  });
});
