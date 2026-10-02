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
// soft only about whether a config uses this feature at all: a config that
// doesn't ship the BPMN fixtures (e.g. camunda-hub) isn't opted in, and
// returns quietly. A config that IS opted in (its fixtures exist) fails
// `globalSetup` loudly on any subsequent error — deploy/create/discovery
// failure, or a missing elementInstanceKey — rather than falling back to
// the filler placeholder, which would silently regress to the 404-masking
// (or a false 400 for the wrong reason) this exists to fix, with nothing to
// catch it.

import { randomUUID } from 'node:crypto';
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

/** Narrows a caught value to its errno `code` (e.g. 'ENOENT'), when it has
 *  one. Exported so global-teardown.ts uses this exact same narrowing rather
 *  than a second copy that could drift. */
export function errnoCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const code = Reflect.get(err, 'code');
  return typeof code === 'string' ? code : undefined;
}

// --- unsecured/secured runtime-key fixtures ---------------------------------

// BPMN process ids ('Process_user_task', 'Process_0zc9jbi') aren't needed as
// constants: instances are created from the exact processDefinitionKey
// deployFixtureProcesses's own response returns, not by id (see that
// function's doc comment for why id-based creation is unsafe here).
const USER_TASK_BPMN = 'bpmn/user-task.bpmn';
const SERVICE_TASK_BPMN = 'bpmn/service-task.bpmn';
// Base job type baked into service-task.bpmn's zeebe:taskDefinition. Never
// used literally for activation (a unique per-run type is patched into the
// deployed BPMN's content instead, in provisionRuntimeKeyFixtures) — jobs/
// activation is broker-wide with no instance-scoping, so activating this
// literal type could capture an unrelated job left by the positive suite's
// own use of the identical fixture, or by a concurrent request-validation
// run, rather than the one from the instance this run just created.
const SERVICE_TASK_JOB_TYPE_BASE = 'sampleJobType';
// Deliberately generous — a safety net against Zeebe search-endpoint import
// lag (findUserTask) and the instance not yet reaching the service task
// (activateJob), not a correctness signal. Don't tighten this without cause
// (AGENTS.md "There are no flaky tests").
const RUNTIME_KEY_DISCOVERY_TIMEOUT_MS = 30_000;
// The `timeout` field of a jobs/activation request is the activated job's
// LOCK duration on the broker (how long it stays held before becoming
// eligible for re-activation by anyone else) — NOT a poll-wait. It must
// outlive the whole request-validation run, not just this discovery step,
// or a later completeJob/failJob/throwJobError/updateJob scenario could
// find the job unlocked/reassigned. Deliberately generous; don't shrink
// this to match RUNTIME_KEY_DISCOVERY_TIMEOUT_MS.
const JOB_LOCK_DURATION_MS = 30 * 60_000;

/**
 * The RV_FIXTURE_* env var `provisionRuntimeKeyFixtures` sets for each
 * runtime key — the single source of truth a config's `resourceFixtures`/
 * `pathResourceFixtures` entries must match exactly (see
 * `configs/camunda-oca/request-validation.json` and the #614 regression
 * guard in `tests/request-validation/resource-fixtures-emit.test.ts`, which
 * imports this constant rather than re-deriving the expected names from the
 * config it's checking — asserting a value against itself can't catch a typo
 * in that same value).
 */
export const RUNTIME_KEY_ENV_VARS = {
  processInstanceKey: 'RV_FIXTURE_PROCESS_INSTANCE_KEY',
  userTaskKey: 'RV_FIXTURE_USER_TASK_KEY',
  jobKey: 'RV_FIXTURE_JOB_KEY',
  elementInstanceKey: 'RV_FIXTURE_ELEMENT_INSTANCE_KEY',
} as const;

/**
 * Reads a fixture BPMN file. Mirrors the candidate-path strategy of the
 * positive suite's `resolveFixture` (materializer/src/playwright/support/
 * fixtures.ts) but kept self-contained here — this file must stay free of
 * cross-package imports since it's vendored standalone into the generated
 * suite. The vendored `<suite>/fixtures/` directory (sibling to `support/`,
 * populated by `materializeStandalone`'s `STANDALONE_FIXTURE_FILES` — see
 * `request-validation/scripts/generate.ts`'s mandatory-once-opted-in check)
 * is the ONLY candidate: `generate.ts` guarantees it exists whenever this
 * config's resourceFixtures/pathResourceFixtures maps a runtime-key name, so
 * no other candidate is needed. Deliberately does NOT also try a
 * `configs/<CONFIG>/fixtures/` monorepo-checkout fallback keyed off
 * `process.env.CONFIG` (removed in #614's review): defaulting an absent
 * `CONFIG` to `'camunda-oca'` meant a standalone Hub suite run without
 * `CONFIG` set could resolve OCA's real fixture files and opt Hub into
 * provisioning it never declared — cross-config leakage the vendored-only
 * lookup can't produce, since Hub's suite simply has no `fixtures/` dir.
 */
async function readFixture(relPath: string): Promise<Buffer> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFile(path.resolve(here, '..', 'fixtures', relPath));
}

function isDeployedProcess(
  v: unknown,
): v is { processDefinition: { processDefinitionKey: string; resourceName: string } } {
  return (
    isPlainObject(v) &&
    isPlainObject(v.processDefinition) &&
    typeof v.processDefinition.processDefinitionKey === 'string' &&
    typeof v.processDefinition.resourceName === 'string'
  );
}

function isDeploymentResponse(v: unknown): v is { deployments: unknown[] } {
  return isPlainObject(v) && Array.isArray(v.deployments);
}

/**
 * Deploys the given files and returns each one's exact `processDefinitionKey`
 * (keyed by the `name` it was uploaded as), NOT the process id — creating a
 * later instance by id alone would resolve to whatever the LATEST deployed
 * version of that id is at that moment, which could be a DIFFERENT run's
 * concurrent deployment on a shared broker (this repo's own e2e driver runs
 * the positive suite and multiple request-validation profiles against the
 * same broker; nothing prevents a genuinely concurrent second invocation
 * either). Pinning to the key this call's own response just returned
 * guarantees the instance created from it is THIS run's version, with THIS
 * run's patched-in unique job type (#614's review discussion).
 */
async function deployFixtureProcesses(
  admin: Record<string, string>,
  files: ReadonlyArray<{ name: string; content: Buffer }>,
): Promise<Map<string, string>> {
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
  const body: unknown = await res.json();
  if (!isDeploymentResponse(body)) {
    throw new Error('deployment: unexpected response shape');
  }
  const processDefinitionKeysByResourceName = new Map<string, string>();
  for (const deployed of body.deployments) {
    if (isDeployedProcess(deployed)) {
      processDefinitionKeysByResourceName.set(
        deployed.processDefinition.resourceName,
        deployed.processDefinition.processDefinitionKey,
      );
    }
  }
  return processDefinitionKeysByResourceName;
}

/**
 * Cancels one process instance, reporting whether it's now actually
 * accounted for — a 404 counts as success (already gone). Exported so
 * global-teardown.ts uses this exact same implementation rather than a
 * second copy that could silently diverge (#614's review discussion): the
 * two previously disagreed on whether a non-2xx response was distinguishable
 * from success at all.
 */
export async function cancelProcessInstance(
  admin: Record<string, string>,
  processInstanceKey: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${credentials.baseUrl}/v2/process-instances/${processInstanceKey}/cancellation`,
      { method: 'POST', headers: admin },
    );
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/**
 * Filename (sibling to `support/`) recording the process instance keys a run
 * created and still needs cancelled — written unconditionally once creation
 * succeeds, read by `global-teardown.ts` after the whole suite finishes.
 * Exported so both files use the exact same literal rather than two copies
 * that could drift.
 */
export const RUNTIME_KEY_CLEANUP_STATE_FILE = 'runtime-key-fixtures-cleanup.json';

function cleanupStatePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', RUNTIME_KEY_CLEANUP_STATE_FILE);
}

/** Exported so global-teardown.ts uses this exact same shape check rather
 *  than a second copy that could drift. */
export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

/**
 * Records this run's created instance keys for global-teardown.ts to act
 * on, merging in whatever a PRIOR run's teardown may have retained as still
 * -outstanding (a cancellation that didn't succeed). Overwriting unconditionally
 * would silently lose track of those: teardown only ever rewrites this file
 * with the keys still left after ITS OWN cancellation attempts, so without
 * the merge here, the very next run's setup would blow that record away the
 * moment it records its own (unrelated) keys — and if that next run then
 * succeeds outright, teardown deletes the file, permanently losing the
 * earlier leak with nothing left to retry against (#614's review discussion).
 *
 * Writes via a temp file + rename rather than a direct `writeFile`, so a
 * process kill mid-write can never leave this file truncated/corrupted —
 * `rename` is atomic on the same filesystem, meaning the real path is
 * always either the complete previous content or the complete new content,
 * never something in between that a later read can't parse back into a key
 * list to retry.
 */
async function recordCreatedInstancesForCleanup(processInstanceKeys: readonly string[]): Promise<void> {
  const statePath = cleanupStatePath();
  let retainedKeys: string[] = [];
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isStringArray(parsed)) {
      throw new Error(`cleanup state file has an unexpected shape (not a string array): ${raw.slice(0, 300)}`);
    }
    retainedKeys = parsed;
  } catch (err) {
    // Only ENOENT means there's genuinely nothing to merge (no prior run
    // ever recorded anything here). Anything else — EACCES, a transient
    // I/O error, a corrupted/wrong-shape file — means an existing record
    // may still hold instances a prior run's teardown couldn't cancel;
    // swallowing it here would let the write below permanently overwrite
    // that record with just this run's own keys, losing them for good.
    // Let it propagate: the caller already cancels this run's own created
    // instances and throws on any failure here, which is exactly the
    // right outcome for "can't safely persist cleanup state."
    if (errnoCode(err) !== 'ENOENT') throw err;
  }
  const merged = Array.from(new Set([...retainedKeys, ...processInstanceKeys]));
  const tmpPath = `${statePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(merged), 'utf8');
  await fs.rename(tmpPath, statePath);
}

function isCreateProcessInstanceResponse(v: unknown): v is { processInstanceKey: string } {
  return isPlainObject(v) && typeof v.processInstanceKey === 'string';
}

/**
 * Creates an instance of the EXACT deployed version identified by
 * `processDefinitionKey` (from `deployFixtureProcesses`'s response), not by
 * process id — see that function's doc comment for why id-based creation is
 * unsafe here.
 */
async function createProcessInstance(
  admin: Record<string, string>,
  processDefinitionKey: string,
): Promise<string> {
  const res = await fetch(`${credentials.baseUrl}/v2/process-instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...admin },
    body: JSON.stringify({ processDefinitionKey }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `createProcessInstance(${processDefinitionKey}) failed: HTTP ${res.status} ${text.slice(0, 300)}`,
    );
  }
  const body: unknown = await res.json();
  if (!isCreateProcessInstanceResponse(body)) {
    throw new Error(`createProcessInstance(${processDefinitionKey}): unexpected response shape`);
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
        timeout: JOB_LOCK_DURATION_MS,
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
 * Only the fixture-file lookup is soft: a config that doesn't ship the BPMN
 * files (e.g. camunda-hub) hasn't opted into this feature at all, so a
 * missing file just means "not applicable" and returns quietly. Past that
 * point the config HAS opted in, and every failure — deploy, create, a
 * discovery timeout, a missing elementInstanceKey — THROWS rather than
 * warning and falling back to the filler placeholder. Swallowing it would
 * silently regress to exactly the 404-masking (or worse, a false 400 for
 * the wrong reason) this PR exists to fix, with no test failure to catch
 * it — see #614's review discussion. The throw propagates out of
 * `globalSetup()` and fails the whole Playwright run, which is the correct,
 * loud outcome for a broker/environment problem during setup.
 *
 * Exported (only) so tests/request-validation/global-setup-provisioning.test.ts
 * can exercise the success/failure/timeout paths directly against a mocked
 * `fetch`, without spinning up Playwright's own globalSetup machinery.
 */
export async function provisionRuntimeKeyFixtures(): Promise<void> {
  const admin = authHeaders();
  let userTaskBpmn: Buffer;
  let serviceTaskBpmn: Buffer;
  try {
    [userTaskBpmn, serviceTaskBpmn] = await Promise.all([
      readFixture(USER_TASK_BPMN),
      readFixture(SERVICE_TASK_BPMN),
    ]);
  } catch (err) {
    // Only ENOENT means this config doesn't ship the user-task/service-task
    // BPMN fixtures (e.g. camunda-hub, which has no
    // configs/camunda-hub/fixtures/bpmn/) — this feature doesn't apply here,
    // not a failure worth a warning. Anything else (EACCES, a corrupted or
    // truncated vendored copy) means generate.ts already confirmed this
    // config IS opted in and the fixture should have been readable — fail
    // loudly here too, matching global-teardown.ts's analogous ENOENT-only
    // narrowing, rather than silently falling back to the filler placeholder
    // this whole feature exists to eliminate (#614's review discussion).
    if (errnoCode(err) !== 'ENOENT') throw err;
    return;
  }

  // A unique job type per run, patched into the service-task BPMN's
  // zeebe:taskDefinition before deploying it: jobs/activation is broker-wide
  // with no instance-scoping, so activating the fixture's literal job type
  // could capture an unrelated job left by the positive suite's own use of
  // the identical BPMN, or by a concurrent request-validation run, instead
  // of the one from the instance this run just created.
  const serviceTaskJobType = `${SERVICE_TASK_JOB_TYPE_BASE}-${randomUUID()}`;
  const serviceTaskBpmnForThisRun = Buffer.from(
    serviceTaskBpmn.toString('utf8').replaceAll(SERVICE_TASK_JOB_TYPE_BASE, serviceTaskJobType),
    'utf8',
  );

  const processDefinitionKeysByResourceName = await deployFixtureProcesses(admin, [
    { name: 'user-task.bpmn', content: userTaskBpmn },
    { name: 'service-task.bpmn', content: serviceTaskBpmnForThisRun },
  ]);
  const userTaskProcessDefinitionKey = processDefinitionKeysByResourceName.get('user-task.bpmn');
  const serviceTaskProcessDefinitionKey = processDefinitionKeysByResourceName.get('service-task.bpmn');
  if (!userTaskProcessDefinitionKey || !serviceTaskProcessDefinitionKey) {
    throw new Error(
      "deployment response didn't include a processDefinitionKey for both user-task.bpmn and service-task.bpmn",
    );
  }

  // allSettled (not all): if one create fails after the other already
  // succeeded, Promise.all would discard the successful one's key and
  // leak it as a permanently running orphan. Cancel anything that DID
  // get created before surfacing the failure.
  const created = await Promise.allSettled([
    createProcessInstance(admin, userTaskProcessDefinitionKey),
    createProcessInstance(admin, serviceTaskProcessDefinitionKey),
  ]);
  const createdKeys: string[] = [];
  const createErrors: string[] = [];
  for (const result of created) {
    if (result.status === 'fulfilled') createdKeys.push(result.value);
    else createErrors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  }

  // Recorded as early as possible — before the createErrors check below, and
  // unconditionally rather than only on failure — so global-teardown.ts has
  // a persisted record of whatever got created even if the in-process
  // cancellation a few lines down (or one later, in the discovery catch)
  // doesn't actually reach the broker (a network error there is swallowed,
  // same as everywhere else here).
  //
  // Fatal, not best-effort: on a run that otherwise succeeds completely,
  // this state file is the ONLY mechanism that will ever release these
  // instances — global-teardown.ts reads it, nothing else does. A run
  // whose in-process cancellation paths never fire (because nothing else
  // goes wrong) but whose bookkeeping write silently failed would leak
  // both instances with no record left to retry against, defeating the
  // reason global-teardown.ts exists. Cancel immediately and surface the
  // failure instead (#614's review discussion).
  if (createdKeys.length > 0) {
    try {
      await recordCreatedInstancesForCleanup(createdKeys);
    } catch (err) {
      // No persisted record exists here, so this in-process cancellation is
      // the ONLY cleanup mechanism for these keys — unlike the other two
      // failure branches below, global-teardown.ts has nothing to fall back
      // on if it also fails. Surface which keys that happened to, rather
      // than swallowing it into a uniform void return (#614's review
      // discussion).
      const results = await Promise.all(
        createdKeys.map(async (key) => ({ key, cleaned: await cancelProcessInstance(admin, key) })),
      );
      const leaked = results.filter((r) => !r.cleaned).map((r) => r.key);
      const leakNote =
        leaked.length > 0
          ? ` In-process cancellation ALSO failed for: ${leaked.join(', ')} — these are now leaked on the broker with no record to retry against.`
          : ' In-process cancellation succeeded for all of them.';
      throw new Error(
        `[runtime-key fixtures] failed to persist cleanup state for ${createdKeys.join(', ')}: ` +
          `${err instanceof Error ? err.message : String(err)}.${leakNote}`,
      );
    }
  }

  if (createErrors.length > 0) {
    await Promise.all(createdKeys.map((key) => cancelProcessInstance(admin, key)));
    throw new Error(`createProcessInstance failed: ${createErrors.join('; ')}`);
  }
  const [userTaskInstanceKey] = createdKeys;
  process.env[RUNTIME_KEY_ENV_VARS.processInstanceKey] = userTaskInstanceKey;

  // Discovery/validation failures below still have both process instances
  // (and, once activated, the job under the service-task one) alive on the
  // broker — cancelling each created instance cancels its active elements
  // too, releasing the job with it, so there's nothing separate to release
  // for the job specifically.
  try {
    const deadlineMs = Date.now() + RUNTIME_KEY_DISCOVERY_TIMEOUT_MS;
    const [userTask, job] = await Promise.all([
      findUserTask(admin, userTaskInstanceKey, deadlineMs),
      activateJob(admin, serviceTaskJobType, deadlineMs),
    ]);

    if (!userTask) {
      throw new Error(
        `[runtime-key fixtures] user task did not appear within ${RUNTIME_KEY_DISCOVERY_TIMEOUT_MS}ms for process instance ${userTaskInstanceKey}`,
      );
    }
    process.env[RUNTIME_KEY_ENV_VARS.userTaskKey] = userTask.userTaskKey;

    if (!job) {
      throw new Error(
        `[runtime-key fixtures] no '${serviceTaskJobType}' job was activated within ${RUNTIME_KEY_DISCOVERY_TIMEOUT_MS}ms`,
      );
    }
    process.env[RUNTIME_KEY_ENV_VARS.jobKey] = job.jobKey;

    // Prefer the user task's element instance — decided directly from the
    // two already-resolved locals, not by probing back through process.env.
    const elementInstanceKey = userTask.elementInstanceKey ?? job.elementInstanceKey;
    if (!elementInstanceKey) {
      throw new Error(
        '[runtime-key fixtures] neither the user task nor the activated job returned an elementInstanceKey',
      );
    }
    process.env[RUNTIME_KEY_ENV_VARS.elementInstanceKey] = elementInstanceKey;
  } catch (err) {
    await Promise.all(createdKeys.map((key) => cancelProcessInstance(admin, key)));
    throw err;
  }

  console.log(
    `[runtime-key fixtures] ready: processInstanceKey=${process.env[RUNTIME_KEY_ENV_VARS.processInstanceKey]} ` +
      `userTaskKey=${process.env[RUNTIME_KEY_ENV_VARS.userTaskKey]} jobKey=${process.env[RUNTIME_KEY_ENV_VARS.jobKey]} ` +
      `elementInstanceKey=${process.env[RUNTIME_KEY_ENV_VARS.elementInstanceKey]}`,
  );

  // Best-effort: only the curl_compare.py oracle propagation (see this
  // function's doc comment) depends on this write — the Playwright process
  // itself already has the real values in its own process.env regardless,
  // and the created instances are already recorded for teardown above, so a
  // failure here shouldn't fail the whole suite or bypass either of those.
  await persistDiscoveredFixtures().catch((err) => {
    console.warn(
      `[runtime-key fixtures] failed to persist fixtures for curl_compare.py (best-effort, continuing): ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

/**
 * Writes the four discovered RV_FIXTURE_* values to `$RV_FIXTURE_ENV_FILE`
 * (as shell `export KEY="value"` lines), when that env var is set.
 *
 * `provisionRuntimeKeyFixtures` sets `process.env.RV_FIXTURE_*` inside THIS
 * Playwright/Node process only — that's sufficient for the generated specs
 * (same process). It is NOT sufficient for scripts/e2e/run-oca.sh's separate
 * curl_compare.py oracle, spawned as its own child process *after* this one
 * exits: process env changes never propagate to a sibling or parent process,
 * so curl_compare.py's own `node -e` evaluation of the emitted
 * `process.env["RV_FIXTURE_..."] || "<filler>"` expressions would silently
 * see the filler and replay every fixture-substituted request differently
 * from what Playwright actually sent — a real request/oracle mismatch, not
 * a bug in the oracle itself (see #614's review discussion). run-oca.sh sets
 * RV_FIXTURE_ENV_FILE to a per-profile path and sources it back into its own
 * shell before invoking curl_compare.py; omitted (the default), this is a
 * no-op for every other invocation style.
 */
/**
 * Quotes a value for safe inclusion in a POSIX shell `export KEY=<value>`
 * line that will later be `source`d. `JSON.stringify` is JSON quoting, not
 * shell quoting — it does nothing to `$`, backticks, or `;`, so a value
 * containing e.g. `$(...)` would be executed by the shell that sources this
 * file. Single-quoting is immune to all of that (bash performs no expansion
 * inside single quotes at all); the only character that needs escaping is a
 * literal single quote itself, closed/reopened around an escaped one.
 */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function persistDiscoveredFixtures(): Promise<void> {
  const dest = process.env.RV_FIXTURE_ENV_FILE;
  if (!dest) return;
  const lines = Object.values(RUNTIME_KEY_ENV_VARS)
    .map((envVar) => `export ${envVar}=${shellSingleQuote(process.env[envVar] ?? '')}\n`)
    .join('');
  await fs.writeFile(dest, lines, 'utf8');
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
