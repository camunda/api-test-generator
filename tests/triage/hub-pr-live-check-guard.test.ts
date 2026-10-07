import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const workflowPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/workflows/hub-pr-live-check.yml',
);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// The guard job's own script, taken from the workflow file, so the test runs what GitHub runs.
function guardScript(): string {
  const wf = load(readFileSync(workflowPath, 'utf8'));
  const jobs = isRecord(wf) && isRecord(wf.jobs) ? wf.jobs : {};
  const guard = isRecord(jobs.guard) ? jobs.guard : {};
  const steps = Array.isArray(guard.steps) ? guard.steps : [];
  const step = steps.find((s) => isRecord(s) && s.id === 'check');
  if (!isRecord(step) || typeof step.run !== 'string') throw new Error('no guard step "check"');
  return step.run;
}

// Runs the guard with a fake `gh pr diff` that prints DIFF_FILES (or fails). Returns the proceed output.
function proceed(headRef: string, author: string, diff: string | 'fail' = 'src/a.ts'): string {
  const dir = mkdtempSync(join(tmpdir(), 'live-guard-'));
  writeFileSync(
    join(dir, 'gh'),
    '#!/usr/bin/env bash\n[ "$FAKE_DIFF" = fail ] && exit 1\nprintf "%s\\n" "$FAKE_DIFF"\n',
  );
  chmodSync(join(dir, 'gh'), 0o755);
  const out = join(dir, 'output');
  writeFileSync(out, '');
  const r = spawnSync('bash', ['-c', guardScript()], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_OUTPUT: out,
      GH_TOKEN: 'x',
      REPO: 'camunda/api-test-generator',
      PR_NUMBER: '1',
      HEAD_REF: headRef,
      PR_AUTHOR: author,
      FAKE_DIFF: diff,
    },
  });
  expect(r.status, r.stderr).toBe(0);
  const m = /proceed=(\w+)/.exec(readFileSync(out, 'utf8'));
  return m?.[1] ?? 'none';
}

describe('hub-pr-live-check guard', () => {
  it('lets a normal PR from a person through', () => {
    expect(proceed('claude/some-change', 'esraagamal6')).toBe('true');
  });

  it('skips the agent branches, whoever opened them', () => {
    expect(proceed('fix/coverage-remove-member-403-123', 'qa-processes[bot]')).toBe('false');
    expect(proceed('fix/nightly-triage-suppress-foo', 'qa-processes[bot]')).toBe('false');
    expect(proceed('fix/coverage-x-1', 'someone')).toBe('false');
  });

  it('does not trust the branch name: any other PR from the automation account is skipped', () => {
    expect(proceed('chore/innocent-looking-name', 'qa-processes[bot]')).toBe('false');
    expect(proceed('feat/anything', 'app/qa-processes')).toBe('false');
  });

  it('keeps the live check for the automation PRs that deterministic scripts open', () => {
    expect(proceed('chore/spec-bump-camunda-hub', 'qa-processes[bot]')).toBe('true');
    expect(proceed('chore/hub-unskip-123', 'qa-processes[bot]')).toBe('true');
  });

  it('fails closed on an empty branch name or author', () => {
    expect(proceed('', 'someone')).toBe('false');
    expect(proceed('chore/spec-bump-camunda-hub', '')).toBe('true');
    expect(proceed('claude/some-change', '')).toBe('false');
  });

  it('keeps the existing .github rule and the unreadable-diff rule', () => {
    expect(proceed('claude/some-change', 'esraagamal6', '.github/workflows/x.yml')).toBe('false');
    expect(proceed('claude/some-change', 'esraagamal6', 'fail')).toBe('false');
  });

  it('does not run a branch name as a command', () => {
    const marker = join(tmpdir(), `pwned-${process.pid}`);
    proceed(`fix/coverage-$(touch ${marker})`, 'esraagamal6');
    const r = spawnSync('test', ['-e', marker]);
    expect(r.status).not.toBe(0);
  });
});
