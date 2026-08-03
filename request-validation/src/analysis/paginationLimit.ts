import type { OperationModel, ValidationScenario } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';
import { makeId } from './common.js';
import { findLimitOnlyBranch, findPaginationPage, isRecord } from './paginationShape.js';

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
}

interface PaginationLimitField {
  pageProp: string;
  minimum?: number;
  maximum?: number;
}

/**
 * `page.limit`'s `minimum`/`maximum` (see `paginationShape.ts` for why it's
 * invisible to every other kind) — matched via the `LimitPagination` branch
 * (the `oneOf` branch whose only property is `limit`), present in every
 * config's pagination family.
 */
export function findPaginationLimitField(op: OperationModel): PaginationLimitField | undefined {
  const page = findPaginationPage(op);
  if (!page) return undefined;
  const branch = findLimitOnlyBranch(page.branches);
  const limitSchema = branch?.properties?.limit;
  if (typeof limitSchema?.minimum !== 'number' && typeof limitSchema?.maximum !== 'number') {
    return undefined;
  }
  return { pageProp: page.pageProp, minimum: limitSchema?.minimum, maximum: limitSchema?.maximum };
}

function planLimitMutations(minimum?: number, maximum?: number): { kind: string; value: number }[] {
  const out: { kind: string; value: number }[] = [];
  if (typeof minimum === 'number') {
    out.push({ kind: 'belowMinimum', value: minimum - 1 });
    out.push({ kind: 'wayBelowMinimum', value: minimum - 100 });
  }
  if (typeof maximum === 'number') {
    out.push({ kind: 'aboveMaximum', value: maximum + 1 });
    out.push({ kind: 'wayAboveMaximum', value: maximum + 100 });
  }
  return out;
}

export function generatePaginationLimitInvalid(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const field = findPaginationLimitField(op);
    if (!field) continue;
    const baseline = buildBaselineBody(op);
    if (!isRecord(baseline)) continue;
    const mutations = planLimitMutations(field.minimum, field.maximum);
    let produced = 0;
    for (const mut of mutations) {
      if (opts.capPerOperation && produced >= opts.capPerOperation) break;
      const body = structuredClone(baseline);
      body[field.pageProp] = { limit: mut.value };
      out.push({
        id: makeId([op.operationId, 'paginationLimit', mut.kind]),
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'pagination-limit-invalid',
        target: `${field.pageProp}.limit`,
        requestBody: body,
        params: buildParams(op.path),
        expectedStatus: 400,
        description: `Pagination limit ${mut.kind} (${field.pageProp}.limit)`,
        headersAuth: true,
      });
      produced++;
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
