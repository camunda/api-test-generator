import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/hub-coverage-fix-live-check.sh',
);

const RUN = '555';
const SHA = 'a'.repeat(40);

interface Opts {
  state?: string;
  head?: string;
  dryNoPrs?: boolean;
  tagFails?: boolean;
  dispatchFails?: boolean;
  commentFails?: boolean;
  // Run ids of the commit that exist before the dispatch, and the ones that appear once `workflow run` was called.
  before?: number[];
  after?: number[];
  listFails?: boolean;
  attempt?: string;
}

// Runs the script with a fake `gh` that records every call to a log file.
function run(o: Opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'live-check-'));
  const log = join(dir, 'calls.log');
  const prs = o.dryNoPrs
    ? []
    : [
        {
          number: 10,
          state: o.state ?? 'OPEN',
          headRefName: `fix/coverage-thing-create-${RUN}`,
          headRefOid: o.head ?? SHA,
        },
        { number: 5, state: 'OPEN', headRefName: `fix/coverage-old-${RUN}`, headRefOid: SHA },
        { number: 11, state: 'OPEN', headRefName: 'fix/coverage-x-999', headRefOid: SHA },
      ];
  writeFileSync(join(dir, 'prs.json'), JSON.stringify(prs));
  writeFileSync(join(dir, 'before'), (o.before ?? []).join('\n'));
  writeFileSync(join(dir, 'after'), (o.after ?? [42]).join('\n'));
  writeFileSync(
    join(dir, 'gh'),
    [
      '#!/usr/bin/env bash',
      'echo "$*" >> "$FAKE_LOG"',
      'for LAST_ARG; do :; done',
      'case "$1 $2" in',
      '  "api -X") [ "$FAKE_TAG_FAILS" = 1 ] && exit 1; exit 0 ;;',
      '  "workflow run") [ "$FAKE_DISPATCH_FAILS" = 1 ] && exit 1; touch "$FAKE_DIR/dispatched"; exit 0 ;;',
      '  "run list") [ "$FAKE_LIST_FAILS" = 1 ] && exit 1; cat "$FAKE_DIR/before"; echo; [ -e "$FAKE_DIR/dispatched" ] && cat "$FAKE_DIR/after"; exit 0 ;;',
      '  "pr comment") [ "$FAKE_COMMENT_FAILS" = 1 ] && exit 1; exit 0 ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(join(dir, 'gh'), 0o755);
  const r = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      RUN_PRS: join(dir, 'prs.json'),
      BASELINE: '7',
      GITHUB_RUN_ID: RUN,
      GITHUB_RUN_ATTEMPT: o.attempt ?? '1',
      GITHUB_REPOSITORY: 'camunda/api-test-generator',
      GITHUB_SERVER_URL: 'https://github.com',
      GH_TOKEN: 'x',
      POLL_SECONDS: '0',
      POLL_TRIES: '2',
      FAKE_LOG: log,
      FAKE_DIR: dir,
      FAKE_LIST_FAILS: o.listFails ? '1' : '0',
      FAKE_TAG_FAILS: o.tagFails ? '1' : '0',
      FAKE_DISPATCH_FAILS: o.dispatchFails ? '1' : '0',
      FAKE_COMMENT_FAILS: o.commentFails ? '1' : '0',
    },
  });
  const calls = (() => {
    try {
      return readFileSync(log, 'utf8');
    } catch {
      return '';
    }
  })();
  return { status: r.status, calls, stderr: r.stderr, stdout: r.stdout };
}

describe('hub-coverage-fix live check dispatch', () => {
  it('pins the verified commit under a tag, starts the run on that tag, and comments the run link', () => {
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    const tag = `hub-live-check/${RUN}-1-10`;
    expect(r.calls).toContain(`ref=refs/tags/${tag}`);
    expect(r.calls).toContain(`sha=${SHA}`);
    expect(r.calls).toContain(
      `workflow run hub-ondemand-test.yml --repo camunda/api-test-generator --ref ${tag}`,
    );
    expect(r.calls).toContain('actions/runs/42');
    // The lookup is narrowed by commit on the server, before any limit is applied.
    expect(r.calls).toContain(`--commit ${SHA}`);
    // Only this run's PR above the baseline: not #5 (old) and not #11 (another run).
    expect(r.calls.match(/workflow run/g)?.length).toBe(1);
  });

  it('puts the run attempt in the tag, so a re-run does not hit an existing ref', () => {
    expect(run({ attempt: '2' }).calls).toContain(`hub-live-check/${RUN}-2-10`);
  });

  it('does nothing when there is no PR of this run, and for a PR that is not open', () => {
    expect(run({ dryNoPrs: true }).calls).toBe('');
    const closed = run({ state: 'CLOSED' });
    expect(closed.status).toBe(0);
    expect(closed.calls).not.toContain('workflow run');
  });

  it('fails closed when the tag cannot be created or the run cannot be started: a fallback comment, no run, exit 1', () => {
    for (const o of [{ tagFails: true }, { dispatchFails: true }]) {
      const r = run(o);
      expect(r.status).toBe(1);
      expect(r.calls).toContain('pr comment 10');
      expect(r.calls).toContain('could not be started automatically');
    }
    expect(run({ tagFails: true }).calls).not.toContain('workflow run');
  });

  it('refuses a PR whose snapshot has no head commit', () => {
    const r = run({ head: 'null' });
    expect(r.status).toBe(1);
    expect(r.calls).not.toContain('workflow run');
  });

  it('links only a run that appeared after the dispatch, never one that already existed for the commit', () => {
    // An earlier attempt's run (7) exists before the dispatch; the new one (42) appears after it.
    const r = run({ before: [7], after: [42] });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toContain('actions/runs/42');
    expect(r.calls).not.toContain('actions/runs/7');
    // Nothing new appeared: the old run must not be linked.
    const stale = run({ before: [7], after: [] });
    expect(stale.status).toBe(1);
    expect(stale.calls).not.toContain('actions/runs/7');
    expect(stale.calls).toContain('its run could not be found');
  });

  it('does not start a run when the existing runs of the commit cannot be listed', () => {
    const r = run({ listFails: true });
    expect(r.status).toBe(1);
    expect(r.calls).not.toContain('workflow run');
    expect(r.calls).toContain('could not be started automatically');
  });

  it('fails the step when the comment cannot be posted', () => {
    expect(run({ commentFails: true }).status).toBe(1);
  });

  it('is only started by the workflow outside a dry run, after the verify step', () => {
    const wf: unknown = load(
      readFileSync(join(dirname(script), '../workflows/hub-coverage-fix.yml'), 'utf8'),
    );
    const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
    const jobs = isRec(wf) && isRec(wf.jobs) ? wf.jobs : {};
    const verify = isRec(jobs.verify) ? jobs.verify : {};
    const steps = (Array.isArray(verify.steps) ? verify.steps : []).filter(isRec);
    const names = steps.map((s) => String(s.name ?? ''));
    const start = names.indexOf('Start the live Hub check on each verified PR');
    expect(start).toBeGreaterThan(names.indexOf('Verify the PRs'));
    expect(String(steps[start]?.if)).toContain("DRY_RUN != 'true'");
  });
});
