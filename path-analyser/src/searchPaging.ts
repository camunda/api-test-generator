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
  return { limit, searches };
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

/** The paging variant for `chain`'s target operation, or none when it has no entry. */
export function buildSearchPagingScenarios(
  chain: EndpointScenario,
  config: SearchPagingConfig,
): EndpointScenario[] {
  const target = chain.operations[chain.operations.length - 1];
  return config.searches
    .filter((s) => s.operationId === target?.operationId)
    .map((s) => ({
      ...chain,
      id: `${chain.id}:paging`,
      name: `page and sort (limit ${config.limit}, ${s.sort.field} ${s.sort.order})`,
      description: `Sends page.limit ${config.limit} and sort ${s.sort.field} ${s.sort.order}${s.filter ? ' with a filter' : ''}; the response holds at most ${config.limit} items${s.checkOrder ? ` ordered by ${s.sort.field}` : ''}.`,
      strategy: 'featureCoverage' as const,
      variantKey: 'paging',
      searchPaging: {
        body: {
          page: { limit: config.limit },
          sort: [{ field: s.sort.field, order: s.sort.order }],
          ...(s.filter ? { filter: s.filter } : {}),
        },
        checks: {
          limit: config.limit,
          ...(s.checkOrder ? { order: { field: s.sort.field, direction: s.sort.order } } : {}),
        },
      },
      bindings: { ...(chain.bindings ?? {}) },
      requestPlan: undefined,
      seedBindings: undefined,
    }));
}
