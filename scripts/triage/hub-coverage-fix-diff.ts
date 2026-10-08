// Checks what a coverage-fix PR actually changed, from GitHub, so the playbook's boundaries do not rest on the
// agent's own word. Pure functions: the verify job fetches the file list and the two JSON files (on the PR's
// base commit and on its head) and passes them in.
//
//   - A lifecycle PR may touch entity-kinds.json, coverage-floors.json and the invariants test file. Its only
//     floor change is lifecycleCreateCovered going up.
//   - A status (403 or 404) PR may touch request-validation.json and coverage-floors.json and, when the missing piece
//     is a test fixture that setup does not create yet, scripts/e2e/run-hub.sh. No generator code, no test. In
//     request-validation.json it may only ADD one entry to resourceFixtures or pathResourceFixtures, and it must not
//     change excludeOperations or any other key. In run-hub.sh it may only ADD a few lines, each one of a small set
//     of fixture-creating shapes (see isAllowedSetupLine); a line of any other shape fails. Its only floor change is
//     assertedByStatus[code] going up. What the added lines DO (which call, which body) is judged by a person: no
//     automatic live run starts on an agent PR, so nothing executes until someone has read the diff.
//   - Neither may lower a floor, or add a zeroTestOperations entry.
//
// Runs under plain `node` (type stripping): no enums, no parameter properties.

import type { Candidate } from './hub-coverage-fix-select.ts';

export const FLOORS_FILE = 'configs/camunda-hub/coverage-floors.json';
export const RV_FILE = 'configs/camunda-hub/request-validation.json';
export const ENTITY_KINDS_FILE = 'configs/camunda-hub/ontology/entity-kinds.json';
export const INVARIANTS_FILE = 'configs/camunda-hub/regression-invariants.test.ts';
export const RUN_HUB_FILE = 'scripts/e2e/run-hub.sh';

export interface FileState {
  rv: unknown;
  floors: unknown;
  // The text of scripts/e2e/run-hub.sh on this side. Only needed when a PR changes that file.
  runHub?: string;
}

// What the verify job gathers for one PR.
export interface PrChange {
  files: string[];
  base: FileState;
  head: FileState;
}

const FIXTURE_KEYS = ['resourceFixtures', 'pathResourceFixtures'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function own(o: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

function mustRise(label: string, was: unknown, now: unknown): string[] {
  if (typeof was !== 'number' || typeof now !== 'number' || now <= was) {
    return [`the floor ${label} must go up, but went from ${String(was)} to ${String(now)}`];
  }
  return [];
}

// Floors: compared by structure, never by flattened names (a top-level key such as "assertedByStatus.403" would
// collide with the nested one). Every key of the file, at the top level and one level down, must be present on both
// sides with the same value, except the one floor the PR may raise, which must go up strictly.
function checkFloors(base: unknown, head: unknown, candidate: Candidate): string[] {
  if (!isRecord(base) || !isRecord(head)) return ['coverage-floors.json is not an object'];
  const out: string[] = [];
  const code = candidate.kind === 'status' ? candidate.code : undefined;

  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    const was = own(base, key);
    const now = own(head, key);
    if (key === 'zeroTestOperations') {
      // The whole list must be unchanged. An entry is an exception someone decided on, so it is never added,
      // edited or removed here.
      if (!same(was, now)) {
        out.push('zeroTestOperations changed (no entry may be added, edited or removed)');
      }
    } else if (candidate.kind === 'lifecycle' && key === 'lifecycleCreateCovered') {
      out.push(...mustRise(key, was, now));
    } else if (isRecord(was) && isRecord(now)) {
      for (const sub of new Set([...Object.keys(was), ...Object.keys(now)])) {
        const label = `${key}.${sub}`;
        if (candidate.kind === 'status' && key === 'assertedByStatus' && sub === code) {
          out.push(...mustRise(label, own(was, sub), own(now, sub)));
        } else if (!same(own(was, sub), own(now, sub))) {
          out.push(
            `the floor ${label} changed from ${String(own(was, sub))} to ${String(own(now, sub))}`,
          );
        }
      }
    } else if (!same(was, now)) {
      out.push(`the floor ${key} changed from ${String(was)} to ${String(now)}`);
    }
  }
  return out;
}

// The fixture variables a setup script exports: only real `export RV_FIXTURE_*` statements count, never a comment or
// text inside another command.
export function exportedFixtures(script: string): Set<string> {
  const names = new Set<string>();
  for (const line of script.split('\n')) {
    const m = /^\s*export\s+(RV_FIXTURE_[A-Z0-9_]+)\b/.exec(line);
    if (m?.[1]) names.add(m[1]);
  }
  return names;
}

// --- scripts/e2e/run-hub.sh: an added line must have one of a few narrow shapes, modelled on the lines already there.
// Anything else (another command, a pipe, a redirect, a variable it did not create, a URL) fails. A denylist of bad
// patterns would miss something, so only what is listed is allowed.
const SETUP_PATH = '"\\$POS_URL(?:/[A-Za-z0-9_-]+|/\\$RV_FIXTURE_[A-Z0-9_]+)+"';
const SETUP_PAYLOAD =
  "(?:'[^'$`\\\\]*'|\"\\$\\(printf '[^'$`\\\\]*'(?: \"\\$RV_FIXTURE_[A-Z0-9_]+\")*\\)\")";
const SETUP_CURL = `curl -s -X (?:POST|PUT|PATCH) ${SETUP_PATH} "\\$\\{h\\[@\\]\\}" -d ${SETUP_PAYLOAD}`;
const SETUP_SHAPES: { name: string; re: RegExp }[] = [
  {
    // export RV_FIXTURE_X; RV_FIXTURE_X="$(curl -s -X POST "$POS_URL/things" "${h[@]}" -d '{"name":"x"}' | _jget thingKey)"
    name: 'create a fixture and export its key',
    re: new RegExp(
      `^export (RV_FIXTURE_[A-Z0-9_]+);\\s+\\1="\\$\\(${SETUP_CURL} \\| _jget [A-Za-z]+\\)"$`,
    ),
  },
  {
    // export RV_FIXTURE_X; RV_FIXTURE_X="rv-member@example.com"
    name: 'export a fixed value',
    re: /^export (RV_FIXTURE_[A-Z0-9_]+);\s+\1="[A-Za-z0-9@._-]+"$/,
  },
  {
    // curl -s -X POST "$POS_URL/workspaces/$RV_FIXTURE_WORKSPACE_KEY/members" "${h[@]}" -d '{"email":"x"}' >/dev/null
    name: 'call the Hub API to prepare a fixture',
    re: new RegExp(`^${SETUP_CURL}(?: >/dev/null(?: 2>&1)?)?$`),
  },
];

// A comment is inert only when it is a real comment. Inside a multi-line quoted string it is text the shell still expands,
// so a comment may not contain anything the shell expands or that closes a quote: no $, backtick, quote or backslash.
const SAFE_COMMENT = /^#[A-Za-z0-9 .,:;()/_@'+-]*$/;

// A line of one of the fixture shapes (not a comment or a blank).
export function isSetupStatement(line: string): boolean {
  const t = line.trim();
  return SETUP_SHAPES.some((shape) => shape.re.test(t));
}

export function isAllowedSetupLine(line: string): boolean {
  const t = line.trim();
  if (t === '') return true;
  if (t.startsWith('#')) return SAFE_COMMENT.test(t);
  return isSetupStatement(t);
}

const MAX_ADDED_SETUP_LINES = 8;

// run-hub.sh: ONE block of added lines, placed directly after an existing fixture statement; nothing else changes.
// Lines are judged one by one by isAllowedSetupLine, which cannot know where in the file a line lands: the same text is
// harmless between two statements and live code inside a multi-line quoted string. A fixture statement is a complete,
// balanced line in the fixture block, so a block inserted right after one cannot be inside a string.
export function checkRunHub(base: unknown, head: unknown): string[] {
  if (typeof base !== 'string' || typeof head !== 'string') {
    return ['run-hub.sh: its text could not be read on both sides'];
  }
  const was = base.split('\n');
  const now = head.split('\n');
  const n = now.length - was.length;
  if (n <= 0) return ['run-hub.sh: no lines were added (only additions are allowed)'];
  // The insertion point: the longest common start; the rest of head must be the added block followed by the rest of base.
  let k = 0;
  while (k < was.length && was[k] === now[k]) k++;
  if (!was.slice(k).every((line, i) => line === now[k + n + i])) {
    return [
      'run-hub.sh: existing lines were changed or removed, or lines were added in more than one place',
    ];
  }
  const out: string[] = [];
  const added = now.slice(k, k + n);
  if (added.length > MAX_ADDED_SETUP_LINES) {
    out.push(
      `run-hub.sh: ${added.length} lines were added, at most ${MAX_ADDED_SETUP_LINES} are allowed`,
    );
  }
  if (!isSetupStatement(k > 0 ? (was[k - 1] ?? '') : '')) {
    out.push(
      'run-hub.sh: the lines must be added directly after an existing fixture statement, and this place is not one',
    );
  }
  for (const line of added) {
    if (!isAllowedSetupLine(line)) {
      out.push(
        `run-hub.sh: an added line is not one of the allowed fixture shapes: ${line.trim()}`,
      );
    }
  }
  if (exportedFixtures(added.join('\n')).size === 0) {
    out.push('run-hub.sh: the added lines export no RV_FIXTURE_* variable');
  }
  return out;
}

// request-validation.json: exactly one new fixture entry, naming an environment variable that setup provisions.
// `provisioned` is the set of RV_FIXTURE_* variables the setup script exports: those on the default branch, plus those
// the PR's own additions export once they have passed the checks.
function checkRv(base: unknown, head: unknown, provisioned: Set<string>): string[] {
  if (!isRecord(base) || !isRecord(head)) return ['request-validation.json is not an object'];
  const out: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (FIXTURE_KEYS.includes(key)) continue;
    if (!same(base[key], head[key])) {
      out.push(
        `request-validation.json: "${key}" changed${key === 'excludeOperations' ? ' (an exclusion is a decision, never overturned)' : ''}`,
      );
    }
  }
  let added = 0;
  for (const key of FIXTURE_KEYS) {
    const b = isRecord(base[key]) ? base[key] : {};
    const h = isRecord(head[key]) ? head[key] : {};
    for (const [name, value] of Object.entries(b)) {
      if (!Object.hasOwn(h, name) || !same(h[name], value))
        out.push(`request-validation.json: ${key}.${name} was changed or removed`);
    }
    for (const [name, value] of Object.entries(h)) {
      // Own properties only: `in` would treat names inherited from Object.prototype (constructor, toString)
      // as already present and let such an entry through unchecked.
      if (Object.hasOwn(b, name)) continue;
      added++;
      if (typeof value !== 'string' || !/^RV_FIXTURE_[A-Z0-9_]+$/.test(value)) {
        out.push(
          `request-validation.json: ${key}.${name} is not an RV_FIXTURE_* environment variable name`,
        );
      } else if (!provisioned.has(value)) {
        out.push(
          `request-validation.json: ${key}.${name} names ${value}, which setup does not provision`,
        );
      }
    }
  }
  if (added === 0) out.push('request-validation.json: no fixture entry was added');
  if (added > 1)
    out.push(
      `request-validation.json: ${added} fixture entries were added, at most one is allowed`,
    );
  return out;
}

export function checkChange(candidate: Candidate, change: PrChange, provisioned: string): string[] {
  const out: string[] = [];
  const allowedFiles =
    candidate.kind === 'status'
      ? [RV_FILE, FLOORS_FILE, RUN_HUB_FILE]
      : [ENTITY_KINDS_FILE, FLOORS_FILE, INVARIANTS_FILE];
  for (const f of change.files) {
    if (!allowedFiles.includes(f))
      out.push(`touches ${f}, which a ${candidate.kind} PR may not change`);
  }
  if (!change.files.includes(FLOORS_FILE))
    out.push('does not raise a floor in coverage-floors.json');
  out.push(...checkFloors(change.base.floors, change.head.floors, candidate));
  if (candidate.kind === 'status') {
    const exported = exportedFixtures(provisioned);
    if (change.files.includes(RUN_HUB_FILE)) {
      const errors = checkRunHub(change.base.runHub, change.head.runHub);
      out.push(...errors);
      if (errors.length === 0 && typeof change.head.runHub === 'string') {
        for (const name of exportedFixtures(change.head.runHub)) exported.add(name);
      }
    }
    out.push(...checkRv(change.base.rv, change.head.rv, exported));
  }
  return out;
}

export function parseChanges(v: unknown): Map<number, PrChange> {
  if (!isRecord(v)) throw new Error('the PR changes file is not an object');
  const m = new Map<number, PrChange>();
  for (const [n, c] of Object.entries(v)) {
    const state = (s: unknown, where: string): FileState => {
      if (!isRecord(s) || !('rv' in s) || !('floors' in s)) {
        throw new Error(`PR #${n} changes: ${where} has no rv and floors`);
      }
      return typeof s.runHub === 'string'
        ? { rv: s.rv, floors: s.floors, runHub: s.runHub }
        : { rv: s.rv, floors: s.floors };
    };
    if (
      !isRecord(c) ||
      !Array.isArray(c.files) ||
      !c.files.every((f): f is string => typeof f === 'string')
    ) {
      throw new Error(`PR #${n} changes have no files list`);
    }
    m.set(Number(n), { files: c.files, base: state(c.base, 'base'), head: state(c.head, 'head') });
  }
  return m;
}
