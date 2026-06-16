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
import { getActiveSpecSource, getSpecBundleDir } from '../path-analyser/src/configResolver.ts';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

function main(): void {
  const argv = process.argv.slice(2);
  const refRequired = argv.includes('--ref-required');

  const spec = getActiveSpecSource(REPO_ROOT);
  const localSpecDir = spec.localSpecDir;
  const useLocalSpecDir = localSpecDir !== undefined;
  const rawRef = process.env.SPEC_REF;
  const ref = rawRef?.trim() ?? '';

  // SPEC_REF is only meaningful in network-fetch mode. In local-bundle mode
  // the spec directory is whatever the sibling clone has checked out, so a
  // ref is neither required nor used.
  if (refRequired && !useLocalSpecDir && ref === '') {
    console.error('fetch-spec:ref requires SPEC_REF=<sha-or-ref> to be set');
    process.exit(2);
  }

  const bundleDir = getSpecBundleDir(REPO_ROOT);
  mkdirSync(bundleDir, { recursive: true });

  const args: string[] = [];
  if (localSpecDir !== undefined) {
    // Local bundle: skip the network fetch, bundle straight from the
    // configured (sibling-clone) spec directory.
    args.push('--spec-dir', resolve(REPO_ROOT, localSpecDir));
  } else {
    if (ref !== '') {
      args.push('--ref', ref);
    }
    if (spec.repoUrl) {
      args.push('--repo-url', spec.repoUrl);
    }
  }
  if (spec.entryFile) {
    args.push('--entry-file', spec.entryFile);
  }
  args.push('--output-spec', join(bundleDir, 'rest-api.bundle.json'));
  args.push('--output-metadata', join(bundleDir, 'spec-metadata.json'));
  args.push('--output-semantic-kinds', join(bundleDir, 'semantic-kinds.json'));

  const sourceDesc = useLocalSpecDir
    ? `local spec-dir ${spec.localSpecDir}`
    : `${spec.repoUrl ?? 'default repo'}${ref !== '' ? ` @ ${ref}` : ''}`;
  console.error(`[fetch-spec] writing to ${bundleDir} (source: ${sourceDesc})`);

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
