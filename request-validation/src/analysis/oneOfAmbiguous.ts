import type { OperationModel, SchemaFragment, ValidationScenario } from '../model/types.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
}

/**
 * Two object variants that both list `required`, where neither required set is a proper subset of the other: the
 * pair a merged, ambiguous body can be built from. Equal sets count (they were ambiguous before #838).
 *
 * A proper subset is skipped because the merge then equals the larger variant's required set, which servers resolve
 * to that variant instead of rejecting: createProcessInstance ById `[processDefinitionId]` and ByVersionTag
 * `[processDefinitionId, processDefinitionVersionTag]` merge to a body the broker accepts (404 for the unknown id,
 * #838). By JSON Schema alone that body still matches both variants, so this rule rests on observed server behaviour,
 * not on the schema.
 */
export function isAmbiguousPair(
  a: SchemaFragment | undefined,
  b: SchemaFragment | undefined,
): boolean {
  if (
    !a ||
    !b ||
    a.type !== 'object' ||
    b.type !== 'object' ||
    !Array.isArray(a.required) ||
    !Array.isArray(b.required)
  ) {
    return false;
  }
  const ra = new Set<string>(a.required);
  const rb = new Set<string>(b.required);
  const aInB = [...ra].every((r) => rb.has(r));
  const bInA = [...rb].every((r) => ra.has(r));
  // Equal sets (both contain the other) stay ambiguous, as before #838; only a proper subset is skipped.
  return aInB === bInA;
}

/**
 * The variant pairs of a ROOT oneOf that a merged, ambiguous body can be built from, in the order the scenarios are
 * built, one at a time (a oneOf nested inside a property is not looked at). The generator builds one scenario per
 * pair and stops at its cap without walking the rest, and generate.ts reuses `isOneOfAmbiguousEligible` (some pair
 * exists) for the coverage report's applicability, so both read the same sequence.
 */
export function* ambiguousPairs(
  op: OperationModel,
): Generator<{ i: number; j: number; a: SchemaFragment; b: SchemaFragment }> {
  const root = op.requestBodySchema;
  if (!root || !Array.isArray(root.oneOf) || root.oneOf.length < 2) return;
  for (let i = 0; i < root.oneOf.length; i++) {
    for (let j = i + 1; j < root.oneOf.length; j++) {
      const a = root.oneOf[i];
      const b = root.oneOf[j];
      if (a && b && isAmbiguousPair(a, b)) yield { i, j, a, b };
    }
  }
}

/** Stops at the first pair: the answer needs no more. */
export function isOneOfAmbiguousEligible(op: OperationModel): boolean {
  return ambiguousPairs(op).next().done === false;
}

export function generateOneOfAmbiguous(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    // For each pair (first up to cap) merge required sets
    let produced = 0;
    for (const { i, j, a, b } of ambiguousPairs(op)) {
      if (opts.capPerOperation && produced >= opts.capPerOperation) break;
      const merged: Record<string, unknown> = {};
      for (const r of a.required ?? []) merged[r] = placeholder(a.properties?.[r]);
      for (const r of b.required ?? []) merged[r] = placeholder(b.properties?.[r]);
      out.push({
        id: makeId([op.operationId, 'oneofAmbiguous', String(i), String(j)]),
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'oneof-ambiguous',
        target: 'oneOf',
        requestBody: merged,
        params: buildParams(op.path),
        expectedStatus: 400,
        description: `Ambiguous oneOf variants ${i}+${j}`,
        headersAuth: true,
      });
      produced++;
    }
  }
  return out;
}

function placeholder(schema: SchemaFragment | undefined): unknown {
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
function buildParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const token of m) params[token.slice(1, -1)] = 'x';
  return params;
}
