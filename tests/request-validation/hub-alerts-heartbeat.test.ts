import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/hub-alerts-heartbeat.sh',
);
const TITLE = '[hub-alerts] Slack alerts are not being posted';
const NOW = Date.parse('2026-10-06T06:00:00Z') / 1000;

type Run = { databaseId: number; createdAt: string; status: string; url: string };
type Step = { name: string; conclusion: string | null };
type Existing = { number: number; title: string; state: 'OPEN' | 'CLOSED' };

const run = (id: number, createdAt: string, status = 'completed'): Run => ({
  databaseId: id,
  createdAt,
  status,
  url: `https://example.test/runs/${id}`,
});
const posted: Step[] = [
  { name: 'Notify Slack (positive suite)', conclusion: 'success' },
  { name: 'Notify Slack (negative suite)', conclusion: 'success' },
];
const triagePosted: Step[] = [{ name: 'Post triage summary to Slack', conclusion: 'success' }];

interface Scenario {
  nightlyRuns: Run[];
  nightlySteps?: Step[];
  triageRuns: Run[];
  triageSteps?: Step[];
  existing?: Existing[];
  dryRun?: boolean;
}

/** Runs the heartbeat against a stub gh serving the scenario; returns exit code, output and the gh calls. */
function heartbeat(sc: Scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'heartbeat-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const write = (name: string, data: unknown) =>
    writeFileSync(join(dir, name), JSON.stringify(data));
  write('runs-nightly.json', sc.nightlyRuns);
  write('runs-triage.json', sc.triageRuns);
  write('view-1.json', { jobs: [{ steps: sc.nightlySteps ?? posted }] });
  write('view-2.json', { jobs: [{ steps: sc.triageSteps ?? triagePosted }] });
  write('existing.json', sc.existing ?? []);
  writeFileSync(join(dir, 'log'), '');
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash
echo "gh $*" >> "$GH_LOG"
case "$1 $2" in
  "run list")
    case "$*" in *nightly-camunda-hub.yml*) cat "$D/runs-nightly.json";; *) cat "$D/runs-triage.json";; esac;;
  "run view") cat "$D/view-$3.json";;
  "issue list") cat "$D/existing.json";;
  "issue create") echo "https://example.test/issues/9";;
esac
`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  const r = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      D: dir,
      GH_LOG: join(dir, 'log'),
      NOW_EPOCH: String(NOW),
      DRY_RUN: sc.dryRun ? 'true' : 'false',
      RUN_URL: 'https://example.test/heartbeat',
    },
  });
  const calls = readFileSync(join(dir, 'log'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('gh run') && !l.startsWith('gh issue list'));
  return { code: r.status, out: r.stdout, calls };
}

// nightly is run id 1 and triage run id 2 in every scenario.
const healthy = {
  nightlyRuns: [run(1, '2026-10-06T02:00:00Z')],
  triageRuns: [run(2, '2026-10-06T02:20:00Z')],
};

describe('hub alerts heartbeat', () => {
  it('is quiet and touches no issue when both posted', () => {
    const r = heartbeat(healthy);
    expect(r.code).toBe(0);
    expect(r.out).toContain('look healthy');
    expect(r.calls).toEqual([]);
  });

  it('opens an issue and fails when the nightly did not run in the last 26 hours', () => {
    const r = heartbeat({ ...healthy, nightlyRuns: [run(1, '2026-10-04T02:00:00Z')] });
    expect(r.code).toBe(1);
    expect(r.out).toContain('no `nightly-camunda-hub.yml` run started in the last 26 hours');
    expect(r.calls.map((c) => c.split(' ').slice(0, 3).join(' '))).toEqual(['gh issue create']);
    expect(r.calls[0]).toContain(`--title ${TITLE}`);
  });

  it('flags a run whose Slack steps were skipped, the silent case this exists for', () => {
    const r = heartbeat({
      ...healthy,
      nightlySteps: [
        { name: 'Notify Slack (positive suite)', conclusion: 'skipped' },
        { name: 'Notify Slack (negative suite)', conclusion: 'skipped' },
      ],
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('Notify Slack (positive suite) (skipped)');
    expect(r.out).toContain('Slack token could not be read');
  });

  it('flags the triage digest step too', () => {
    const r = heartbeat({
      ...healthy,
      triageSteps: [{ name: 'Post triage summary to Slack', conclusion: 'skipped' }],
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('**triage digest**');
  });

  it('flags a run that has no Slack step at all (the workflow changed)', () => {
    const r = heartbeat({
      ...healthy,
      nightlySteps: [{ name: 'Checkout', conclusion: 'success' }],
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('has no Slack post step');
  });

  it('does not judge a run that is still in progress, whatever its steps show so far', () => {
    const r = heartbeat({
      ...healthy,
      nightlyRuns: [run(1, '2026-10-06T02:00:00Z', 'in_progress')],
      nightlySteps: [{ name: 'Notify Slack (positive suite)', conclusion: null }],
    });
    expect(r.code).toBe(0);
  });

  it('updates the open issue instead of opening a second one', () => {
    const r = heartbeat({
      ...healthy,
      nightlyRuns: [],
      existing: [{ number: 7, title: TITLE, state: 'OPEN' }],
    });
    expect(r.code).toBe(1);
    expect(r.calls.map((c) => c.split(' ').slice(0, 3).join(' '))).toEqual([
      'gh issue edit',
      'gh issue comment',
    ]);
  });

  it('reopens a closed issue when the alerts stop again', () => {
    const r = heartbeat({
      ...healthy,
      nightlyRuns: [],
      existing: [{ number: 7, title: TITLE, state: 'CLOSED' }],
    });
    expect(r.calls[0]).toContain('gh issue reopen 7');
  });

  it('closes the open issue once everything posts again', () => {
    const r = heartbeat({ ...healthy, existing: [{ number: 7, title: TITLE, state: 'OPEN' }] });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toContain('gh issue close 7');
  });

  it('only prints in a dry run', () => {
    const r = heartbeat({ ...healthy, nightlyRuns: [], dryRun: true });
    expect(r.code).toBe(0);
    expect(r.out).toContain('Dry run');
    expect(r.calls).toEqual([]);
  });
});
