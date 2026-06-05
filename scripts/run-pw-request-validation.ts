#!/usr/bin/env tsx
/**
 * run-pw-request-validation — run the request-validation Playwright suite
 * out of the active config's generated directory.
 *
 * Replaces a hard-coded `request-validation/generated/playwright.config.ts`
 * path with one resolved from CONFIG (#128 PR 2 — output partitioning).
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getRequestValidationSuiteDir } from '../path-analyser/src/configResolver.ts';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

// The request-validation suite is emitted as parallel profiles:
//   unsecured/ — 400 validation tests, plain local dev server (default)
//   secured/   — 400 tests + auth-absent (401) tests, secured server
//   rbac/      — read-side RBAC deny (403) tests; needs an authorizations-enabled
//                server + admin creds (the global-setup provisions a zero-grant
//                probe user). Select via RV_PROFILE=secured | rbac.
const PROFILES = ['unsecured', 'secured', 'rbac'] as const;
type Profile = (typeof PROFILES)[number];
function isProfile(v: string | undefined): v is Profile {
  return v !== undefined && PROFILES.some((p) => p === v);
}
const profile: Profile = isProfile(process.env.RV_PROFILE) ? process.env.RV_PROFILE : 'unsecured';
const config = join(getRequestValidationSuiteDir(REPO_ROOT), profile, 'playwright.config.ts');

const child = spawn('npx', ['playwright', 'test', '-c', config, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: REPO_ROOT,
  // On Windows, npx is npx.cmd; node's spawn does not auto-resolve
  // .cmd shims unless a shell is used.
  shell: process.platform === 'win32',
});
child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
