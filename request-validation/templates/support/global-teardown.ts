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
import { authHeaders, credentials } from './env';
import { RUNTIME_KEY_CLEANUP_STATE_FILE } from './global-setup';

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

async function cancelProcessInstance(
  admin: Record<string, string>,
  processInstanceKey: string,
): Promise<void> {
  await fetch(`${credentials.baseUrl}/v2/process-instances/${processInstanceKey}/cancellation`, {
    method: 'POST',
    headers: admin,
  }).catch(() => undefined);
}

async function globalTeardown(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const statePath = path.resolve(here, '..', RUNTIME_KEY_CLEANUP_STATE_FILE);

  let processInstanceKeys: string[];
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    processInstanceKeys = isStringArray(parsed) ? parsed : [];
  } catch {
    return; // nothing recorded — global-setup.ts never created anything
  }
  if (processInstanceKeys.length === 0) return;

  const admin = authHeaders();
  await Promise.all(processInstanceKeys.map((key) => cancelProcessInstance(admin, key)));
  await fs.rm(statePath, { force: true }).catch(() => undefined);
}

export default globalTeardown;
