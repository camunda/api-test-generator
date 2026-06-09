import type { OperationModel, ParameterModel, ValidationScenario } from '../model/types.js';
import {
  buildValidValue,
  isUrlCollapsingPathSegment,
  type ResolvedParamSchema,
  resolveParamSchema,
} from '../util/paramSchema.js';
import { buildGuaranteedPatternMismatch } from '../util/patternMismatch.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
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
