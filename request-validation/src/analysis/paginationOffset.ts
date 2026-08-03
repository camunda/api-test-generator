import type { OperationModel, ValidationScenario } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';
import { makeId } from './common.js';
import { findOffsetBranch, findPaginationPage, isRecord } from './paginationShape.js';

interface Opts {
  onlyOperations?: Set<string>;
}

/**
 * A schema-valid `page.from` value can still be semantically meaningless: an
 * offset past the real result count. Verified live against a running
 * camunda-oca cluster (203 real process instances):
 *   - `from: 250` (just past total, well under the ES window) → `200`,
 *     `items: []` — the correct, intended graceful behavior this kind tests.
 *   - `from: 10000`+ → `500` (Elasticsearch's default `index.max_result_window`
 *     kicking in) — a DIFFERENT failure mode tied to a fixed numeric
 *     threshold, not "past the real total". Deliberately not modeled as a
 *     scenario here: a 500 isn't something to assert as "expected" (that
 *     would enshrine what looks like a real product gap — no graceful 400
 *     for from+limit exceeding the search backend's window — as correct
 *     behavior). Worth its own bug report, not a generated negative test.
 * `5000` is comfortably under that window (10x any realistic seeded dataset,
 * safely below where the window bug kicks in) — reliably "past total" without
 * tripping the unrelated 500.
 */
const PAST_TOTAL_FROM = 5000;

export function generatePaginationOffsetPastTotal(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const page = findPaginationPage(op);
    if (!page) continue;
    const branch = findOffsetBranch(page.branches);
    if (!branch) continue;
    const baseline = buildBaselineBody(op);
    if (!isRecord(baseline)) continue;
    const body = structuredClone(baseline);
    body[page.pageProp] = { from: PAST_TOTAL_FROM };
    out.push({
      id: makeId([op.operationId, 'paginationOffset', 'pastTotal']),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'pagination-offset-past-total',
      target: `${page.pageProp}.from`,
      requestBody: body,
      params: buildParams(op.path),
      expectedStatus: 200,
      description: `Pagination offset past total result count (${page.pageProp}.from=${PAST_TOTAL_FROM})`,
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
