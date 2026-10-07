import { describe, expect, it } from 'vitest';
import type { Selection } from '../../scripts/triage/hub-coverage-fix-select.ts';
import {
  assertComplete,
  parseRunPrs,
  parseSelection,
  type RunPr,
  reportedPrUrls,
  verify,
} from '../../scripts/triage/hub-coverage-fix-verify.ts';

const RUN = '777';
const BOT = ['app/qa-processes', 'qa-processes[bot]'];
const URL = (n: number) => `https://github.com/camunda/api-test-generator/pull/${n}`;

const selection: Selection = {
  budget: 2,
  recentCount: 0,
  candidates: [
    { resource: 'ProjectSnapshot', createOp: 'createProjectSnapshot', area: 'Project Snapshot' },
    { resource: 'Version', createOp: 'createVersion', area: 'Version' },
    { resource: 'Gadget', createOp: 'createGadget', area: 'Version' },
  ],
  skipped: [],
};

function pr(n: number, over: Partial<RunPr> = {}): RunPr {
  return {
    number: n,
    url: URL(n),
    headRefName: `fix/coverage-project-snapshot-${RUN}`,
    baseRefName: 'main',
    isDraft: true,
    author: 'app/qa-processes',
    labels: ['nightly-api-fix', 'auto-generated'],
    ...over,
  };
}

describe('verify', () => {
  it('accepts a PR that matches a candidate, is a draft with both labels, and was reported', () => {
    expect(verify([pr(1)], selection, [URL(1)], RUN, false, BOT, 0)).toEqual([]);
  });

  it('accepts a run that opened nothing', () => {
    expect(verify([], selection, [], RUN, false, BOT, 0)).toEqual([]);
    expect(verify([], selection, [], RUN, true, BOT, 0)).toEqual([]);
  });

  it('rejects any PR in a dry run', () => {
    const v = verify([pr(1)], selection, [URL(1)], RUN, true, BOT, 0);
    expect(v.some((m) => m.includes('a dry run opened'))).toBe(true);
  });

  it('rejects more PRs than the budget, even when the agent did not report them', () => {
    const prs = [
      pr(1),
      pr(2, { headRefName: `fix/coverage-version-${RUN}` }),
      pr(3, { headRefName: `fix/coverage-gadget-${RUN}` }),
    ];
    const v = verify(prs, selection, [URL(1)], RUN, false, BOT, 0);
    expect(v.some((m) => m.includes('over the budget of 2'))).toBe(true);
    expect(v.some((m) => m.includes(`${URL(2)}: exists but the agent did not report it`))).toBe(
      true,
    );
  });

  it('rejects a PR for a resource that is not a candidate', () => {
    const v = verify(
      [pr(1, { headRefName: `fix/coverage-something-else-${RUN}` })],
      selection,
      [URL(1)],
      RUN,
      false,
      BOT,
      0,
    );
    expect(v.some((m) => m.includes('not one of this run'))).toBe(true);
  });

  it('rejects two PRs for the same area', () => {
    const prs = [
      pr(1, { headRefName: `fix/coverage-version-${RUN}` }),
      pr(2, { headRefName: `fix/coverage-gadget-${RUN}` }),
    ];
    const v = verify(prs, selection, [URL(1), URL(2)], RUN, false, BOT, 0);
    expect(v.some((m) => m.includes('two PRs for the area Version'))).toBe(true);
  });

  it('rejects a PR that is not a draft, not against main, or missing a label', () => {
    const v = verify(
      [pr(1, { isDraft: false, baseRefName: 'dev', labels: ['auto-generated'] })],
      selection,
      [URL(1)],
      RUN,
      false,
      BOT,
      0,
    );
    expect(v.some((m) => m.includes('not a draft'))).toBe(true);
    expect(v.some((m) => m.includes('not main'))).toBe(true);
    expect(v.some((m) => m.includes('missing the label nightly-api-fix'))).toBe(true);
  });

  it('rejects a PR the agent reported but that does not exist', () => {
    const v = verify([], selection, [URL(9)], RUN, false, BOT, 0);
    expect(v.some((m) => m.includes('reported by the agent but not found'))).toBe(true);
  });

  it('rejects a PR by the agent account on a branch outside the run pattern', () => {
    const v = verify(
      [pr(5, { headRefName: 'sneaky/other-branch' })],
      selection,
      [],
      RUN,
      false,
      BOT,
      0,
    );
    expect(v.some((m) => m.includes("not one of this run's coverage PRs"))).toBe(true);
  });

  it("rejects an unreported PR on a branch that looks like other automation: the name is the agent's choice", () => {
    for (const branch of [
      'fix/nightly-triage-x-1',
      'chore/spec-bump-camunda-hub',
      'chore/hub-unskip-123',
    ]) {
      const v = verify([pr(5, { headRefName: branch })], selection, [], RUN, false, BOT, 0);
      expect(v.some((m) => m.includes('not one of this run'))).toBe(true);
    }
  });

  it('ignores PRs by other people, and every PR at or below the baseline', () => {
    const prs = [
      pr(8, { headRefName: 'feature/by-a-person', author: 'alice' }),
      pr(50, { headRefName: 'fix/nightly-triage-x-1' }),
      pr(100, { headRefName: 'sneaky/old' }),
    ];
    expect(verify(prs, selection, [], RUN, false, BOT, 100)).toEqual([]);
  });

  it('counts a PR above the baseline, and not one at the baseline', () => {
    const prs = [
      pr(100, { headRefName: 'sneaky/at-baseline' }),
      pr(101, { headRefName: 'sneaky/new' }),
    ];
    const v = verify(prs, selection, [], RUN, false, BOT, 100);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain(URL(101));
  });

  it('does not take a PR from another run for this run', () => {
    const v = verify(
      [pr(5, { headRefName: 'fix/coverage-project-snapshot-111' })],
      selection,
      [],
      RUN,
      false,
      BOT,
      0,
    );
    expect(v.some((m) => m.includes("not one of this run's coverage PRs"))).toBe(true);
  });
});

describe('assertComplete', () => {
  const list = (numbers: number[]): RunPr[] => numbers.map((n) => pr(n));

  it('accepts a list that is not full', () => {
    expect(() => assertComplete(list([101, 102]), 100, 200)).not.toThrow();
  });

  it('accepts a full list that reaches back to the baseline', () => {
    expect(() => assertComplete(list([100, 101, 102]), 100, 3)).not.toThrow();
  });

  it('rejects a full list that is entirely newer than the baseline: PRs may have fallen off', () => {
    expect(() => assertComplete(list([101, 102, 103]), 100, 3)).toThrow('may be cut off');
  });
});

describe('parsers', () => {
  it('reads the reported fix-pr URLs only, not the existing PR a skip links to', () => {
    expect(
      reportedPrUrls({
        gaps: [
          { action: 'fix-pr', pr_url: URL(1) },
          { action: 'skip', pr_url: URL(2) },
          { action: 'fix-pr', pr_url: null },
        ],
      }),
    ).toEqual([URL(1)]);
    expect(() => reportedPrUrls({})).toThrow('no gaps list');
  });

  it('rejects malformed PR records and selections', () => {
    expect(() => parseRunPrs([{ number: 1 }])).toThrow('PR record 0');
    expect(() => parseRunPrs('x')).toThrow('not a list');
    expect(() => parseSelection({})).toThrow('no budget and candidates');
    expect(() => parseSelection({ budget: 2, candidates: [{ resource: 'A' }] })).toThrow(
      'candidate 0',
    );
    expect(parseSelection({ budget: 1, candidates: [] }).budget).toBe(1);
  });

  it('reads a gh pr list record with the author login and label names', () => {
    const [p] = parseRunPrs([
      {
        number: 1,
        url: URL(1),
        headRefName: 'b',
        baseRefName: 'main',
        isDraft: true,
        author: { login: 'app/qa-processes' },
        labels: [{ name: 'nightly-api-fix' }],
      },
    ]);
    expect(p?.author).toBe('app/qa-processes');
    expect(p?.labels).toEqual(['nightly-api-fix']);
  });
});
