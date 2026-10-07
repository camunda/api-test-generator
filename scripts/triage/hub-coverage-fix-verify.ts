// Checks what the coverage-fix agent ACTUALLY did, from the PRs GitHub has after it ran, instead of
// trusting the result file the agent wrote about itself. Used by hub-coverage-fix.yml.
//
// A PR belongs to this run when its branch is `fix/coverage-<resource>-<run id>`. The checks:
//   - a dry run opened nothing,
//   - no more PRs than the budget the job computed, only for candidate resources, one per API area,
//   - every PR is a draft against main with the labels the playbook requires,
//   - the PRs the agent reported are exactly the PRs that exist,
//   - the agent's account opened no other PR during the run. "During the run" is decided by the PR number: the
//     caller records the newest PR number just before the agent starts, and every later PR by the account must
//     be one of this run's PRs. Nothing here depends on a branch name the agent chose, so there are no
//     exemptions; if other automation opens a PR in the same window the run fails closed.
//
// Runs under plain `node` (type stripping): no enums, no parameter properties.
//
//   node hub-coverage-fix-verify.ts <prs.json> <selection.json> <result.json> <run-id> <true|false dry run> <bot logins, comma separated> <baseline PR number> <list limit>

import { readFileSync } from 'node:fs';
import { BRANCH_PREFIX, type Candidate, kebab, type Selection } from './hub-coverage-fix-select.ts';

export interface RunPr {
  number: number;
  url: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  author: string;
  labels: string[];
}

export const REQUIRED_LABELS = ['nightly-api-fix', 'auto-generated'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseRunPrs(prs: unknown): RunPr[] {
  if (!Array.isArray(prs)) throw new Error('the PR list is not a list');
  return prs.map((p, i) => {
    if (
      !isRecord(p) ||
      typeof p.number !== 'number' ||
      typeof p.url !== 'string' ||
      typeof p.headRefName !== 'string' ||
      typeof p.baseRefName !== 'string' ||
      typeof p.isDraft !== 'boolean' ||
      !isRecord(p.author) ||
      typeof p.author.login !== 'string' ||
      !Array.isArray(p.labels)
    ) {
      throw new Error(`PR record ${i} does not have the expected fields`);
    }
    const labels = p.labels.map((l) => (isRecord(l) && typeof l.name === 'string' ? l.name : ''));
    return {
      number: p.number,
      url: p.url,
      headRefName: p.headRefName,
      baseRefName: p.baseRefName,
      isDraft: p.isDraft,
      author: p.author.login,
      labels,
    };
  });
}

export function parseSelection(v: unknown): Selection {
  if (!isRecord(v) || typeof v.budget !== 'number' || !Array.isArray(v.candidates)) {
    throw new Error('selection.json has no budget and candidates');
  }
  const candidates: Candidate[] = v.candidates.map((c, i) => {
    if (
      !isRecord(c) ||
      typeof c.resource !== 'string' ||
      typeof c.createOp !== 'string' ||
      typeof c.area !== 'string'
    ) {
      throw new Error(`selection.json candidate ${i} has no resource, createOp and area`);
    }
    return { resource: c.resource, createOp: c.createOp, area: c.area };
  });
  return { budget: v.budget, recentCount: 0, candidates, skipped: [] };
}

export function reportedPrUrls(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.gaps)) {
    throw new Error('the agent result has no gaps list');
  }
  const urls: string[] = [];
  for (const g of result.gaps) {
    if (isRecord(g) && g.action === 'fix-pr' && typeof g.pr_url === 'string' && g.pr_url !== '') {
      urls.push(g.pr_url);
    }
  }
  return urls;
}

function runResource(branch: string, runId: string): string | null {
  const suffix = `-${runId}`;
  if (!branch.startsWith(BRANCH_PREFIX) || !branch.endsWith(suffix)) return null;
  const middle = branch.slice(BRANCH_PREFIX.length, branch.length - suffix.length);
  return middle === '' ? null : middle;
}

// The PR list is the newest `limit` PRs. If it is full and its oldest entry is still newer than the baseline,
// PRs from the run may have fallen off the end: stop instead of verifying an incomplete list.
export function assertComplete(prs: RunPr[], baseline: number, limit: number): void {
  if (prs.length >= limit && Math.min(...prs.map((p) => p.number)) > baseline) {
    throw new Error(
      `the PR list holds ${prs.length} PRs, all newer than #${baseline}: it may be cut off, so the run cannot be verified`,
    );
  }
}

export function verify(
  allPrs: RunPr[],
  selection: Selection,
  reported: string[],
  runId: string,
  dryRun: boolean,
  botLogins: string[],
  baseline: number,
): string[] {
  const violations: string[] = [];
  const candidateByKebab = new Map(selection.candidates.map((c) => [kebab(c.resource), c]));

  // Only PRs created after the baseline can be this run's work.
  const prs = allPrs.filter((p) => p.number > baseline);
  const ours = prs.filter((p) => runResource(p.headRefName, runId) !== null);
  const bots = new Set(botLogins);
  const strays = prs.filter(
    (p) => bots.has(p.author) && runResource(p.headRefName, runId) === null,
  );

  if (dryRun && ours.length > 0) {
    violations.push(`a dry run opened ${ours.length} PR(s): ${ours.map((p) => p.url).join(', ')}`);
  }
  if (ours.length > selection.budget) {
    violations.push(`${ours.length} PRs opened, over the budget of ${selection.budget}`);
  }

  const areas = new Map<string, string>();
  for (const p of ours) {
    const key = runResource(p.headRefName, runId) ?? '';
    const candidate = candidateByKebab.get(key);
    if (!candidate) {
      violations.push(`${p.url}: resource "${key}" is not one of this run's candidates`);
    } else {
      const other = areas.get(candidate.area);
      if (other) {
        violations.push(`${p.url} and ${other}: two PRs for the area ${candidate.area}`);
      }
      areas.set(candidate.area, p.url);
    }
    if (!p.isDraft) violations.push(`${p.url}: not a draft`);
    if (p.baseRefName !== 'main') violations.push(`${p.url}: base is ${p.baseRefName}, not main`);
    for (const label of REQUIRED_LABELS) {
      if (!p.labels.includes(label)) violations.push(`${p.url}: missing the label ${label}`);
    }
  }

  for (const p of strays) {
    violations.push(
      `${p.url}: opened by the agent account during the run on branch ${p.headRefName}, which is not one of this run's coverage PRs`,
    );
  }

  const actual = new Set(ours.map((p) => p.url));
  const claimed = new Set(reported);
  for (const url of actual) {
    if (!claimed.has(url)) violations.push(`${url}: exists but the agent did not report it`);
  }
  for (const url of claimed) {
    if (!actual.has(url)) violations.push(`${url}: reported by the agent but not found on GitHub`);
  }
  return violations;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const [prsPath, selectionPath, resultPath, runId, dryRun, logins, baselineArg, limitArg] =
    process.argv.slice(2);
  const baseline = Number(baselineArg);
  const limit = Number(limitArg);
  if (
    !prsPath ||
    !selectionPath ||
    !resultPath ||
    !runId ||
    !dryRun ||
    !logins ||
    !Number.isInteger(baseline) ||
    !Number.isInteger(limit)
  ) {
    console.error(
      'usage: hub-coverage-fix-verify.ts <prs.json> <selection.json> <result.json> <run-id> <true|false> <bot logins> <baseline PR number> <list limit>',
    );
    process.exit(2);
  }
  try {
    const selection = parseSelection(JSON.parse(readFileSync(selectionPath, 'utf8')));
    const prs = parseRunPrs(JSON.parse(readFileSync(prsPath, 'utf8')));
    const reported = reportedPrUrls(JSON.parse(readFileSync(resultPath, 'utf8')));
    assertComplete(prs, baseline, limit);
    const violations = verify(
      prs,
      selection,
      reported,
      runId,
      dryRun === 'true',
      logins.split(','),
      baseline,
    );
    for (const v of violations) console.error(`::error::${v}`);
    process.stdout.write(`${JSON.stringify({ violations }, null, 2)}\n`);
    process.exit(violations.length === 0 ? 0 : 1);
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
