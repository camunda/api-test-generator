// Decides whether a Hub PR-check verdict is safe to auto-open a fix PR for, and for which
// operations. This is the policy gate for the PR-check-triggered autofix: the PR check itself is
// read-only and runs on an untrusted repository_dispatch, so it only classifies; a separate,
// trusted workflow_run consumer (running from main with the qa-processes token) reads the verdict
// artifact, calls this gate, and — only when it says so — dispatches the fix agent.
//
// Only a high-confidence `generator-gap` is auto-fixable: that is the generator not yet modelling a
// new/changed endpoint, or a generated assertion that is over-generalized — a test-generation bug
// with a minimal, mechanical fix, the same class the nightly fixer already opens PRs for. Every
// other verdict stays a human decision: `product` is a suppress-not-fix call, and `infra`, `flaky`
// and `unknown` are not fixes at all.
//
// Runs under plain `node` (type stripping): no enums, no parameter properties.
//
//   node hub-pr-autofix-gate.ts <verdict.json> <open-fix-prs.json>

import { readFileSync } from 'node:fs';

// The auto-fixable category and the confidence it must carry. A verdict outside these is never
// dispatched from here.
export const FIXABLE_CATEGORY = 'generator-gap';
export const REQUIRED_CONFIDENCE = 'high';

// The classify job's verdict, as it is written to the classify-verdict.json artifact. The parse step
// in hub-pr-check.yml already enforces the category/confidence enums and sanitizes the operation ids.
export interface Verdict {
  category: string;
  confidence: string;
  affectedOperationIds: string[];
  // false when the run produced no readable test evidence (hub-pr-evidence.ts observed=false): the
  // failure could not be attributed, so it is never auto-fixed.
  observed: boolean;
}

// An open nightly-api-fix PR with its diff, as hub-open-fix-prs.sh writes it (the same shape the
// coverage-fix selector dedups against).
export interface OpenFixPr {
  number: number;
  url: string;
  diff: string;
}

export interface GateResult {
  // Whether to dispatch the fix agent at all.
  dispatch: boolean;
  // The operations to fix: the affected set minus any already covered by an open fix PR.
  operationIds: string[];
  // A human-readable reason, logged on the run and surfaced in the skip/dispatch summary.
  reason: string;
}

function skip(reason: string): GateResult {
  return { dispatch: false, operationIds: [], reason };
}

// An operation is "covered" when its id appears in an open fix PR's diff as a whole identifier (not a
// substring, so getWorkspace matches neither getWorkspaceEnvironments nor getWorkspace-v2). The
// boundary class includes the "." and "-" the classifier permits in an operationId
// (hub-pr-check.yml sanitizes to [A-Za-z0-9_.-]), so those count as part of the identifier, not as a
// delimiter that would let a prefix match.
function coveredByOpenPr(op: string, openFixPrs: OpenFixPr[]): boolean {
  const escaped = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const whole = new RegExp(`(^|[^A-Za-z0-9_.-])${escaped}([^A-Za-z0-9_.-]|$)`);
  return openFixPrs.some((p) => typeof p.diff === 'string' && whole.test(p.diff));
}

export function gate(verdict: Verdict, openFixPrs: OpenFixPr[] = []): GateResult {
  // Fail closed: `observed` is the proof an attributable failure was found, so only a literal true
  // passes — a missing or malformed value must not reach the privileged autofix path.
  if (verdict.observed !== true) {
    return skip('no test evidence was observed, so the failure cannot be attributed to a fix');
  }
  if (verdict.category !== FIXABLE_CATEGORY) {
    return skip(
      `category "${verdict.category}" is not auto-fixable (only "${FIXABLE_CATEGORY}" is)`,
    );
  }
  if (verdict.confidence !== REQUIRED_CONFIDENCE) {
    return skip(`confidence "${verdict.confidence}" is below "${REQUIRED_CONFIDENCE}"`);
  }
  const ops = (verdict.affectedOperationIds ?? []).filter(
    (o) => typeof o === 'string' && o.length > 0,
  );
  if (ops.length === 0) {
    return skip('the verdict names no affected operation to fix');
  }
  const remaining = ops.filter((o) => !coveredByOpenPr(o, openFixPrs));
  if (remaining.length === 0) {
    return skip('every affected operation already has an open fix PR');
  }
  return {
    dispatch: true,
    operationIds: remaining,
    reason: `auto-fixable generator-gap on ${remaining.join(', ')}`,
  };
}

// Reads a verdict and the open-fix-PR list from disk and prints the gate decision as JSON, so the
// workflow can read `dispatch` and `operationIds` from it.
export function parseVerdict(raw: string): Verdict {
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON (the artifact)
  const v = JSON.parse(raw) as Partial<Verdict> & { affected_operation_ids?: unknown };
  const idsSource = Array.isArray(v.affectedOperationIds)
    ? v.affectedOperationIds
    : Array.isArray(v.affected_operation_ids)
      ? v.affected_operation_ids
      : [];
  return {
    category: typeof v.category === 'string' ? v.category : 'unknown',
    confidence: typeof v.confidence === 'string' ? v.confidence : 'low',
    affectedOperationIds: idsSource.filter((o): o is string => typeof o === 'string'),
    // Fail closed: anything but the literal boolean true (missing, null, the string "false", ...)
    // is treated as "no evidence observed", so an incomplete artifact never passes the evidence gate.
    observed: v.observed === true,
  };
}

function isOpenFixPr(p: unknown): p is OpenFixPr {
  return typeof p === 'object' && p !== null && 'diff' in p && typeof p.diff === 'string';
}

function main(): void {
  const [verdictPath, prsPath] = process.argv.slice(2);
  // The open fix-PR list is required: without it duplicate suppression cannot run, and a silent []
  // would let a duplicate autofix through. The workflow always passes it.
  if (!verdictPath || !prsPath) {
    console.error('usage: hub-pr-autofix-gate.ts <verdict.json> <open-fix-prs.json>');
    process.exit(2);
  }
  const verdict = parseVerdict(readFileSync(verdictPath, 'utf8'));
  // Fail closed: if the list cannot be read as an array we cannot prove an operation is not already
  // being fixed, so refuse to dispatch rather than risk a duplicate autofix PR — the same posture
  // .github/scripts/hub-open-fix-prs.sh takes when it cannot produce the list.
  let openFixPrs: OpenFixPr[];
  try {
    const parsed: unknown = JSON.parse(readFileSync(prsPath, 'utf8'));
    if (!Array.isArray(parsed)) {
      throw new Error('the open fix PR list is not an array');
    }
    openFixPrs = parsed.filter(isOpenFixPr);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    const reason = `could not read the open fix PR list (${detail}); refusing to dispatch`;
    process.stdout.write(`${JSON.stringify({ dispatch: false, operationIds: [], reason })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(gate(verdict, openFixPrs))}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
