// Daily digest of generator-gap issues whose camunda-hub PR has already merged.
//
// hub-pr-check.yml keeps one issue per camunda-hub PR whose own change the generator cannot
// handle (label `generator-gap`, assigned to the PR's author). Once that PR merges, the gap is
// live on Hub main and the nightly will hit it, so a still-open issue is overdue. This lists
// those, oldest merge first, and closes issues whose camunda-hub PR was closed without merging.
// Silent when there is nothing to report.
//
// Runs under plain `node` (type stripping): no enums, no parameter properties.

export type HubPrState = 'open' | 'merged' | 'closed';

export interface GapIssue {
  number: number;
  url: string;
  title: string;
  createdAt: string;
  assignee: string;
}

export interface Item extends GapIssue {
  hubPr: number;
  hubState: HubPrState;
  mergedAt: string;
}

const HUB_PR_TITLE = /camunda-hub#(\d{1,9})\b/;

export function parseHubPr(title: string): number | null {
  const m = HUB_PR_TITLE.exec(title);
  return m?.[1] ? Number(m[1]) : null;
}

function daysBetween(fromIso: string, now: Date): number {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((now.getTime() - from) / 86_400_000));
}

// Slack mrkdwn treats & < > as markup. Titles and logins here come from GitHub, not from a PR
// author's free text, but escaping is cheap and keeps a crafted login from forming a link.
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, '');
}

export interface Digest {
  text: string;
  overdue: Item[];
  toClose: Item[];
  waiting: number;
}

const COOKBOOK_URL =
  'https://github.com/camunda/api-test-generator/blob/main/docs/hub-pr-check-cookbook.md';

export function buildDigest(items: Item[], now: Date): Digest {
  const overdue = items
    .filter((i) => i.hubState === 'merged')
    .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt));
  const toClose = items.filter((i) => i.hubState === 'closed');
  const waiting = items.filter((i) => i.hubState === 'open').length;

  if (overdue.length === 0) return { text: '', overdue, toClose, waiting };

  const lines = [
    `:hourglass_flowing_sand: *Generator fixes still pending for merged camunda-hub PRs* (${overdue.length})`,
  ];
  for (const i of overdue) {
    const who = i.assignee ? `assigned to \`${esc(i.assignee)}\`` : 'unassigned';
    lines.push(
      `• <https://github.com/camunda/camunda-hub/pull/${i.hubPr}|camunda-hub#${i.hubPr}> merged ` +
        `${daysBetween(i.mergedAt, now)}d ago — <${i.url}|api-test-generator#${i.number}> still open ` +
        `(${daysBetween(i.createdAt, now)}d), ${who}`,
    );
  }
  if (waiting > 0)
    lines.push(`_${waiting} more tracked for camunda-hub PRs that have not merged yet._`);
  lines.push(
    `<${COOKBOOK_URL}#keeping-track-of-pending-generator-fixes|📖 What to do about these>`,
  );
  return { text: lines.join('\n'), overdue, toClose, waiting };
}

// ---- I/O -------------------------------------------------------------------------------

interface ApiIssue {
  number: number;
  html_url: string;
  title: string;
  created_at: string;
  assignee: { login: string } | null;
  pull_request?: unknown;
}

interface ApiPull {
  state: string;
  merged_at: string | null;
}

async function api<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  // biome-ignore lint/plugin: runtime contract boundary for parsed GitHub/Slack JSON
  return (await resp.json()) as T;
}

const MAX_PAGES = 5;

/** `truncated` is true when the page cap was reached with a full last page, so some issues were never read. */
async function openGapIssues(
  repo: string,
  token: string,
): Promise<{ issues: GapIssue[]; truncated: boolean }> {
  const out: GapIssue[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api<ApiIssue[]>(
      `https://api.github.com/repos/${repo}/issues?labels=generator-gap&state=open&per_page=100&page=${page}`,
      token,
    );
    for (const i of batch) {
      if (i.pull_request) continue;
      out.push({
        number: i.number,
        url: i.html_url,
        title: i.title,
        createdAt: i.created_at,
        assignee: i.assignee?.login ?? '',
      });
    }
    if (batch.length < 100) return { issues: out, truncated: false };
  }
  return { issues: out, truncated: true };
}

async function hubPrState(
  pr: number,
  token: string,
): Promise<{ state: HubPrState; mergedAt: string }> {
  const p = await api<ApiPull>(
    `https://api.github.com/repos/camunda/camunda-hub/pulls/${pr}`,
    token,
  );
  if (p.merged_at) return { state: 'merged', mergedAt: p.merged_at };
  return { state: p.state === 'open' ? 'open' : 'closed', mergedAt: '' };
}

function env(name: string): string {
  return process.env[name] ?? '';
}

type SlackReply = { ok: boolean; error?: string };

/** Posts the digest. Slack answers HTTP 200 with `ok: false` for a rejected post (bot not in the channel, bad token), so
 * that has to throw: a warning would leave the run green with the alert not posted. `send` is injectable for tests. */
export async function postDigest(
  text: string,
  token: string,
  channel: string,
  send: (url: string, token: string, init: RequestInit) => Promise<SlackReply> = api<SlackReply>,
): Promise<void> {
  const resp = await send('https://slack.com/api/chat.postMessage', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text, unfurl_links: false }),
  });
  if (!resp.ok) throw new Error(`Slack post failed: ${resp.error}`);
}

export interface Resolved {
  items: Item[];
  /** One line per issue the digest could not judge. Each one is a silent omission if not reported. */
  failed: string[];
}

/** Looks up each gap issue's camunda-hub PR. An issue whose PR cannot be read, or whose title names
 * no PR, is not guessed at (it can neither nag nor close), but it is reported in `failed` so the run
 * fails rather than printing "nothing overdue" over a partial read. `lookup` is injectable for tests. */
export async function resolveItems(
  issues: GapIssue[],
  lookup: (pr: number) => Promise<{ state: HubPrState; mergedAt: string }>,
): Promise<Resolved> {
  const items: Item[] = [];
  const failed: string[] = [];
  for (const issue of issues) {
    const hubPr = parseHubPr(issue.title);
    if (hubPr === null) {
      failed.push(`api-test-generator#${issue.number}: no camunda-hub PR number in its title`);
      continue;
    }
    try {
      const { state, mergedAt } = await lookup(hubPr);
      items.push({ ...issue, hubPr, hubState: state, mergedAt });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push(`camunda-hub#${hubPr} (api-test-generator#${issue.number}): ${reason}`);
    }
  }
  return { items, failed };
}

/** Everything `runDigest` reads or writes, so a test can drive the whole run without the network. */
export interface DigestDeps {
  dryRun: boolean;
  /** Empty when the Slack token was not available. */
  slackToken: string;
  listIssues: () => Promise<{ issues: GapIssue[]; truncated: boolean }>;
  lookupPr: (pr: number) => Promise<{ state: HubPrState; mergedAt: string }>;
  closeIssue: (item: Item) => Promise<void>;
  post: (text: string, token: string) => Promise<void>;
  log: (line: string) => void;
  error: (line: string) => void;
  now: Date;
}

/** Reads the tracked issues, closes the ones whose PR was closed unmerged, posts the overdue digest,
 * then throws if any part of the read did not complete. Every problem is collected and reported at the
 * end: the run still posts and closes what it could read, so a partial read is never mistaken for a
 * clean one and never costs the readable part its alert. */
export async function runDigest(deps: DigestDeps): Promise<void> {
  const problems: string[] = [];
  const { issues, truncated } = await deps.listIssues();
  if (truncated) {
    problems.push(`more than ${MAX_PAGES * 100} open generator-gap issues; the rest were not read`);
  }
  const { items, failed } = await resolveItems(issues, deps.lookupPr);
  problems.push(...failed);

  const digest = buildDigest(items, deps.now);

  for (const i of digest.toClose) {
    deps.log(`camunda-hub#${i.hubPr} closed without merging: closing #${i.number}`);
    if (!deps.dryRun) await deps.closeIssue(i);
  }

  if (digest.text === '') {
    deps.log('Nothing overdue; staying silent.');
  } else {
    deps.log(digest.text);
    if (deps.dryRun) {
      deps.log('Dry run: not posting.');
    } else if (!deps.slackToken) {
      problems.push('overdue PRs found but SLACK_TOKEN is empty, so the digest was not posted');
    } else {
      await deps.post(digest.text, deps.slackToken);
    }
  }

  // A dry run still fails on problems: it is how a manual check shows a partial read.
  if (problems.length > 0) {
    for (const p of problems) deps.error(`::error title=Digest incomplete::${p}`);
    throw new Error(`Digest incomplete: ${problems.length} problem(s), see the errors above`);
  }
}

async function main(): Promise<void> {
  const repo = env('GITHUB_REPOSITORY') || 'camunda/api-test-generator';
  const ghToken = env('GITHUB_TOKEN');
  const hubToken = env('HUB_TOKEN');
  if (!ghToken || !hubToken) throw new Error('GITHUB_TOKEN and HUB_TOKEN are required');

  await runDigest({
    dryRun: env('DRY_RUN') === 'true',
    slackToken: env('SLACK_TOKEN'),
    listIssues: () => openGapIssues(repo, ghToken),
    lookupPr: (pr) => hubPrState(pr, hubToken),
    closeIssue: async (i) => {
      await api(`https://api.github.com/repos/${repo}/issues/${i.number}/comments`, ghToken, {
        method: 'POST',
        body: JSON.stringify({
          body: `camunda-hub#${i.hubPr} was closed without merging, so this generator gap will not land on Hub main. Closing.`,
        }),
      });
      await api(`https://api.github.com/repos/${repo}/issues/${i.number}`, ghToken, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }),
      });
    },
    post: (text, token) =>
      postDigest(text, token, env('SLACK_CHANNEL') || '#camunda-hub-pr-e2e-results'),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    now: new Date(),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
