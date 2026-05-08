import type { OperationModel, ParameterModel, ValidationScenario } from '../model/types.js';
import { buildGuaranteedPatternMismatch } from '../util/patternMismatch.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
}

interface SchemaFragment {
  type?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  enum?: unknown[];
  allOf?: SchemaFragment[];
}

function isSchemaFragment(v: unknown): v is SchemaFragment {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

interface ResolvedParamSchema {
  schema: SchemaFragment;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  enumValues?: unknown[];
  type?: string;
}

// Very small resolver: follows allOf chains to merge top-level constraints.
function resolveParamSchema(p: ParameterModel): ResolvedParamSchema | undefined {
  const schema = isSchemaFragment(p.schema) ? p.schema : undefined;
  if (!schema) return undefined;
  const out: ResolvedParamSchema = { schema };
  function merge(s: SchemaFragment | undefined) {
    if (!s || typeof s !== 'object') return;
    if (typeof s.pattern === 'string' && out.pattern === undefined) out.pattern = s.pattern;
    if (typeof s.minLength === 'number' && out.minLength === undefined) out.minLength = s.minLength;
    if (typeof s.maxLength === 'number' && out.maxLength === undefined) out.maxLength = s.maxLength;
    if (Array.isArray(s.enum) && !out.enumValues) out.enumValues = s.enum.slice();
    if (typeof s.type === 'string' && !out.type) out.type = s.type;
  }
  // Direct
  merge(schema);
  // allOf chain
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) merge(part);
  }
  return out;
}

function buildValidValue(r: ResolvedParamSchema): string {
  if (r.enumValues?.length) return String(r.enumValues[0]);
  if (r.pattern) {
    // If numeric-only pattern
    if (/^\^-?\[0-9]\+\$$/.test(r.pattern) || r.pattern === '^-?[0-9]+$') return '1';
  }
  if (r.minLength && r.minLength > 1) return 'a'.repeat(r.minLength);
  return 'x';
}

/**
 * Returns true if `value`, after URL substitution into a path template,
 * would not survive as a single non-empty path segment — making any
 * resulting 400 expectation noise (Spring's router resolves the request as
 * a different route and returns 404 from a static-resource handler before
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
function isUrlCollapsingPathSegment(value: string): boolean {
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

function buildViolations(
  p: ParameterModel,
  r: ResolvedParamSchema,
): { kind: string; invalid: string }[] {
  const out: { kind: string; invalid: string }[] = [];
  const isPath = p.in === 'path';
  const accept = (kind: string, invalid: string): void => {
    // Path-param scenarios that collapse the URL never reach the validator
    // (Spring routes them to a different handler and returns 404). Elide
    // them so the 400 assertion isn't a noisy false-fail. See issue #147.
    if (isPath && isUrlCollapsingPathSegment(invalid)) return;
    out.push({ kind, invalid });
  };
  // Pattern violation
  if (r.pattern) {
    const invalid = buildGuaranteedPatternMismatch(r.pattern, {
      pathSegmentSafe: isPath,
    });
    if (invalid) accept('pattern', invalid);
  }
  // Length violations
  if (typeof r.minLength === 'number' && r.minLength > 0) {
    // PR #148 review: previously `''.padEnd(N, '')` returned `''` for any
    // `minLength > 0` because `padEnd` with an empty pad string is a no-op.
    // Use a non-empty pad so we synthesise a genuinely-too-short value
    // (length `minLength - 1`); for `minLength: 1` the result is still `''`
    // (length 0), and `accept()` will elide that for path params via
    // `isUrlCollapsingPathSegment`. For `minLength: 3` we now correctly
    // emit `'aa'` instead of `''`, exercising the validator on a
    // non-collapsing shorter value.
    const tooShort = 'a'.repeat(r.minLength - 1);
    accept('length-min', tooShort);
  }
  if (typeof r.maxLength === 'number') {
    const tooLong = 'a'.repeat(r.maxLength + 10);
    accept('length-max', tooLong);
  }
  // Enum violation (only if enum present)
  if (r.enumValues?.length) {
    let inval = `${String(r.enumValues[0])}_X`;
    if (r.pattern === '^-?[0-9]+$') inval = '9999999999999999999999999'; // excessively long number string
    accept('enum', inval);
  }
  return out;
}

function buildParams(
  path: string,
  overrides: Record<string, string>,
): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const token of m) params[token.slice(1, -1)] = 'x';
  for (const [k, v] of Object.entries(overrides)) params[k] = v;
  return params;
}

export function generateParamConstraintViolations(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    let produced = 0;
    for (const p of op.parameters) {
      if (p.in !== 'path' && p.in !== 'query') continue; // focus path+query first
      const resolved = resolveParamSchema(p);
      if (!resolved) continue;
      const violations = buildViolations(p, resolved);
      if (!violations.length) continue;
      // Use valid placeholders for all params first
      const validMap: Record<string, string> = {};
      for (const pp of op.parameters.filter((pp) => pp.in === p.in)) {
        const rr = resolveParamSchema(pp);
        if (rr) validMap[pp.name] = buildValidValue(rr);
      }
      for (const v of violations) {
        if (opts.capPerOperation && produced >= opts.capPerOperation) break;
        const params = buildParams(op.path, { ...validMap, [p.name]: v.invalid });
        out.push({
          id: makeId([op.operationId, 'paramConstraint', p.in, p.name, v.kind]),
          operationId: op.operationId,
          method: op.method,
          path: op.path,
          type: 'param-constraint-violation',
          target: `${p.in}.${p.name}`,
          params,
          expectedStatus: 400,
          description: `${p.in === 'path' ? 'Path' : 'Query'} parameter ${p.name} ${v.kind} constraint violation`,
          headersAuth: true,
          source: p.in,
          // Additional metadata for emitter/title building
          constraintKind: v.kind,
          constraintOrigin: 'param',
        });
        produced++;
      }
    }
  }
  return out;
}

// Local pattern mismatch helper removed in favor of shared util.
