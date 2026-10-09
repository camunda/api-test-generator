import type { ParameterModel } from '../model/types.js';
import { VALID_BY_FORMAT } from './formatValues.js';

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
  format?: string;
  enum?: unknown[];
  allOf?: SchemaFragment[];
}

export interface ResolvedParamSchema {
  schema: SchemaFragment;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  format?: string;
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
    if (typeof s.format === 'string' && out.format === undefined) out.format = s.format;
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
  const t = Array.isArray(r.type) ? r.type[0] : r.type;
  if (t === 'integer' || t === 'number') return '1';
  if (t === 'boolean') return 'true';
  const byFormat = r.format !== undefined ? VALID_BY_FORMAT[r.format] : undefined;
  if (byFormat !== undefined) return byFormat;
  const first = r.minLength && r.minLength > 1 ? 'a'.repeat(r.minLength) : 'x';
  // Cover the pattern shapes in the bundled specs: lowercase, uppercase, digits, `1-1` keys and
  // `1*` prefix wildcards. If none fits, `first` is returned and the scenario sends it as is.
  const candidates = [
    first,
    'x',
    'a',
    '1',
    'a_1',
    'A',
    'AA',
    'A1',
    'test',
    '0',
    'a-b',
    '1-1',
    '*',
    '1*',
  ];
  return firstSatisfying(candidates, r) ?? first;
}

const END_NAME = /^(end|to|until|before)/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_DATE_MS = Date.UTC(2025, 0, 1);

/**
 * Valid values for the `date` and `date-time` params of one location, one day apart and in range
 * order: a start-like name (`startTime`, `from`) first, an end-like one (`endTime`, `to`) after it.
 * A server that checks "endTime must be after startTime" rejects two equal placeholders, so each
 * date param needs its own value. Declaration order breaks ties. A lone date param gets the same
 * value `buildValidValue` gives it.
 */
export function orderedDateValues(params: ParameterModel[]): Map<string, string> {
  const dates: { name: string; format: string; end: boolean }[] = [];
  for (const p of params) {
    const f = resolveParamSchema(p)?.format;
    if (f === 'date-time' || f === 'date')
      dates.push({ name: p.name, format: f, end: END_NAME.test(p.name) });
  }
  dates.sort((a, b) => Number(a.end) - Number(b.end)); // stable: declaration order within each group
  const out = new Map<string, string>();
  dates.forEach((d, i) => {
    const iso = new Date(BASE_DATE_MS + i * DAY_MS).toISOString();
    out.set(d.name, d.format === 'date' ? iso.slice(0, 10) : `${iso.slice(0, 19)}Z`);
  });
  return out;
}

/** The first candidate that meets the schema's length bounds and pattern, if any does. */
function firstSatisfying(candidates: string[], r: ResolvedParamSchema): string | undefined {
  let re: RegExp | undefined;
  if (r.pattern) {
    try {
      re = new RegExp(r.pattern);
    } catch {
      // A pattern JavaScript cannot compile (e.g. a Java-only flag) cannot be checked here.
      re = undefined;
    }
  }
  return candidates.find(
    (c) =>
      (r.minLength === undefined || c.length >= r.minLength) &&
      (r.maxLength === undefined || c.length <= r.maxLength) &&
      (re === undefined || re.test(c)),
  );
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
