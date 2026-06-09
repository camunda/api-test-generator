import type { ParameterModel } from '../model/types.js';

/**
 * Minimal schema view used by the path/query parameter analysers. A
 * parameter's `schema` is an arbitrary dereferenced OpenAPI fragment; these
 * are the only fields the constraint/not-found generators read.
 */
export interface SchemaFragment {
  type?: string | string[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  enum?: unknown[];
  allOf?: SchemaFragment[];
}

export interface ResolvedParamSchema {
  schema: SchemaFragment;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  enumValues?: unknown[];
  type?: string | string[];
}

function isSchemaFragment(v: unknown): v is SchemaFragment {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Very small resolver: follows the top-level `allOf` chain to merge the
 * constraint fields a parameter's value must satisfy. Camunda key types
 * (e.g. `ProcessInstanceKey`) carry their numeric `pattern`/`maxLength`
 * inside an `allOf: [LongKey]` branch, so a flat read of `p.schema` misses
 * them — this merge surfaces them.
 */
export function resolveParamSchema(p: ParameterModel): ResolvedParamSchema | undefined {
  const schema = isSchemaFragment(p.schema) ? p.schema : undefined;
  if (!schema) return undefined;
  const out: ResolvedParamSchema = { schema };
  function merge(s: SchemaFragment | undefined): void {
    if (!s || typeof s !== 'object') return;
    if (typeof s.pattern === 'string' && out.pattern === undefined) out.pattern = s.pattern;
    if (typeof s.minLength === 'number' && out.minLength === undefined) out.minLength = s.minLength;
    if (typeof s.maxLength === 'number' && out.maxLength === undefined) out.maxLength = s.maxLength;
    if (Array.isArray(s.enum) && !out.enumValues) out.enumValues = s.enum.slice();
    if (s.type !== undefined && out.type === undefined) out.type = s.type;
  }
  merge(schema);
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) merge(part);
  }
  return out;
}

/**
 * Build a syntactically-valid value for a parameter (used to populate
 * sibling params with non-violating placeholders).
 */
export function buildValidValue(r: ResolvedParamSchema): string {
  if (r.enumValues?.length) return String(r.enumValues[0]);
  if (r.pattern) {
    if (/^\^-?\[0-9]\+\$$/.test(r.pattern) || r.pattern === '^-?[0-9]+$') return '1';
  }
  if (r.minLength && r.minLength > 1) return 'a'.repeat(r.minLength);
  return 'x';
}

/**
 * Returns true if `value`, after URL substitution into a path template,
 * would not survive as a single non-empty path segment — making any
 * resulting status expectation noise (Spring's router resolves the request
 * as a different route and returns 404 from a static-resource handler before
 * the request validator runs).
 *
 * `buildUrl()` substitutes path-param values raw (no encoding), so the
 * predicate must reject any value that *literally* contains a routing-
 * significant character, plus any value whose `encodeURIComponent` form
 * contains an encoded segment splitter.
 *
 * Class-scoped check (issue #147 + PR #148 review):
 *   - empty segment
 *   - `.` / `..` (path traversal)
 *   - raw `/` or `\` (forward / back slash)
 *   - raw `?` or `#` (query / fragment delimiters)
 *   - already-encoded `%2F` / `%5C` (case-insensitive) in the value as
 *     supplied — the server may decode these to `/` or `\`
 *   - any value whose `encodeURIComponent` form contains `%2F`/`%5C`
 *     (catches values that contain raw separators not covered above —
 *     defence in depth in case the rules above drift).
 */
export function isUrlCollapsingPathSegment(value: string): boolean {
  if (value.length === 0) return true;
  if (value === '.' || value === '..') return true;
  // Raw routing-significant characters (no encoding by buildUrl).
  if (/[/\\?#]/.test(value)) return true;
  // Already-encoded separators in the supplied value — buildUrl substitutes
  // the value as-is, and the server (or any intermediate proxy) may decode
  // %2F / %5C back to / or \. `encodeURIComponent` would re-encode the `%`
  // to `%25`, so check the raw value directly.
  if (/%2f|%5c/i.test(value)) return true;
  // Defence in depth: catch any value whose canonical encoding contains a
  // segment splitter not flagged above.
  const encoded = encodeURIComponent(value);
  if (/%2f|%5c/i.test(encoded)) return true;
  return false;
}
