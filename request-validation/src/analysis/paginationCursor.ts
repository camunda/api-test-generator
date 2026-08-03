import type { OperationModel, ValidationScenario } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';
import { makeId } from './common.js';
import { findCursorFields, findPaginationPage, isRecord } from './paginationShape.js';

interface Opts {
  onlyOperations?: Set<string>;
}

/**
 * `after`/`before` (`EndCursor`/`StartCursor`) only constrain the base64
 * CHARSET via a `pattern` — not whether the content actually decodes to a
 * valid cursor. Verified live against a running camunda-oca cluster:
 *   - base64 of NON-JSON garbage bytes (still pattern-valid) → `400` with
 *     `{"title":"INVALID_ARGUMENT","detail":"Cannot decode pagination
 *     cursor '...'"}"` — a clean, well-formed ProblemDetail. This is the
 *     "schema-valid but semantically meaningless" case this kind targets.
 *   - a well-formed-but-past-the-end cursor (valid JSON sort-key array,
 *     just pointing past all real data) → `200`, `items: []` — the SAME
 *     graceful behavior as pagination-offset-past-total, so not modeled as
 *     a separate kind (would need per-operation sort-key-shape awareness
 *     for no additional coverage value over the `from` case).
 * The garbage value is universal — it never needs to look like a real sort
 * key, so no per-operation awareness of sort-key shape is needed here,
 * unlike the deferred "past-the-end cursor" case above.
 */
const UNDECODABLE_CURSOR = Buffer.from('not a real cursor payload', 'utf8').toString('base64');

export function generatePaginationCursorInvalid(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const page = findPaginationPage(op);
    if (!page) continue;
    const baseline = buildBaselineBody(op);
    if (!isRecord(baseline)) continue;
    for (const field of findCursorFields(page.branches)) {
      const body = structuredClone(baseline);
      body[page.pageProp] = { [field]: UNDECODABLE_CURSOR };
      out.push({
        id: makeId([op.operationId, 'paginationCursor', field, 'undecodable']),
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'pagination-cursor-invalid',
        target: `${page.pageProp}.${field}`,
        requestBody: body,
        params: buildParams(op.path),
        expectedStatus: 400,
        description: `Pagination cursor undecodable (${page.pageProp}.${field})`,
        headersAuth: true,
      });
    }
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
