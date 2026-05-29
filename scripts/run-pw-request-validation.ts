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

// The request-validation suite is emitted as two parallel profiles
// (unsecured/ and secured/). Default to the unsecured profile — it runs
// against a plain local dev server. Set RV_PROFILE=secured to run the suite
// that adds the auth-absent (401) tests against a secured server.
const profile = process.env.RV_PROFILE === 'secured' ? 'secured' : 'unsecured';
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
