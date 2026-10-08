// Picks which coverage gaps the coverage-fix agent may work on in one run, and enforces its limits
// in code so the agent's own playbook is not the only guard:
//   - at most one agent PR per API area, counting PRs from the last WINDOW_DAYS days and any still open. A PR that
//     was closed without being merged (a person decided against it, or it went stale) does not hold its area, so the
//     gap can be tried again; a merged PR still does for the window.
// There is no cap on the number of PRs per run or per week: the areas and the gaps are the limit.
//
// Only the gap kind the pilot allows is considered: a resource with no create-read-delete test
// (`lifecycle.createMissing` in the weekly report's summary.json). Everything else is the agent's
// report-only list and is not selected here.
//
// Runs under plain `node` (type stripping): no enums, no parameter properties.
//
//   node hub-coverage-fix-select.ts <summary.json> <rows.json> <agent-prs.json> [now-iso]

import { readFileSync } from 'node:fs';

export const WINDOW_DAYS = 7;
export const BRANCH_PREFIX = 'fix/coverage-';

export interface AgentPr {
  number: number;
  url: string;
  createdAt: string;
  headRefName: string;
  state: string;
}

export interface Row {
  operationId: string;
  area: string;
  // Scoped exclusions on the operation (a kind of test left out on purpose). Empty when there are none.
  notes: string[];
}

// The status-code gaps the agent may work on besides lifecycle gaps.
export const STATUS_CODES = ['403', '404'] as const;
export type StatusCode = (typeof STATUS_CODES)[number];

// An operation that lacks a test for one documented status code, and is not held or excluded on purpose.
export interface StatusGap {
  operationId: string;
  code: StatusCode;
}

// An open nightly-api-fix PR with its diff, as hub-open-fix-prs.sh writes it.
export interface OpenFixPr {
  number: number;
  url: string;
  diff: string;
}

export interface Candidate {
  // A lifecycle gap names a resource (ProjectSnapshot); a status gap names an operation (removeMember).
  resource: string;
  createOp: string;
  area: string;
  kind: 'lifecycle' | 'status';
  code?: StatusCode;
}

export interface Skipped {
  resource: string;
  reason: string;
}

export interface Selection {
  budget: number;
  recentCount: number;
  candidates: Candidate[];
  skipped: Skipped[];
}

// ProjectSnapshot -> project-snapshot, the form the agent uses in its branch name.
export function kebab(resource: string): string {
  return resource.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// The part of the agent's branch name that identifies a candidate: project-snapshot for a lifecycle gap,
// remove-member-403 for a status gap.
export function branchKey(c: Candidate): string {
  return c.kind === 'status' && c.code ? `${kebab(c.resource)}-${c.code}` : kebab(c.resource);
}

// fix/coverage-project-snapshot-123456 -> project-snapshot. Null for any other branch.
export function resourceFromBranch(branch: string): string | null {
  if (!branch.startsWith(BRANCH_PREFIX)) return null;
  const m = /^(.+)-\d+$/.exec(branch.slice(BRANCH_PREFIX.length));
  return m?.[1] ?? null;
}

function isRecent(createdAt: string, now: Date): boolean {
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < WINDOW_DAYS * 86_400_000;
}

export function select(
  createMissing: string[],
  rows: Row[],
  prs: AgentPr[],
  now: Date,
  known: string[] = [],
  openFixPrs: OpenFixPr[] = [],
  statusGaps: StatusGap[] = [],
): Selection {
  const agentPrs = prs.filter((p) => p.headRefName.startsWith(BRANCH_PREFIX));
  const recent = agentPrs.filter((p) => isRecent(p.createdAt, now));
  // No weekly cap: every gap can get a PR, one per area. The budget the verifier checks is the number of gaps.
  const budget = createMissing.length + statusGaps.length;

  const areaOf = new Map<string, string>();
  for (const r of rows) areaOf.set(r.operationId, r.area);

  // Resolve a prior PR's resource to its area through EVERY create operation in the report, not only
  // the ones still missing a test: a resource the earlier PR already fixed is no longer in
  // createMissing, but its area is still busy.
  const areaByKebab = new Map<string, string>();
  for (const r of rows) {
    if (r.operationId.startsWith('create') && r.operationId.length > 'create'.length) {
      areaByKebab.set(kebab(r.operationId.slice('create'.length)), r.area);
    }
  }

  // A status-gap branch is remove-member-403: map each operation and code to its area too.
  for (const r of rows) {
    for (const code of STATUS_CODES) areaByKebab.set(`${kebab(r.operationId)}-${code}`, r.area);
  }

  // An area is busy when an agent PR for one of its resources is recent or still open. A PR closed without being
  // merged does not count: the gap is still there, and a retry is the point.
  const busyAreas = new Set<string>();
  for (const p of agentPrs) {
    const state = p.state.toLowerCase();
    if (state === 'closed') continue;
    if (!isRecent(p.createdAt, now) && state !== 'open') continue;
    const k = resourceFromBranch(p.headRefName);
    const area = k ? areaByKebab.get(k) : undefined;
    if (area) busyAreas.add(area);
  }

  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];
  const takenAreas = new Set<string>();
  const knownSet = new Set(known);
  for (const resource of [...createMissing].sort()) {
    const createOp = `create${resource}`;
    const area = areaOf.get(createOp);
    if (knownSet.has(resource)) {
      // The report marks it known: its create operation is suppressed or excluded in the config, tracked by an
      // issue. The playbook says such gaps are never touched, so the agent must not be told they are allowed work.
      skipped.push({
        resource,
        reason: 'known and tracked: its create operation is suppressed or excluded in the config',
      });
    } else if (openFixPrs.some((p) => p.diff.includes(createOp))) {
      // Another open fix PR already touches this create operation (an entity-kinds entry, a suppression, ...).
      // Enforced here, before the agent starts, so it does not depend on the agent reading the PR list.
      const covering = openFixPrs.find((p) => p.diff.includes(createOp));
      skipped.push({
        resource,
        reason: `${createOp} is already covered by the open PR #${covering?.number ?? '?'}`,
      });
    } else if (!area) {
      skipped.push({ resource, reason: `no operation ${createOp} in the report` });
    } else if (busyAreas.has(area)) {
      skipped.push({ resource, reason: `area ${area} already has an agent PR (recent or open)` });
    } else if (takenAreas.has(area)) {
      skipped.push({ resource, reason: `area ${area} already has a candidate in this run` });
    } else {
      candidates.push({ resource, createOp, area, kind: 'lifecycle' });
      takenAreas.add(area);
    }
  }

  // Status gaps (403 and 404) come after lifecycle gaps, under the same area and duplicate rules.
  for (const gap of [...statusGaps].sort(
    (a, b) => a.operationId.localeCompare(b.operationId) || a.code.localeCompare(b.code),
  )) {
    const label = `${gap.operationId} ${gap.code}`;
    const area = areaOf.get(gap.operationId);
    const covering = openFixPrs.find((p) => p.diff.includes(gap.operationId));
    if (covering) {
      skipped.push({
        resource: label,
        reason: `${gap.operationId} is already covered by the open PR #${covering.number}`,
      });
    } else if (!area) {
      skipped.push({ resource: label, reason: `no operation ${gap.operationId} in the report` });
    } else if (busyAreas.has(area)) {
      skipped.push({
        resource: label,
        reason: `area ${area} already has an agent PR (recent or open)`,
      });
    } else if (takenAreas.has(area)) {
      skipped.push({ resource: label, reason: `area ${area} already has a candidate in this run` });
    } else {
      candidates.push({
        resource: gap.operationId,
        createOp: gap.operationId,
        area,
        kind: 'status',
        code: gap.code,
      });
      takenAreas.add(area);
    }
  }
  return { budget, recentCount: recent.length, candidates, skipped };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// The parsers below are strict on purpose. This script enforces safety limits, so a report or a PR list
// that does not look as expected must stop the run, never be read as "nothing there" (which would turn a
// format change into a silently disabled agent, or an undercounted weekly cap into extra budget).

export function parseCreateMissing(summary: unknown): string[] {
  const list =
    isRecord(summary) && isRecord(summary.lifecycle) ? summary.lifecycle.createMissing : undefined;
  if (!Array.isArray(list) || !list.every((x): x is string => typeof x === 'string')) {
    throw new Error(
      'summary.json has no lifecycle.createMissing list of resource names: the report format may have changed',
    );
  }
  return list;
}

export function parseKnown(summary: unknown): string[] {
  const list =
    isRecord(summary) && isRecord(summary.lifecycle) ? summary.lifecycle.known : undefined;
  if (!Array.isArray(list) || !list.every((x): x is string => typeof x === 'string')) {
    throw new Error(
      'summary.json has no lifecycle.known list of resource names: the report format may have changed',
    );
  }
  return list;
}

export function parseOpenFixPrs(prs: unknown): OpenFixPr[] {
  if (!Array.isArray(prs)) throw new Error('the open fix PR list is not a list');
  return prs.map((p, i) => {
    if (
      !isRecord(p) ||
      typeof p.number !== 'number' ||
      typeof p.url !== 'string' ||
      typeof p.diff !== 'string'
    ) {
      throw new Error(`open fix PR record ${i} does not have number, url and diff`);
    }
    return { number: p.number, url: p.url, diff: p.diff };
  });
}

export function parseRows(rows: unknown): Row[] {
  if (!Array.isArray(rows)) throw new Error('rows.json is not a list');
  return rows.map((r, i) => {
    if (!isRecord(r) || typeof r.operationId !== 'string' || typeof r.area !== 'string') {
      throw new Error(`rows.json row ${i} has no operationId and area`);
    }
    const notes = r.notes === undefined ? [] : r.notes;
    if (!Array.isArray(notes) || !notes.every((n): n is string => typeof n === 'string')) {
      throw new Error(`rows.json row ${i} has notes that are not a list of strings`);
    }
    return { operationId: r.operationId, area: r.area, notes };
  });
}

// Operations that lack a 403 or 404 test and are not held on purpose. summary.json lists every operation
// missing a status in `missing`, and the ones held by a whole-operation exclusion in `heldCells`. An operation
// with a scoped exclusion (a row note) is left out too: someone decided on purpose not to test that kind.
export function parseStatusGaps(summary: unknown, rows: Row[]): StatusGap[] {
  const missing = isRecord(summary) && isRecord(summary.missing) ? summary.missing : undefined;
  const held = isRecord(summary) && isRecord(summary.heldCells) ? summary.heldCells : undefined;
  if (!missing || !held) {
    throw new Error(
      'summary.json has no missing and heldCells lists: the report format may have changed',
    );
  }
  const notesOf = new Map(rows.map((r) => [r.operationId, r.notes]));
  const gaps: StatusGap[] = [];
  for (const code of STATUS_CODES) {
    const m = missing[code];
    const h = held[code];
    if (
      !Array.isArray(m) ||
      !m.every((x): x is string => typeof x === 'string') ||
      !Array.isArray(h) ||
      !h.every((x): x is string => typeof x === 'string')
    ) {
      throw new Error(`summary.json has no missing and heldCells list for ${code}`);
    }
    for (const op of m) {
      if (h.includes(op) || (notesOf.get(op) ?? []).length > 0) continue;
      gaps.push({ operationId: op, code });
    }
  }
  return gaps;
}

export function parsePrs(prs: unknown): AgentPr[] {
  if (!Array.isArray(prs)) throw new Error('the PR list is not a list');
  return prs.map((p, i) => {
    if (
      !isRecord(p) ||
      typeof p.number !== 'number' ||
      typeof p.url !== 'string' ||
      typeof p.createdAt !== 'string' ||
      typeof p.headRefName !== 'string' ||
      typeof p.state !== 'string'
    ) {
      throw new Error(`PR record ${i} does not have number, url, createdAt, headRefName and state`);
    }
    // An unparseable date would read as "not recent" and widen the weekly budget: stop instead.
    if (Number.isNaN(Date.parse(p.createdAt))) {
      throw new Error(`PR record ${i} has a createdAt that is not a date: ${p.createdAt}`);
    }
    return {
      number: p.number,
      url: p.url,
      createdAt: p.createdAt,
      headRefName: p.headRefName,
      state: p.state,
    };
  });
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const [summaryPath, rowsPath, prsPath, nowIso, openFixPath] = process.argv.slice(2);
  if (!summaryPath || !rowsPath || !prsPath) {
    console.error(
      'usage: hub-coverage-fix-select.ts <summary.json> <rows.json> <agent-prs.json> [now-iso] [open-fix-prs.json]',
    );
    process.exit(2);
  }
  const now = nowIso ? new Date(nowIso) : new Date();
  try {
    const summary = readJson(summaryPath);
    const rows = parseRows(readJson(rowsPath));
    const selection = select(
      parseCreateMissing(summary),
      rows,
      parsePrs(readJson(prsPath)),
      now,
      parseKnown(summary),
      openFixPath ? parseOpenFixPrs(readJson(openFixPath)) : [],
      parseStatusGaps(summary, rows),
    );
    process.stdout.write(`${JSON.stringify(selection, null, 2)}\n`);
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
