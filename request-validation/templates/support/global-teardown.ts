/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH under
 * one or more contributor license agreements. See the NOTICE file distributed
 * with this work for additional information regarding copyright ownership.
 * Licensed under the Camunda License 1.0. You may not use this file
 * except in compliance with the Camunda License 1.0.
 */

// Vendored support file. Cancels the process instances support/global-setup.ts's
// runtime-key provisioning created for a SUCCESSFUL run — a discovery/creation
// failure there already cancels them itself in its own catch block, but until
// this file existed, a successful run left the user-task instance, the
// service-task instance, and the job/lease under it running on the broker
// forever, since nothing ever cancelled them (#614's review discussion).
//
// Reads the process instance keys global-setup.ts recorded (unconditionally,
// on every run that got past creation) rather than sharing in-memory module
// state with it: globalSetup and globalTeardown are two separately-resolved
// Playwright config entries, and relying on a plain module-level variable
// surviving between them is a fragile assumption this avoids entirely.
//
// No-op if the state file is missing (global-setup.ts never got far enough to
// create anything — e.g. the `rbac` profile, or a config without these BPMN
// fixtures at all) or empty.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authHeaders } from './env';
import {
  RUNTIME_KEY_CLEANUP_STATE_FILE,
  cancelProcessInstance,
  errnoCode,
  isStringArray,
} from './global-setup';

async function globalTeardown(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const statePath = path.resolve(here, '..', RUNTIME_KEY_CLEANUP_STATE_FILE);

  let processInstanceKeys: string[];
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isStringArray(parsed)) {
      throw new Error(`cleanup state file has an unexpected shape (not a string array): ${raw.slice(0, 300)}`);
    }
    processInstanceKeys = parsed;
  } catch (err) {
    // ENOENT alone means global-setup.ts never got far enough to create
    // anything (rbac, or a config without these BPMN fixtures) — a true
    // no-op. Anything else — a permission error, a truncated/corrupted file
    // from an interrupted write, an unexpected shape — means something WAS
    // likely recorded and this is silently losing track of it; fail loudly
    // rather than treating it the same as "nothing to clean up" (#614's
    // review discussion).
    if (errnoCode(err) === 'ENOENT') return;
    throw new Error(
      `[runtime-key fixtures] cleanup state file at ${statePath} exists but couldn't be read: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (processInstanceKeys.length === 0) return;

  const admin = authHeaders();
  const results = await Promise.all(
    processInstanceKeys.map(async (key) => ({ key, cleaned: await cancelProcessInstance(admin, key) })),
  );
  const remaining = results.filter((r) => !r.cleaned).map((r) => r.key);

  if (remaining.length === 0) {
    await fs.rm(statePath, { force: true }).catch(() => undefined);
    return;
  }

  // Retain only what's still outstanding — rather than deleting the state
  // file unconditionally and losing track of a genuine failure — so a
  // future run's teardown (or a manual retry) has something to act on.
  // Throwing (rather than warning) makes a real cleanup failure fail the
  // whole `npx playwright test` run's exit code, matching this suite's
  // fail-loud-on-broker-problems design elsewhere (#614's review
  // discussion) instead of letting broker state silently accumulate.
  //
  // Via a temp file + rename, not a direct write: this record is the ONLY
  // retry path for whatever's left in `remaining`, so a process kill
  // mid-write truncating it would itself turn a transient cancellation
  // failure into a permanent, untracked broker leak — the one outcome this
  // whole retry mechanism exists to prevent (#614's review discussion).
  const tmpPath = `${statePath}.${process.pid}.tmp`;
  await fs
    .writeFile(tmpPath, JSON.stringify(remaining), 'utf8')
    .then(() => fs.rename(tmpPath, statePath))
    .catch(() => undefined);
  throw new Error(
    `[runtime-key fixtures] failed to cancel ${remaining.length} process instance(s) during teardown: ` +
      `${remaining.join(', ')}. They remain on the broker and in the cleanup state file for a future run to retry.`,
  );
}

export default globalTeardown;
