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

interface Commit {
  file: string;
  op: string;
}

// A throwaway camunda-hub-shaped git repo built one commit at a time, so each
// operation's defining line is blamed to its OWN commit (not just HEAD). Returns
// the commit SHA that introduced each op, so a test can map SHA -> login and
// prove the script attributes to the commit that last touched the op's line.
function makeHubRepo(commits: Commit[]): { dir: string; sha: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), 'hub-endpoint-'));
  mkdirSync(join(dir, SPEC_DIR), { recursive: true });
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'dev@camunda.com']);
  git(['config', 'user.name', 'Dev']);
  const sha: Record<string, string> = {};
  const content: Record<string, string[]> = {};
  for (const c of commits) {
    const lines = content[c.file] ?? ['openapi: 3.0.0', 'paths:'];
    lines.push('  /thing:', '    get:', `      operationId: ${c.op}`);
    content[c.file] = lines;
    writeFileSync(join(dir, SPEC_DIR, c.file), `${lines.join('\n')}\n`);
    git(['add', '.']);
    git(['commit', '-q', '-m', `add ${c.op}`]);
    sha[c.op] = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  return { dir, sha };
}

// The `gh` stub is SHA-sensitive: it reads the requested `commits/<sha>` path and
// returns the login mapped to THAT sha (empty if unmapped). So a test passes only
// if the script looked up the right commit — resolving HEAD instead would query a
// different sha and get the wrong (or no) login.
function run(op: string, hub: string, shaLogins: Record<string, string>): string {
  const stubDir = mkdtempSync(join(tmpdir(), 'gh-stub-'));
  const mapFile = join(stubDir, 'map');
  const mapText = Object.entries(shaLogins)
    .map(([s, l]) => `${s} ${l}`)
    .join('\n');
  writeFileSync(mapFile, `${mapText}\n`);
  const stub = join(stubDir, 'gh');
  // `dollar` keeps a literal "${" out of the source so biome does not read the
  // bash variables as JS template placeholders.
  const dollar = '$';
  const stubBody = [
    '#!/usr/bin/env bash',
    // $2 is "repos/camunda/camunda-hub/commits/<sha>" — take the sha after the last "/".
    `sha="${dollar}{2##*/}"`,
    `grep "^${dollar}{sha} " "${dollar}{GH_STUB_MAP}" 2>/dev/null | head -1 | cut -d' ' -f2-`,
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
      GH_STUB_MAP: mapFile,
      GH_TOKEN: 'x',
    },
  }).trim();
}

describe('hub-endpoint-author.sh', () => {
  it('attributes to the commit that added the operation, not HEAD', () => {
    // getFolder is added in a LATER commit than getFile, in the same file, so
    // HEAD != the commit that introduced getFile. A helper that resolved HEAD
    // would return getFolder's author ("bob") for getFile and fail this.
    const { dir, sha } = makeHubRepo([
      { file: 'files.yaml', op: 'getFile' },
      { file: 'files.yaml', op: 'getFolder' },
    ]);
    const map = { [sha.getFile]: 'alice', [sha.getFolder]: 'bob' };
    expect(sha.getFile).not.toBe(sha.getFolder);
    expect(run('getFile', dir, map)).toBe('alice');
    expect(run('getFolder', dir, map)).toBe('bob');
  });

  it('returns nothing when the operationId is not in the spec', () => {
    const { dir, sha } = makeHubRepo([{ file: 'files.yaml', op: 'getFile' }]);
    expect(run('deleteFolder', dir, { [sha.getFile]: 'octocat' })).toBe('');
  });

  it('matches the operationId exactly, not as a prefix', () => {
    const { dir, sha } = makeHubRepo([{ file: 'files.yaml', op: 'getFiles' }]);
    expect(run('getFile', dir, { [sha.getFiles]: 'octocat' })).toBe('');
  });

  it('falls back (empty) for a bot author', () => {
    const { dir, sha } = makeHubRepo([{ file: 'files.yaml', op: 'getFile' }]);
    expect(run('getFile', dir, { [sha.getFile]: 'renovate[bot]' })).toBe('');
  });

  it('falls back (empty) when the commit email is not linked to a GitHub account', () => {
    const { dir, sha } = makeHubRepo([{ file: 'files.yaml', op: 'getFile' }]);
    expect(run('getFile', dir, { [sha.getFile]: '' })).toBe('');
  });

  it('rejects an operationId with unexpected characters without resolving anything', () => {
    const { dir, sha } = makeHubRepo([{ file: 'files.yaml', op: 'getFile' }]);
    const map = { [sha.getFile]: 'octocat' };
    expect(run('get File', dir, map)).toBe('');
    expect(run('get;whoami', dir, map)).toBe('');
  });

  it('returns nothing when the spec directory is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-nospec-'));
    execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'pipe' });
    expect(run('getFile', dir, {})).toBe('');
  });

  it('resolves an operation that lives in a different spec file', () => {
    const { dir, sha } = makeHubRepo([
      { file: 'files.yaml', op: 'getFile' },
      { file: 'folders.yaml', op: 'getFolder' },
    ]);
    expect(run('getFolder', dir, { [sha.getFile]: 'alice', [sha.getFolder]: 'carol' })).toBe(
      'carol',
    );
  });
});
