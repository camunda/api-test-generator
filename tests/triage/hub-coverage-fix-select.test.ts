import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type AgentPr,
  kebab,
  parseCreateMissing,
  parsePrs,
  parseRows,
  resourceFromBranch,
  select,
  WEEKLY_CAP,
} from '../../scripts/triage/hub-coverage-fix-select.ts';

const now = new Date('2026-10-12T07:00:00Z');

const rows = [
  { operationId: 'createProjectSnapshot', area: 'Project Snapshot' },
  { operationId: 'createVersion', area: 'Version' },
  { operationId: 'createWidget', area: 'Widget' },
  { operationId: 'createGadget', area: 'Widget' },
];

function pr(over: Partial<AgentPr>): AgentPr {
  return {
    number: 1,
    url: 'https://github.com/camunda/api-test-generator/pull/1',
    createdAt: '2026-10-11T07:00:00Z',
    headRefName: 'fix/coverage-project-snapshot-111',
    state: 'OPEN',
    ...over,
  };
}

describe('kebab and resourceFromBranch', () => {
  it('turns a resource name into the branch form', () => {
    expect(kebab('ProjectSnapshot')).toBe('project-snapshot');
    expect(kebab('Version')).toBe('version');
  });

  it('reads the resource back from an agent branch and ignores other branches', () => {
    expect(resourceFromBranch('fix/coverage-project-snapshot-12345')).toBe('project-snapshot');
    expect(resourceFromBranch('fix/nightly-triage-something-12')).toBeNull();
    expect(resourceFromBranch('fix/coverage-version')).toBeNull();
  });
});

describe('select', () => {
  it('picks every gap when nothing is open and the budget allows', () => {
    const s = select(['ProjectSnapshot', 'Version'], rows, [], now);
    expect(s.budget).toBe(WEEKLY_CAP);
    expect(s.candidates.map((c) => c.resource)).toEqual(['ProjectSnapshot', 'Version']);
    expect(s.candidates[0]).toEqual({
      resource: 'ProjectSnapshot',
      createOp: 'createProjectSnapshot',
      area: 'Project Snapshot',
    });
    expect(s.skipped).toEqual([]);
  });

  it('counts recent agent PRs, open or closed, against the weekly cap', () => {
    const prs = [
      pr({ number: 1, state: 'CLOSED', headRefName: 'fix/coverage-old-thing-1' }),
      pr({ number: 2, state: 'MERGED', headRefName: 'fix/coverage-other-thing-2' }),
    ];
    const s = select(['ProjectSnapshot'], rows, prs, now);
    expect(s.recentCount).toBe(2);
    expect(s.budget).toBe(0);
    expect(s.candidates).toEqual([]);
    expect(s.skipped[0]?.reason).toContain('weekly cap');
  });

  it('stops at the budget that is left', () => {
    const prs = [pr({ headRefName: 'fix/coverage-old-thing-1' })];
    const s = select(['ProjectSnapshot', 'Version'], rows, prs, now);
    expect(s.budget).toBe(1);
    expect(s.candidates).toHaveLength(1);
    expect(s.skipped).toHaveLength(1);
  });

  it('does not count PRs older than the window, or PRs that are not the agent', () => {
    const prs = [
      pr({ createdAt: '2026-10-01T07:00:00Z', state: 'CLOSED', headRefName: 'fix/coverage-a-1' }),
      pr({ headRefName: 'fix/nightly-triage-x-2' }),
      pr({ headRefName: 'chore/spec-bump-camunda-hub' }),
    ];
    const s = select(['ProjectSnapshot'], rows, prs, now);
    expect(s.recentCount).toBe(0);
    expect(s.budget).toBe(WEEKLY_CAP);
  });

  it('allows a retry after an old closed PR for the same resource, because the branch name is unique', () => {
    const prs = [
      pr({
        createdAt: '2026-10-01T07:00:00Z',
        state: 'CLOSED',
        headRefName: 'fix/coverage-project-snapshot-100',
      }),
    ];
    const s = select(['ProjectSnapshot'], rows, prs, now);
    expect(s.candidates.map((c) => c.resource)).toEqual(['ProjectSnapshot']);
  });

  it('skips an area that already has a recent agent PR', () => {
    const prs = [pr({ headRefName: 'fix/coverage-project-snapshot-111' })];
    const s = select(['ProjectSnapshot', 'Version'], rows, prs, now);
    expect(s.candidates.map((c) => c.resource)).toEqual(['Version']);
    expect(s.skipped).toEqual([
      { resource: 'ProjectSnapshot', reason: expect.stringContaining('already has an agent PR') },
    ]);
  });

  it('skips an area whose agent PR is still open even when it is older than the window', () => {
    const prs = [
      pr({
        createdAt: '2026-09-01T07:00:00Z',
        state: 'OPEN',
        headRefName: 'fix/coverage-version-222',
      }),
    ];
    const s = select(['Version'], rows, prs, now);
    expect(s.candidates).toEqual([]);
    expect(s.skipped[0]?.reason).toContain('already has an agent PR');
  });

  it('treats an area as busy when the earlier PR fixed a resource that is no longer missing', () => {
    // Widget was fixed by a recent merged PR, so only Gadget is still missing. Both are in the same area.
    const prs = [pr({ state: 'MERGED', headRefName: 'fix/coverage-widget-333' })];
    const s = select(['Gadget'], rows, prs, now);
    expect(s.candidates).toEqual([]);
    expect(s.skipped).toEqual([
      { resource: 'Gadget', reason: expect.stringContaining('already has an agent PR') },
    ]);
  });

  it('ignores an earlier PR whose resource is not in the report at all', () => {
    const prs = [pr({ headRefName: 'fix/coverage-no-such-resource-1' })];
    const s = select(['Version'], rows, prs, now);
    expect(s.candidates.map((c) => c.resource)).toEqual(['Version']);
  });

  it('picks one resource per area when two missing resources share an area', () => {
    const s = select(['Widget', 'Gadget'], rows, [], now);
    expect(s.candidates.map((c) => c.resource)).toEqual(['Gadget']);
    expect(s.skipped).toEqual([
      { resource: 'Widget', reason: expect.stringContaining('already has a candidate') },
    ]);
  });

  it('skips a resource whose create operation is not in the report', () => {
    const s = select(['Unknown'], rows, [], now);
    expect(s.candidates).toEqual([]);
    expect(s.skipped[0]?.reason).toContain('createUnknown');
  });

  it('selects nothing when there is no gap', () => {
    const s = select([], rows, [], now);
    expect(s.candidates).toEqual([]);
    expect(s.skipped).toEqual([]);
  });
});

describe('parsers', () => {
  it('read a report summary and fall back to empty on bad input', () => {
    expect(parseCreateMissing({ lifecycle: { createMissing: ['A', 3, 'B'] } })).toEqual(['A', 'B']);
    expect(parseCreateMissing(null)).toEqual([]);
    expect(parseCreateMissing({ lifecycle: 'x' })).toEqual([]);
    expect(parseRows([{ operationId: 'a', area: 'X' }, { operationId: 1 }, 'z'])).toEqual([
      { operationId: 'a', area: 'X' },
    ]);
    expect(parseRows({})).toEqual([]);
    expect(parsePrs([{ number: 1 }, 'x'])).toEqual([]);
  });
});

describe('command line', () => {
  it('prints the selection as JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-fix-'));
    writeFileSync(
      join(dir, 'summary.json'),
      JSON.stringify({ lifecycle: { createMissing: ['ProjectSnapshot'] } }),
    );
    writeFileSync(join(dir, 'rows.json'), JSON.stringify(rows));
    writeFileSync(join(dir, 'prs.json'), '[]');
    const script = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../scripts/triage/hub-coverage-fix-select.ts',
    );
    const out = execFileSync(
      'node',
      [
        script,
        join(dir, 'summary.json'),
        join(dir, 'rows.json'),
        join(dir, 'prs.json'),
        '2026-10-12T07:00:00Z',
      ],
      { encoding: 'utf8' },
    );
    const parsed: unknown = JSON.parse(out);
    expect(parsed).toMatchObject({ budget: 2, candidates: [{ resource: 'ProjectSnapshot' }] });
  });
});
