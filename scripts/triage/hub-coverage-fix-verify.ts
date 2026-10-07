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
//   node hub-coverage-fix-verify.ts <prs.json> <selection.json> <result.json> <run-id> <true|false dry run> <bot logins, comma separated> <baseline PR number> <list limit> <pre-run PRs.json>

import { readFileSync } from 'node:fs';
import { checkChange, type PrChange, parseChanges } from './hub-coverage-fix-diff.ts';
import {
  BRANCH_PREFIX,
  branchKey,
  type Candidate,
  type Selection,
  STATUS_CODES,
} from './hub-coverage-fix-select.ts';

export interface RunPr {
  number: number;
  url: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  author: string;
  labels: string[];
  state: string;
  headRefOid: string;
}

// What a PR looked like just before the agent started: enough to see that it changed during the run. It holds
// what the guarded checks look at (state, commit, draft, base, labels), so changing any of them is noticed.
export interface PreRunPr {
  number: number;
  state: string;
  headRefOid: string;
  isDraft: boolean;
  baseRefName: string;
  labels: string[];
}

export const REQUIRED_LABELS = ['nightly-api-fix', 'auto-generated', 'hub'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Label names, sorted, so two lists can be compared as text.
function labelNames(labels: unknown[]): string[] {
  return labels
    .map((l) => (isRecord(l) && typeof l.name === 'string' ? l.name : ''))
    .filter((n) => n !== '')
    .sort();
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
      typeof p.state !== 'string' ||
      typeof p.headRefOid !== 'string' ||
      !Array.isArray(p.labels)
    ) {
      throw new Error(`PR record ${i} does not have the expected fields`);
    }
    const labels = labelNames(p.labels);
    return {
      number: p.number,
      url: p.url,
      headRefName: p.headRefName,
      baseRefName: p.baseRefName,
      isDraft: p.isDraft,
      author: p.author.login,
      labels,
      state: p.state,
      headRefOid: p.headRefOid,
    };
  });
}

export function parsePreRun(prs: unknown): PreRunPr[] {
  if (!Array.isArray(prs)) throw new Error('the pre-run PR snapshot is not a list');
  return prs.map((p, i) => {
    if (
      !isRecord(p) ||
      typeof p.number !== 'number' ||
      typeof p.state !== 'string' ||
      typeof p.headRefOid !== 'string' ||
      typeof p.isDraft !== 'boolean' ||
      typeof p.baseRefName !== 'string' ||
      !Array.isArray(p.labels)
    ) {
      throw new Error(
        `pre-run PR record ${i} does not have number, state, headRefOid, isDraft, baseRefName and labels`,
      );
    }
    return {
      number: p.number,
      state: p.state,
      headRefOid: p.headRefOid,
      isDraft: p.isDraft,
      baseRefName: p.baseRefName,
      labels: labelNames(p.labels),
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
    const kind = c.kind === undefined ? 'lifecycle' : c.kind;
    if (kind !== 'lifecycle' && kind !== 'status') {
      throw new Error(`selection.json candidate ${i} has an unknown kind`);
    }
    const code = STATUS_CODES.find((x) => x === c.code);
    if (kind === 'status' && !code) {
      throw new Error(`selection.json candidate ${i} is a status gap without a 403 or 404 code`);
    }
    const candidate: Candidate = { resource: c.resource, createOp: c.createOp, area: c.area, kind };
    if (kind === 'status' && code) candidate.code = code;
    return candidate;
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

// The list holds every PR of the agent's account, newest first, up to `limit`. A full list may have lost
// its oldest entries, and an old PR that is reopened or given a commit during the run could be one of them,
// so a full list is never accepted. (A list that is empty is caught by the workflow, which knows the account
// has opened PRs before.)
export function assertComplete(prs: RunPr[], limit: number): void {
  if (prs.length >= limit) {
    throw new Error(
      `the list of the agent account's PRs holds ${prs.length} PRs, the most it can return: it may be cut off, so the run cannot be verified`,
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
  preRun: PreRunPr[],
  changes?: Map<number, PrChange>,
  provisioned = '',
): string[] {
  const violations: string[] = [];
  const candidateByKebab = new Map(selection.candidates.map((c) => [branchKey(c), c]));

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
    // What the PR changed, read from GitHub: the playbook's file and config boundaries are checked here too.
    if (candidate && changes) {
      const change = changes.get(p.number);
      if (!change) {
        violations.push(`${p.url}: its changed files could not be checked`);
      } else {
        for (const v of checkChange(candidate, change, provisioned))
          violations.push(`${p.url}: ${v}`);
      }
    }
    if (p.state !== 'OPEN') {
      violations.push(`${p.url}: not open (${p.state}), so there is nothing to review`);
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

  // A PR the agent's account already had before the run can still become agent work: reopened, or given a
  // new commit. The number baseline cannot see that, so compare each such PR with its snapshot.
  const before = new Map(preRun.map((p) => [p.number, p]));
  for (const p of allPrs) {
    if (p.number > baseline || !bots.has(p.author)) continue;
    const was = before.get(p.number);
    if (!was) continue;
    const changes: string[] = [];
    if (was.state !== p.state) changes.push(`state ${was.state} to ${p.state}`);
    if (was.headRefOid !== p.headRefOid) {
      changes.push(`commit ${was.headRefOid.slice(0, 7)} to ${p.headRefOid.slice(0, 7)}`);
    }
    if (was.isDraft !== p.isDraft) changes.push(`draft ${was.isDraft} to ${p.isDraft}`);
    if (was.baseRefName !== p.baseRefName) {
      changes.push(`base ${was.baseRefName} to ${p.baseRefName}`);
    }
    const wasLabels = [...was.labels].sort();
    const nowLabels = [...p.labels].sort();
    if (wasLabels.join(',') !== nowLabels.join(',')) {
      changes.push(`labels [${wasLabels.join(', ')}] to [${nowLabels.join(', ')}]`);
    }
    if (changes.length > 0) {
      violations.push(`${p.url}: changed during the run (${changes.join('; ')})`);
    }
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
  const [
    prsPath,
    selectionPath,
    resultPath,
    runId,
    dryRun,
    logins,
    baselineArg,
    limitArg,
    preRunPath,
    changesPath,
    provisionedPath,
  ] = process.argv.slice(2);
  const baseline = Number(baselineArg);
  const limit = Number(limitArg);
  if (
    !prsPath ||
    !selectionPath ||
    !resultPath ||
    !runId ||
    !dryRun ||
    !logins ||
    !preRunPath ||
    !changesPath ||
    !provisionedPath ||
    !Number.isInteger(baseline) ||
    !Number.isInteger(limit)
  ) {
    console.error(
      'usage: hub-coverage-fix-verify.ts <prs.json> <selection.json> <result.json> <run-id> <true|false> <bot logins> <baseline PR number> <list limit> <pre-run PRs.json> <pr-changes.json> <fixture-setup-script>',
    );
    process.exit(2);
  }
  try {
    const selection = parseSelection(JSON.parse(readFileSync(selectionPath, 'utf8')));
    const prs = parseRunPrs(JSON.parse(readFileSync(prsPath, 'utf8')));
    const reported = reportedPrUrls(JSON.parse(readFileSync(resultPath, 'utf8')));
    const preRun = parsePreRun(JSON.parse(readFileSync(preRunPath, 'utf8')));
    const changes = parseChanges(JSON.parse(readFileSync(changesPath, 'utf8')));
    const provisioned = readFileSync(provisionedPath, 'utf8');
    assertComplete(prs, limit);
    const violations = verify(
      prs,
      selection,
      reported,
      runId,
      dryRun === 'true',
      logins.split(','),
      baseline,
      preRun,
      changes,
      provisioned,
    );
    for (const v of violations) console.error(`::error::${v}`);
    process.stdout.write(`${JSON.stringify({ violations }, null, 2)}\n`);
    process.exit(violations.length === 0 ? 0 : 1);
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
