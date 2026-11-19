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
  minimum?: number;
  maximum?: number;
  /** A number in OpenAPI 3.1, a flag that makes `minimum` exclusive in OpenAPI 3.0. */
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  multipleOf?: number;
  allOf?: SchemaFragment[];
  oneOf?: unknown[];
  anyOf?: unknown[];
}

export interface ResolvedParamSchema {
  schema: SchemaFragment;
  /** The first pattern found. `patterns` holds all of them: every `allOf` part's pattern applies. */
  pattern?: string;
  patterns?: string[];
  minLength?: number;
  maxLength?: number;
  format?: string;
  enumValues?: unknown[];
  type?: string | string[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  multipleOf?: number;
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
  return resolveFieldSchema(schema);
}

/**
 * The constraints to build a VALID value from: the schema itself, every `allOf` part (recursively)
 * and the first branch of a `oneOf`/`anyOf`. A value that satisfies one branch satisfies the union,
 * so the first branch is enough here. A Camunda key that may be one of several key types (`ScopeKey`
 * is `oneOf: [ProcessInstanceKey, ElementInstanceKey]`, each `allOf: [LongKey]`) keeps its numeric
 * `pattern` only inside those branches. The schema's own fields win over its parts.
 *
 * Do not build an INVALID value from this: a constraint of the first branch can be one another branch
 * does not have. Use {@link resolveViolationSchema} for that.
 */
export function resolveFieldSchema(schema: SchemaFragment): ResolvedParamSchema {
  const out: ResolvedParamSchema = { schema };
  const seen = new Set<SchemaFragment>();
  // Every part applies (the schema itself, each allOf part, the chosen union branch), so the result is
  // their intersection: the tightest length and numeric bounds, every pattern, the enum values all
  // parts allow. A looser bound in one part must not hide a tighter one in another (PR #802 review).
  function merge(s: unknown): void {
    if (!isSchemaFragment(s) || seen.has(s)) return;
    seen.add(s);
    if (typeof s.pattern === 'string') {
      out.pattern ??= s.pattern;
      out.patterns = [...new Set([...(out.patterns ?? []), s.pattern])];
    }
    if (typeof s.minLength === 'number')
      out.minLength = Math.max(out.minLength ?? s.minLength, s.minLength);
    if (typeof s.maxLength === 'number')
      out.maxLength = Math.min(out.maxLength ?? s.maxLength, s.maxLength);
    if (typeof s.format === 'string') out.format ??= s.format;
    if (Array.isArray(s.enum)) {
      const allowed = s.enum;
      out.enumValues = out.enumValues
        ? out.enumValues.filter((v) => allowed.includes(v))
        : allowed.slice();
    }
    if (s.type !== undefined) out.type ??= s.type;
    if (typeof s.multipleOf === 'number' && s.multipleOf > 0) out.multipleOf ??= s.multipleOf;
    tightenBounds(out, numericInterval({ schema: s, ...numericFields(s) }));
    if (Array.isArray(s.allOf)) for (const part of s.allOf) merge(part);
    for (const branches of [s.oneOf, s.anyOf]) {
      if (Array.isArray(branches) && branches.length) merge(branches[0]);
    }
  }
  merge(schema);
  return out;
}

function numericFields(s: SchemaFragment): Partial<ResolvedParamSchema> {
  return {
    minimum: typeof s.minimum === 'number' ? s.minimum : undefined,
    maximum: typeof s.maximum === 'number' ? s.maximum : undefined,
    exclusiveMinimum: isBound(s.exclusiveMinimum) ? s.exclusiveMinimum : undefined,
    exclusiveMaximum: isBound(s.exclusiveMaximum) ? s.exclusiveMaximum : undefined,
  };
}

/**
 * Narrow `out`'s numeric bounds to `part` where `part` is tighter. A bound is stored back in the
 * OpenAPI 3.1 form (an exclusive bound as a number), which {@link numericInterval} reads.
 */
function tightenBounds(out: ResolvedParamSchema, part: NumericInterval): void {
  const cur = numericInterval(out);
  if (
    part.lo !== undefined &&
    (cur.lo === undefined || part.lo > cur.lo || (part.lo === cur.lo && part.loOpen))
  ) {
    out.minimum = part.loOpen ? undefined : part.lo;
    out.exclusiveMinimum = part.loOpen ? part.lo : undefined;
  }
  if (
    part.hi !== undefined &&
    (cur.hi === undefined || part.hi < cur.hi || (part.hi === cur.hi && part.hiOpen))
  ) {
    out.maximum = part.hiOpen ? undefined : part.hi;
    out.exclusiveMaximum = part.hiOpen ? part.hi : undefined;
  }
}

function isBound(v: unknown): v is number | boolean {
  return typeof v === 'number' || typeof v === 'boolean';
}

/** The allowed range of a number, with both OpenAPI exclusive-bound forms normalized. */
interface NumericInterval {
  lo?: number;
  loOpen: boolean;
  hi?: number;
  hiOpen: boolean;
  multipleOf?: number;
}

function numericInterval(r: ResolvedParamSchema): NumericInterval {
  const out: NumericInterval = { loOpen: false, hiOpen: false, multipleOf: r.multipleOf };
  if (r.minimum !== undefined) out.lo = r.minimum;
  if (r.exclusiveMinimum === true && out.lo !== undefined) out.loOpen = true; // OpenAPI 3.0
  if (
    typeof r.exclusiveMinimum === 'number' &&
    (out.lo === undefined || r.exclusiveMinimum >= out.lo)
  )
    Object.assign(out, { lo: r.exclusiveMinimum, loOpen: true }); // OpenAPI 3.1, the tighter bound
  if (r.maximum !== undefined) out.hi = r.maximum;
  if (r.exclusiveMaximum === true && out.hi !== undefined) out.hiOpen = true;
  if (
    typeof r.exclusiveMaximum === 'number' &&
    (out.hi === undefined || r.exclusiveMaximum <= out.hi)
  )
    Object.assign(out, { hi: r.exclusiveMaximum, hiOpen: true });
  return out;
}

function inInterval(v: number, iv: NumericInterval, integer: boolean): boolean {
  if (!Number.isFinite(v)) return false;
  if (integer && !Number.isInteger(v)) return false;
  if (iv.lo !== undefined && (iv.loOpen ? v <= iv.lo : v < iv.lo)) return false;
  if (iv.hi !== undefined && (iv.hiOpen ? v >= iv.hi : v > iv.hi)) return false;
  if (iv.multipleOf !== undefined) {
    const q = v / iv.multipleOf;
    if (Math.abs(q - Math.round(q)) > 1e-9) return false;
  }
  return true;
}

/**
 * A number the schema accepts: 1 when allowed, else a value at or next to a bound, or the middle of
 * the range, each also moved up to the next `multipleOf`. Both exclusive-bound forms count (a 3.0
 * `exclusiveMinimum: true` flag next to `minimum`, a 3.1 numeric `exclusiveMinimum`). Undefined when
 * none fits, e.g. an integer strictly between 1 and 2.
 */
export function findValidNumber(r: ResolvedParamSchema, integer: boolean): number | undefined {
  const iv = numericInterval(r);
  const raw: number[] = [1];
  if (iv.lo !== undefined) raw.push(inward(iv.lo, iv.loOpen, integer, 1));
  if (iv.hi !== undefined) raw.push(inward(iv.hi, iv.hiOpen, integer, -1));
  if (iv.lo !== undefined && iv.hi !== undefined) {
    const mid = (iv.lo + iv.hi) / 2;
    raw.push(integer ? Math.round(mid) : mid);
  }
  const candidates = [...raw];
  if (iv.multipleOf !== undefined) {
    const m = iv.multipleOf;
    for (const c of raw)
      candidates.push(Math.ceil(c / m) * m, Math.floor(c / m) * m, Math.ceil(c / m + 1) * m);
  }
  return candidates.find((c) => inInterval(c, iv, integer));
}

/**
 * The allowed value closest to `bound` on the inside of the range (`dir` 1 for a lower bound, -1 for
 * an upper one): the bound itself when inclusive, else one step in. For an integer the step is 1 and
 * a fractional bound rounds inward too (`minimum: 1.5` gives 2).
 */
function inward(bound: number, open: boolean, integer: boolean, dir: 1 | -1): number {
  if (!integer) return open ? bound + dir * 1e-6 : bound;
  const nearest = dir === 1 ? Math.ceil(bound) : Math.floor(bound);
  return open && nearest === bound ? bound + dir : nearest;
}

/** {@link resolveViolationSchema} for a parameter. */
export function resolveParamViolationSchema(p: ParameterModel): ResolvedParamSchema | undefined {
  const schema = isSchemaFragment(p.schema) ? p.schema : undefined;
  if (!schema) return undefined;
  return resolveViolationSchema(schema);
}

type Constraints = Omit<ResolvedParamSchema, 'schema'>;

/**
 * The constraints EVERY allowed value meets, to build an INVALID value from: the schema itself and
 * every `allOf` part (recursively), plus, for a `oneOf`/`anyOf`, only what all branches agree on.
 * A value that breaks a constraint must break every branch, or another branch accepts it and the
 * test expects 400 for a valid request (PR #802 review). So across branches:
 *  - `pattern`, `format`, `type`: kept only when every branch has the same one;
 *  - `minLength`: the smallest, `maxLength`: the largest, each only when every branch has one;
 *  - `enumValues`: the union, only when every branch is an enum.
 * The Camunda key unions (`ResourceKey`: four `allOf: [LongKey]` branches) share their pattern and
 * lengths, so they keep them. The schema's own fields win over its parts.
 */
export function resolveViolationSchema(schema: SchemaFragment): ResolvedParamSchema {
  return { schema, ...violationConstraints(schema, new Set()) };
}

function violationConstraints(s: unknown, seen: Set<SchemaFragment>): Constraints {
  const out: Constraints = {};
  if (!isSchemaFragment(s) || seen.has(s)) return out;
  seen.add(s);
  const fill = (from: Constraints): void => {
    if (from.pattern !== undefined && out.pattern === undefined) out.pattern = from.pattern;
    if (from.minLength !== undefined && out.minLength === undefined) out.minLength = from.minLength;
    if (from.maxLength !== undefined && out.maxLength === undefined) out.maxLength = from.maxLength;
    if (from.format !== undefined && out.format === undefined) out.format = from.format;
    if (from.enumValues && !out.enumValues) out.enumValues = from.enumValues.slice();
    if (from.type !== undefined && out.type === undefined) out.type = from.type;
  };
  fill({
    pattern: typeof s.pattern === 'string' ? s.pattern : undefined,
    minLength: typeof s.minLength === 'number' ? s.minLength : undefined,
    maxLength: typeof s.maxLength === 'number' ? s.maxLength : undefined,
    format: typeof s.format === 'string' ? s.format : undefined,
    enumValues: Array.isArray(s.enum) ? s.enum : undefined,
    type: s.type,
  });
  if (Array.isArray(s.allOf)) for (const part of s.allOf) fill(violationConstraints(part, seen));
  for (const branches of [s.oneOf, s.anyOf]) {
    if (Array.isArray(branches) && branches.length) {
      // Each branch resolves on its own copy of `seen`: a schema shared by two branches must count
      // for both.
      fill(commonToAll(branches.map((b) => violationConstraints(b, new Set(seen)))));
    }
  }
  return out;
}

function commonToAll(views: Constraints[]): Constraints {
  const same = <T>(get: (v: Constraints) => T | undefined): T | undefined => {
    const first = get(views[0]);
    if (first === undefined) return undefined;
    const key = JSON.stringify(first);
    return views.every((v) => JSON.stringify(get(v)) === key) ? first : undefined;
  };
  const all = <T>(get: (v: Constraints) => T | undefined): T[] | undefined => {
    const values = views.map(get);
    return values.every((x) => x !== undefined) ? values.filter((x) => x !== undefined) : undefined;
  };
  const mins = all((v) => v.minLength);
  const maxs = all((v) => v.maxLength);
  const enums = all((v) => v.enumValues);
  return {
    pattern: same((v) => v.pattern),
    format: same((v) => v.format),
    type: same((v) => v.type),
    minLength: mins ? Math.min(...mins) : undefined,
    maxLength: maxs ? Math.max(...maxs) : undefined,
    enumValues: enums ? [...new Set(enums.flat())] : undefined,
  };
}

/**
 * Build a syntactically-valid value for a parameter (used to populate
 * sibling params with non-violating placeholders).
 */
export function buildValidValue(r: ResolvedParamSchema): string {
  const t = Array.isArray(r.type) ? r.type[0] : r.type;
  // A number param keeps a number: a letter would be rejected as not a number, before its range.
  const fallback = t === 'integer' || t === 'number' ? '1' : fallbackValue(r);
  return findValidValue(r) ?? fallback;
}

function fallbackValue(r: ResolvedParamSchema): string {
  return r.minLength && r.minLength > 1 ? 'a'.repeat(r.minLength) : 'x';
}

/**
 * A value that satisfies the schema, or undefined when none of the candidates meets its pattern
 * and length bounds. {@link buildValidValue} falls back to a plain token in that case; a caller
 * that can leave the param out (an optional sibling) should do that instead of sending it invalid.
 */
export function findValidValue(r: ResolvedParamSchema): string | undefined {
  return validValues(r)[0];
}

/**
 * Distinct string values the schema accepts, best first; {@link findValidValue} takes the first. Every
 * candidate goes through the same check (enum, length, every pattern), so a shortcut value such as '1'
 * for a numeric key or the sample uuid for a format can't skip a limit it breaks (PR #802 review).
 * Used on its own where several different values are needed (`uniqueItems` arrays).
 */
export function validValues(r: ResolvedParamSchema): string[] {
  const ok = (c: string): boolean => satisfiesAll(c, r);
  const distinct = (cs: string[]): string[] => [...new Set(cs.filter(ok))];
  if (r.enumValues?.length) return distinct(r.enumValues.map(String));
  const t = Array.isArray(r.type) ? r.type[0] : r.type;
  if (t === 'integer' || t === 'number') {
    const n = findValidNumber(r, t === 'integer');
    return n === undefined ? [] : distinct([String(n)]);
  }
  const out: string[] = [];
  const numericKey =
    r.pattern !== undefined && (/^\^-?\[0-9]\+\$$/.test(r.pattern) || r.pattern === '^-?[0-9]+$');
  if (numericKey) {
    // A numeric key is a string: only its length bounds limit it, so try digit strings sized to them.
    const digits = ['1', '2'];
    if (r.minLength) digits.push('1'.padEnd(r.minLength, '0'), '2'.padEnd(r.minLength, '0'));
    if (r.maxLength) digits.push('1'.padEnd(Math.min(r.maxLength, 18), '0'));
    out.push(...distinct(digits));
  }
  if (t === 'boolean') return distinct([...out, 'true', 'false']);
  const byFormat = r.format !== undefined ? VALID_BY_FORMAT[r.format] : undefined;
  if (byFormat !== undefined) return distinct([...out, byFormat]);
  // Cover the pattern shapes in the bundled specs: lowercase, uppercase, digits, `1-1` keys and
  // `1*` prefix wildcards.
  const candidates = [
    fallbackValue(r),
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
  return distinct([...out, ...candidates]);
}

/** Does `c` meet the schema's enum, length bounds and pattern? */
function satisfiesAll(c: string, r: ResolvedParamSchema): boolean {
  if (r.enumValues?.length && !r.enumValues.map(String).includes(c)) return false;
  if (r.minLength !== undefined && c.length < r.minLength) return false;
  if (r.maxLength !== undefined && c.length > r.maxLength) return false;
  const patterns = r.patterns ?? (r.pattern ? [r.pattern] : []);
  return patterns.every((p) => {
    const re = compilePattern(p);
    return re === undefined || re.test(c);
  });
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
  return orderedDateValuesFor(
    params.map((p) => ({ name: p.name, resolved: resolveParamSchema(p) })),
  );
}

/** {@link orderedDateValues} for any named fields, such as the properties of one body object. */
export function orderedDateValuesFor(
  fields: readonly { name: string; resolved: ResolvedParamSchema | undefined }[],
): Map<string, string> {
  const dates: { name: string; format: string; end: boolean }[] = [];
  for (const { name, resolved: r } of fields) {
    // A date restricted to an enum keeps its allowed member (findValidValue picks it), so it is
    // left out of the synthesized ordering.
    if (r?.enumValues?.length) continue;
    const f = r?.format;
    if (f === 'date-time' || f === 'date')
      dates.push({ name, format: f, end: END_NAME.test(name) });
  }
  dates.sort((a, b) => Number(a.end) - Number(b.end)); // stable: declaration order within each group
  const out = new Map<string, string>();
  dates.forEach((d, i) => {
    const iso = new Date(BASE_DATE_MS + i * DAY_MS).toISOString();
    out.set(d.name, d.format === 'date' ? iso.slice(0, 10) : `${iso.slice(0, 19)}Z`);
  });
  return out;
}

/**
 * A schema-valid value for every param in `params`, to fill the ones a scenario is NOT testing.
 * Date params get distinct, ordered values (see {@link orderedDateValues}). An optional param named
 * in `gates` is left out: the environment rejects any non-blank value for it (a capability gate,
 * #404), so sending one makes the server answer for the gate instead of the param under test.
 * An optional param no candidate value can satisfy (an unusual pattern) is left out too, rather
 * than sent invalid; a required one falls back to a plain token because it cannot be omitted.
 */
export function buildSiblingValues(
  params: ParameterModel[],
  gates?: ReadonlyMap<string, unknown>,
): Record<string, string> {
  const dates = orderedDateValues(params);
  const out: Record<string, string> = {};
  for (const p of params) {
    if (!p.required && gates?.has(p.name)) continue;
    const r = resolveParamSchema(p);
    const value = dates.get(p.name) ?? (r ? findValidValue(r) : 'x');
    if (value !== undefined) out[p.name] = value;
    else if (p.required && r) out[p.name] = buildValidValue(r);
  }
  return out;
}

/**
 * An OpenAPI `pattern` as a JavaScript RegExp. Unicode mode first, so property escapes such as
 * `\p{L}` (Java regex syntax the specs use for ids) mean a letter rather than a literal `p{L}`.
 * Undefined for a pattern JavaScript cannot compile (e.g. a Java-only flag), which cannot be
 * checked here.
 */
export function compilePattern(pattern: string): RegExp | undefined {
  for (const flags of ['u', '']) {
    try {
      return new RegExp(pattern, flags);
    } catch {
      // try the next mode
    }
  }
  return undefined;
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
