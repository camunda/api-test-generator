import fsSync from 'node:fs';
import path from 'node:path';
import type { EndpointScenario, OperationGraph } from './types.js';

export interface SearchPagingEntry {
  operationId: string;
  /** Sort field and direction sent with the request. */
  sort: { field: string; order: 'ASC' | 'DESC' };
  /**
   * Assert the response is ordered by the sort field. Only for fields whose values compare
   * the same in JavaScript as on the server (timestamps); names depend on the database collation.
   */
  checkOrder: boolean;
  /** Sent as the search `filter`, for operations whose only success tests send none. */
  filter?: Record<string, unknown>;
}

export interface SearchPagingConfig {
  limit: number;
  /** The `page.from` of the offset variant. */
  offsetFrom: number;
  searches: SearchPagingEntry[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * `configs/<config>/search-paging.json` (optional): search operations that also get a
 * success-path test sending `page` (limit) and `sort`, and asserting the limit and order hold.
 * Returns `null` when absent; throws when present but malformed.
 */
export function loadSearchPaging(configDir: string): SearchPagingConfig | null {
  const p = path.join(configDir, 'search-paging.json');
  if (!fsSync.existsSync(p)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fsSync.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to read/parse ${p}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isRecord(raw) || !Array.isArray(raw.searches)) {
    throw new Error(`${p}: expected a JSON object with a "searches" array.`);
  }
  const limit = raw.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`${p}: "limit" must be a positive integer.`);
  }
  const offsetFrom = raw.offsetFrom;
  if (typeof offsetFrom !== 'number' || !Number.isInteger(offsetFrom) || offsetFrom < 1) {
    throw new Error(`${p}: "offsetFrom" must be a positive integer.`);
  }
  const seen = new Set<string>();
  const searches = raw.searches.map((e, i): SearchPagingEntry => {
    const rec = isRecord(e) ? e : {};
    const sort = isRecord(rec.sort) ? rec.sort : {};
    if (
      typeof rec.operationId !== 'string' ||
      !rec.operationId ||
      typeof sort.field !== 'string' ||
      !sort.field ||
      (sort.order !== 'ASC' && sort.order !== 'DESC') ||
      typeof rec.checkOrder !== 'boolean' ||
      (rec.filter !== undefined && !isRecord(rec.filter))
    ) {
      throw new Error(
        `${p}: searches[${i}] must be { operationId, sort: { field, order: "ASC"|"DESC" }, checkOrder: boolean, filter?: object }.`,
      );
    }
    if (seen.has(rec.operationId))
      throw new Error(`${p}: searches[${i}] repeats ${rec.operationId}.`);
    seen.add(rec.operationId);
    return {
      operationId: rec.operationId,
      sort: { field: sort.field, order: sort.order },
      checkOrder: rec.checkOrder,
      ...(isRecord(rec.filter) ? { filter: rec.filter } : {}),
    };
  });
  return { limit, offsetFrom, searches };
}

/** Fails generation for an entry naming an operation the spec does not have. */
export function validateSearchPaging(graph: OperationGraph, config: SearchPagingConfig): void {
  const unknown = config.searches.map((s) => s.operationId).filter((id) => !graph.operations[id]);
  if (unknown.length) {
    throw new Error(
      `search-paging.json lists operationId(s) not present in the spec: ${unknown.join(', ')}.`,
    );
  }
}

/** The paging variants for `chain`'s target operation: limit and sort, and an offset page. */
export function buildSearchPagingScenarios(
  chain: EndpointScenario,
  config: SearchPagingConfig,
): EndpointScenario[] {
  const target = chain.operations[chain.operations.length - 1];
  const out: EndpointScenario[] = [];
  for (const s of config.searches) {
    if (s.operationId !== target?.operationId) continue;
    const sort = [{ field: s.sort.field, order: s.sort.order }];
    const filter = s.filter ? { filter: s.filter } : {};
    const order = s.checkOrder ? { order: { field: s.sort.field, direction: s.sort.order } } : {};
    const base = {
      ...chain,
      strategy: 'featureCoverage' as const,
      bindings: { ...(chain.bindings ?? {}) },
      requestPlan: undefined,
      seedBindings: undefined,
    };
    out.push({
      ...base,
      id: `${chain.id}:paging`,
      name: `page and sort (limit ${config.limit}, ${s.sort.field} ${s.sort.order})`,
      description: `Sends page.limit ${config.limit} and sort ${s.sort.field} ${s.sort.order}${s.filter ? ' with a filter' : ''}; the response holds at most ${config.limit} items${s.checkOrder ? `, ordered by ${s.sort.field}, and the opposite sort comes back in the opposite order` : ''}.`,
      variantKey: 'paging',
      searchPaging: {
        body: { page: { limit: config.limit }, sort, ...filter },
        checks: { limit: config.limit, ...order },
      },
    });
    // The offset test compares two queries made a moment apart. Ascending, an item created
    // in between lands after the compared slice; descending, it would shift every position.
    const offsetOrder = 'ASC' as const;
    const offsetSort = s.checkOrder ? [{ field: s.sort.field, order: offsetOrder }] : sort;
    const offsetChecks = s.checkOrder
      ? { order: { field: s.sort.field, direction: offsetOrder } }
      : {};
    out.push({
      ...base,
      id: `${chain.id}:paging-offset`,
      name: `page offset (from ${config.offsetFrom}, limit ${config.limit}, ${s.sort.field} ${s.checkOrder ? offsetOrder : s.sort.order})`,
      description: `Sends page.from ${config.offsetFrom} and page.limit ${config.limit}${s.checkOrder ? '; the items match the same slice of an unpaged query sorted the same way' : ''}.`,
      variantKey: 'paging-offset',
      searchPaging: {
        body: {
          page: { from: config.offsetFrom, limit: config.limit },
          sort: offsetSort,
          ...filter,
        },
        checks: { limit: config.limit, ...offsetChecks, offset: { from: config.offsetFrom } },
      },
    });
  }
  return out;
}
