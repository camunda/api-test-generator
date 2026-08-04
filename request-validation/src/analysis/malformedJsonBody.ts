import type { OperationModel, ValidationScenario } from '../model/types.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
}

/**
 * Every other kind sends a well-formed, `JSON.stringify`-able body with a
 * wrong *value* — nothing sends a body that isn't parseable JSON at all.
 * That hits Spring's deserialization exception path
 * (`HttpMessageNotReadableException`) before the request ever reaches our
 * schema-driven validation — a different code path than every other kind
 * exercises (#499).
 *
 * Deliberately truncated (unterminated object) — invalid under any JSON
 * parser, strict or lenient, and self-descriptive in a failure report.
 *
 * Verified live against a running camunda-oca cluster across 4 distinct
 * operations (2 search, 2 non-search; different resources): uniformly
 * `400` with a COMPLETE ProblemDetail (type/title/status/detail/instance
 * all present) — unlike the shape gap camunda-hub#26448 found on other
 * Spring-exception paths (missing multipart parts, missing query params).
 * No `knownProblemDetailShapeGaps` entry needed for this kind today.
 */
const MALFORMED_JSON_BODY = '{"malformed": ';

export function generateMalformedJsonBody(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    if (!op.requestBodySchema) continue;
    out.push({
      id: makeId([op.operationId, 'malformedJsonBody']),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'malformed-json-body',
      requestBody: MALFORMED_JSON_BODY,
      params: buildParams(op.path),
      expectedStatus: 400,
      description: 'Malformed/unparseable JSON body (truncated)',
      headersAuth: true,
    });
  }
  return out;
}

function buildParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const t of m) params[t.slice(1, -1)] = '1';
  return params;
}
