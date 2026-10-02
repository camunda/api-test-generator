import fsSync from 'node:fs';
import path from 'node:path';
import type { OperationGraph } from './types.js';

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

/**
 * `configs/<config>/conflict-replay.json` (optional): operations whose feature
 * scenario is followed by a second, identical call that must answer 409.
 * Switches on the planner's `duplicatePolicy: conflict` replay for specs that
 * do not carry `x-operation-kind` themselves. Returns `[]` when the file is
 * absent; throws when it exists but is malformed.
 */
export function loadConflictReplay(configDir: string): ConflictReplayEntry[] {
  const p = path.join(configDir, 'conflict-replay.json');
  if (!fsSync.existsSync(p)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(fsSync.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to read/parse ${p}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const list = isRecord(raw) ? raw.replay : undefined;
  if (!Array.isArray(list)) {
    throw new Error(`${p}: expected a JSON object with a "replay" array.`);
  }
  const out: ConflictReplayEntry[] = [];
  list.forEach((e, i) => {
    const operationId = isRecord(e) ? e.operationId : undefined;
    const reason = isRecord(e) ? e.reason : undefined;
    if (typeof operationId !== 'string' || !operationId || typeof reason !== 'string' || !reason) {
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
