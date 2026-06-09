import type {
  OperationModel,
  ParameterModel,
  SchemaFragment,
  ValidationScenario,
} from '../model/types.js';
import {
  buildValidValue,
  isUrlCollapsingPathSegment,
  type ResolvedParamSchema,
  resolveParamSchema,
} from '../util/paramSchema.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
}

// A syntactically-valid Camunda key (Java long serialized as string) that is
// astronomically unlikely to resolve to a real resource in a fresh test
// cluster: ~1e16, comfortably inside int64 range and far above the low
// partition-base counters keys are minted from. Matches `^-?[0-9]+$` and fits
// LongKey's `maxLength: 25`.
const FAKE_NUMERIC_KEY = '9'.repeat(16);

// Unlikely-to-exist string-id candidates, tried in order. The first that
// satisfies the parameter's pattern/length constraints is used.
const FAKE_STRING_CANDIDATES = ['nonexistent-fake-id', 'nonexistent', 'zzzznonexistentzzzz'];

function isNumericKeyParam(r: ResolvedParamSchema): boolean {
  const t = r.type;
  if (t === 'integer' || t === 'number') return true;
  if (Array.isArray(t) && t.some((x) => x === 'integer' || x === 'number')) return true;
  return r.pattern === '^-?[0-9]+$';
}

/**
 * Recursively decide whether a parameter schema can only be satisfied by a
 * numeric Camunda key. The flat `resolveParamSchema` merge only follows the
 * top-level `allOf`, so it misses keys whose numeric constraint lives behind a
 * `oneOf` of `LongKey` aliases — e.g. `ResourceKey` is
 * `oneOf:[ProcessDefinitionKey, DecisionRequirementsKey, FormKey,
 * DecisionDefinitionKey]`, each an `allOf:[LongKey]`. Treating such a param as
 * a string id synthesises `nonexistent-fake-id`, which the server rejects as a
 * malformed key (400) instead of "not found" (404).
 */
function schemaImpliesNumericKey(s: SchemaFragment | undefined): boolean {
  if (!s) return false;
  if (s.pattern === '^-?[0-9]+$') return true;
  const t = s.type;
  if (t === 'integer' || t === 'number') return true;
  if (Array.isArray(t) && t.some((x) => x === 'integer' || x === 'number')) return true;
  if (Array.isArray(s.allOf) && s.allOf.some(schemaImpliesNumericKey)) return true;
  // A oneOf is numeric only when *every* branch is numeric (any branch is a
  // legal value, so a single non-numeric branch means a string could be valid).
  if (Array.isArray(s.oneOf) && s.oneOf.length > 0 && s.oneOf.every(schemaImpliesNumericKey)) {
    return true;
  }
  return false;
}

function satisfies(value: string, r: ResolvedParamSchema): boolean {
  // A value that collapses the URL never reaches the resource lookup (Spring
  // routes it elsewhere); it would 404 for the wrong reason. Reject it here so
  // the 404 we assert is genuinely "resource not found". See issue #147.
  if (isUrlCollapsingPathSegment(value)) return false;
  if (typeof r.minLength === 'number' && value.length < r.minLength) return false;
  if (typeof r.maxLength === 'number' && value.length > r.maxLength) return false;
  if (r.pattern) {
    try {
      if (!new RegExp(r.pattern).test(value)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function clampToLength(value: string, r: ResolvedParamSchema, pad: string): string {
  let out = value;
  if (typeof r.minLength === 'number' && out.length < r.minLength) {
    out = out.padEnd(r.minLength, pad);
  }
  if (typeof r.maxLength === 'number' && out.length > r.maxLength) {
    out = out.slice(0, r.maxLength);
  }
  return out;
}

/**
 * Synthesise a syntactically-valid but nonexistent value for a path
 * parameter. Returns `undefined` when no value can be guaranteed valid (so
 * the caller skips the scenario rather than emit a flaky 404 expectation):
 * an enum parameter (any non-member is a 400, not a 404), or a pattern the
 * candidate values can't satisfy.
 */
export function fakePathParamValue(p: ParameterModel): string | undefined {
  const r = resolveParamSchema(p);
  if (!r) return undefined;
  // A closed enum can't be "missing-but-valid": a non-member is malformed
  // (400), a member may exist. Skip.
  if (r.enumValues?.length) return undefined;
  if (schemaImpliesNumericKey(p.schema) || isNumericKeyParam(r)) {
    const value = clampToLength(FAKE_NUMERIC_KEY, r, '9');
    return satisfies(value, r) ? value : undefined;
  }
  for (const base of FAKE_STRING_CANDIDATES) {
    const value = clampToLength(base, r, '0');
    if (satisfies(value, r)) return value;
  }
  return undefined;
}

/**
 * Eligibility for a fake-ID 404 test (#381):
 *   - the operation is a GET (read-by-key). v1 is scoped to safe, idempotent
 *     reads, which have unambiguous "resource not found" → 404 semantics. A
 *     missing key on a mutating/command endpoint (POST/PUT/PATCH/DELETE that
 *     dispatches to the engine) surfaces as a command rejection (503) or a
 *     validation 400, not a clean 404 — so those are deferred to the
 *     field-site affordance follow-up (#279 / #368).
 *   - has at least one path parameter,
 *   - the contract declares a `404` response (don't assert a status the spec
 *     doesn't allow),
 *   - the success response is NOT a paginated collection — list/search
 *     endpoints return an empty `200` for a nonexistent parent, not `404`
 *     (#372 pattern 3),
 *   - the operation does not require a request body — v1 sends no body, so a
 *     required-body op would 400 on the missing body before the lookup runs.
 */
export function isNotFoundEligible(op: OperationModel): boolean {
  if (op.method.toUpperCase() !== 'GET') return false;
  if (!op.parameters.some((p) => p.in === 'path')) return false;
  if (!op.responseCodes?.includes('404')) return false;
  if (op.successIsCollection) return false;
  if (op.bodyRequired) return false;
  return true;
}

export function generateNotFoundFakeId(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    if (!isNotFoundEligible(op)) continue;
    const pathParams = op.parameters.filter((p) => p.in === 'path');
    const params: Record<string, string> = {};
    let allFaked = true;
    for (const p of pathParams) {
      const fake = fakePathParamValue(p);
      if (fake === undefined) {
        allFaked = false;
        break;
      }
      params[p.name] = fake;
    }
    if (!allFaked) continue;
    // Populate required query params with valid placeholders so the request
    // doesn't fail with an unrelated 400.
    for (const q of op.parameters) {
      if (q.in !== 'query' || !q.required) continue;
      const r = resolveParamSchema(q);
      params[q.name] = r ? buildValidValue(r) : 'x';
    }
    const target = pathParams.map((p) => p.name).join('+');
    out.push({
      id: makeId([op.operationId, 'notFound', target]),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'not-found-fake-id',
      target,
      params: Object.keys(params).length ? params : undefined,
      expectedStatus: 404,
      description: `Nonexistent ${target} returns 404`,
      headersAuth: true,
      source: 'path',
    });
  }
  return out;
}
