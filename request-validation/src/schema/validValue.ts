import { VALID_BY_FORMAT } from '../util/formatValues.js';
import type { WalkNode } from './walker.js';

/**
 * A value that satisfies a walked schema node's own constraints (length, pattern, format, range, item count,
 * uniqueness), with only its required properties for an object. `variant` picks a different value of the same node,
 * so the items of a `uniqueItems` array can differ. Returns undefined when no valid value can be built, so a caller
 * that needs one only to reach another field can skip the case instead of sending a second, unrelated error.
 */
export function synthesizeValid(node: WalkNode, variant = 0): unknown {
  if (Array.isArray(node.enum) && node.enum.length) {
    return variant < node.enum.length ? node.enum[variant] : undefined;
  }
  const c = node.constraints ?? {};
  const t = Array.isArray(node.type) ? node.type[0] : node.type;
  switch (t) {
    case 'object': {
      if (variant > 0) return undefined;
      const obj: Record<string, unknown> = {};
      for (const r of node.required ?? []) {
        const child = node.properties?.[r];
        if (!child) continue;
        const v = synthesizeValid(child);
        if (v === undefined) return undefined;
        obj[r] = v;
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
      return validNumber(c, variant);
    case 'boolean':
      return variant < 2 ? variant === 0 : undefined;
    case 'string':
      return validString(node, c, variant);
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

function validNumber(c: Record<string, unknown>, variant: number): number | undefined {
  let low = 1;
  if (typeof c.minimum === 'number') low = c.minimum;
  else if (typeof c.exclusiveMinimum === 'number') low = Math.floor(c.exclusiveMinimum) + 1;
  else if (typeof c.maximum === 'number' && c.maximum < 1) low = Math.floor(c.maximum);
  else if (typeof c.exclusiveMaximum === 'number' && c.exclusiveMaximum <= 1)
    low = Math.ceil(c.exclusiveMaximum) - 1;
  const v = Math.ceil(low) + variant;
  if (typeof c.maximum === 'number' && v > c.maximum) return undefined;
  if (typeof c.exclusiveMaximum === 'number' && v >= c.exclusiveMaximum) return undefined;
  if (typeof c.minimum === 'number' && v < c.minimum) return undefined;
  if (typeof c.exclusiveMinimum === 'number' && v <= c.exclusiveMinimum) return undefined;
  return v;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function validString(
  node: WalkNode,
  c: Record<string, unknown>,
  variant: number,
): string | undefined {
  const format = typeof node.raw?.format === 'string' ? node.raw.format : undefined;
  const byFormat = format !== undefined ? VALID_BY_FORMAT[format] : undefined;
  const minLength = typeof c.minLength === 'number' ? c.minLength : undefined;
  const maxLength = typeof c.maxLength === 'number' ? c.maxLength : undefined;
  let re: RegExp | undefined;
  if (typeof c.pattern === 'string') {
    try {
      re = new RegExp(c.pattern);
    } catch {
      // A pattern JavaScript cannot compile (e.g. a Java-only flag) cannot be checked here.
      re = undefined;
    }
  }
  const width = Math.max(minLength ?? 1, 1);
  const candidates =
    byFormat !== undefined
      ? [byFormat]
      : [
          minLength !== undefined && minLength > 1 ? 'a'.repeat(minLength) : 'x',
          ...['x', 'a', '1', 'a_1', 'A', 'AA', 'A1', 'test', '0', 'a-b', '1-1', '*', '1*'],
          ...Array.from(LETTERS, (ch) => ch.repeat(width)),
          ...Array.from(LETTERS.toUpperCase(), (ch) => ch.repeat(width)),
          ...Array.from('0123456789', (ch) => ch.repeat(width)),
          ...Array.from({ length: 50 }, (_, i) => `a${i}`.padStart(width, 'a')),
        ];
  const valid = [
    ...new Set(
      candidates.filter(
        (s) =>
          (minLength === undefined || s.length >= minLength) &&
          (maxLength === undefined || s.length <= maxLength) &&
          (re === undefined || re.test(s)),
      ),
    ),
  ];
  return valid[variant];
}
