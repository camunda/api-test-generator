import type { OperationModel, SchemaFragment } from '../model/types.js';

export function firstResourceSegment(path: string): string {
  // strip leading slash then split after /v1|/v2 if present
  const cleaned = path.startsWith('/') ? path.slice(1) : path;
  const segs = cleaned.split('/');
  if (segs[0] === 'v1' || segs[0] === 'v2') return segs[1] || 'root';
  return segs[0] || 'root';
}

export function makeId(parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('__')
    .replace(/[^a-zA-Z0-9_]+/g, '_');
}

export function genPlaceholder(schema: SchemaFragment | undefined): unknown {
  if (!schema) return 'x';
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (t) {
    case 'string':
      return 'x';
    case 'integer':
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {}; // shallow for now
    default:
      return 'x';
  }
}

export function deriveOperationKey(op: OperationModel): string {
  return op.operationId || `${op.method}_${op.path}`;
}

/**
 * Set `value` at `path` inside `root`, creating any missing intermediate
 * containers. Path segments are strings; a segment matching `/^\d+$/`
 * indicates descent through an array (the segment is the index). When an
 * intermediate must be created, the NEXT segment's shape is inspected to
 * choose between `[]` (next is numeric) and `{}` (otherwise).
 *
 * Returns false if traversal hits a primitive that cannot be descended into,
 * or if any segment is a prototype-polluting key (`__proto__`, `prototype`,
 * `constructor`).
 */
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function setAtPath(root: unknown, path: string[], value: unknown): boolean {
  if (path.length === 0) return false;
  for (const seg of path) if (UNSAFE_KEYS.has(seg)) return false;
  let cur: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const nextSeg = path[i + 1];
    const nextIsIndex = /^\d+$/.test(nextSeg);
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0) return false;
      if (cur[idx] === undefined || cur[idx] === null) cur[idx] = nextIsIndex ? [] : {};
      cur = cur[idx];
    } else if (cur && typeof cur === 'object') {
      // biome-ignore lint/plugin: descending into a generic object container; runtime check above narrows shape.
      const obj = cur as Record<string, unknown>;
      if (!Object.hasOwn(obj, seg) || obj[seg] === null) obj[seg] = nextIsIndex ? [] : {};
      cur = obj[seg];
    } else {
      return false;
    }
  }
  const last = path[path.length - 1];
  if (Array.isArray(cur)) {
    const idx = Number(last);
    if (!Number.isInteger(idx) || idx < 0) return false;
    cur[idx] = value;
    return true;
  }
  if (cur && typeof cur === 'object') {
    // biome-ignore lint/plugin: assigning a property by string key on an unknown-typed object container; runtime check above narrows shape.
    (cur as Record<string, unknown>)[last] = value;
    return true;
  }
  return false;
}
