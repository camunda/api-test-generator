#!/usr/bin/env tsx
/**
 * bump-spec-pin — re-pin a config's spec to a newer upstream ref.
 *
 * Resolves a target upstream ref, fetches + bundles that spec, and rewrites
 * `configs/<config>/spec-pin.json` (`specRef` + `expectedSpecHash`, preserving
 * the `$comment` and key order). It does NOT commit — review the diff, then
 * regenerate + run invariants to confirm the new spec is clean before landing:
 *
 *   CONFIG=<config> npm run testsuite:generate \
 *     && CONFIG=<config> npm run generate:request-validation \
 *     && CONFIG=<config> npm test
 *
 * Usage:
 *   npm run bump-spec-pin -- --config camunda-oca [--ref <sha|branch>] [--dry-run]
 *   npm run bump-spec-pin -- --config camunda-hub [--ref <sha>] [--dry-run]
 *
 * Modes (from configs.json `spec.source`):
 *   - network-fetch (camunda-oca): `--ref` defaults to the upstream default
 *     branch tip (resolved via `git ls-remote`). Runs `SPEC_REF=<ref>
 *     npm run fetch-spec:ref`.
 *   - local-bundle (camunda-hub): bundles from the sibling clone
 *     (`../camunda-hub`); `--ref` (if given) is checked out there first, else the
 *     sibling's current HEAD is used. `specRef` = that SHA.
 *
 * `--dry-run` prints the old → new pin without writing.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  getActiveConfigName,
  getActiveSpecSource,
  getSpecBundleDir,
} from '../path-analyser/src/configResolver.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  // Guard against `--config --dry-run` swallowing the next flag as the value.
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

function git(args: string[], cwd = REPO_ROOT): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const SHA_RE = /^[0-9a-f]{40}$/i;

// specRef MUST be a resolved 40-char commit SHA (branches drift). Resolve the
// remote's default branch tip via `HEAD` (no hardcoded `main`, so it works for
// any config's repo).
function resolveDefaultBranchSha(repoUrl: string): string {
  const sha = git(['ls-remote', repoUrl, 'HEAD']).split('\n')[0]?.split('\t')[0] ?? '';
  if (!SHA_RE.test(sha)) {
    throw new Error(`could not resolve default-branch HEAD to a SHA for ${repoUrl} (got '${sha}')`);
  }
  return sha;
}

// Resolve a user-supplied --ref (SHA passthrough, or branch/tag → SHA).
function resolveSha(repoUrl: string, ref: string): string {
  if (SHA_RE.test(ref)) return ref.toLowerCase();
  const lines = git(['ls-remote', repoUrl, ref])
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) {
    throw new Error(`could not resolve ref '${ref}' to a commit SHA in ${repoUrl}`);
  }
  // `ls-remote <ref>` can match multiple refs (e.g. a branch AND a tag of the
  // same name); don't silently pick the first — require an unambiguous ref.
  if (lines.length > 1) {
    throw new Error(
      `ref '${ref}' is ambiguous in ${repoUrl} (${lines.length} matches); pass a full refname (refs/heads/… or refs/tags/…) or a SHA:\n${lines.join('\n')}`,
    );
  }
  const sha = lines[0].split('\t')[0] ?? '';
  if (!SHA_RE.test(sha)) {
    throw new Error(`could not resolve ref '${ref}' to a commit SHA in ${repoUrl}`);
  }
  return sha;
}

function run(cmd: string, env: NodeJS.ProcessEnv): void {
  const res = spawnSync('npm', ['run', cmd], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    throw new Error(`\`npm run ${cmd}\` failed (exit ${res.status ?? res.signal})`);
  }
}

function readSpecHash(): string {
  const metaPath = join(getSpecBundleDir(REPO_ROOT), 'spec-metadata.json');
  const raw: unknown = JSON.parse(readFileSync(metaPath, 'utf8'));
  if (!isRecord(raw) || typeof raw.specHash !== 'string') {
    throw new Error(`spec-metadata.json at ${metaPath} is malformed`);
  }
  return raw.specHash;
}

function main(): void {
  const dryRun = hasFlag('dry-run');
  // configResolver reads CONFIG from the env — set it so every helper + the
  // spawned fetch-spec target the requested config.
  const requested = (arg('config') ?? process.env.CONFIG ?? '').trim();
  if (requested) process.env.CONFIG = requested;
  else delete process.env.CONFIG;
  // Validate + canonicalise via getActiveConfigName BEFORE building any path:
  // it enforces the configs.json allowlist + safe-name regex (rejecting e.g.
  // `--config ../../..`) and falls back to the configs.json default when unset.
  const config = getActiveConfigName(REPO_ROOT);
  process.env.CONFIG = config;

  const pinPath = join(REPO_ROOT, 'configs', config, 'spec-pin.json');
  const pinRaw: unknown = JSON.parse(readFileSync(pinPath, 'utf8'));
  if (
    !isRecord(pinRaw) ||
    typeof pinRaw.specRef !== 'string' ||
    typeof pinRaw.expectedSpecHash !== 'string'
  ) {
    throw new Error(`spec-pin.json at ${pinPath} is malformed`);
  }
  const oldRef = pinRaw.specRef;
  const oldHash = pinRaw.expectedSpecHash;

  const spec = getActiveSpecSource(REPO_ROOT);
  const localBundle = spec.localSpecDir !== undefined;
  let newRef: string;

  if (localBundle) {
    // local-bundle (hub): bundle from the sibling clone; specRef = its HEAD.
    // Use `git -C <dir>` and keep the child's cwd at REPO_ROOT — launching git
    // with cwd set to the sibling path fails on macOS ("Unable to read current
    // working directory: Operation not permitted").
    const specDirAbs = resolve(REPO_ROOT, spec.localSpecDir ?? '');
    const siblingRoot = git(['-C', specDirAbs, 'rev-parse', '--show-toplevel']);
    const wantRef = arg('ref');
    if (wantRef) {
      // `fetch` updates FETCH_HEAD but NOT an existing local branch of the same
      // name, so check out the freshly-fetched commit directly (detached) rather
      // than a possibly-stale local branch (`git checkout main` could otherwise
      // land on the old local `main`).
      git(['-C', siblingRoot, 'fetch', '--depth', '1', 'origin', wantRef]);
      git(['-C', siblingRoot, 'checkout', '--detach', 'FETCH_HEAD']);
    }
    newRef = git(['-C', siblingRoot, 'rev-parse', 'HEAD']);
    console.error(`[bump-spec-pin] ${config}: local-bundle from ${siblingRoot} @ ${newRef}`);
    run('fetch-spec', { ...process.env });
  } else {
    // network-fetch (oca): resolve --ref (or the remote's default branch) to a
    // 40-char SHA before it's written to spec-pin.json / passed as SPEC_REF.
    const repoUrl = spec.repoUrl;
    if (!repoUrl) throw new Error(`${config}: spec.repoUrl is required for network-fetch mode`);
    const wantRef = arg('ref');
    newRef = wantRef ? resolveSha(repoUrl, wantRef) : resolveDefaultBranchSha(repoUrl);
    console.error(`[bump-spec-pin] ${config}: network-fetch ${repoUrl} @ ${newRef}`);
    run('fetch-spec:ref', { ...process.env, SPEC_REF: newRef });
  }

  const newHash = readSpecHash();

  console.error(`\n[bump-spec-pin] ${config}`);
  console.error(`  specRef:  ${oldRef}  →  ${newRef}`);
  console.error(`  specHash: ${oldHash}  →  ${newHash}`);

  if (oldRef === newRef && oldHash === newHash) {
    console.error('  pin already current — nothing to write.');
    return;
  }
  if (oldHash === newHash) {
    console.error('  note: SHA moved but spec content is unchanged (hash identical).');
  }
  if (dryRun) {
    console.error('  --dry-run: not writing spec-pin.json.');
    return;
  }

  pinRaw.specRef = newRef;
  pinRaw.expectedSpecHash = newHash;
  writeFileSync(pinPath, `${JSON.stringify(pinRaw, null, 2)}\n`);
  console.error(`  wrote ${pinPath}`);
  console.error(
    `\nNext: CONFIG=${config} npm run testsuite:generate && CONFIG=${config} npm run generate:request-validation && CONFIG=${config} npm test  (confirm the new spec is clean, update any changed invariants), then commit.`,
  );
}

main();
