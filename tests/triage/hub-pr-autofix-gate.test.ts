import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FIXABLE_CATEGORY,
  gate,
  type OpenFixPr,
  parseVerdict,
  REQUIRED_CONFIDENCE,
  type Verdict,
} from '../../scripts/triage/hub-pr-autofix-gate.ts';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/triage/hub-pr-autofix-gate.ts',
);

const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  category: FIXABLE_CATEGORY,
  confidence: REQUIRED_CONFIDENCE,
  affectedOperationIds: ['searchWorkspaces'],
  observed: true,
  ...over,
});

const openPr = (diff: string, number = 1): OpenFixPr => ({
  number,
  url: `https://github.com/camunda/api-test-generator/pull/${number}`,
  diff,
});

describe('hub PR-check autofix gate', () => {
  it('dispatches for a high-confidence generator-gap with an affected operation', () => {
    const r = gate(verdict(), []);
    expect(r.dispatch).toBe(true);
    expect(r.operationIds).toEqual(['searchWorkspaces']);
  });

  it('does not dispatch for a product verdict (suppress-not-fix, a human call)', () => {
    expect(gate(verdict({ category: 'product' }), []).dispatch).toBe(false);
  });

  it('does not dispatch for infra, flaky or unknown', () => {
    for (const category of ['infra', 'flaky', 'unknown']) {
      expect(gate(verdict({ category }), []).dispatch).toBe(false);
    }
  });

  it('does not dispatch below high confidence', () => {
    for (const confidence of ['medium', 'low']) {
      expect(gate(verdict({ confidence }), []).dispatch).toBe(false);
    }
  });

  it('does not dispatch when no evidence was observed', () => {
    const r = gate(verdict({ observed: false }), []);
    expect(r.dispatch).toBe(false);
    expect(r.reason).toContain('evidence');
  });

  it('does not dispatch when the verdict names no operation', () => {
    expect(gate(verdict({ affectedOperationIds: [] }), []).dispatch).toBe(false);
  });

  it('drops an operation already covered by an open fix PR, and dispatches the rest', () => {
    const r = gate(verdict({ affectedOperationIds: ['searchWorkspaces', 'getFolder'] }), [
      openPr('--- a/...\n+++ b/...\n@@\n-  // getFolder paging\n'),
    ]);
    expect(r.dispatch).toBe(true);
    expect(r.operationIds).toEqual(['searchWorkspaces']);
  });

  it('does not dispatch when every affected operation already has an open fix PR', () => {
    const r = gate(verdict({ affectedOperationIds: ['searchWorkspaces'] }), [
      openPr('touches searchWorkspaces in its assertion'),
    ]);
    expect(r.dispatch).toBe(false);
    expect(r.reason).toContain('already has an open fix PR');
  });

  it('matches an operation id as a whole identifier, not a substring', () => {
    // getWorkspace must NOT be considered covered by a PR that only touches a longer id — whether the
    // extra chars are letters (getWorkspaceEnvironments) or a permitted "." / "-" (getWorkspace-v2),
    // since the classifier allows both in an operationId.
    for (const other of ['getWorkspaceEnvironments', 'getWorkspace-v2', 'getWorkspace.v2']) {
      const r = gate(verdict({ affectedOperationIds: ['getWorkspace'] }), [
        openPr(`fix ${other} paging assertion`),
      ]);
      expect(r.dispatch).toBe(true);
      expect(r.operationIds).toEqual(['getWorkspace']);
    }
  });
});

describe('parseVerdict (fail-closed artifact parsing)', () => {
  it('treats a missing observed field as "not observed"', () => {
    expect(parseVerdict('{}').observed).toBe(false);
  });

  it('accepts only the literal boolean true for observed', () => {
    expect(parseVerdict('{"observed":true}').observed).toBe(true);
    for (const bad of ['"true"', 'false', '1', 'null']) {
      expect(parseVerdict(`{"observed":${bad}}`).observed).toBe(false);
    }
  });

  it('defaults category/confidence to the non-dispatchable values', () => {
    const v = parseVerdict('{}');
    expect(v.category).toBe('unknown');
    expect(v.confidence).toBe('low');
  });

  it("reads affected ops from the artifact's snake_case field", () => {
    const v = parseVerdict('{"affected_operation_ids":["searchWorkspaces","getFolder"]}');
    expect(v.affectedOperationIds).toEqual(['searchWorkspaces', 'getFolder']);
  });
});

describe('CLI fail-closed on the open-fix-PR list', () => {
  const run = (verdictJson: unknown, prsRaw: string | null): string => {
    const dir = mkdtempSync(join(tmpdir(), 'autofix-gate-'));
    const vf = join(dir, 'verdict.json');
    writeFileSync(vf, JSON.stringify(verdictJson));
    const args = [script, vf];
    if (prsRaw !== null) {
      const pf = join(dir, 'prs.json');
      writeFileSync(pf, prsRaw);
      args.push(pf);
    }
    return execFileSync('node', args, { encoding: 'utf8' });
  };

  const eligible = {
    category: FIXABLE_CATEGORY,
    confidence: REQUIRED_CONFIDENCE,
    affected_operation_ids: ['searchWorkspaces'],
    observed: true,
  };

  it('refuses to dispatch when the open-fix-PR list is malformed', () => {
    const out = JSON.parse(run(eligible, 'not json'));
    expect(out.dispatch).toBe(false);
    expect(out.reason).toContain('could not read the open fix PR list');
  });

  it('refuses to dispatch when the open-fix-PR list is not an array', () => {
    const out = JSON.parse(run(eligible, '{"oops":true}'));
    expect(out.dispatch).toBe(false);
    expect(out.reason).toContain('could not read the open fix PR list');
  });

  it('dispatches when the verdict is eligible and the (empty) list is valid', () => {
    const out = JSON.parse(run(eligible, '[]'));
    expect(out.dispatch).toBe(true);
    expect(out.operationIds).toEqual(['searchWorkspaces']);
  });

  it('exits non-zero when the open-fix-PR list argument is missing', () => {
    expect(() => run(eligible, null)).toThrow();
  });
});
