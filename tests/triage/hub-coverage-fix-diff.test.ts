import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkChange,
  checkRunHub,
  ENTITY_KINDS_FILE,
  exportedFixtures,
  FLOORS_FILE,
  INVARIANTS_FILE,
  isAllowedSetupLine,
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

  it('still rejects workflows, templates and generator code for a status PR', () => {
    for (const f of [
      '.github/workflows/hub-pr-live-check.yml',
      'request-validation/templates/support/global-setup.ts',
      'request-validation/src/analysis/authDeny.ts',
    ]) {
      const v = check(status, change({ files: [RV_FILE, FLOORS_FILE, f] }));
      expect(v).toEqual([`touches ${f}, which a status PR may not change`]);
    }
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

describe('run-hub.sh additions for a status PR', () => {
  const H = ['"$', '{h[@]}"'].join('');
  const baseSh = [
    `  export RV_FIXTURE_WORKSPACE_KEY; RV_FIXTURE_WORKSPACE_KEY="$(curl -s -X POST "$POS_URL/workspaces" ${H} -d '{"name":"x"}' | _jget workspaceKey)"`,
    '  echo done',
  ].join('\n');
  const addEmail = '  export RV_FIXTURE_NEW_EMAIL; RV_FIXTURE_NEW_EMAIL="rv-member@example.com"';
  const addMember = `  curl -s -X POST "$POS_URL/workspaces/$RV_FIXTURE_WORKSPACE_KEY/members" ${H} -d "$(printf '{"email":"%s"}' "$RV_FIXTURE_NEW_EMAIL")" >/dev/null`;
  const withLines = (...lines: string[]) =>
    baseSh.replace('  echo done', `${lines.join('\n')}\n  echo done`);
  const good = withLines('  # a member for removeMember', addEmail, addMember);

  it('allows the shapes that create, export or prepare a fixture, and comments', () => {
    for (const l of [
      '# a comment',
      '',
      addEmail,
      addMember,
      `export RV_FIXTURE_NEW_KEY;   RV_FIXTURE_NEW_KEY="$(curl -s -X POST "$POS_URL/things" ${H} -d '{"name":"x"}' | _jget thingKey)"`,
      `curl -s -X PUT "$POS_URL/things/$RV_FIXTURE_THING_KEY" ${H} -d '{"a":1}' >/dev/null 2>&1`,
    ]) {
      expect(isAllowedSetupLine(l), l).toBe(true);
    }
  });

  it('allows the create lines that already exist in the real setup script, the ones of the same shape', () => {
    const real = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../scripts/e2e/run-hub.sh'),
      'utf8',
    );
    const creates = real
      .split('\n')
      .filter((l) => /^\s*export RV_FIXTURE_\w+;\s+RV_FIXTURE_\w+="\$\(curl -s -X POST/.test(l));
    expect(creates.length).toBeGreaterThan(3);
    const allowed = creates.filter((l) => isAllowedSetupLine(l));
    expect(allowed.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects anything else: other commands, pipes, redirects, URLs, other variables', () => {
    for (const l of [
      'export RV_FIXTURE_X=x; python3 -c pass',
      'python3 -c "import os"',
      `curl -s "$POS_URL/things" ${H} -d '{"a":1}'`,
      `curl -s -X DELETE "$POS_URL/things" ${H} -d '{"a":1}'`,
      `curl -s -X POST "https://example.com/x" ${H} -d '{"a":1}'`,
      `curl -s -X POST "$OTHER/x" ${H} -d '{"a":1}'`,
      `curl -s -X POST "$POS_URL/things" ${H} -d '{"a":1}' > /tmp/out`,
      `curl -s -X POST "$POS_URL/things" ${H} -d '{"a":1}' | sh`,
      `curl -s -X POST "$POS_URL/things" ${H} -d '$(whoami)'`,
      `curl -s -X POST "$POS_URL/things" ${H} -d "$(whoami)"`,
      'export PATH=/x',
      'export RV_FIXTURE_X; RV_FIXTURE_X="$(whoami)"',
      'echo "$GITHUB_TOKEN"',
      'eval "$x"',
      'RV_FIXTURE_X=$(curl -s https://example.com)',
    ]) {
      expect(isAllowedSetupLine(l), l).toBe(false);
    }
  });

  it('accepts additions only, and rejects changed or removed lines, too many lines, or no fixture export', () => {
    expect(checkRunHub(baseSh, good)).toEqual([]);
    expect(checkRunHub(baseSh, good.replace('echo done', 'echo changed')).join()).toContain(
      'existing lines',
    );
    expect(
      checkRunHub(
        baseSh,
        withLines(...Array.from({ length: 9 }, () => addMember, addEmail)),
      ).join(),
    ).toContain('at most 8');
    expect(checkRunHub(baseSh, withLines(addMember)).join()).toContain('export no RV_FIXTURE_');
    expect(checkRunHub(undefined, good)).toHaveLength(1);
  });

  it('rejects a comment that the shell would still expand, and counts comments and blank lines in the limit', () => {
    for (const c of ['# $(whoami)', '# `whoami`', '# "quoted"', '# a \\ b', '#$HOME']) {
      expect(isAllowedSetupLine(c), c).toBe(false);
    }
    expect(isAllowedSetupLine('# plain words, numbers 1 2 3 (and) a/b_c-d')).toBe(true);
    const many = Array.from({ length: 9 }, () => '');
    expect(checkRunHub(baseSh, withLines(addEmail, ...many)).join()).toContain('at most 8');
  });

  it('only accepts one block placed directly after an existing fixture statement', () => {
    // Inside a multi-line double-quoted string, text is still expanded by the shell: an allowed line there is not safe.
    const withString = [
      baseSh.split('\n')[0],
      '  note="first line of a string',
      'second line of the string"',
      '  echo done',
    ].join('\n');
    const inString = withString.replace(
      'second line of the string"',
      `${addEmail}\nsecond line of the string"`,
    );
    expect(checkRunHub(withString, inString).join()).toContain(
      'directly after an existing fixture statement',
    );
    // Not after a statement at all.
    const afterEcho = baseSh.replace('  echo done', `  echo done\n${addEmail}`);
    expect(checkRunHub(baseSh, afterEcho).join()).toContain(
      'directly after an existing fixture statement',
    );
    // At the very start of the file.
    expect(checkRunHub(baseSh, `${addEmail}\n${baseSh}`).join()).toContain(
      'directly after an existing fixture statement',
    );
    // Two separate blocks.
    const base3 = [baseSh.split('\n')[0], '  echo mid', '  echo done'].join('\n');
    const two = [baseSh.split('\n')[0], addEmail, '  echo mid', addMember, '  echo done'].join(
      '\n',
    );
    expect(checkRunHub(base3, two).join()).toContain('more than one place');
    // Nothing added.
    expect(checkRunHub(baseSh, baseSh).join()).toContain('no lines were added');
  });

  it('accepts a block after a real fixture statement of the real setup script, and rejects it inside its multi-line text', () => {
    const real = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../scripts/e2e/run-hub.sh'),
      'utf8',
    );
    const lines = real.split('\n');
    const anchorIdx = lines.findIndex((l) => /^\s*export RV_FIXTURE_VERSION_KEY;/.test(l));
    expect(anchorIdx).toBeGreaterThan(0);
    const insert = (at: number) => [...lines.slice(0, at), addEmail, ...lines.slice(at)].join('\n');
    expect(checkRunHub(real, insert(anchorIdx + 1))).toEqual([]);
    // Right after the start of the multi-line _jget helper (a few lines into the file) is not a fixture statement.
    const helperIdx = lines.findIndex((l) => l.includes('_jget'));
    expect(checkRunHub(real, insert(helperIdx + 1)).join()).toContain(
      'directly after an existing fixture statement',
    );
  });

  it('reads only real export statements, never a comment or text in another command', () => {
    const script = [
      '  export RV_FIXTURE_A; RV_FIXTURE_A="1"',
      '  # export RV_FIXTURE_B; RV_FIXTURE_B="2"',
      '  echo "export RV_FIXTURE_C"',
    ].join('\n');
    expect([...exportedFixtures(script)]).toEqual(['RV_FIXTURE_A']);
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

  it('accepts the setup fixture when the variable it names is exported by the accepted added lines', () => {
    expect(check(status, withSetup(good))).toEqual([]);
  });

  it('does not count a variable as provisioned when it is only in a comment, the additions fail, or the name differs', () => {
    const commentOnly = withLines(
      '  # export RV_FIXTURE_NEW_EMAIL; RV_FIXTURE_NEW_EMAIL="x@y.z"',
      addEmail.replace('NEW_EMAIL', 'ELSE'),
    );
    const v1 = check(status, withSetup(commentOnly));
    expect(
      v1.some((m) => m.includes('names RV_FIXTURE_NEW_EMAIL, which setup does not provision')),
    ).toBe(true);
    expect(check(status, withSetup(`${good}\n  echo "$GITHUB_TOKEN"`)).length).toBeGreaterThan(0);
    expect(
      check(status, withSetup(good, 'RV_FIXTURE_OTHER_NAME')).some((m) =>
        m.includes('names RV_FIXTURE_OTHER_NAME, which setup does not provision'),
      ),
    ).toBe(true);
  });

  it('still rejects run-hub.sh for a lifecycle PR', () => {
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
