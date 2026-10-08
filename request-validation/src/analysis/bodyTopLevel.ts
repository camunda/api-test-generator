import type { OperationModel, ValidationScenario } from '../model/types.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
}

/**
 * Whether a `missing-body` scenario is built for the operation: only when the body is explicitly required OR
 * effectively required (every property is required). Optional bodies are skipped entirely (we don't assert
 * positives; business logic not derivable here). generate.ts reuses this exact check for the coverage report's
 * applicability, so the report cannot ask for a scenario this generator never builds.
 */
export function isMissingBodyEligible(op: OperationModel): boolean {
  if (!op.requestBodySchema) return false;
  if (op.bodyRequired === true) return true;
  const schema = op.requestBodySchema;
  if (schema.type === 'object' && schema.properties && op.requiredProps?.length) {
    const propCount = Object.keys(schema.properties).length;
    return propCount > 0 && op.requiredProps.length === propCount;
  }
  return false;
}

export function generateMissingBody(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    if (!isMissingBodyEligible(op)) continue;
    out.push({
      id: makeId([op.operationId, 'missingBody']),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'missing-body',
      expectedStatus: 400,
      description: 'Omit entire required (or effectively required) body',
      headersAuth: true,
      params: buildParams(op.path),
      source: 'body',
    });
  }
  return out;
}

export function generateBodyTopTypeMismatch(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const schema = op.requestBodySchema;
    if (!schema) continue;
    const actual = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    let wrong: unknown;
    switch (actual) {
      case 'object':
        wrong = [];
        break;
      case 'array':
        wrong = {};
        break;
      case 'string':
        wrong = 123;
        break;
      case 'integer':
      case 'number':
        wrong = 'notNumber';
        break;
      case 'boolean':
        wrong = 'notBoolean';
        break;
      default:
        wrong = 42;
    }
    out.push({
      id: makeId([op.operationId, 'bodyTopType']),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'body-top-type-mismatch',
      requestBody: wrong,
      expectedStatus: 400,
      description: 'Wrong top-level body type',
      headersAuth: true,
      params: buildParams(op.path),
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
