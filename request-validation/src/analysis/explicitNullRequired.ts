import type { OperationModel, SchemaFragment, ValidationScenario } from '../model/types.js';
import { genPlaceholder, makeId } from './common.js';

interface Opts {
  capPerOperation?: number;
  onlyOperations?: Set<string>;
}

/**
 * `missing-required` omits a required key from the body entirely.
 * Jackson/Spring (and Bean Validation) can treat an explicit `null`
 * differently from an absent key depending on how the field is annotated
 * (`@NotNull` vs. relying purely on the JSON body's `required` array) — a
 * distinct case `missing-required` never exercises (#500).
 *
 * Same target-field selection as `missingRequired.ts` (top-level
 * `requiredProps`, JSON bodies only) — mirrored deliberately, not shared,
 * since the only difference is the mutation itself (set `null` vs. omit).
 *
 * Skips a field whose schema allows `null` — either an OAS 3.1 `type` array
 * including `'null'`, or a `oneOf`/`anyOf` branch of `{ type: 'null' }`
 * (the other common way JSON Schema expresses nullability, typically when
 * the nullable side is itself a `$ref`, which can't sit in a `type` array).
 * Sending `null` in either case is schema-valid input, not a negative test.
 * (None of the 47 real top-level-required fields checked are nullable
 * today via either form, but the check is part of this kind's own
 * definition — "required, NON-NULLABLE property" — not a hypothetical.)
 *
 * Verified live against a running camunda-oca cluster across 4 required
 * fields on 3 operations (string, and object-typed): uniformly 400, with
 * the exact same ProblemDetail `detail` message as the omitted-key case
 * (`missing-required`) — confirms this API doesn't distinguish the two,
 * but is still a genuinely different code path worth covering per #500's
 * own reasoning (some APIs/frameworks do distinguish).
 */
export function generateExplicitNullRequired(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    if (!op.requiredProps?.length) continue;
    if (!op.requestBodySchema || op.requestBodySchema.type !== 'object') continue;
    if (op.mediaTypes && !op.mediaTypes.includes('application/json')) continue;
    let count = 0;
    for (const prop of op.requiredProps) {
      if (opts.capPerOperation && count >= opts.capPerOperation) break;
      const schema = op.requestBodySchema.properties?.[prop];
      if (isNullable(schema)) continue;
      const body: Record<string, unknown> = {};
      for (const p of op.requiredProps) {
        body[p] = p === prop ? null : genPlaceholder(op.requestBodySchema.properties?.[p]);
      }
      out.push({
        id: makeId([op.operationId, 'explicitNull', prop]),
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'explicit-null-required',
        target: prop,
        requestBody: body,
        params: buildDummyParams(op.path),
        expectedStatus: 400,
        description: `Explicit null for required field '${prop}' (not omitted)`,
        headersAuth: true,
        bodyEncoding: 'json',
      });
      count++;
    }
  }
  return out;
}

function isNullable(schema: SchemaFragment | undefined): boolean {
  if (!schema) return false;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('null')) return true;
  const branches = [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])];
  return branches.some((b) => b.type === 'null');
}

function buildDummyParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const token of m) params[token.slice(1, -1)] = 'x';
  return params;
}
