#!/usr/bin/env tsx
/**
 * with-config — set CONFIG=<name> for a child npm script invocation.
 *
 * Usage (from package.json):
 *   "pipeline": "tsx scripts/with-config.ts -- npm run testsuite:generate"
 *
 * Usage (from the shell):
 *   tsx scripts/with-config.ts --config=camunda-oca -- npm run testsuite:generate
 *
 * Resolution:
 *   1. If --config=<name> is passed, the *last* occurrence wins (matches
 *      typical CLI override semantics) and is exported as CONFIG.
 *   2. Otherwise the existing CONFIG env var is preserved.
 *   3. Otherwise the default declared in configs.json is used.
 *
 * In every case the resolved value is written back into the child
 * environment so downstream consumers — including those that don't read
 * configs.json themselves — see the same name we validated and logged.
 *
 * The name is validated up front (safe pattern + configs.json allowlist)
 * via path-analyser/src/configResolver.ts so a typo or path-traversal
 * attempt fails before any child process is spawned.
 *
 * See #128 for the broader configuration-driven generation work.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getActiveConfigName } from '../path-analyser/src/configResolver.ts';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

function parseArgs(argv: string[]): { config: string | undefined; cmd: string[] } {
  const dashDash = argv.indexOf('--');
  const head = dashDash === -1 ? argv : argv.slice(0, dashDash);
  const tail = dashDash === -1 ? [] : argv.slice(dashDash + 1);

  let config: string | undefined;
  for (const arg of head) {
    if (arg.startsWith('--config=')) {
      config = arg.slice('--config='.length);
    } else if (arg === '--config') {
      throw new Error('--config requires a value: use --config=<name>');
    }
  }
  return { config, cmd: tail };
}

function main(): void {
  const { config, cmd } = parseArgs(process.argv.slice(2));

  if (cmd.length === 0) {
    console.error(
      'usage: with-config [--config=<name>] -- <command> [args...]\n' +
        '       e.g. tsx scripts/with-config.ts --config=camunda-oca -- npm run pipeline',
    );
    process.exit(2);
  }

  const env = { ...process.env };
  if (config !== undefined) {
    env.CONFIG = config;
  }

  // Validate up front so a typo / unsafe value fails before we spawn
  // anything. getActiveConfigName reads CONFIG from process.env, so
  // assign first; then write the *resolved* (trimmed, allowlist-checked,
  // default-if-unset) value back into the child env so downstream
  // consumers — including those that don't read configs.json themselves
  // — see the same value we logged here.
  if (env.CONFIG !== undefined) {
    process.env.CONFIG = env.CONFIG;
  }
  const resolved = getActiveConfigName(REPO_ROOT);
  env.CONFIG = resolved;
  process.env.CONFIG = resolved;
  console.error(`[with-config] CONFIG=${resolved}`);

  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: 'inherit',
    env,
    cwd: REPO_ROOT,
    // On Windows, common shims (npm, npx, tsx) are .cmd files; node's
    // spawn does not auto-resolve them without a shell.
    shell: process.platform === 'win32',
  });
  child.on('exit', (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main();
