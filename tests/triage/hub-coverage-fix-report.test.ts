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

function build(
  gaps: unknown,
  prs: unknown[] = [openedPr],
  issueUrl = '',
  maxIssue = '',
  skipped?: unknown[],
) {
  const dir = mkdtempSync(join(tmpdir(), 'cf-report-'));
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ gaps }));
  writeFileSync(join(dir, 'prs.json'), JSON.stringify(prs));
  // A 5th arg is passed only when the test supplies a skipped list, so the no-selection path stays covered.
  const args = [
    script,
    join(dir, 'result.json'),
    join(dir, 'prs.json'),
    join(dir, 'issue.md'),
    join(dir, 'slack.txt'),
  ];
  if (skipped !== undefined) {
    writeFileSync(
      join(dir, 'selection.json'),
      JSON.stringify({ budget: 0, candidates: [], skipped }),
    );
    args.push(join(dir, 'selection.json'));
  }
  const r = spawnSync('bash', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_RUN_ID: RUN,
      BASELINE: '900',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'camunda/api-test-generator',
      ISSUE_URL: issueUrl,
      ...(maxIssue ? { ISSUE_MAX_CHARS: maxIssue } : {}),
    },
  });
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
    expect(r.slack).toContain('pull/999|#999> `test(coverage-fix): add removeMember 403 test`');
    expect(r.slack).toContain(
      '`removeClusterRegistration` (`status-403`): `report-only` — `Needs cluster management switched on.`',
    );
    expect(r.slack).toContain(
      '<https://github.com/camunda/api-test-generator/issues/684|tracking issue>',
    );
    expect(r.slack).not.toContain('evil.example');
    expect(r.issue).toContain('<!-- coverage-fix-run:555 -->');
    expect(r.issue).toContain('- https://github.com/camunda/api-test-generator/pull/999');
    expect(r.issue).toContain('Reason: `Needs cluster management switched on.`');
    expect(r.issue).toContain('Proposal: `Add clusterId to resourceFixtures.`');
    expect(r.issue).not.toContain('evil.example');
  });

  it('includes the scope note so a reader knows the counts cover only auto-fixable gaps', () => {
    const r = build(
      [{ ...left }],
      [openedPr],
      'https://github.com/camunda/api-test-generator/issues/684',
    );
    expect(r.slack).toContain(
      '> :information_source: Auto-fixes only create-read-delete and config-only 403/404 gaps; the full backlog is in the weekly report and per-area issues.',
    );
    expect(r.issue).toContain(
      '> ℹ️ Auto-fixes only create-read-delete and config-only 403/404 gaps; the full backlog is in the weekly report and per-area issues.',
    );
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

  it('writes nothing for a quiet run', () => {
    const quiet = build([], []);
    expect(quiet.slack).toBe('');
    expect(quiet.issue).toBe('');
  });

  it('still reports the PRs GitHub shows when the agent left no usable result', () => {
    const run = (result: string, prs: unknown[]) => {
      const dir = mkdtempSync(join(tmpdir(), 'cf-report-'));
      writeFileSync(join(dir, 'result.json'), result);
      writeFileSync(join(dir, 'prs.json'), JSON.stringify(prs));
      const r = spawnSync(
        'bash',
        [
          script,
          join(dir, 'result.json'),
          join(dir, 'prs.json'),
          join(dir, 'i.md'),
          join(dir, 's.txt'),
        ],
        { encoding: 'utf8', env: { ...process.env, GITHUB_RUN_ID: RUN, BASELINE: '900' } },
      );
      expect(r.status, r.stderr).toBe(0);
      return {
        out: r.stdout,
        slack: readFileSync(join(dir, 's.txt'), 'utf8'),
        issue: readFileSync(join(dir, 'i.md'), 'utf8'),
      };
    };
    for (const bad of ['{"agent_error":true}', '{"gaps":"no"}', 'not json']) {
      const withPr = run(bad, [openedPr]);
      expect(withPr.out).toContain('no gaps list');
      expect(withPr.slack).toContain('1 PR opened, 0 gaps left');
      expect(withPr.slack).toContain('pull/999');
      expect(withPr.slack).toContain('The agent left no usable result');
      expect(withPr.issue).toContain('pull/999');
      expect(withPr.issue).toContain('The agent left no usable result');
      // With no PR either, the note still says the agent left nothing usable.
      const none = run(bad, []);
      expect(none.slack).toContain('0 PRs opened, 0 gaps left');
      expect(none.slack).toContain('The agent left no usable result');
    }
  });

  it('treats the agent text as untrusted: mentions, control characters, length, and everything in a code span', () => {
    const r = build([
      {
        ...left,
        resource: 'a<b>&c',
        reason: `<!channel> @here <https://evil.example|click> \`rm\` \u0007\nsecond line ${'x'.repeat(1000)}`,
        proposal: `@team ${'y'.repeat(3000)}`,
      },
    ]);
    for (const text of [r.slack, r.issue]) {
      expect(text).not.toContain('\u0007');
      expect(text).toContain('…');
    }
    // Slack: neutralised and in a code span. GitHub: the text is in a code span, which shows it literally and
    // never mentions anyone.
    expect(r.slack).not.toContain('@here');
    expect(r.slack).toContain('@\u200bhere');
    expect(r.issue).toContain('Reason: `<!channel> @here');
    expect(r.slack).not.toContain('<!channel>');
    expect(r.slack).toContain('&lt;!channel&gt;');
    expect(r.slack).toContain('a&lt;b&gt;&amp;c');
    expect(r.slack.length).toBeLessThan(1100);
    expect(r.issue.length).toBeLessThan(2800);
    expect(r.slack).not.toContain('\n  ');
  });

  it('shows Markdown links and images as plain text, not as clickable content', () => {
    const text =
      '[review fix](https://evil.example) ![i](https://evil.example/i.png) **bold** # head';
    const r = build([{ ...left, reason: text, proposal: text }], []);
    // Every agent text sits inside one code span, which GitHub and Slack show literally.
    expect(r.issue).toContain(`Reason: \`${text}\``);
    expect(r.issue).toContain(`Proposal: \`${text}\``);
    expect(r.slack).toContain(`\`${text}\``);
    // A backtick in the text cannot close the span early.
    const tick = build([{ ...left, reason: 'a` [x](https://evil.example) `b' }], []);
    expect(tick.issue).toContain("Reason: `a' [x](https://evil.example) 'b`");
  });

  it("keeps the whole issue comment below GitHub's size limit, whatever the agent wrote", () => {
    const big = 'z'.repeat(5000);
    const gaps = Array.from({ length: 40 }, (_, i) => ({
      kind: big,
      resource: big,
      action: big,
      reason: big,
      proposal: big,
      file_error: big,
      pr_url: `https://x/${i}`,
    }));
    const prs = Array.from({ length: 40 }, (_, i) => ({
      ...openedPr,
      number: 1000 + i,
      title: big,
    }));
    const r = build(gaps, prs);
    expect(r.issue.length).toBeLessThan(60000);
    expect(r.slack.length).toBeLessThan(4000);
    expect(r.issue).toContain('<!-- coverage-fix-run:555 -->');
  });

  it('cuts a too long comment at the end of a line, so every agent text keeps its closing backtick', () => {
    const evil = '[a](https://evil.example) ![i](https://evil.example/i.png) ';
    const gaps = Array.from({ length: 20 }, (_, i) => ({
      kind: 'status-403',
      resource: `op${i}`,
      action: 'report-only',
      reason: evil + 'r'.repeat(800),
      proposal: evil + 'p'.repeat(1200),
      file_error: evil + 'e'.repeat(200),
    }));
    const prs = Array.from({ length: 20 }, (_, i) => ({
      ...openedPr,
      number: 1000 + i,
      title: 't'.repeat(120),
    }));
    const r = build(gaps, prs, '', '9000');
    expect(r.issue.length).toBeLessThan(9300);
    expect(r.issue).toContain('…cut here');
    const lines = r.issue.split('\n').filter((l) => /^ {2}- (Reason|Proposal|Error): /.test(l));
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(l.endsWith('`'), l.slice(-40)).toBe(true);
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
    expect(r.issue).toContain('Error: `push failed`');
    expect(r.issue).not.toContain('Proposal:');
  });

  it('lists the gaps the agent did not attempt this run, in both texts, with the headline count', () => {
    const r = build([{ ...left }], [openedPr], '', '', [
      { resource: 'File', reason: 'area File already has an agent PR (recent or open)' },
      { resource: 'removeMember', reason: 'removeMember is already covered by the open PR #799' },
    ]);
    expect(r.slack).toContain('1 PR opened, 1 gap left for a person, 2 not attempted.');
    // Skipped entries render one per line (so truncation keeps the ones that fit), not one joined line.
    expect(r.slack).toContain('*Not attempted this run:*');
    expect(r.slack).toContain('• `File` (area File already has an agent PR (recent or open))');
    expect(r.slack).toContain(
      '• `removeMember` (removeMember is already covered by the open PR #799)',
    );
    expect(r.issue).toContain('left for a person, 2 not attempted.');
    expect(r.issue).toContain('**Not attempted this run**');
    expect(r.issue).toContain('- `File`: `area File already has an agent PR (recent or open)`');
  });

  it('posts the not-attempted line even when no PR was opened and no gap was left for a person', () => {
    const r = build([], [], '', '', [
      { resource: 'File', reason: 'known and tracked: suppressed' },
    ]);
    expect(r.slack).toContain('0 PRs opened, 0 gaps left for a person, 1 not attempted.');
    expect(r.slack).toContain('*Not attempted this run:*');
    expect(r.slack).toContain('• `File` (known and tracked: suppressed)');
    expect(r.issue).toContain('<!-- coverage-fix-run:555 -->');
    expect(r.issue).toContain('**Not attempted this run**');
  });

  it('writes no not-attempted line when the selector reported nothing skipped', () => {
    const r = build([{ ...left }], [openedPr], '', '', []);
    expect(r.slack).toContain('1 gap left for a person.');
    expect(r.slack).not.toContain('not attempted');
    expect(r.issue).not.toContain('Not attempted');
  });

  it('caps the not-attempted list and neutralises its text', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      resource: `op${i}`,
      reason: 'area <X> & <Y> already has an agent PR',
    }));
    const r = build([], [], '', '', many);
    expect(r.slack).toContain('25 not attempted.');
    expect(r.slack).toContain('`op19`');
    expect(r.slack).not.toContain('`op20`');
    expect(r.slack).toContain('• …and 5 more');
    // Slack mrkdwn markup characters in the reason are neutralised.
    expect(r.slack).toContain('area &lt;X&gt; &amp; &lt;Y&gt; already has an agent PR');
    expect(r.issue).toContain('…and 5 more');
  });

  it('keeps the skipped entries that fit when the Slack message is truncated at the cap', () => {
    // A single joined line would be dropped whole by the cap, losing every skipped entry while the headline
    // still counts them. One line per entry means the cut (at a line boundary) retains the ones that fit.
    const prs = Array.from({ length: 2 }, (_, i) => ({
      ...openedPr,
      number: 1000 + i,
      title: 'add a lifecycle test for a resource with a fairly long descriptive title '.repeat(2),
    }));
    const skipped = Array.from({ length: 20 }, (_, i) => ({
      resource: `op${i}`,
      reason: 'its area already has an open agent PR, so it waits for the next run '.repeat(2),
    }));
    const r = build([], prs, 'https://github.com/camunda/api-test-generator/issues/684', '', skipped);
    expect(r.slack).toContain('20 not attempted.'); // headline still counts all of them
    expect(r.slack).toContain('*Not attempted this run:*');
    expect(r.slack).toContain('• `op0`'); // the first skipped entries survive the cut
    expect(r.slack).toContain('…cut here'); // the cap actually triggered
    // The footer is reserved space, so the scope note and Details link survive even a truncated report.
    expect(r.slack).toContain(':information_source: Auto-fixes only create-read-delete');
    expect(r.slack).toContain('<https://github.com/camunda/api-test-generator/issues/684|tracking issue>');
    expect(r.slack.length).toBeLessThan(3000); // body + footer stays within the Slack cap
    // Every rendered skipped bullet is a complete line, so no code span is left half-open by the cut.
    for (const line of r.slack.split('\n').filter((l) => l.startsWith('• `op'))) {
      expect(line.trimEnd().endsWith(')'), line.slice(-30)).toBe(true);
    }
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
    const comment = steps.find((s) => s.name === 'Comment on the tracking issue');
    // The marker is looked for anywhere in the body: a verification warning is put in front of it.
    expect(String(isRec(comment) ? comment.run : '')).toContain('contains(');
    expect(String(isRec(comment) ? comment.run : '')).not.toContain('startswith(');
    for (const s of steps.slice(first)) {
      expect(String(s.if), String(s.name)).toContain("DRY_RUN != 'true'");
      expect(s['continue-on-error'], String(s.name)).toBe(true);
    }
  });

  const jobOf = (file: string, job: string): Record<string, unknown> => {
    const wf: unknown = load(readFileSync(join(root, file), 'utf8'));
    const jobs = isRec(wf) && isRec(wf.jobs) ? wf.jobs : {};
    return isRec(jobs[job]) ? jobs[job] : {};
  };

  it('links issues on verification success, independent of the live-check step outcome', () => {
    const steps = stepsOf('hub-coverage-fix.yml', 'verify');
    const link = steps.find(
      (s) => String(s.name) === 'Link each verified PR to its tracking issue',
    );
    expect(link, 'linking step must exist').toBeTruthy();
    const cond = String(isRec(link) ? link.if : '');
    // Explicit gate, so a failed live-check step (which runs just before) cannot skip linking via the
    // implicit success() a plain `if` would add; still skipped when verification itself failed.
    expect(cond).toContain('always()');
    expect(cond).toContain("steps.verify.outcome == 'success'");
    expect(isRec(link) ? link['continue-on-error'] : undefined).toBe(true);
  });

  it('anchors the Slack Details link to this run comment in both reporting jobs', () => {
    for (const job of ['verify', 'report-skipped']) {
      const comment = stepsOf('hub-coverage-fix.yml', job).find(
        (s) => String(s.name) === 'Comment on the tracking issue',
      );
      const run = String(isRec(comment) ? comment.run : '');
      // Capture the posted/edited comment's URL and swap it into the Slack Details link.
      expect(run, job).toContain("--jq '.html_url'");
      expect(run, job).toContain('comment_url');
      expect(run, job).toContain('slack.txt');
    }
  });

  it('reports a skipped-only run from a dedicated agent-less job', () => {
    const job = jobOf('hub-coverage-fix.yml', 'report-skipped');
    expect(Object.keys(job).length, 'report-skipped job must exist').toBeGreaterThan(0);
    const cond = String(job.if);
    // Only a zero-candidate run that still set gaps aside, and only a real run.
    expect(cond).toContain("needs.fix.outputs.count == '0'");
    expect(cond).toContain("needs.fix.outputs.skipped != '0'");
    const perms = isRec(job.permissions) ? job.permissions : {};
    expect(perms.issues).toBe('write');
    // It only reports: it must never gain PR-write, run the agent, or verify PRs.
    expect(perms['pull-requests']).toBeUndefined();
    const names = stepsOf('hub-coverage-fix.yml', 'report-skipped').map((s) => String(s.name));
    expect(names).toContain('Write the run report');
    expect(names).toContain('Comment on the tracking issue');
    expect(names).toContain('Reply in the weekly Slack thread');
    expect(names).not.toContain('Verify the PRs');
  });

  it('hands the selection to the skipped-only report on a zero-candidate run', () => {
    const fix = jobOf('hub-coverage-fix.yml', 'fix');
    const outputs = isRec(fix.outputs) ? fix.outputs : {};
    expect(String(outputs.skipped)).toContain('steps.select.outputs.skipped');
    const upload = stepsOf('hub-coverage-fix.yml', 'fix').find((s) =>
      String(s.name).includes('Upload the selection for the skipped-only report'),
    );
    expect(upload, 'fix job must upload the selection on count==0').toBeTruthy();
    expect(String(isRec(upload) ? upload.if : '')).toContain("count == '0'");
  });
});
