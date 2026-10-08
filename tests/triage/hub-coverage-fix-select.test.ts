import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type AgentPr,
  branchKey,
  kebab,
  parseCreateMissing,
  parseKnown,
  parseOpenFixPrs,
  parsePrs,
  parseRows,
  parseStatusGaps,
  type Row,
  resourceFromBranch,
  select,
} from '../../scripts/triage/hub-coverage-fix-select.ts';

const now = new Date('2026-10-12T07:00:00Z');

const rows: Row[] = [
  { operationId: 'createProjectSnapshot', area: 'Project Snapshot', notes: [] },
  { operationId: 'createVersion', area: 'Version', notes: [] },
  { operationId: 'createWidget', area: 'Widget', notes: [] },
  { operationId: 'createGadget', area: 'Widget', notes: [] },
  { operationId: 'removeMember', area: 'Member', notes: [] },
  { operationId: 'addMember', area: 'Member', notes: ['auth-deny'] },
  { operationId: 'removeClusterRegistration', area: 'Cluster', notes: [] },
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
    expect(s.budget).toBe(2);
    expect(s.candidates.map((c) => c.resource)).toEqual(['ProjectSnapshot', 'Version']);
    expect(s.candidates[0]).toEqual({
      resource: 'ProjectSnapshot',
      createOp: 'createProjectSnapshot',
      area: 'Project Snapshot',
      kind: 'lifecycle',
    });
    expect(s.skipped).toEqual([]);
  });

  it('has no weekly cap: recent agent PRs for other areas do not reduce what may be picked', () => {
    const prs = [
      pr({ number: 1, state: 'CLOSED', headRefName: 'fix/coverage-old-thing-1' }),
      pr({ number: 2, state: 'MERGED', headRefName: 'fix/coverage-other-thing-2' }),
      pr({ number: 3, state: 'MERGED', headRefName: 'fix/coverage-third-thing-3' }),
    ];
    const s = select(['ProjectSnapshot', 'Version'], rows, prs, now);
    expect(s.recentCount).toBe(3);
    expect(s.budget).toBe(2);
    expect(s.candidates.map((c) => c.resource)).toEqual(['ProjectSnapshot', 'Version']);
  });

  it('does not count PRs older than the window, or PRs that are not the agent', () => {
    const prs = [
      pr({ createdAt: '2026-10-01T07:00:00Z', state: 'CLOSED', headRefName: 'fix/coverage-a-1' }),
      pr({ headRefName: 'fix/nightly-triage-x-2' }),
      pr({ headRefName: 'chore/spec-bump-camunda-hub' }),
    ];
    const s = select(['ProjectSnapshot'], rows, prs, now);
    expect(s.recentCount).toBe(0);
    expect(s.budget).toBe(1);
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

  it('does not hold an area for a recent PR that was closed without being merged', () => {
    const prs = [pr({ state: 'CLOSED', headRefName: 'fix/coverage-version-222' })];
    const s = select(['Version'], rows, prs, now);
    expect(s.candidates.map((c) => c.resource)).toEqual(['Version']);
    expect(s.skipped).toEqual([]);
  });

  it('holds an area for a recent PR that was merged', () => {
    const prs = [pr({ state: 'MERGED', headRefName: 'fix/coverage-version-222' })];
    const s = select(['Version'], rows, prs, now);
    expect(s.candidates).toEqual([]);
    expect(s.skipped[0]?.reason).toContain('already has an agent PR');
  });

  it('lets a status gap be tried again after its PR was closed without merging', () => {
    const closed = [pr({ state: 'CLOSED', headRefName: 'fix/coverage-remove-member-403-333' })];
    const gaps = [{ operationId: 'removeMember', code: '403' as const }];
    const again = select([], rows, closed, now, [], [], gaps);
    expect(again.candidates.map((c) => c.resource)).toEqual(['removeMember']);
    const open = [pr({ state: 'OPEN', headRefName: 'fix/coverage-remove-member-403-333' })];
    expect(select([], rows, open, now, [], [], gaps).candidates).toEqual([]);
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

  it('never selects a resource the report marks known, even though it is missing', () => {
    const s = select(['ProjectSnapshot', 'Version'], rows, [], now, ['Version']);
    expect(s.candidates.map((c) => c.resource)).toEqual(['ProjectSnapshot']);
    expect(s.skipped).toEqual([
      { resource: 'Version', reason: expect.stringContaining('known and tracked') },
    ]);
  });

  it('does not spend the budget or an area on a known resource', () => {
    const s = select(['Gadget', 'Widget'], rows, [], now, ['Gadget']);
    expect(s.candidates.map((c) => c.resource)).toEqual(['Widget']);
  });

  it('never selects a create operation that an open fix PR already touches', () => {
    const open = [
      { number: 41, url: 'u41', diff: '+      "establishedBy": "createVersion",' },
      { number: 42, url: 'u42', diff: '+ unrelated change' },
    ];
    const s = select(['ProjectSnapshot', 'Version'], rows, [], now, [], open);
    expect(s.candidates.map((c) => c.resource)).toEqual(['ProjectSnapshot']);
    expect(s.skipped).toEqual([
      { resource: 'Version', reason: 'createVersion is already covered by the open PR #41' },
    ]);
  });

  it('matches the whole operation id, not just the resource name', () => {
    // "Version" appears in countless diffs; only createVersion means the operation is being handled.
    const open = [{ number: 41, url: 'u41', diff: '+ updateVersion and the Version folder' }];
    const s = select(['Version'], rows, [], now, [], open);
    expect(s.candidates.map((c) => c.resource)).toEqual(['Version']);
  });

  it('selects nothing when there is no gap', () => {
    const s = select([], rows, [], now);
    expect(s.candidates).toEqual([]);
    expect(s.skipped).toEqual([]);
  });
});

describe('status gaps (403 and 404)', () => {
  const gaps = [
    { operationId: 'removeMember', code: '403' as const },
    { operationId: 'removeClusterRegistration', code: '403' as const },
  ];

  it('picks status gaps after lifecycle gaps, one per area, with a branch key that includes the code', () => {
    const s = select(['Version'], rows, [], now, [], [], gaps);
    expect(s.budget).toBe(3);
    expect(s.candidates.map((c) => c.resource)).toEqual([
      'Version',
      'removeClusterRegistration',
      'removeMember',
    ]);
    const m = s.candidates.find((c) => c.resource === 'removeMember');
    expect(m).toEqual({
      resource: 'removeMember',
      createOp: 'removeMember',
      area: 'Member',
      kind: 'status',
      code: '403',
    });
    expect(m && branchKey(m)).toBe('remove-member-403');
    expect(resourceFromBranch('fix/coverage-remove-member-403-777')).toBe('remove-member-403');
  });

  it('keeps one PR per area: a second gap in the same area is skipped', () => {
    const s = select(
      [],
      rows,
      [],
      now,
      [],
      [],
      [
        { operationId: 'removeMember', code: '403' },
        { operationId: 'removeMember', code: '404' },
      ],
    );
    expect(s.candidates).toHaveLength(1);
    expect(s.skipped[0]?.reason).toContain('already has a candidate in this run');
  });

  it('skips a gap whose area has a recent or open agent PR, for either kind of gap', () => {
    const prs = [pr({ headRefName: 'fix/coverage-remove-member-403-9', state: 'MERGED' })];
    const s = select([], rows, prs, now, [], [], gaps);
    expect(s.candidates.map((c) => c.resource)).toEqual(['removeClusterRegistration']);
    expect(s.skipped[0]?.reason).toContain('area Member already has an agent PR');
  });

  it('skips a gap that an open fix PR already touches', () => {
    const open = [{ number: 12, url: 'u', diff: '+ removeClusterRegistration' }];
    const s = select([], rows, [], now, [], open, gaps);
    expect(s.candidates.map((c) => c.resource)).toEqual(['removeMember']);
    expect(s.skipped[0]?.reason).toContain('open PR #12');
  });

  it('reads the gaps from the report, leaving out held operations and scoped exclusions', () => {
    const summary = {
      missing: { '403': ['addMember', 'removeMember', 'heldOp'], '404': ['purgeFile'] },
      heldCells: { '403': ['heldOp'], '404': [] },
    };
    const parsed = parseStatusGaps(summary, [
      ...rows,
      { operationId: 'heldOp', area: 'X', notes: [] },
      { operationId: 'purgeFile', area: 'File', notes: ['not-found-fake-id'] },
    ]);
    expect(parsed).toEqual([{ operationId: 'removeMember', code: '403' }]);
  });

  it('rejects a report without the lists, so a format change cannot hide or invent gaps', () => {
    expect(() => parseStatusGaps({}, rows)).toThrow('missing and heldCells');
    expect(() =>
      parseStatusGaps({ missing: { '403': [] }, heldCells: { '403': [], '404': [] } }, rows),
    ).toThrow('for 404');
    expect(() =>
      parseStatusGaps(
        { missing: { '403': [1], '404': [] }, heldCells: { '403': [], '404': [] } },
        rows,
      ),
    ).toThrow('for 403');
  });
});

describe('parsers are strict', () => {
  it('read a well-formed summary, rows and PR list', () => {
    expect(parseCreateMissing({ lifecycle: { createMissing: ['A', 'B'] } })).toEqual(['A', 'B']);
    expect(parseCreateMissing({ lifecycle: { createMissing: [] } })).toEqual([]);
    expect(parseRows([{ operationId: 'a', area: 'X' }])).toEqual([
      { operationId: 'a', area: 'X', notes: [] },
    ]);
    expect(parseRows([{ operationId: 'a', area: 'X', notes: ['auth-deny'] }])[0]?.notes).toEqual([
      'auth-deny',
    ]);
    expect(parsePrs([])).toEqual([]);
  });

  it('read the known list and reject a report without it', () => {
    expect(parseKnown({ lifecycle: { known: ['A'] } })).toEqual(['A']);
    expect(parseKnown({ lifecycle: { known: [] } })).toEqual([]);
    expect(() => parseKnown({ lifecycle: {} })).toThrow('lifecycle.known');
    expect(() => parseKnown({ lifecycle: { known: [1] } })).toThrow('lifecycle.known');
    expect(() => parseKnown(null)).toThrow('lifecycle.known');
  });

  it('reject a report without the lifecycle list, so a format change cannot disable the agent', () => {
    expect(() => parseCreateMissing(null)).toThrow('lifecycle.createMissing');
    expect(() => parseCreateMissing({})).toThrow('lifecycle.createMissing');
    expect(() => parseCreateMissing({ lifecycle: 'x' })).toThrow('lifecycle.createMissing');
    expect(() => parseCreateMissing({ lifecycle: {} })).toThrow('lifecycle.createMissing');
    expect(() => parseCreateMissing({ lifecycle: { createMissing: ['A', 3] } })).toThrow(
      'lifecycle.createMissing',
    );
  });

  it('read the open fix PR list strictly', () => {
    expect(parseOpenFixPrs([{ number: 1, url: 'u', diff: 'd' }])).toHaveLength(1);
    expect(parseOpenFixPrs([])).toEqual([]);
    expect(() => parseOpenFixPrs({})).toThrow('not a list');
    expect(() => parseOpenFixPrs([{ number: 1, url: 'u' }])).toThrow('open fix PR record 0');
  });

  it('reject rows that are not a list of operations with an area', () => {
    expect(() => parseRows({})).toThrow('not a list');
    expect(() => parseRows([{ operationId: 'a', area: 'X' }, { operationId: 1 }])).toThrow('row 1');
    expect(() => parseRows(['z'])).toThrow('row 0');
    expect(() => parseRows([{ operationId: 'a', area: 'X', notes: [1] }])).toThrow('notes');
  });

  it('reject any malformed PR record instead of dropping it, so the weekly count cannot shrink', () => {
    const good = {
      number: 1,
      url: 'u',
      createdAt: '2026-10-01T00:00:00Z',
      headRefName: 'fix/coverage-a-1',
      state: 'OPEN',
    };
    expect(parsePrs([good])).toHaveLength(1);
    expect(() => parsePrs([good, { number: 2 }])).toThrow('PR record 1');
    expect(() => parsePrs([good, 'x'])).toThrow('PR record 1');
    expect(() => parsePrs({})).toThrow('not a list');
  });

  it('reject a PR record whose createdAt is not a date, so it cannot widen the weekly budget', () => {
    const bad = {
      number: 1,
      url: 'u',
      createdAt: 'not a date',
      headRefName: 'fix/coverage-a-1',
      state: 'OPEN',
    };
    expect(() => parsePrs([bad])).toThrow('createdAt that is not a date');
  });
});

describe('command line', () => {
  it('prints the selection as JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-fix-'));
    writeFileSync(
      join(dir, 'summary.json'),
      JSON.stringify({
        lifecycle: { createMissing: ['ProjectSnapshot'], known: [] },
        missing: { '403': [], '404': [] },
        heldCells: { '403': [], '404': [] },
      }),
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
    expect(parsed).toMatchObject({ budget: 1, candidates: [{ resource: 'ProjectSnapshot' }] });
  });

  it('exits non-zero with an error when the report has no lifecycle section', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-fix-'));
    writeFileSync(join(dir, 'summary.json'), JSON.stringify({ negative: {} }));
    writeFileSync(join(dir, 'rows.json'), JSON.stringify(rows));
    writeFileSync(join(dir, 'prs.json'), '[]');
    const script = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../scripts/triage/hub-coverage-fix-select.ts',
    );
    let status = 0;
    let stderr = '';
    try {
      execFileSync(
        'node',
        [script, join(dir, 'summary.json'), join(dir, 'rows.json'), join(dir, 'prs.json')],
        { encoding: 'utf8', stdio: 'pipe' },
      );
    } catch (e) {
      if (typeof e === 'object' && e !== null && 'status' in e && 'stderr' in e) {
        status = Number(e.status);
        stderr = String(e.stderr);
      }
    }
    expect(status).toBe(1);
    expect(stderr).toContain('lifecycle.createMissing');
  });
});
