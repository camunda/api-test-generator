import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/hub-endpoint-author.sh',
);

const SPEC_DIR = 'restapi/public-api/src/main/resources/openapi/v2';

// A throwaway camunda-hub-shaped git repo: one committed spec line per op, so
// the script's `git blame` resolves a real SHA. The commit author is irrelevant
// — the SHA -> login hop is the stubbed `gh` below, which the script feeds the
// SHA to — so the tests control the returned login independently of git.
function makeHubRepo(ops: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'hub-endpoint-'));
  mkdirSync(join(dir, SPEC_DIR), { recursive: true });
  const byFile = new Map<string, string[]>();
  for (const [op, file] of Object.entries(ops)) {
    const lines = byFile.get(file) ?? ['openapi: 3.0.0', 'paths:'];
    lines.push('  /thing:', '    get:', `      operationId: ${op}`);
    byFile.set(file, lines);
  }
  for (const [file, lines] of byFile) {
    writeFileSync(join(dir, SPEC_DIR, file), `${lines.join('\n')}\n`);
  }
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'dev@camunda.com']);
  git(['config', 'user.name', 'Dev']);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'add spec']);
  return dir;
}

// `gh api .../commits/<sha>` is stubbed to print whatever login the test wants
// (FAKE_LOGIN), so the script's blame + filtering logic is what's under test.
function run(op: string, hub: string, fakeLogin: string): string {
  const stubDir = mkdtempSync(join(tmpdir(), 'gh-stub-'));
  const stub = join(stubDir, 'gh');
  // `dollar` keeps a literal "${" out of the source so biome does not read the
  // bash variable as a JS template placeholder.
  const dollar = '$';
  const stubBody = [
    '#!/usr/bin/env bash',
    `[ "$1" = api ] && printf %s "${dollar}{FAKE_LOGIN:-}"`,
    'exit 0',
    '',
  ].join('\n');
  writeFileSync(stub, stubBody);
  chmodSync(stub, 0o755);
  return execFileSync('bash', [script, op, hub], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ''}`,
      FAKE_LOGIN: fakeLogin,
      GH_TOKEN: 'x',
    },
  }).trim();
}

describe('hub-endpoint-author.sh', () => {
  it('resolves the GitHub login for an operation that exists in the spec', () => {
    const hub = makeHubRepo({ getFile: 'files.yaml' });
    expect(run('getFile', hub, 'octocat')).toBe('octocat');
  });

  it('returns nothing when the operationId is not in the spec', () => {
    const hub = makeHubRepo({ getFile: 'files.yaml' });
    expect(run('deleteFolder', hub, 'octocat')).toBe('');
  });

  it('matches the operationId exactly, not as a prefix', () => {
    const hub = makeHubRepo({ getFiles: 'files.yaml' });
    expect(run('getFile', hub, 'octocat')).toBe('');
  });

  it('falls back (empty) for a bot author', () => {
    const hub = makeHubRepo({ getFile: 'files.yaml' });
    expect(run('getFile', hub, 'renovate[bot]')).toBe('');
  });

  it('falls back (empty) when the commit email is not linked to a GitHub account', () => {
    const hub = makeHubRepo({ getFile: 'files.yaml' });
    expect(run('getFile', hub, '')).toBe('');
  });

  it('rejects an operationId with unexpected characters without resolving anything', () => {
    const hub = makeHubRepo({ getFile: 'files.yaml' });
    expect(run('get File', hub, 'octocat')).toBe('');
    expect(run('get;whoami', hub, 'octocat')).toBe('');
  });

  it('returns nothing when the spec directory is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-nospec-'));
    execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'pipe' });
    expect(run('getFile', dir, 'octocat')).toBe('');
  });

  it('resolves an operation that lives in a different spec file', () => {
    const hub = makeHubRepo({ getFile: 'files.yaml', getFolder: 'folders.yaml' });
    expect(run('getFolder', hub, 'alice')).toBe('alice');
  });
});
