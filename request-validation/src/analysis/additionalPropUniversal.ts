import type { OperationModel, ValidationScenario } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
}

function universalBaseline(op: OperationModel): Record<string, unknown> | undefined {
  const schema = op.requestBodySchema;
  if (!schema || schema.type !== 'object') return undefined;
  // A closed body is left to additional-prop (additionalProps.ts): it sends the same request (baseline plus one
  // unexpected key), and generate.ts's structural dedupe would drop this copy anyway.
  if (schema.additionalProperties === false) return undefined;
  const baseline = buildBaselineBody(op);
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return undefined;
  return baseline;
}

/** Does `op` get an additional-prop-general scenario? generate.ts uses this for the kind's applicability. */
export function isUniversalAdditionalPropEligible(op: OperationModel): boolean {
  return universalBaseline(op) !== undefined;
}

// One additional field injection per object body that does not already get an additional-prop scenario.
export function generateUniversalAdditionalProp(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const baseline = universalBaseline(op);
    if (!baseline) continue;
    const body = structuredClone(baseline);
    if (body.__extraField === undefined) {
      body.__extraField = 'unexpected';
    }
    out.push({
      id: makeId([op.operationId, 'additionalPropAny']),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'additional-prop-general',
      target: '__extraField',
      requestBody: body,
      params: buildParams(op.path),
      expectedStatus: 400,
      description: 'Extra property should be rejected',
      headersAuth: true,
      source: 'body',
    });
  }
  return out;
}

function buildParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const token of m) params[token.slice(1, -1)] = 'x';
  return params;
}
