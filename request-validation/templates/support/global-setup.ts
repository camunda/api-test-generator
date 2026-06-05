/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH under
 * one or more contributor license agreements. See the NOTICE file distributed
 * with this work for additional information regarding copyright ownership.
 * Licensed under the Camunda License 1.0. You may not use this file
 * except in compliance with the Camunda License 1.0.
 */

// Vendored support file. Provisions the read-side RBAC deny-test probe user
// (#359): a non-admin user with NO authorization grants. The `rbac` profile's
// deny-tests authenticate as this user (denyProbeHeaders()) so an
// authorizations-enabled server rejects the request.
//
// Runs only for the `rbac` profile (gated on RV_PROFILE); a no-op otherwise, so
// the unsecured/secured suites are unaffected. Idempotent: an already-existing
// probe user (HTTP 409) is treated as success.

import { authHeaders, basicAuthHeaders, credentials, denyProbeCredentials } from './env';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function globalSetup(): Promise<void> {
  if (process.env.RV_PROFILE !== 'rbac') return;

  const admin = authHeaders();
  if (!admin.Authorization) {
    throw new Error(
      '[rbac global-setup] No admin credentials. Set CAMUNDA_BASIC_AUTH_USER / CAMUNDA_BASIC_AUTH_PASSWORD ' +
        'so the probe user can be provisioned.',
    );
  }

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
      throw new Error(
        `[rbac global-setup] probe user '${username}' did not become authenticatable within 60s ` +
          `(last topology status: ${ping?.status ?? 'no response'}).`,
      );
    }
    await sleep(2_000);
  }
}

export default globalSetup;
