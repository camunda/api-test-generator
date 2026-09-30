/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH under
 * one or more contributor license agreements. See the NOTICE file distributed
 * with this work for additional information regarding copyright ownership.
 * Licensed under the Camunda License 1.0. You may not use this file
 * except in compliance with the Camunda License 1.0.
 */

// Vendored support file. Provisions runtime fixtures the generated suite needs
// against a live broker before tests run, split by profile (RV_PROFILE):
//
//   - `unsecured` / `secured`: real, server-assigned resource keys
//     (userTaskKey, jobKey, elementInstanceKey, processInstanceKey) for
//     operations whose path param has no create endpoint of its own — it
//     only exists once a deployed process's instance reaches a user task /
//     pending job / active element. A filler placeholder ('1'/'x') for one of
//     these always 404s before the body/param validation a scenario targets
//     is ever reached. See `provisionRuntimeKeyFixtures` below and #352's
//     `resourceFixtures` mechanism (configs/<config>/request-validation.json)
//     that consumes the RV_FIXTURE_* env vars this sets.
//   - `rbac`: the read-side deny-test fixtures —
//       1. a probe user — a non-admin user with NO authorization grants; the
//          `rbac` profile's deny-tests authenticate as it (denyProbeHeaders())
//          so an authorizations-enabled server rejects the request.
//       2. one instance of each get-by-key resource the deny-tests target,
//          created as admin with a fixed id. These exist purely so the
//          probe's read has a real target — making its failure a genuine
//          authorization denial (admin would see the resource at 200) rather
//          than a 404-not-found. They carry no grants. The fixed ids MUST
//          match the auth-deny allowlist in the api-test-generator that
//          emitted this suite (its authDeny analysis pass).
//
// All creates are idempotent — an already-existing resource (HTTP 409) is
// treated as success. The runtime-key provisioning for unsecured/secured is
// best-effort: a failure there is logged and swallowed (not thrown) so the
// affected scenarios fall back to the old filler/404 behaviour instead of
// failing the whole suite over one broker hiccup.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authHeaders,
  basicAuthHeaders,
  credentials,
  denyProbeBearerToken,
  denyProbeCredentials,
} from './env';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// --- unsecured/secured runtime-key fixtures ---------------------------------

const USER_TASK_BPMN = 'bpmn/user-task.bpmn';
const USER_TASK_PROCESS_ID = 'Process_user_task';
const SERVICE_TASK_BPMN = 'bpmn/service-task.bpmn';
const SERVICE_TASK_PROCESS_ID = 'Process_0zc9jbi';
const SERVICE_TASK_JOB_TYPE = 'sampleJobType';
const RUNTIME_KEY_DISCOVERY_TIMEOUT_MS = 30_000;

/**
 * Reads a fixture BPMN file. Mirrors the candidate-path strategy of the
 * positive suite's `resolveFixture` (materializer/src/playwright/support/
 * fixtures.ts) but kept self-contained here — this file must stay free of
 * cross-package imports since it's vendored standalone into the generated
 * suite. Tries the in-repo `configs/<CONFIG>/fixtures/` layout (the normal
 * case when running via scripts/e2e/run-oca.sh from the repo root) and a
 * walk-up from this file's own location as a fallback for other layouts.
 */
async function readFixture(relPath: string): Promise<Buffer> {
  const activeConfig = process.env.CONFIG?.trim() || 'camunda-oca';
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'configs', activeConfig, 'fixtures', relPath),
    path.resolve(here, '..', '..', '..', 'configs', activeConfig, 'fixtures', relPath),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `[runtime-key fixtures] fixture not found: ${relPath} (tried: ${candidates.join(', ')})`,
  );
}

async function deployFixtureProcesses(
  admin: Record<string, string>,
  files: ReadonlyArray<{ name: string; content: Buffer }>,
): Promise<void> {
  const form = new FormData();
  for (const f of files) {
    form.append('resources', new Blob([new Uint8Array(f.content)]), f.name);
  }
  const res = await fetch(`${credentials.baseUrl}/v2/deployments`, {
    method: 'POST',
    headers: admin,
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`deployment failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
}

function isCreateProcessInstanceResponse(v: unknown): v is { processInstanceKey: string } {
  return isPlainObject(v) && typeof v.processInstanceKey === 'string';
}

async function createProcessInstance(
  admin: Record<string, string>,
  processDefinitionId: string,
): Promise<string> {
  const res = await fetch(`${credentials.baseUrl}/v2/process-instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...admin },
    body: JSON.stringify({ processDefinitionId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `createProcessInstance(${processDefinitionId}) failed: HTTP ${res.status} ${text.slice(0, 300)}`,
    );
  }
  const body: unknown = await res.json();
  if (!isCreateProcessInstanceResponse(body)) {
    throw new Error(`createProcessInstance(${processDefinitionId}): unexpected response shape`);
  }
  return body.processInstanceKey;
}

function isUserTaskSearchItem(
  v: unknown,
): v is { userTaskKey: string; elementInstanceKey?: string } {
  return (
    isPlainObject(v) &&
    typeof v.userTaskKey === 'string' &&
    (v.elementInstanceKey === undefined || typeof v.elementInstanceKey === 'string')
  );
}

function isSearchResponse(v: unknown): v is { items: unknown[] } {
  return isPlainObject(v) && Array.isArray(v.items);
}

/** Polls user-tasks/search for the instance's user task, retrying until the
 *  importer catches up (search endpoints are eventually consistent) or the
 *  deadline passes. */
async function findUserTask(
  admin: Record<string, string>,
  processInstanceKey: string,
  deadlineMs: number,
): Promise<{ userTaskKey: string; elementInstanceKey?: string } | undefined> {
  for (;;) {
    const res = await fetch(`${credentials.baseUrl}/v2/user-tasks/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...admin },
      body: JSON.stringify({ filter: { processInstanceKey } }),
    });
    if (res.ok) {
      const body: unknown = await res.json();
      if (isSearchResponse(body) && body.items.length > 0 && isUserTaskSearchItem(body.items[0])) {
        return body.items[0];
      }
    }
    if (Date.now() > deadlineMs) return undefined;
    await sleep(1_000);
  }
}

function isActivatedJob(v: unknown): v is { jobKey: string; elementInstanceKey?: string } {
  return (
    isPlainObject(v) &&
    typeof v.jobKey === 'string' &&
    (v.elementInstanceKey === undefined || typeof v.elementInstanceKey === 'string')
  );
}

function isActivationResponse(v: unknown): v is { jobs: unknown[] } {
  return isPlainObject(v) && Array.isArray(v.jobs);
}

/** Polls jobs/activation for a job of `type`, retrying until one becomes
 *  available (the instance needs to reach the service task first) or the
 *  deadline passes. */
async function activateJob(
  admin: Record<string, string>,
  type: string,
  deadlineMs: number,
): Promise<{ jobKey: string; elementInstanceKey?: string } | undefined> {
  for (;;) {
    const res = await fetch(`${credentials.baseUrl}/v2/jobs/activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...admin },
      body: JSON.stringify({
        type,
        maxJobsToActivate: 1,
        timeout: RUNTIME_KEY_DISCOVERY_TIMEOUT_MS,
        worker: 'rv-global-setup',
      }),
    });
    if (res.ok) {
      const body: unknown = await res.json();
      if (isActivationResponse(body) && body.jobs.length > 0 && isActivatedJob(body.jobs[0])) {
        return body.jobs[0];
      }
    }
    if (Date.now() > deadlineMs) return undefined;
    await sleep(1_000);
  }
}

/**
 * Deploys the user-task and service-task fixture processes (the same ones
 * the positive suite uses for `ModelHasUserTask`/`ModelHasServiceTaskType` —
 * configs/<config>/fixtures/deployment-artifacts.json), starts one instance
 * of each, discovers the real userTaskKey/jobKey/elementInstanceKey, and
 * exports them (plus the user-task instance's processInstanceKey) as
 * RV_FIXTURE_* env vars for qaEmitter's resourceFixtures substitution.
 *
 * Best-effort: any failure is logged and swallowed, not thrown — the
 * affected scenarios simply fall back to the filler placeholder (and the
 * 404 they were already getting), rather than failing the whole suite.
 */
async function provisionRuntimeKeyFixtures(): Promise<void> {
  const admin = authHeaders();
  try {
    const [userTaskBpmn, serviceTaskBpmn] = await Promise.all([
      readFixture(USER_TASK_BPMN),
      readFixture(SERVICE_TASK_BPMN),
    ]);
    await deployFixtureProcesses(admin, [
      { name: 'user-task.bpmn', content: userTaskBpmn },
      { name: 'service-task.bpmn', content: serviceTaskBpmn },
    ]);

    // Job activation (jobs/activation) isn't scoped to a single instance —
    // it activates the next available job of `type` broker-wide — so the
    // service-task instance's own key never needs to be read back.
    const [userTaskInstanceKey] = await Promise.all([
      createProcessInstance(admin, USER_TASK_PROCESS_ID),
      createProcessInstance(admin, SERVICE_TASK_PROCESS_ID),
    ]);
    process.env.RV_FIXTURE_PROCESS_INSTANCE_KEY = userTaskInstanceKey;

    const deadlineMs = Date.now() + RUNTIME_KEY_DISCOVERY_TIMEOUT_MS;
    const [userTask, job] = await Promise.all([
      findUserTask(admin, userTaskInstanceKey, deadlineMs),
      activateJob(admin, SERVICE_TASK_JOB_TYPE, deadlineMs),
    ]);

    if (userTask) {
      process.env.RV_FIXTURE_USER_TASK_KEY = userTask.userTaskKey;
      if (userTask.elementInstanceKey) {
        process.env.RV_FIXTURE_ELEMENT_INSTANCE_KEY = userTask.elementInstanceKey;
      }
    } else {
      console.warn(
        '[runtime-key fixtures] user task did not appear within 30s — userTaskKey scenarios fall back to the filler placeholder.',
      );
    }

    if (job) {
      process.env.RV_FIXTURE_JOB_KEY = job.jobKey;
      if (!process.env.RV_FIXTURE_ELEMENT_INSTANCE_KEY && job.elementInstanceKey) {
        process.env.RV_FIXTURE_ELEMENT_INSTANCE_KEY = job.elementInstanceKey;
      }
    } else {
      console.warn(
        '[runtime-key fixtures] no job activated within 30s — jobKey scenarios fall back to the filler placeholder.',
      );
    }

    console.log(
      `[runtime-key fixtures] ready: processInstanceKey=${process.env.RV_FIXTURE_PROCESS_INSTANCE_KEY ?? '(none)'} ` +
        `userTaskKey=${process.env.RV_FIXTURE_USER_TASK_KEY ?? '(none)'} jobKey=${process.env.RV_FIXTURE_JOB_KEY ?? '(none)'} ` +
        `elementInstanceKey=${process.env.RV_FIXTURE_ELEMENT_INSTANCE_KEY ?? '(none)'}`,
    );
  } catch (err) {
    console.warn(
      `[runtime-key fixtures] provisioning failed — affected scenarios fall back to filler placeholders: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

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
  if (process.env.RV_PROFILE !== 'rbac') {
    await provisionRuntimeKeyFixtures();
    return;
  }

  // Bearer-probe mode (authDenyMode: 'all-secured', e.g. Hub): the deny probe is
  // a reduced-permission token minted out-of-band (Keycloak). Only keyless,
  // no-required-body ops are targeted, so no real resource keys are needed and
  // no probe USER needs provisioning. Nothing to set up here.
  if (denyProbeBearerToken) {
    process.stderr.write(
      '[rbac global-setup] Bearer-probe mode (RBAC_DENY_PROBE_BEARER_TOKEN set) — ' +
        'no fixtures/probe-user provisioning needed.\n',
    );
    return;
  }

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
