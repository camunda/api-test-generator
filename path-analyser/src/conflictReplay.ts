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
  reason: string;
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
      before.length === 0 ||
      !before.every(nonEmptyString) ||
      (expectStatus !== 409 && expectStatus !== 400)
    ) {
      throw new Error(
        `${p}: sequences[${i}] must be { name, operationId, before: [operationId | { operationId, body }, ...], reason, expectStatus?: 400 | 409 } with non-empty values.`,
      );
    }
    const key = `${operationId}/${name}`;
    if (seen.has(key)) throw new Error(`${p}: sequences[${i}] repeats ${key}.`);
    seen.add(key);
    out.push({ name, operationId, before, bodies, expectStatus, reason });
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
  if (!extract || !rename) return extract;
  return extract.map((e) => (rename[e.fieldPath] ? { ...e, bind: rename[e.fieldPath] } : e));
}

/** Fails generation for a sequence that names an operation the spec does not have. */
export function validateConflictSequences(
  graph: OperationGraph,
  sequences: ConflictSequenceEntry[],
): void {
  // The planner finds the final step by its operationId, so a setup call to the target itself would
  // be taken for the final step too.
  const same = sequences.filter((s) => s.before.includes(s.operationId));
  if (same.length) {
    throw new Error(
      `conflict-replay.json: a setup call cannot be the target operation itself: ${same.map((s) => `${s.operationId}/${s.name}`).join(', ')}.`,
    );
  }
  const unknown = new Set<string>();
  for (const seq of sequences) {
    for (const id of [seq.operationId, ...seq.before]) {
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
      stepBodies: Object.fromEntries(
        Object.entries(seq.bodies).map(([i, b]) => [chain.operations.length - 1 + Number(i), b]),
      ),
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
