// Checks what a coverage-fix PR actually changed, from GitHub, so the playbook's boundaries do not rest on the
// agent's own word. Pure functions: the verify job fetches the file list and the two JSON files (on the PR's
// base commit and on its head) and passes them in.
//
//   - A lifecycle PR may touch entity-kinds.json, coverage-floors.json and the invariants test file. Its only
//     floor change is lifecycleCreateCovered going up.
//   - A status (403 or 404) PR may touch request-validation.json and coverage-floors.json, and, when the missing
//     piece is a test fixture that setup does not create yet, scripts/e2e/run-hub.sh. No generator code, no test.
//     In request-validation.json it may only ADD one entry to resourceFixtures or pathResourceFixtures, and it
//     must not change excludeOperations or any other key. In run-hub.sh it may only ADD a few lines that create
//     the fixture through the Hub API and export one RV_FIXTURE_* variable (see checkRunHub). Its only floor
//     change is assertedByStatus[code] going up.
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// request-validation.json: exactly one new fixture entry, naming an environment variable that setup provisions.
// `provisioned` is the text of the script that sets the RV_FIXTURE_* variables, read from the default branch on the
// verify runner (the agent cannot change it, and its PR may not touch it).
function checkRv(base: unknown, head: unknown, provisioned: string): string[] {
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
      } else if (!new RegExp(`\\bexport\\s+${escapeRegExp(value)}\\b`).test(provisioned)) {
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

const MAX_ADDED_SETUP_LINES = 8;

// Patterns an added setup line may never contain: setup runs with the suite's credentials, so it may only call the
// Hub API through the existing helper and export fixture variables.
const FORBIDDEN_SETUP = [
  { re: /`/, why: 'a backtick' },
  { re: /\b(eval|sudo|chmod|wget|ssh|nc|rm)\b/, why: 'a command that setup fixtures never need' },
  { re: /\/dev\/tcp/, why: '/dev/tcp' },
  { re: /https?:\/\//i, why: 'a literal URL (use $POS_URL)' },
  { re: /GITHUB|TOKEN|SECRET|PASSWORD|CREDENTIAL/i, why: 'a credential name' },
  { re: />>/, why: 'an append redirect' },
];

// scripts/e2e/run-hub.sh: additions only, each of them a plain fixture-creating line modelled on its neighbours.
// What the lines DO (which call, which body) cannot be judged here: the PR's live-Hub check and a reviewer decide that.
export function checkRunHub(base: unknown, head: unknown): string[] {
  if (typeof base !== 'string' || typeof head !== 'string') {
    return ['run-hub.sh: its text could not be read on both sides'];
  }
  const out: string[] = [];
  const was = base.split('\n');
  const now = head.split('\n');
  const added: string[] = [];
  let i = 0;
  for (const line of now) {
    if (i < was.length && line === was[i]) i++;
    else added.push(line);
  }
  if (i < was.length)
    out.push('run-hub.sh: existing lines were changed or removed (only additions are allowed)');
  const code = added.filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  if (code.length > MAX_ADDED_SETUP_LINES) {
    out.push(
      `run-hub.sh: ${code.length} lines were added, at most ${MAX_ADDED_SETUP_LINES} are allowed`,
    );
  }
  let exportsFixture = false;
  for (const line of code) {
    for (const f of FORBIDDEN_SETUP) {
      if (f.re.test(line)) out.push(`run-hub.sh: an added line contains ${f.why}: ${line.trim()}`);
    }
    // Redirects other than to /dev/null or a stream copy are not allowed.
    if (/[<>]/.test(line.replace(/\d?>\s*\/dev\/null|\d>&\d/g, ''))) {
      out.push(`run-hub.sh: an added line redirects or reads a file: ${line.trim()}`);
    }
    if (/\bcurl\b/.test(line)) {
      const ok =
        /\bcurl\s+(-[A-Za-z]+\s+)*(-X\s+(POST|PUT|PATCH)\s+)?(-[A-Za-z]+\s+)*"\$POS_URL\//.test(
          line,
        );
      if (!ok)
        out.push(
          `run-hub.sh: an added curl call is not a POST, PUT or PATCH to "$POS_URL/...": ${line.trim()}`,
        );
    }
    for (const m of line.matchAll(/\bexport\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (m[1]?.startsWith('RV_FIXTURE_')) exportsFixture = true;
      else
        out.push(
          `run-hub.sh: an added line exports ${m[1]}, which is not an RV_FIXTURE_* variable`,
        );
    }
  }
  if (!exportsFixture)
    out.push('run-hub.sh: no RV_FIXTURE_* variable is exported by the added lines');
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
    // When the PR adds the fixture to setup, the variable counts as provisioned only if those additions passed
    // the checks above; otherwise only what the default branch already exports counts.
    let effective = provisioned;
    if (change.files.includes(RUN_HUB_FILE)) {
      const errors = checkRunHub(change.base.runHub, change.head.runHub);
      out.push(...errors);
      if (errors.length === 0 && typeof change.head.runHub === 'string') {
        effective = change.head.runHub;
      }
    }
    out.push(...checkRv(change.base.rv, change.head.rv, effective));
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
      const runHub = typeof s.runHub === 'string' ? s.runHub : undefined;
      return runHub === undefined
        ? { rv: s.rv, floors: s.floors }
        : { rv: s.rv, floors: s.floors, runHub };
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
