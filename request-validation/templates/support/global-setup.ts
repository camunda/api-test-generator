/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH under
 * one or more contributor license agreements. See the NOTICE file distributed
 * with this work for additional information regarding copyright ownership.
 * Licensed under the Camunda License 1.0. You may not use this file
 * except in compliance with the Camunda License 1.0.
 */

// Vendored support file. Provisions the read-side RBAC deny-test fixtures:
//   1. a probe user — a non-admin user with NO authorization grants; the `rbac`
//      profile's deny-tests authenticate as it (denyProbeHeaders()) so an
//      authorizations-enabled server rejects the request.
//   2. one instance of each get-by-key resource the deny-tests target, created
//      as admin with a fixed id. These exist purely so the probe's read has a
//      real target — making its failure a genuine authorization denial (admin
//      would see the resource at 200) rather than a 404-not-found. They carry no
//      grants. The fixed ids MUST match the auth-deny allowlist in the
//      api-test-generator that emitted this suite (its authDeny analysis pass).
//
// Runs only for the `rbac` profile (gated on RV_PROFILE); a no-op otherwise, so
// the unsecured/secured suites are unaffected. All creates are idempotent — an
// already-existing resource (HTTP 409) is treated as success.

import { authHeaders, basicAuthHeaders, credentials, denyProbeCredentials } from './env';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** POST a create body as admin; accept any 2xx (create endpoints return
 *  200/201/204) or 409 (already exists from a prior run) as success. */
async function provision(
  label: string,
  path: string,
  body: unknown,
  admin: Record<string, string>,
): Promise<number> {
  const res = await fetch(`${credentials.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...admin },
    body: JSON.stringify(body),
  });
  // Any 2xx (create endpoints variously return 200/201/204) or 409 (already
  // exists from a prior run) is success.
  if (!res.ok && res.status !== 409) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[rbac global-setup] failed to provision ${label}: HTTP ${res.status} ${text.slice(0, 300)}`,
    );
  }
  return res.status;
}

// Get-by-key resources the deny-tests fetch — created with the fixed ids the
// generator's auth-deny allowlist references. Created as admin, no grants.
const FIXTURES: ReadonlyArray<{ label: string; path: string; body: unknown }> = [
  { label: 'tenant', path: '/v2/tenants', body: { tenantId: 'rbac-probe-tenant', name: 'RBAC Probe Tenant' } },
  { label: 'group', path: '/v2/groups', body: { groupId: 'rbac-probe-group', name: 'RBAC Probe Group' } },
  { label: 'role', path: '/v2/roles', body: { roleId: 'rbac-probe-role', name: 'RBAC Probe Role' } },
  {
    label: 'mapping-rule',
    path: '/v2/mapping-rules',
    body: {
      mappingRuleId: 'rbac-probe-mapping',
      claimName: 'rbac-probe-claim',
      claimValue: 'rbac-probe-value',
      name: 'RBAC Probe Mapping',
    },
  },
  {
    label: 'cluster-variable',
    path: '/v2/cluster-variables/global',
    body: { name: 'rbac-probe-clustervar', value: 'rbac-probe' },
  },
  {
    label: 'global-task-listener',
    path: '/v2/global-task-listeners',
    body: { id: 'rbac-probe-gtl', type: 'rbac-probe-listener', eventTypes: ['all'] },
  },
];

async function globalSetup(): Promise<void> {
  if (process.env.RV_PROFILE !== 'rbac') return;

  const admin = authHeaders();
  if (!admin.Authorization) {
    throw new Error(
      '[rbac global-setup] No admin credentials. Set CAMUNDA_BASIC_AUTH_USER / CAMUNDA_BASIC_AUTH_PASSWORD ' +
        'so the probe user and fixtures can be provisioned.',
    );
  }

  // 1. Get-by-key target resources (existence makes the probe's read a real deny).
  for (const f of FIXTURES) {
    await provision(f.label, f.path, f.body, admin);
  }

  // 2. The zero-grant probe user.
  const { username, password } = denyProbeCredentials;
  const res = await fetch(`${credentials.baseUrl}/v2/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...admin },
    body: JSON.stringify({
      username,
      password,
      name: 'RBAC Deny Probe',
      email: `${username}@example.com`,
    }),
  });

  // 201 created, or 409 (already exists from a prior run) — both fine. The probe
  // is created with no role/authorization, so under authorizations it is denied
  // everything: exactly the zero-grant principal the deny-tests need.
  if (res.status !== 201 && res.status !== 409) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `[rbac global-setup] failed to provision probe user '${username}': HTTP ${res.status} ${body.slice(0, 300)}`,
    );
  }

  // A freshly-created user is not usable for basic auth immediately — the record
  // propagates to the auth store with a short lag. Until then it returns 401
  // (not authenticated) rather than the intended 403 (authenticated-but-denied),
  // which would flake the deny-tests. Poll an unauthZ-gated endpoint (topology)
  // as the probe until it authenticates (200) before letting tests run.
  const probe = basicAuthHeaders(username, password);
  const deadlineMs = Date.now() + 60_000;
  for (let attempt = 1; ; attempt++) {
    const ping = await fetch(`${credentials.baseUrl}/v2/topology`, { headers: probe }).catch(
      () => undefined,
    );
    if (ping?.status === 200) {
      console.log(
        `[rbac global-setup] probe user '${username}' ready (created HTTP ${res.status}, authenticated after ${attempt} check(s))`,
      );
      return;
    }
    if (Date.now() > deadlineMs) {
      // A 409 on create means the user pre-existed; if it was created with a
      // different password, basic auth will never succeed and the poll just
      // times out. Surface that as the likely cause.
      const hint =
        res.status === 409
          ? ` The probe user already existed (create returned HTTP 409); if it was provisioned with a different password, ` +
            `set RBAC_DENY_PROBE_PASSWORD to match the existing user (or delete the user and re-run).`
          : '';
      throw new Error(
        `[rbac global-setup] probe user '${username}' did not become authenticatable within 60s ` +
          `(create: HTTP ${res.status}, last topology status: ${ping?.status ?? 'no response'}).${hint}`,
      );
    }
    await sleep(2_000);
  }
}

export default globalSetup;
