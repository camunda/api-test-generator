import { describe, expect, it } from 'vitest';
import {
  checkChange,
  ENTITY_KINDS_FILE,
  FLOORS_FILE,
  INVARIANTS_FILE,
  type PrChange,
  parseChanges,
  RV_FILE,
} from '../../scripts/triage/hub-coverage-fix-diff.ts';
import type { Candidate } from '../../scripts/triage/hub-coverage-fix-select.ts';

const status: Candidate = {
  resource: 'removeMember',
  createOp: 'removeMember',
  area: 'Member',
  kind: 'status',
  code: '403',
};
const lifecycle: Candidate = {
  resource: 'Version',
  createOp: 'createVersion',
  area: 'Version',
  kind: 'lifecycle',
};

const floors = {
  assertedByStatus: { '2xx': 64, '403': 61, '404': 42 },
  lifecycleCreateCovered: 5,
  zeroTestOperations: [{ operationId: 'getClusterUsageMetrics', reason: 'x' }],
};
const rv = {
  excludeOperations: [{ operationId: 'purgeFile', reason: 'r' }],
  resourceFixtures: { projectKey: 'RV_FIXTURE_V2_PROJECT_KEY' },
  pathResourceFixtures: {},
  authDenyMode: 'fixtures',
};

function change(
  over: Partial<PrChange> & { headFloors?: unknown; headRv?: unknown } = {},
): PrChange {
  return {
    files: over.files ?? [RV_FILE, FLOORS_FILE],
    base: { rv, floors },
    head: {
      rv: over.headRv ?? {
        ...rv,
        resourceFixtures: { ...rv.resourceFixtures, memberEmail: 'RV_FIXTURE_MEMBER_EMAIL' },
      },
      floors: over.headFloors ?? {
        ...floors,
        assertedByStatus: { ...floors.assertedByStatus, '403': 62 },
      },
    },
  };
}

describe('checkChange: a status PR', () => {
  it('accepts one new fixture entry and the matching floor going up', () => {
    expect(checkChange(status, change())).toEqual([]);
  });

  it('rejects a file outside the config and the floors, such as generator code or a test', () => {
    const v = checkChange(
      status,
      change({ files: [RV_FILE, FLOORS_FILE, 'request-validation/src/analysis/authDeny.ts'] }),
    );
    expect(v).toEqual([
      'touches request-validation/src/analysis/authDeny.ts, which a status PR may not change',
    ]);
    expect(
      checkChange(status, change({ files: [RV_FILE, FLOORS_FILE, INVARIANTS_FILE] })),
    ).toHaveLength(1);
  });

  it('rejects any change to excludeOperations', () => {
    const v = checkChange(
      status,
      change({
        headRv: {
          ...rv,
          excludeOperations: [],
          resourceFixtures: { ...rv.resourceFixtures, k: 'RV_FIXTURE_K' },
        },
      }),
    );
    expect(v.some((m) => m.includes('"excludeOperations" changed'))).toBe(true);
  });

  it('rejects a changed mode or any other key', () => {
    const v = checkChange(
      status,
      change({
        headRv: {
          ...rv,
          authDenyMode: 'all-secured',
          resourceFixtures: { ...rv.resourceFixtures, k: 'RV_FIXTURE_K' },
        },
      }),
    );
    expect(v.some((m) => m.includes('"authDenyMode" changed'))).toBe(true);
  });

  it('rejects a changed or removed fixture, and a value that is not an RV_FIXTURE_ name', () => {
    expect(
      checkChange(
        status,
        change({ headRv: { ...rv, resourceFixtures: { projectKey: 'OTHER' } } }),
      ).some((m) => m.includes('was changed or removed')),
    ).toBe(true);
    expect(
      checkChange(
        status,
        change({
          headRv: { ...rv, resourceFixtures: { ...rv.resourceFixtures, k: 'process.env.X' } },
        }),
      ).some((m) => m.includes('not an RV_FIXTURE_* environment variable name')),
    ).toBe(true);
  });

  it('rejects a PR that adds no fixture entry', () => {
    const v = checkChange(status, change({ headRv: rv }));
    expect(v).toContain('request-validation.json: no fixture entry was added');
  });

  it('rejects a lowered floor, another floor raised, and a new zeroTestOperations entry', () => {
    const lowered = checkChange(
      status,
      change({
        headFloors: { ...floors, assertedByStatus: { ...floors.assertedByStatus, '403': 60 } },
      }),
    );
    expect(lowered.some((m) => m.includes('assertedByStatus.403 went from 61 to 60'))).toBe(true);
    const other = checkChange(
      status,
      change({
        headFloors: {
          ...floors,
          assertedByStatus: { ...floors.assertedByStatus, '403': 62, '404': 43 },
        },
      }),
    );
    expect(other.some((m) => m.includes('assertedByStatus.404 changed'))).toBe(true);
    const zero = checkChange(
      status,
      change({
        headFloors: {
          ...floors,
          assertedByStatus: { ...floors.assertedByStatus, '403': 62 },
          zeroTestOperations: [
            ...floors.zeroTestOperations,
            { operationId: 'removeMember', reason: 'r' },
          ],
        },
      }),
    );
    expect(zero.some((m) => m.includes('zeroTestOperations got a new entry (removeMember)'))).toBe(
      true,
    );
  });

  it('rejects a PR that does not touch the floors file', () => {
    expect(checkChange(status, change({ files: [RV_FILE] }))).toContain(
      'does not raise a floor in coverage-floors.json',
    );
  });
});

describe('checkChange: a lifecycle PR', () => {
  const lc = (over: Partial<PrChange> & { headFloors?: unknown } = {}): PrChange => ({
    files: over.files ?? [ENTITY_KINDS_FILE, FLOORS_FILE, INVARIANTS_FILE],
    base: { rv, floors },
    head: { rv, floors: over.headFloors ?? { ...floors, lifecycleCreateCovered: 6 } },
  });

  it('accepts the entry, the floor and the adapted invariant', () => {
    expect(checkChange(lifecycle, lc())).toEqual([]);
  });

  it('rejects other files, a floor that went down, and any other floor change', () => {
    expect(
      checkChange(lifecycle, lc({ files: [ENTITY_KINDS_FILE, FLOORS_FILE, RV_FILE] })),
    ).toHaveLength(1);
    expect(
      checkChange(lifecycle, lc({ headFloors: { ...floors, lifecycleCreateCovered: 4 } })).some(
        (m) => m.includes('lifecycleCreateCovered went from 5 to 4'),
      ),
    ).toBe(true);
    expect(
      checkChange(
        lifecycle,
        lc({
          headFloors: {
            ...floors,
            lifecycleCreateCovered: 6,
            assertedByStatus: { ...floors.assertedByStatus, '2xx': 70 },
          },
        }),
      ).some((m) => m.includes('assertedByStatus.2xx changed')),
    ).toBe(true);
  });
});

describe('parseChanges', () => {
  it('reads a well-formed file and rejects a malformed one', () => {
    const ok = {
      '7': { files: ['a'], base: { rv: {}, floors: {} }, head: { rv: {}, floors: {} } },
    };
    expect(parseChanges(ok).get(7)?.files).toEqual(['a']);
    expect(parseChanges({}).size).toBe(0);
    expect(() => parseChanges([])).toThrow('not an object');
    expect(() => parseChanges({ '7': { files: 'a' } })).toThrow('no files list');
    expect(() => parseChanges({ '7': { files: [], base: {}, head: {} } })).toThrow(
      'no rv and floors',
    );
  });
});
