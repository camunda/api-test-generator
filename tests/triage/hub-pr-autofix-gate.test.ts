import { describe, expect, it } from 'vitest';
import {
  FIXABLE_CATEGORY,
  gate,
  type OpenFixPr,
  REQUIRED_CONFIDENCE,
  type Verdict,
} from '../../scripts/triage/hub-pr-autofix-gate.ts';

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
    // getWorkspace must NOT be considered covered by a PR that only touches getWorkspaceEnvironments.
    const r = gate(verdict({ affectedOperationIds: ['getWorkspace'] }), [
      openPr('fix getWorkspaceEnvironments paging assertion'),
    ]);
    expect(r.dispatch).toBe(true);
    expect(r.operationIds).toEqual(['getWorkspace']);
  });
});
