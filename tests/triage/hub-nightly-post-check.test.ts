import { describe, expect, it } from 'vitest';
import {
  buildAlert,
  type CheckDeps,
  evaluate,
  type Run,
  runCheck,
  startOfDayUtc,
} from '../../scripts/triage/hub-nightly-post-check.ts';

const now = new Date('2026-10-12T04:30:00Z');

function triageRun(over: Partial<Run> = {}): Run {
  return run({ event: 'workflow_run', createdAt: '2026-10-12T02:40:00Z', ...over });
}

function run(over: Partial<Run>): Run {
  return {
    url: 'https://github.com/camunda/api-test-generator/actions/runs/1',
    event: 'schedule',
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-10-12T02:05:00Z',
    ...over,
  };
}

describe('startOfDayUtc', () => {
  it('is midnight UTC of the same day', () => {
    expect(startOfDayUtc(now).toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });
});

describe('evaluate', () => {
  it('finds nothing when both ran and finished', () => {
    expect(evaluate([run({})], [triageRun()], now)).toEqual([]);
  });

  it('reports a nightly that did not start today, and only that', () => {
    const yesterday = run({ createdAt: '2026-10-11T02:05:00Z' });
    const problems = evaluate([yesterday], [yesterday], now);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.what).toContain('nightly');
    expect(problems[0]?.why).toBe('did not start today');
  });

  it('reports a nightly that is still running at the check time', () => {
    const problems = evaluate([run({ status: 'in_progress', conclusion: '' })], [], now);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.why).toBe('still in progress');
    expect(problems[0]?.url).toContain('/actions/runs/');
  });

  it('reports a nightly that was cancelled or timed out', () => {
    for (const conclusion of ['cancelled', 'timed_out', 'startup_failure']) {
      const problems = evaluate([run({ conclusion })], [], now);
      expect(problems[0]?.why).toBe(`ended as ${conclusion}`);
    }
  });

  it('does not report a nightly whose tests failed: it still posts', () => {
    expect(evaluate([run({ conclusion: 'failure' })], [triageRun()], now)).toEqual([]);
  });

  it('reports a triage that never ran after the nightly finished', () => {
    const problems = evaluate([run({})], [], now);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.what).toContain('triage');
    expect(problems[0]?.why).toContain('did not run');
  });

  it('ignores yesterday’s triage run', () => {
    const problems = evaluate([run({})], [triageRun({ createdAt: '2026-10-11T02:40:00Z' })], now);
    expect(problems[0]?.what).toContain('triage');
  });

  it('reports a failed triage run, because the digest is its post', () => {
    const problems = evaluate([run({})], [triageRun({ conclusion: 'failure' })], now);
    expect(problems[0]?.why).toBe('ended as failure');
  });

  it('reports a skipped or neutral triage: it posted no digest', () => {
    for (const conclusion of ['skipped', 'neutral']) {
      const problems = evaluate([run({})], [triageRun({ conclusion })], now);
      expect(problems[0]?.why).toBe(`ended as ${conclusion}`);
    }
  });

  it('reports a nightly that ended skipped or neutral', () => {
    for (const conclusion of ['skipped', 'neutral']) {
      expect(evaluate([run({ conclusion })], [], now)[0]?.why).toBe(`ended as ${conclusion}`);
    }
  });

  it('does not let a manual triage run stand in for the automatic one', () => {
    const manual = triageRun({ event: 'workflow_dispatch', createdAt: '2026-10-12T03:00:00Z' });
    const problems = evaluate([run({})], [manual], now);
    expect(problems[0]?.what).toContain('triage');
  });

  it('does not count a triage run from before the nightly started', () => {
    const earlier = triageRun({ createdAt: '2026-10-12T01:00:00Z' });
    const problems = evaluate([run({ createdAt: '2026-10-12T02:05:00Z' })], [earlier], now);
    expect(problems[0]?.what).toContain('triage');
  });

  it('judges the newest run of the day when there was a re-run', () => {
    const first = run({ conclusion: 'cancelled', createdAt: '2026-10-12T02:05:00Z' });
    const rerun = run({ createdAt: '2026-10-12T03:10:00Z' });
    expect(
      evaluate([first, rerun], [triageRun({ createdAt: '2026-10-12T03:50:00Z' })], now),
    ).toEqual([]);
  });
});

describe('buildAlert', () => {
  it('is empty when nothing is wrong', () => {
    expect(buildAlert([])).toBe('');
  });

  it('names each problem, links the run and pings hub-medic', () => {
    const text = buildAlert([
      { what: 'the triage digest', why: 'ended as failure', url: 'https://example.test/run/9' },
    ]);
    expect(text).toContain('No nightly post this morning');
    expect(text).toContain('the triage digest: ended as failure');
    expect(text).toContain('<https://example.test/run/9|run>');
    expect(text).toContain('<!subteam^S014VK4482H|hub-medic>');
    expect(text).toContain('docs/hub-nightly-cookbook.md|');
    expect(text).not.toContain('#when-a-post-is-missing');
  });

  it('has no run link when there is none', () => {
    const text = buildAlert([
      { what: 'the nightly run (02:00 UTC)', why: 'did not start today', url: '' },
    ]);
    expect(text).not.toContain('|run>');
  });
});

function deps(over: Partial<CheckDeps> & { nightly?: Run[]; triage?: Run[] }): {
  d: CheckDeps;
  posted: string[];
  logs: string[];
  errors: string[];
} {
  const posted: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const d: CheckDeps = {
    dryRun: false,
    slackToken: 'xoxb-test',
    now,
    listNightly: async () => over.nightly ?? [run({})],
    listTriage: async () => over.triage ?? [triageRun()],
    post: async (text) => {
      posted.push(text);
    },
    log: (l) => logs.push(l),
    error: (e) => errors.push(e),
    ...over,
  };
  return { d, posted, logs, errors };
}

describe('runCheck', () => {
  it('stays silent when both ran', async () => {
    const { d, posted, logs } = deps({});
    await runCheck(d);
    expect(posted).toEqual([]);
    expect(logs[0]).toContain('staying silent');
  });

  it('posts one alert when the nightly did not start', async () => {
    const { d, posted } = deps({ nightly: [], triage: [] });
    await runCheck(d);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('did not start today');
  });

  it('prints the alert but posts nothing in a dry run', async () => {
    const { d, posted, logs } = deps({ nightly: [], triage: [], dryRun: true });
    await runCheck(d);
    expect(posted).toEqual([]);
    expect(logs.join('\n')).toContain('Dry run: not posting.');
  });

  it('fails when the alert is needed but there is no Slack token', async () => {
    const { d, posted, errors } = deps({ nightly: [], triage: [], slackToken: '' });
    await expect(runCheck(d)).rejects.toThrow('could not be posted');
    expect(posted).toEqual([]);
    expect(errors[0]).toContain('::error');
  });

  it('lets an API failure fail the run instead of reading as "all fine"', async () => {
    const { d } = deps({
      listNightly: async () => {
        throw new Error('nightly-camunda-hub.yml: HTTP 403');
      },
    });
    await expect(runCheck(d)).rejects.toThrow('HTTP 403');
  });
});
