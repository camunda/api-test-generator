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

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export function loadConflictReplay(configDir: string): ConflictReplayEntry[] {
  const file = readConflictFile(configDir);
  if (!file) return [];
  const { p, raw } = file;
  const list = raw.replay;
  if (!Array.isArray(list)) {
    throw new Error(`${p}: expected a JSON object with a "replay" array.`);
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
    const { name, operationId, before, reason } = rec;
    if (
      !nonEmptyString(name) ||
      !nonEmptyString(operationId) ||
      !nonEmptyString(reason) ||
      !Array.isArray(before) ||
      before.length === 0 ||
      !before.every(nonEmptyString)
    ) {
      throw new Error(
        `${p}: sequences[${i}] must be { name, operationId, before: [operationId, ...], reason } with non-empty values.`,
      );
    }
    const key = `${operationId}/${name}`;
    if (seen.has(key)) throw new Error(`${p}: sequences[${i}] repeats ${key}.`);
    seen.add(key);
    out.push({ name, operationId, before: [...before], reason });
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

/** Fails generation for a sequence that names an operation the spec does not have. */
export function validateConflictSequences(
  graph: OperationGraph,
  sequences: ConflictSequenceEntry[],
): void {
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
      name: `409 conflict - ${seq.name.replace(/-/g, ' ')}`,
      description: `${seq.reason} Runs ${seq.before.join(', ')} before ${seq.operationId}, which must answer 409.`,
      strategy: 'featureCoverage' as const,
      variantKey: `conflict=${seq.name}`,
      expectedResult: { kind: 'error' as const, code: '409' },
      operations: [
        ...chain.operations.slice(0, -1),
        ...seq.before.map((id) => {
          const { operationId, method, path: opPath } = graph.operations[id];
          return { operationId, method, path: opPath };
        }),
        target,
      ],
      bindings: { ...(chain.bindings ?? {}) },
      requestPlan: undefined,
      seedBindings: undefined,
    }));
}
