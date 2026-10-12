// Checks, once a morning, that last night's nightly run and its triage run actually happened.
//
// The nightly (02:00 UTC) and the triage that follows it post to #camunda-hub-nightly-test-results.
// A failed Slack step turns its run red, but if a run never starts (a disabled schedule, an outage)
// or hangs, nothing posts and nothing is red, so a missing post would go unnoticed. This looks at
// the two workflows' runs for today (UTC) and posts one alert when one is missing, stuck or ended
// without finishing. Silent when both ran.
//
// Runs under plain `node` (type stripping): no enums, no parameter properties.

import { postDigest } from './hub-gap-digest.ts';

export interface Run {
  url: string;
  event: string;
  status: string;
  conclusion: string;
  createdAt: string;
}

export interface Problem {
  /** Which post is affected, for the alert line. */
  what: string;
  /** What is wrong, in a few words. */
  why: string;
  /** The run to open, when there is one. */
  url: string;
}

const NIGHTLY = 'the nightly run (02:00 UTC)';
const TRIAGE = 'the triage digest';

/** The conclusions that mean a run did its job. For the nightly a plain `failure` is healthy: a
 * nightly with failing tests is red but still posts. For the triage only `success` is, because its
 * digest is the post: `skipped` (its job has an `if`), `neutral`, `failure`, `cancelled` and the
 * rest all mean no digest. */
const NIGHTLY_HEALTHY = new Set(['success', 'failure']);
const TRIAGE_HEALTHY = new Set(['success']);

/** Midnight UTC of the day `now` falls on: the nightly of "today" starts after it. */
export function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function latestSince(runs: Run[], since: Date): Run | undefined {
  return runs
    .filter((r) => Date.parse(r.createdAt) >= since.getTime())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

function judge(run: Run, what: string, healthy: Set<string>): Problem | null {
  if (run.status !== 'completed') {
    return { what, why: `still ${run.status.replace('_', ' ')}`, url: run.url };
  }
  if (!healthy.has(run.conclusion)) {
    return { what, why: `ended as ${run.conclusion || 'no result'}`, url: run.url };
  }
  return null;
}

/** The problems with today's nightly and triage runs. `nightly` and `triage` are the runs of each
 * workflow: only scheduled nightly runs created since midnight UTC count (a manual run on
 * some branch must not replace the scheduled one, and its triage is skipped on purpose). The triage that counts is the one
 * the nightly triggered (`workflow_run`) after the nightly started: a manual triage run, or one
 * from earlier in the day, must not hide a missing automatic digest. A triage is only expected
 * once the nightly has finished, so a missing nightly is reported once, not twice. */
export function evaluate(nightly: Run[], triage: Run[], now: Date): Problem[] {
  const n = latestSince(
    nightly.filter((r) => r.event === 'schedule'),
    startOfDayUtc(now),
  );
  if (!n) {
    return [{ what: NIGHTLY, why: 'did not start on schedule today', url: '' }];
  }
  const nightlyProblem = judge(n, NIGHTLY, NIGHTLY_HEALTHY);
  if (nightlyProblem) return [nightlyProblem];
  const t = latestSince(
    triage.filter((r) => r.event === 'workflow_run'),
    new Date(Date.parse(n.createdAt)),
  );
  if (!t) return [{ what: TRIAGE, why: 'did not run after the nightly finished', url: n.url }];
  const triageProblem = judge(t, TRIAGE, TRIAGE_HEALTHY);
  return triageProblem ? [triageProblem] : [];
}

const HUB_MEDIC = '<!subteam^S014VK4482H|hub-medic>';
const COOKBOOK_URL =
  'https://github.com/camunda/api-test-generator/blob/main/docs/hub-nightly-cookbook.md';

export function buildAlert(problems: Problem[]): string {
  if (problems.length === 0) return '';
  const lines = [':warning: *No nightly post this morning*'];
  for (const p of problems) {
    lines.push(`• ${p.what}: ${p.why}${p.url ? ` (<${p.url}|run>)` : ''}`);
  }
  lines.push(`<${COOKBOOK_URL}|📖 What to check> ${HUB_MEDIC}`);
  return lines.join('\n');
}

// ---- I/O -------------------------------------------------------------------------------

interface ApiRun {
  html_url: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  created_at: string;
}

async function listRuns(repo: string, file: string, token: string, since: Date): Promise<Run[]> {
  const day = since.toISOString().slice(0, 10);
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?per_page=20&created=%3E%3D${day}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`${file}: HTTP ${resp.status}`);
  // biome-ignore lint/plugin: runtime contract boundary for parsed GitHub JSON
  const body = (await resp.json()) as { workflow_runs?: ApiRun[] };
  return (body.workflow_runs ?? []).map((r) => ({
    url: r.html_url,
    event: r.event,
    status: r.status ?? '',
    conclusion: r.conclusion ?? '',
    createdAt: r.created_at,
  }));
}

/** Everything `runCheck` reads or writes, so a test can drive the whole run without the network. */
export interface CheckDeps {
  dryRun: boolean;
  /** Empty when the Slack token was not available. */
  slackToken: string;
  now: Date;
  listNightly: (since: Date) => Promise<Run[]>;
  listTriage: (since: Date) => Promise<Run[]>;
  post: (text: string, token: string) => Promise<void>;
  log: (line: string) => void;
  error: (line: string) => void;
}

/** Reads both workflows' runs and posts the alert when a post is missing. Throws when the alert
 * is needed but cannot go out, so the run is red rather than silently green. */
export async function runCheck(deps: CheckDeps): Promise<void> {
  const since = startOfDayUtc(deps.now);
  const [nightly, triage] = await Promise.all([deps.listNightly(since), deps.listTriage(since)]);
  const problems = evaluate(nightly, triage, deps.now);
  const text = buildAlert(problems);
  if (text === '') {
    deps.log('Both the nightly and the triage ran today; staying silent.');
    return;
  }
  deps.log(text);
  if (deps.dryRun) {
    deps.log('Dry run: not posting.');
    return;
  }
  if (!deps.slackToken) {
    deps.error('::error title=Alert not posted::a post is missing but SLACK_TOKEN is empty');
    throw new Error('A nightly post is missing and the alert could not be posted');
  }
  await deps.post(text, deps.slackToken);
}

function env(name: string): string {
  return process.env[name] ?? '';
}

async function main(): Promise<void> {
  const repo = env('GITHUB_REPOSITORY') || 'camunda/api-test-generator';
  const token = env('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN is required');
  await runCheck({
    dryRun: env('DRY_RUN') === 'true',
    slackToken: env('SLACK_TOKEN'),
    now: new Date(),
    listNightly: (since) => listRuns(repo, 'nightly-camunda-hub.yml', token, since),
    listTriage: (since) => listRuns(repo, 'triage-camunda-hub-nightly.yml', token, since),
    post: (text, slack) =>
      postDigest(text, slack, env('SLACK_CHANNEL') || '#camunda-hub-nightly-test-results'),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
