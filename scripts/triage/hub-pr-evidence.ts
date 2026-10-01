// Deterministic evidence for the Hub PR check's `classify` job.
//
// Ported from camunda-hub's AlwaysGreen triage (.github/scripts/alwaysgreen/classify.py): the
// agent gets Playwright's reports parsed into per-spec attempt histories (and whether any
// attempt passed) instead of re-parsing raw JSON, and the failing set is fingerprinted.
//
// There is deliberately no retry-based "flaky" verdict here, unlike AlwaysGreen: Playwright exits
// successfully when a retry passes and `classify` only runs after a failed run, so a flaky-only
// verdict could never fire for a real flaky run, and could only mask some other failed step.
//
// Runs under plain `node` (type stripping), so keep it to erasable syntax: no enums, no
// parameter properties.

import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// One shared definition of "this attempt did not pass". AlwaysGreen had two that drifted, so a
// spec that timed out on every attempt was reported as flaky.
export const FAILED_ATTEMPT_STATUSES: ReadonlySet<string> = new Set([
  'failed',
  'timedOut',
  'timed_out',
  'interrupted',
]);

export interface SpecEvidence {
  file: string;
  title: string;
  project: string;
  statuses: string[];
  // True when no attempt passed: a failed -> passed sequence is flakiness, never a defect.
  deterministic: boolean;
  error: string;
}

export interface Evidence {
  // False when no Playwright JSON report was readable. A run that produced no evidence must
  // not look like one whose tests passed.
  reportsPresent: boolean;
  total: number;
  failing: SpecEvidence[];
  flaky: SpecEvidence[];
}

type Json = unknown;

function isRecord(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Playwright nests suites[].suites[].specs[]; a one-level walk finds nothing on a real report.
export function* iterSpecs(node: Json): Generator<Record<string, Json>> {
  if (Array.isArray(node)) {
    for (const item of node) yield* iterSpecs(item);
    return;
  }
  if (!isRecord(node)) return;
  const specs = node.specs;
  if (Array.isArray(specs)) {
    for (const s of specs) if (isRecord(s)) yield s;
  }
  for (const value of Object.values(node)) {
    if (typeof value === 'object' && value !== null) yield* iterSpecs(value);
  }
}

function resultsOf(test: Json): Record<string, Json>[] {
  if (!isRecord(test) || !Array.isArray(test.results)) return [];
  return test.results.filter(isRecord);
}

function statusesOf(results: Record<string, Json>[]): string[] {
  return results.map((r) => (typeof r.status === 'string' ? r.status : ''));
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

// Playwright assertion errors are full of colour codes; they waste tokens and wreck a summary.
export function cleanError(message: Json, limit = 600): string {
  const text = typeof message === 'string' ? message : '';
  return [...text.replace(ANSI, '')]
    .filter((ch) => ch >= ' ' || ch === '\n')
    .join('')
    .slice(0, limit);
}

export function isFlakySpec(spec: Record<string, Json>): boolean {
  if (spec.ok === false) return false;
  const tests = Array.isArray(spec.tests) ? spec.tests : [];
  return tests.some((t) => {
    const statuses = statusesOf(resultsOf(t));
    return (
      statuses.length > 1 &&
      statuses[statuses.length - 1] === 'passed' &&
      statuses.slice(0, -1).some((s) => FAILED_ATTEMPT_STATUSES.has(s))
    );
  });
}

function buildSpec(spec: Record<string, Json>): SpecEvidence {
  const tests = Array.isArray(spec.tests) ? spec.tests : [];
  // One entry per project: pick the one with a failing attempt, not blindly the first.
  const hasFailure = (t: Json) =>
    statusesOf(resultsOf(t)).some((s) => FAILED_ATTEMPT_STATUSES.has(s));
  const chosen = tests.find(hasFailure) ?? tests[0];
  const results = resultsOf(chosen);
  const errored = results.filter((r) => isRecord(r.error));
  const source = errored.at(-1) ?? results.at(-1);
  const statuses = statusesOf(results);
  return {
    file: typeof spec.file === 'string' ? spec.file : '',
    title: typeof spec.title === 'string' ? spec.title : '',
    project: isRecord(chosen) && typeof chosen.projectName === 'string' ? chosen.projectName : '',
    statuses,
    // "No attempt passed", computed from the absence of `passed`: a sequence such as
    // failed, skipped has no passing attempt and is not flakiness evidence.
    deterministic: statuses.length > 0 && !statuses.includes('passed'),
    error: cleanError(isRecord(source?.error) ? source.error.message : ''),
  };
}

export function buildEvidence(reports: Json[]): Evidence {
  const evidence: Evidence = {
    reportsPresent: reports.length > 0,
    total: 0,
    failing: [],
    flaky: [],
  };
  for (const report of reports) {
    for (const spec of iterSpecs(report)) {
      evidence.total += 1;
      if (spec.ok === false) evidence.failing.push(buildSpec(spec));
      else if (isFlakySpec(spec)) evidence.flaky.push(buildSpec(spec));
    }
  }
  return evidence;
}

// Identity of "the same failure" on one PR, so repeated pushes with the same failing set
// collapse into one alert. The category is deliberately not an input: the agent can word the
// same failure differently between runs, and that must not re-page.
//
// Deduplication is only valid when a failing set (or unmapped operations) was actually observed.
// With no readable report, or a failed run that shows no failing spec, sameness cannot be
// established, so the fingerprint is salted with the commit and every push stays distinct.
export function fingerprint(pr: string, evidence: Evidence, unmapped: string, salt = ''): string {
  const failing = evidence.failing.map((s) => `${s.file}::${s.title}`).sort();
  const ops = unmapped
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
  const observed = failing.length > 0 || ops.length > 0;
  const joined = [
    'hub-pr',
    pr,
    ...failing,
    '|',
    ...ops,
    ...(observed ? [] : ['unobserved', salt]),
  ].join('::');
  return createHash('sha256').update(joined).digest('hex').slice(0, 8);
}

function readReports(dir: string): Json[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Json[] = [];
  for (const name of names) {
    if (!/^pw-.*\.json$/.test(name)) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')));
    } catch {
      // A half-written report is no evidence; the others still count.
    }
  }
  return out;
}

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : '';
}

function main(): void {
  const evidence = buildEvidence(readReports(arg('reports')));
  const unmapped = arg('unmapped');
  const fp = fingerprint(arg('pr') || arg('sha'), evidence, unmapped, arg('sha'));
  writeFileSync(arg('out'), `${JSON.stringify({ ...evidence, fingerprint: fp }, null, 2)}\n`);

  // Every value is an enum literal, hex digest or a newline-stripped string, so none can inject
  // extra lines into $GITHUB_OUTPUT.
  const lines = [
    `fingerprint=${fp}`,
    `failing=${evidence.failing.length}`,
    `flaky=${evidence.flaky.length}`,
  ];
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `${lines.join('\n')}\n`);
  else console.log(lines.join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
