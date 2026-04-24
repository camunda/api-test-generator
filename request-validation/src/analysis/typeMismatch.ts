import type { OperationModel, SchemaFragment, ValidationScenario } from '../model/types.js';
import { makeId } from './common.js';

interface Opts {
  capPerOperation?: number;
  onlyOperations?: Set<string>;
}

export function generateTypeMismatch(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    let count = 0;
    for (const param of op.parameters) {
      if (opts.capPerOperation && count >= opts.capPerOperation) break;
      if (!param.schema || !param.required) continue; // focus on required
      // Guard: only generate generic type-mismatch for path params.
      // Query/header param mismatches are handled by generateParamTypeMismatch to avoid duplicates.
      if (param.in !== 'path') continue;
      // No meaningful negative for bare string path params (runtime treats all path segments as strings).
      const paramType = Array.isArray(param.schema.type) ? param.schema.type[0] : param.schema.type;
      if (paramType === 'string') continue;
      const wrong = buildWrongType(param.schema);
      if (wrong === undefined) continue;
      const params: Record<string, string> | undefined = buildParams(op.path);
      if (param.in === 'path') {
        // override path param with wrong value (stringify)
        if (params) params[param.name] = String(wrong);
      }
      const id = makeId([op.operationId, 'paramType', param.name]);
      out.push({
        id,
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'type-mismatch',
        target: param.name,
        params,
        requestBody: buildMinimalBody(op),
        expectedStatus: 400,
        description: `Parameter '${param.name}' wrong type`,
        headersAuth: true,
      });
      count++;
    }
  }
  return out;
}

function buildWrongType(schema: SchemaFragment): unknown {
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (t) {
    case 'string':
      return 12345;
    case 'integer':
    case 'number':
      return 'not-a-number';
    case 'boolean':
      return 'NOT_A_BOOLEAN';
    case 'array':
      return {}; // object instead of array
    case 'object':
      return 42; // number instead of object
    default:
      return undefined;
  }
}

function buildParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const token of m) {
    const name = token.slice(1, -1);
    params[name] = 'x';
  }
  return params;
}

function buildMinimalBody(op: OperationModel): Record<string, unknown> | undefined {
  if (
    !op.requestBodySchema ||
    op.requestBodySchema.type !== 'object' ||
    !Array.isArray(op.requiredProps)
  )
    return undefined;
  const body: Record<string, unknown> = {};
  for (const p of op.requiredProps) {
    const schema = op.requestBodySchema.properties?.[p];
    body[p] = schemaValue(schema);
  }
  return body;
}

function schemaValue(schema: SchemaFragment | undefined): unknown {
  if (!schema) return 'x';
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (t) {
    case 'string':
      return 'x';
    case 'integer':
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {}; // shallow
    default:
      return 'x';
  }
}
