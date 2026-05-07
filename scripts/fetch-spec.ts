#!/usr/bin/env tsx
/**
 * fetch-spec — invoke camunda-schema-bundler with per-config output paths.
 *
 * Replaces the inline package.json bundler invocation so the output
 * partition (#128 PR 2) is computed from CONFIG rather than hard-coded.
 *
 * Outputs:
 *   spec/<config>/bundled/rest-api.bundle.json
 *   spec/<config>/bundled/spec-metadata.json
 *   spec/<config>/bundled/semantic-kinds.json
 *
 * Spec ref: SPEC_REF env var (preserved). Optional --ref-required mode
 * for the `fetch-spec:ref` script that fails when SPEC_REF is unset.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getSpecBundleDir } from '../path-analyser/src/configResolver.ts';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

function main(): void {
  const argv = process.argv.slice(2);
  const refRequired = argv.includes('--ref-required');

  const ref = process.env.SPEC_REF;
  if (refRequired && (!ref || ref.trim() === '')) {
    console.error('fetch-spec:ref requires SPEC_REF=<sha-or-ref> to be set');
    process.exit(2);
  }

  const bundleDir = getSpecBundleDir(REPO_ROOT);
  mkdirSync(bundleDir, { recursive: true });

  const args: string[] = [];
  if (ref && ref.trim() !== '') {
    args.push('--ref', ref);
  }
  args.push('--output-spec', join(bundleDir, 'rest-api.bundle.json'));
  args.push('--output-metadata', join(bundleDir, 'spec-metadata.json'));
  args.push('--output-semantic-kinds', join(bundleDir, 'semantic-kinds.json'));

  console.error(`[fetch-spec] writing to ${bundleDir}${ref ? ` (ref ${ref})` : ''}`);

  const child = spawn('npx', ['camunda-schema-bundler', ...args], {
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
}

main();
