import type { OperationModel, ParameterModel, ValidationScenario } from '../model/types.js';
import { INVALID_BY_FORMAT } from '../util/formatValues.js';
import { buildValidValue, orderedDateValues, resolveParamSchema } from '../util/paramSchema.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
  /** Formats the server does not check (config `unenforcedStringFormats`); no scenario targets them. */
  unenforcedStringFormats?: readonly string[];
}

function collectQueryParams(op: OperationModel): ParameterModel[] {
  return op.parameters.filter((p) => p.in === 'query');
}

/**
 * Every query parameter set to a value its own schema accepts. A scenario overwrites the one
 * parameter it tests, so each other parameter must be valid or the server rejects that one first
 * and the scenario never reaches the target.
 */
function buildQueryParamMap(op: OperationModel): Record<string, string> {
  const q: Record<string, string> = {};
  const query = collectQueryParams(op);
  const dates = orderedDateValues(query);
  for (const p of query) {
    const r = resolveParamSchema(p);
    q[p.name] = dates.get(p.name) ?? (r ? buildValidValue(r) : 'x');
  }
  return q;
}

/**
 * What each parameter generator can actually produce, written once. The generators below and the
 * per-operation applicability rules in `generate.ts` (which COVERAGE.json's `missingApplicableKinds`
 * is measured against) both call these, so an operation is never reported as missing a check the
 * generator cannot build. The applicability rules used to read the parameters more loosely (a
 * required path parameter counted for param-missing, although a path parameter cannot be omitted).
 */

/** A required parameter that can be left out of the request. A path parameter cannot be omitted. */
function isOmittableParam(p: ParameterModel): boolean {
  return Boolean(p.required) && p.in !== 'path';
}

/** The schema type a type-mismatch scenario would break for `p`, or undefined if none can be built. */
function typeMismatchTargetType(
  p: ParameterModel,
  unenforced: readonly string[] = [],
): string | undefined {
  if (!p.schema?.type) return undefined;
  // Only a query value is rendered as the bad value the scenario sends (a header or cookie would be
  // written into the URL instead), and path params are often strictly string serialized.
  if (p.in !== 'query') return undefined;
  const paramType = Array.isArray(p.schema.type) ? p.schema.type[0] : p.schema.type;
  // A query value is always a string, so a string has a wrong "type" only through an enum or a
  // format the validator checks. A custom format (`TenantId`) accepts any value that fits its
  // pattern, so a made-up bad value would get 200, not 400.
  if (paramType === 'string' && !p.schema.enum && invalidStringValue(p, unenforced) === undefined) {
    return undefined;
  }
  return wrongTypeValue(paramType) === undefined ? undefined : paramType;
}

/** A value that breaks the parameter's checkable string format, or undefined if it has none. */
function invalidStringValue(p: ParameterModel, unenforced: readonly string[]): string | undefined {
  const format = p.schema?.format;
  if (typeof format !== 'string' || unenforced.includes(format)) return undefined;
  return INVALID_BY_FORMAT[format];
}

/** A query parameter with an enum. Only a query value is rendered as the bad value the scenario sends. */
function isEnumViolationParam(p: ParameterModel): boolean {
  const e = p.schema?.enum;
  return Array.isArray(e) && e.length > 0 && p.in === 'query';
}

export function isParamMissingEligible(op: OperationModel): boolean {
  return op.parameters.some(isOmittableParam);
}

export function isParamTypeMismatchEligible(
  op: OperationModel,
  unenforcedStringFormats: readonly string[] = [],
): boolean {
  return op.parameters.some(
    (p) => typeMismatchTargetType(p, unenforcedStringFormats) !== undefined,
  );
}

export function isParamEnumViolationEligible(op: OperationModel): boolean {
  return op.parameters.some(isEnumViolationParam);
}

export function generateParamMissing(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    let produced = 0;
    for (const p of op.parameters) {
      if (!isOmittableParam(p)) continue; // a path param can't be omitted without changing the path shape
      if (opts.capPerOperation && produced >= opts.capPerOperation) break;
      let params: Record<string, string> | undefined;
      if (p.in === 'query') {
        const allQ = buildQueryParamMap(op);
        delete allQ[p.name];
        params = Object.keys(allQ).length ? allQ : undefined;
      } else {
        params = buildParams(op.path, {});
      }
      out.push({
        id: makeId([op.operationId, 'paramMissing', p.in, p.name]),
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'param-missing',
        target: `${p.in}.${p.name}`,
        params,
        expectedStatus: 400,
        description: `Missing required ${p.in} parameter ${p.name}`,
        headersAuth: true,
        source: p.in,
      });
      produced++;
    }
  }
  return out;
}

export function generateParamTypeMismatch(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    let produced = 0;
    for (const p of op.parameters) {
      const paramType = typeMismatchTargetType(p, opts.unenforcedStringFormats);
      if (paramType === undefined) continue;
      if (opts.capPerOperation && produced >= opts.capPerOperation) break;
      // Start with all required query params (so we don't unintentionally create identical empty queries)
      const allQ = buildQueryParamMap(op);
      // Overwrite the specific param with a wrong typed value (stringified to keep buildUrl logic simple).
      // Branch on the type the eligibility rule resolved, not the raw schema type, which may be a union
      // such as ['string', 'null'] that matches no branch and would leave the valid value in place.
      if (paramType === 'boolean') {
        allQ[p.name] = 'notBoolean';
      } else if (paramType === 'integer' || paramType === 'number') {
        allQ[p.name] = 'NaNValue';
      } else if (paramType === 'string') {
        // An enum or a checkable format got us here; break the format, else use a token outside the enum.
        allQ[p.name] =
          invalidStringValue(p, opts.unenforcedStringFormats ?? []) ?? '__INVALID_STRING__';
      } else if (paramType === 'array') {
        allQ[p.name] = 'notArray';
      } else if (paramType === 'object') {
        allQ[p.name] = 'notObject';
      }
      const params: Record<string, string> | undefined = allQ;
      out.push({
        id: makeId([op.operationId, 'paramType', p.in, p.name]),
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'param-type-mismatch',
        target: `${p.in}.${p.name}`,
        params,
        expectedStatus: 400,
        description: `Type mismatch for ${p.in} parameter ${p.name}`,
        headersAuth: true,
        source: p.in,
      });
      produced++;
    }
  }
  return out;
}

export function generateParamEnumViolation(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    let produced = 0;
    for (const p of op.parameters) {
      if (!isEnumViolationParam(p)) continue;
      const e = p.schema?.enum;
      if (!Array.isArray(e)) continue;
      if (opts.capPerOperation && produced >= opts.capPerOperation) break;
      let invalid = '__INVALID_ENUM__';
      if (typeof e[0] === 'string') {
        invalid = `${e[0]}_X`;
      }
      out.push({
        id: makeId([op.operationId, 'paramEnum', p.in, p.name]),
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'param-enum-violation',
        target: `${p.in}.${p.name}`,
        params: buildParams(op.path, { extraQuery: { [p.name]: String(invalid) } }),
        expectedStatus: 400,
        description: `Enum violation for ${p.in} parameter ${p.name}`,
        headersAuth: true,
        source: p.in,
      });
      produced++;
    }
  }
  return out;
}

function wrongTypeValue(type: string): string | number | undefined {
  switch (type) {
    case 'integer':
    case 'number':
      return 'NaNValue';
    case 'boolean':
      return 'notBoolean';
    case 'string':
      return 12345; // number instead of string
    case 'array':
      return 'notArray';
    case 'object':
      return 'notObject';
    default:
      return undefined;
  }
}

interface BuildParamsOpts {
  omit?: string;
  extraQuery?: Record<string, string>;
}
function buildParams(path: string, opt: BuildParamsOpts): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  const params: Record<string, string> = {};
  if (m) for (const token of m) params[token.slice(1, -1)] = '1'; // default valid numeric-like placeholder
  if (opt.extraQuery) {
    for (const [k, v] of Object.entries(opt.extraQuery)) params[k] = v;
  }
  if (opt.omit) delete params[opt.omit];
  return Object.keys(params).length ? params : undefined;
}
