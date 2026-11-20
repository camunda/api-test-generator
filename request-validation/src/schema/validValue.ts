import { VALID_BY_FORMAT } from '../util/formatValues.js';
import {
  type ResolvedParamSchema,
  resolveFieldSchema,
  satisfiesAll,
  validNumbers,
  validValues,
} from '../util/paramSchema.js';
import type { WalkNode } from './walker.js';

/**
 * A value that satisfies a walked schema node's own constraints (length, pattern, format, range, item count,
 * uniqueness), with only its required properties for an object. `variant` picks a different value of the same node,
 * so the items of a `uniqueItems` array can differ. Returns undefined when no valid value can be built, so a caller
 * that needs one only to reach another field can skip the case instead of sending a second, unrelated error.
 */
export function synthesizeValid(node: WalkNode, variant = 0): unknown {
  const t = Array.isArray(node.type) ? node.type[0] : node.type;
  const r = t === 'object' || t === 'array' ? undefined : resolved(node);
  const enumValues = r?.enumValues ?? node.enum;
  if (Array.isArray(enumValues) && enumValues.length) {
    return variant < enumValues.length ? enumValues[variant] : undefined;
  }
  const c = node.constraints ?? {};
  switch (t) {
    case 'object': {
      if (variant > 0) return undefined;
      const obj: Record<string, unknown> = {};
      for (const key of node.required ?? []) {
        const child = node.properties?.[key];
        if (!child) continue;
        const v = synthesizeValid(child);
        if (v === undefined) return undefined;
        obj[key] = v;
      }
      return obj;
    }
    case 'array': {
      if (!node.items) return variant > 0 ? undefined : [];
      const min = typeof c.minItems === 'number' ? c.minItems : 0;
      const length = Math.max(min, 1) + variant;
      if (typeof c.maxItems === 'number' && length > c.maxItems) {
        return variant === 0 && min === 0 ? [] : undefined;
      }
      return validItems(node, length);
    }
    case 'integer':
    case 'number':
      return r ? validNumbers(r, t === 'integer', variant + 1)[variant] : undefined;
    case 'boolean':
      return variant < 2 ? variant === 0 : undefined;
    case 'string':
      return r ? validString(r, variant) : undefined;
    default:
      return variant > 0 ? undefined : null;
  }
}

/** `length` valid items for an array node, distinct when it has `uniqueItems`; undefined when that is not possible. */
export function validItems(node: WalkNode, length: number): unknown[] | undefined {
  if (!node.items) return undefined;
  const unique = node.constraints?.uniqueItems === true;
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < length; i++) {
    const v = synthesizeValid(node.items, unique ? i : 0);
    if (v === undefined) return undefined;
    const key = JSON.stringify(v);
    if (unique && seen.has(key)) return undefined;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** The node's declared schema with every `allOf` part merged (patterns, bounds, `multipleOf`, both exclusive forms). */
function resolved(node: WalkNode): ResolvedParamSchema {
  const r = resolveFieldSchema(node.source ?? node.raw ?? {});
  if (r.type === undefined) r.type = node.type;
  if (node.enum?.length && !r.enumValues) r.enumValues = node.enum.slice();
  return r;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function validString(r: ResolvedParamSchema, variant: number): string | undefined {
  // A format or enum has its own valid values; otherwise add more shapes than validValues tries, so a
  // uniqueItems array of a narrow pattern still gets enough distinct items.
  if (r.enumValues?.length || (r.format !== undefined && VALID_BY_FORMAT[r.format] !== undefined))
    return validValues(r)[variant];
  const width = Math.max(r.minLength ?? 1, 1);
  const extra = [
    ...Array.from(LETTERS, (ch) => ch.repeat(width)),
    ...Array.from(LETTERS.toUpperCase(), (ch) => ch.repeat(width)),
    ...Array.from('0123456789', (ch) => ch.repeat(width)),
    ...Array.from({ length: 50 }, (_, i) => `a${i}`.padStart(width, 'a')),
  ].filter((c) => satisfiesAll(c, r));
  return [...new Set([...validValues(r), ...extra])][variant];
}
