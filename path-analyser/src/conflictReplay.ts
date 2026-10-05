import fsSync from 'node:fs';
import path from 'node:path';
import type { EndpointScenario, OperationGraph } from './types.js';

export interface ConflictReplayEntry {
  operationId: string;
  reason: string;
  /**
   * Body fields set on the call before it is replayed. For an optimistic-lock
   * conflict the first call must really change state (a no-op update keeps the
   * revision), or the replay's stale value is still current and succeeds.
   */
  changeBody?: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface ConflictSequenceEntry {
  /** Names the scenario; unique per target operation. */
  name: string;
  /** The operation that must answer 409. */
  operationId: string;
  /** Operations run, in order, after the target's own setup chain and before the target. */
  before: string[];
  /**
   * Body fields merged over the generated body of a `before` operation, by its index in
   * `before`. Values may reference earlier results as "${folderKeyVar}".
   */
  bodies: Record<number, Record<string, unknown>>;
  /** The status the target must answer: 409 (default) or 400 for a state precondition. */
  expectStatus: 409 | 400;
  /**
   * Body fields merged over the generated body of an operation in the target's own setup chain,
   * by operationId (for example a different file type for `createFile`).
   */
  chainBodies: Record<string, Record<string, unknown>>;
  /** Body fields merged over the target's own generated body. */
  body?: Record<string, unknown>;
  reason: string;
}

/** Indexes of the setup-chain steps (never the last) whose operation has an entry in `chainBodies`. */
export function chainBodyOverrides(
  chain: EndpointScenario,
  chainBodies: Record<string, Record<string, unknown>>,
  target: string,
): Record<number, Record<string, unknown>> {
  const out: Record<number, Record<string, unknown>> = {};
  const unmatched = new Set(Object.keys(chainBodies));
  chain.operations.slice(0, -1).forEach((op, i) => {
    const body = chainBodies[op.operationId];
    if (!body) return;
    out[i] = body;
    unmatched.delete(op.operationId);
  });
  // A name that is not in the chain would be a silent no-op, and the test would then run against
  // the default fixture instead of the one this config asks for.
  if (unmatched.size) {
    throw new Error(
      `chainBodies names operation(s) the setup chain of ${target} does not call: ${[...unmatched].join(', ')}.`,
    );
  }
  return out;
}

/**
 * `configs/<config>/conflict-replay.json` (optional): operations whose feature
 * scenario is followed by a second, identical call that must answer 409.
 * Switches on the planner's `duplicatePolicy: conflict` replay for specs that
 * do not carry `x-operation-kind` themselves. Returns `[]` when the file is
 * absent; throws when it exists but is malformed.
 */
function readConflictFile(configDir: string): { p: string; raw: Record<string, unknown> } | null {
  const p = path.join(configDir, 'conflict-replay.json');
  if (!fsSync.existsSync(p)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fsSync.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to read/parse ${p}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isRecord(raw)) throw new Error(`${p}: expected a JSON object.`);
  return { p, raw };
}

/** A sequence name ends up in a scenario ID and a generated test title, so it must be quote-safe. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;

function parseChainBodies(
  p: string,
  i: number,
  raw: unknown,
): Record<string, Record<string, unknown>> {
  if (raw === undefined) return {};
  if (!isRecord(raw) || !Object.values(raw).every(isRecord)) {
    throw new Error(`${p}: sequences[${i}].chainBodies must map an operationId to a body object.`);
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [op, b] of Object.entries(raw)) if (isRecord(b)) out[op] = b;
  return out;
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export function loadConflictReplay(configDir: string): ConflictReplayEntry[] {
  const file = readConflictFile(configDir);
  if (!file) return [];
  const { p, raw } = file;
  if (raw.replay === undefined) return [];
  const list = raw.replay;
  if (!Array.isArray(list)) {
    throw new Error(`${p}: "replay" must be an array.`);
  }
  const out: ConflictReplayEntry[] = [];
  list.forEach((e, i) => {
    const operationId = isRecord(e) ? e.operationId : undefined;
    const reason = isRecord(e) ? e.reason : undefined;
    if (!nonEmptyString(operationId) || !nonEmptyString(reason)) {
      throw new Error(`${p}: replay[${i}] must be { operationId, reason } with non-empty strings.`);
    }
    const changeBody = isRecord(e) ? e.changeBody : undefined;
    if (changeBody !== undefined && !isRecord(changeBody)) {
      throw new Error(`${p}: replay[${i}].changeBody must be an object when present.`);
    }
    out.push({ operationId, reason, ...(changeBody ? { changeBody } : {}) });
  });
  return out;
}

/** The optional `sequences` array: setup operations that leave the target in a state that conflicts. */
export function loadConflictSequences(configDir: string): ConflictSequenceEntry[] {
  const file = readConflictFile(configDir);
  if (!file || file.raw.sequences === undefined) return [];
  const { p, raw } = file;
  const list = raw.sequences;
  if (!Array.isArray(list)) throw new Error(`${p}: "sequences" must be an array.`);
  const out: ConflictSequenceEntry[] = [];
  const seen = new Set<string>();
  list.forEach((e, i) => {
    const rec = isRecord(e) ? e : {};
    const { name, operationId, before: rawBefore, reason } = rec;
    const expectStatus = rec.expectStatus === undefined ? 409 : rec.expectStatus;
    const chainBodies = parseChainBodies(p, i, rec.chainBodies);
    if (rec.body !== undefined && !isRecord(rec.body)) {
      throw new Error(`${p}: sequences[${i}].body must be an object when present.`);
    }
    const body = isRecord(rec.body) ? rec.body : undefined;
    const entries: unknown[] = Array.isArray(rawBefore) ? rawBefore : [];
    const before: string[] = [];
    const bodies: Record<number, Record<string, unknown>> = {};
    for (const [bi, item] of entries.entries()) {
      if (typeof item === 'string') before.push(item);
      else if (isRecord(item) && nonEmptyString(item.operationId)) {
        before.push(item.operationId);
        if (item.body !== undefined) {
          if (!isRecord(item.body)) {
            throw new Error(
              `${p}: sequences[${i}].before[${bi}].body must be an object when present.`,
            );
          }
          bodies[bi] = item.body;
        }
      } else before.push('');
    }
    if (
      !nonEmptyString(name) ||
      !SAFE_NAME.test(name) ||
      !nonEmptyString(operationId) ||
      !nonEmptyString(reason) ||
      (before.length === 0 && Object.keys(chainBodies).length === 0 && !body) ||
      !before.every(nonEmptyString) ||
      (expectStatus !== 409 && expectStatus !== 400)
    ) {
      throw new Error(
        `${p}: sequences[${i}] must be { name, operationId, before: [operationId | { operationId, body }, ...], reason, expectStatus?: 400 | 409 } with non-empty values; needs a before list, chainBodies or body.`,
      );
    }
    const key = `${operationId}/${name}`;
    if (seen.has(key)) throw new Error(`${p}: sequences[${i}] repeats ${key}.`);
    seen.add(key);
    out.push({
      name,
      operationId,
      before,
      bodies,
      expectStatus,
      chainBodies,
      ...(body ? { body } : {}),
      reason,
    });
  });
  return out;
}

/** Marks each listed operation as `duplicatePolicy: conflict`; an unknown operation is an error. */
export function applyConflictReplay(graph: OperationGraph, entries: ConflictReplayEntry[]): void {
  const unknown = entries.filter((e) => !graph.operations[e.operationId]).map((e) => e.operationId);
  if (unknown.length) {
    throw new Error(
      `conflict-replay.json lists operationId(s) not present in the spec: ${unknown.join(', ')}.`,
    );
  }
  for (const e of entries) {
    const op = graph.operations[e.operationId];
    op.operationMetadata = { ...op.operationMetadata, duplicatePolicy: 'conflict' };
    if (e.changeBody) op.conflictReplay = { changeBody: e.changeBody };
  }
}

/**
 * The request body for the step at `index` of a scenario: the generated body with any
 * sequence override for that step merged over it.
 */
export function applyStepBody(
  bodyTemplate: unknown,
  stepBodies: Record<number, Record<string, unknown>> | undefined,
  index: number,
): unknown {
  const override = stepBodies?.[index];
  if (!override || !isRecord(bodyTemplate)) return bodyTemplate;
  return { ...bodyTemplate, ...override };
}

/**
 * The extracts of the step at `index`, with the bindings of any response field named in
 * `extractAs` replaced by the variable chosen for it.
 */
export function applyStepExtractAs<T extends { fieldPath: string; bind: string }>(
  extract: T[] | undefined,
  extractAs: Record<number, Record<string, string>> | undefined,
  index: number,
): T[] | undefined {
  const rename = extractAs?.[index];
  if (!rename) return extract;
  // A field with no extract would be a silent no-op, and the variable it was meant to hold would
  // then be seeded with an unrelated value, so name the mistake instead.
  const unmatched = Object.keys(rename).filter((f) => !extract?.some((e) => e.fieldPath === f));
  if (unmatched.length) {
    throw new Error(
      `extractAs names response field(s) the step at index ${index} does not extract: ${unmatched.join(', ')}.`,
    );
  }
  return extract?.map((e) => (rename[e.fieldPath] ? { ...e, bind: rename[e.fieldPath] } : e));
}

/** Fails generation for a sequence that names an operation the spec does not have. */
export function validateConflictSequences(
  graph: OperationGraph,
  sequences: ConflictSequenceEntry[],
): void {
  const unknown = new Set<string>();
  for (const seq of sequences) {
    for (const id of [seq.operationId, ...seq.before, ...Object.keys(seq.chainBodies)]) {
      if (!graph.operations[id]) unknown.add(id);
    }
  }
  if (unknown.size) {
    throw new Error(
      `conflict-replay.json sequences list operationId(s) not present in the spec: ${[...unknown].join(', ')}.`,
    );
  }
}

/**
 * One scenario per sequence for `chain`'s target: the target's own setup chain, then the
 * `before` operations, then the target, which must answer 409.
 */
export function buildConflictSequenceScenarios(
  chain: EndpointScenario,
  sequences: ConflictSequenceEntry[],
  graph: OperationGraph,
): EndpointScenario[] {
  const target = chain.operations[chain.operations.length - 1];
  return sequences
    .filter((seq) => seq.operationId === target?.operationId)
    .map((seq) => ({
      ...chain,
      id: `${chain.id}:conflict:${seq.name}`,
      name: `${seq.expectStatus} ${seq.expectStatus === 409 ? 'conflict' : 'precondition'} - ${seq.name.replace(/-/g, ' ')}`,
      description: `${seq.reason} Runs ${seq.before.join(', ')} before ${seq.operationId}, which must answer ${seq.expectStatus}.`,
      strategy: 'featureCoverage' as const,
      variantKey: `conflict=${seq.name}`,
      expectedResult: { kind: 'error' as const, code: String(seq.expectStatus) },
      // The target is found by position, so a setup call to the target's own operation is fine.
      finalStepIndex: chain.operations.length - 1 + seq.before.length,
      stepBodies: {
        ...chainBodyOverrides(chain, seq.chainBodies, seq.operationId),
        ...Object.fromEntries(
          Object.entries(seq.bodies).map(([i, b]) => [chain.operations.length - 1 + Number(i), b]),
        ),
        ...(seq.body ? { [chain.operations.length - 1 + seq.before.length]: seq.body } : {}),
      },
      operations: [
        ...chain.operations.slice(0, -1),
        ...seq.before.map((id) => {
          const {
            operationId,
            method,
            path: opPath,
            eventuallyConsistent,
            serverOverride,
          } = graph.operations[id];
          return { operationId, method, path: opPath, eventuallyConsistent, serverOverride };
        }),
        target,
      ],
      bindings: { ...(chain.bindings ?? {}) },
      requestPlan: undefined,
      seedBindings: undefined,
    }));
}
