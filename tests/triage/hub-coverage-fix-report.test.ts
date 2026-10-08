import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/hub-coverage-fix-report.sh',
);

const RUN = '555';

interface Gap {
  kind?: string;
  resource?: string;
  action?: string;
  reason?: string;
  proposal?: string | null;
  file_error?: string | null;
  pr_url?: string | null;
}

const openedPr = {
  number: 999,
  state: 'OPEN',
  headRefName: `fix/coverage-remove-member-403-${RUN}`,
  url: 'https://github.com/camunda/api-test-generator/pull/999',
  title: 'test(coverage-fix): add removeMember 403 test',
};

function build(gaps: unknown, prs: unknown[] = [openedPr], issueUrl = '') {
  const dir = mkdtempSync(join(tmpdir(), 'cf-report-'));
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ gaps }));
  writeFileSync(join(dir, 'prs.json'), JSON.stringify(prs));
  const r = spawnSync(
    'bash',
    [
      script,
      join(dir, 'result.json'),
      join(dir, 'prs.json'),
      join(dir, 'issue.md'),
      join(dir, 'slack.txt'),
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_RUN_ID: RUN,
        BASELINE: '900',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'camunda/api-test-generator',
        ISSUE_URL: issueUrl,
      },
    },
  );
  expect(r.status, r.stderr).toBe(0);
  return {
    issue: readFileSync(join(dir, 'issue.md'), 'utf8'),
    slack: readFileSync(join(dir, 'slack.txt'), 'utf8'),
    stdout: r.stdout,
  };
}

const left: Gap = {
  kind: 'status-403',
  resource: 'removeClusterRegistration',
  action: 'report-only',
  reason: 'Needs cluster management switched on.',
  proposal: 'Add clusterId to resourceFixtures.',
};

describe('hub-coverage-fix-report', () => {
  it('writes the opened PR from GitHub and the gap left for a person, in both texts', () => {
    const r = build(
      [
        { ...left },
        {
          kind: 'status-403',
          resource: 'removeMember',
          action: 'fix-pr',
          pr_url: 'https://evil.example/x',
        },
      ],
      [openedPr],
      'https://github.com/camunda/api-test-generator/issues/684',
    );
    expect(r.slack).toContain('1 PR opened, 1 gap left for a person');
    expect(r.slack).toContain('pull/999|#999 test(coverage-fix): add removeMember 403 test');
    expect(r.slack).toContain(
      '`removeClusterRegistration` (status-403): report-only — Needs cluster management switched on.',
    );
    expect(r.slack).toContain(
      '<https://github.com/camunda/api-test-generator/issues/684|tracking issue>',
    );
    expect(r.slack).not.toContain('evil.example');
    expect(r.issue).toContain('<!-- coverage-fix-run:555 -->');
    expect(r.issue).toContain('- https://github.com/camunda/api-test-generator/pull/999');
    expect(r.issue).toContain('Reason: Needs cluster management switched on.');
    expect(r.issue).toContain('Proposal: Add clusterId to resourceFixtures.');
    expect(r.issue).not.toContain('evil.example');
  });

  it('only counts PRs of this run: not older ones, not another run, not closed ones', () => {
    const others = [
      { ...openedPr, number: 5 },
      { ...openedPr, number: 901, headRefName: 'fix/coverage-x-999' },
      { ...openedPr, number: 902, state: 'CLOSED' },
    ];
    const r = build([left], others);
    expect(r.slack).toContain('0 PRs opened, 1 gap left');
    expect(r.slack).not.toContain('pull/999');
  });

  it('writes nothing for a quiet run, and warns when the result has no gaps list', () => {
    const quiet = build([], []);
    expect(quiet.slack).toBe('');
    expect(quiet.issue).toBe('');
    const dir = mkdtempSync(join(tmpdir(), 'cf-report-'));
    writeFileSync(join(dir, 'result.json'), '{"agent_error":true}');
    writeFileSync(join(dir, 'prs.json'), '[]');
    const r = spawnSync(
      'bash',
      [
        script,
        join(dir, 'result.json'),
        join(dir, 'prs.json'),
        join(dir, 'i.md'),
        join(dir, 's.txt'),
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_RUN_ID: RUN, BASELINE: '0' },
      },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('no gaps list');
    expect(readFileSync(join(dir, 's.txt'), 'utf8')).toBe('');
  });

  it('treats the agent text as untrusted: markup, mentions, control characters and length', () => {
    const r = build([
      {
        ...left,
        resource: 'a<b>&c',
        reason: `<!channel> @here <https://evil.example|click> \`rm\` \u0007\nsecond line ${'x'.repeat(400)}`,
        proposal: `@team ${'y'.repeat(3000)}`,
      },
    ]);
    for (const text of [r.slack, r.issue]) {
      expect(text).not.toContain('<!channel>');
      expect(text).not.toContain('<https://evil.example');
      expect(text).not.toContain('@here');
      expect(text).not.toContain('\u0007');
      expect(text).toContain('&lt;!channel&gt;');
      expect(text).toContain('@​here');
    }
    expect(r.slack).toContain('a&lt;b&gt;&amp;c');
    expect(r.slack).toContain('…');
    expect(r.slack.length).toBeLessThan(900);
    expect(r.issue.length).toBeLessThan(4500);
    expect(r.slack).not.toContain('\n  ');
  });

  it('caps the number of gaps shown and says how many more there are', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...left, resource: `op${i}` }));
    const r = build(many, []);
    expect(r.slack).toContain('25 gaps left');
    expect(r.slack).toContain('`op19`');
    expect(r.slack).not.toContain('`op20`');
    expect(r.slack).toContain('…and 5 more');
    expect(r.issue).toContain('…and 5 more not shown');
  });

  it('shows an error written by the agent for a gap, and leaves out an empty proposal', () => {
    const r = build([{ ...left, proposal: null, file_error: 'push failed' }], []);
    expect(r.issue).toContain('Error: push failed');
    expect(r.issue).not.toContain('Proposal:');
  });
});

describe('the workflows that carry the report', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');
  const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  const stepsOf = (file: string, job: string): Record<string, unknown>[] => {
    const wf: unknown = load(readFileSync(join(root, file), 'utf8'));
    const jobs = isRec(wf) && isRec(wf.jobs) ? wf.jobs : {};
    const j = isRec(jobs[job]) ? jobs[job] : {};
    return (Array.isArray(j.steps) ? j.steps : []).filter(isRec);
  };
  const artifactNames = (steps: Record<string, unknown>[]) =>
    steps
      .map((s) => (isRec(s.with) ? s.with.name : undefined))
      .filter((n): n is string => typeof n === 'string');

  it('saves the Slack message id under the name the coverage-fix run downloads', () => {
    const saved = artifactNames(stepsOf('hub-response-coverage.yml', 'report'));
    const downloaded = artifactNames(stepsOf('hub-coverage-fix.yml', 'verify'));
    expect(saved).toContain('hub-coverage-slack-ts');
    expect(downloaded).toContain('hub-coverage-slack-ts');
  });

  it('posts only after a real run and never fails the run over a note', () => {
    const steps = stepsOf('hub-coverage-fix.yml', 'verify');
    const names = steps.map((s) => String(s.name));
    const first = names.indexOf('Download the weekly report');
    expect(first).toBeGreaterThan(names.indexOf('Start the live Hub check on each verified PR'));
    for (const s of steps.slice(first)) {
      expect(String(s.if), String(s.name)).toContain("DRY_RUN != 'true'");
      expect(s['continue-on-error'], String(s.name)).toBe(true);
    }
  });
});
