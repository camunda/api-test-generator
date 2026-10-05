import fsSync from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
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
  /**
   * Derive an entry for every search operation in the spec (a JSON body that takes both `page` and
   * `sort`) that has no explicit entry and is not excluded. See {@link deriveSearchPaging}.
   */
  auto: boolean;
  /** Search operations that get no paging test, each with the reason. */
  exclude: { operationId: string; reason: string }[];
  /** Explicit entries: exceptions to the derived choice, or everything when `auto` is false. */
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
  if (raw.auto !== undefined && typeof raw.auto !== 'boolean') {
    throw new Error(`${p}: "auto" must be a boolean when present.`);
  }
  const rawExclude = raw.exclude ?? [];
  if (!Array.isArray(rawExclude)) throw new Error(`${p}: "exclude" must be an array.`);
  const exclude = rawExclude.map((e, i) => {
    const rec = isRecord(e) ? e : {};
    if (
      typeof rec.operationId !== 'string' ||
      !rec.operationId ||
      typeof rec.reason !== 'string' ||
      !rec.reason
    ) {
      throw new Error(
        `${p}: exclude[${i}] must be { operationId, reason } with non-empty strings.`,
      );
    }
    return { operationId: rec.operationId, reason: rec.reason };
  });
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
  // An operation both excluded and listed would be skipped by the derivation yet still emitted from
  // its explicit entry, contradicting the exclusion.
  const excludedIds = new Set(exclude.map((e) => e.operationId));
  const both = searches.filter((e) => excludedIds.has(e.operationId)).map((e) => e.operationId);
  if (both.length) {
    throw new Error(
      `${p}: operationId(s) listed in both "searches" and "exclude": ${both.join(', ')}.`,
    );
  }
  return { limit, offsetFrom, auto: raw.auto === true, exclude, searches };
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/** Timestamp fields compare the same in JavaScript as on the server, so their order can be asserted. */
const TIMESTAMP_FIELDS = ['created', 'updated', 'deleted'];

/** A search operation found in the spec: its JSON body takes both `page` and `sort`. */
export interface SpecSearchOperation {
  operationId: string;
  /** The values of the sort item's `field` enum, in spec order. */
  sortFields: string[];
}

/**
 * The node a local `$ref` (`#/components/schemas/X`, `#/paths/~1files~1search/post/requestBody`, ...)
 * points to: an RFC 6901 JSON pointer, with `~1` and `~0` unescaped and percent-decoding applied.
 * Anything that is not a local pointer, or does not resolve, yields undefined.
 */
function resolvePointer(spec: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let cur: unknown = spec;
  for (const raw of ref.slice(2).split('/')) {
    let token = raw;
    try {
      token = decodeURIComponent(raw);
    } catch {
      // keep the raw token; a malformed escape cannot match a key anyway
    }
    token = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(cur)) cur = cur[Number(token)];
    else if (isRecord(cur)) cur = cur[token];
    else return undefined;
  }
  return cur;
}

/** Follows `$ref`s until a node that is not a reference. */
function follow(spec: Record<string, unknown>, node: unknown): Record<string, unknown> {
  let cur = node;
  for (let depth = 0; depth < 10 && isRecord(cur) && typeof cur.$ref === 'string'; depth++) {
    cur = resolvePointer(spec, cur.$ref);
  }
  return isRecord(cur) ? cur : {};
}

/**
 * A schema with its `$ref`s followed and its `allOf` branches merged in: the union of their
 * `properties`, and the first `enum` and `items` found. Enough to read which properties a request
 * body takes and what a sort item's `field` may be, however the spec composes them.
 */
function flatten(spec: Record<string, unknown>, node: unknown, depth = 0): Record<string, unknown> {
  const schema = follow(spec, node);
  if (depth > 10) return schema;
  const merged: Record<string, unknown> = { ...schema };
  const properties: Record<string, unknown> = isRecord(schema.properties)
    ? { ...schema.properties }
    : {};
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      const part = flatten(spec, branch, depth + 1);
      if (isRecord(part.properties)) Object.assign(properties, part.properties);
      if (merged.enum === undefined && part.enum !== undefined) merged.enum = part.enum;
      if (merged.items === undefined && part.items !== undefined) merged.items = part.items;
    }
  }
  if (Object.keys(properties).length) merged.properties = properties;
  return merged;
}

/** Every operation whose JSON request body has both a `page` and a `sort` property. */
export function findSearchOperations(spec: unknown): SpecSearchOperation[] {
  if (!isRecord(spec) || !isRecord(spec.paths)) return [];
  const out: SpecSearchOperation[] = [];
  for (const item of Object.values(spec.paths)) {
    if (!isRecord(item)) continue;
    for (const [key, op] of Object.entries(item)) {
      // Only HTTP method keys are operations; a path item may also hold `parameters`, `x-*`
      // extensions and so on, some of which carry an operationId-shaped object.
      if (!HTTP_METHODS.has(key.toLowerCase())) continue;
      if (!isRecord(op) || typeof op.operationId !== 'string') continue;
      const body = follow(spec, op.requestBody);
      const content = isRecord(body.content) ? body.content : {};
      const json = isRecord(content['application/json']) ? content['application/json'] : {};
      const properties = flatten(spec, json.schema).properties;
      if (!isRecord(properties) || !('page' in properties) || !('sort' in properties)) continue;
      const sortItem = flatten(spec, flatten(spec, properties.sort).items);
      const sortItemProps = isRecord(sortItem.properties) ? sortItem.properties : {};
      const fieldSchema = flatten(spec, sortItemProps.field);
      const sortFields = Array.isArray(fieldSchema.enum)
        ? fieldSchema.enum.filter((f): f is string => typeof f === 'string')
        : [];
      out.push({ operationId: op.operationId, sortFields });
    }
  }
  return out;
}

/**
 * The spec the other readers use: `OPENAPI_SPEC_PATH` when set (resolved against `baseDir`, like
 * the graph loader), else the active config's bundled spec. JSON or YAML.
 */
export function loadSpecDocument(baseDir: string, bundledSpecPath: string): unknown {
  const override = process.env.OPENAPI_SPEC_PATH;
  const specPath = override ? path.resolve(baseDir, override) : bundledSpecPath;
  return parseYaml(fsSync.readFileSync(specPath, 'utf8'));
}

/**
 * The effective config: the explicit entries plus, when `auto` is set, one derived entry per search
 * operation in the spec that is neither listed nor excluded. The derived choice is `created`, else
 * `updated`, else `deleted` (whichever the sort enum offers), descending, with its order asserted; if there is none, the first
 * enum field ascending without an order assertion (names sort by the database collation).
 */
export function deriveSearchPaging(config: SearchPagingConfig, spec: unknown): SearchPagingConfig {
  if (!config.auto) return config;
  const found = findSearchOperations(spec);
  const known = new Set(found.map((s) => s.operationId));
  const stale = config.exclude.filter((e) => !known.has(e.operationId)).map((e) => e.operationId);
  if (stale.length) {
    throw new Error(
      `search-paging.json excludes operationId(s) that are not search operations in the spec: ${stale.join(', ')}.`,
    );
  }
  const listed = new Set(config.searches.map((s) => s.operationId));
  const excluded = new Set(config.exclude.map((e) => e.operationId));
  const derived: SearchPagingEntry[] = [];
  for (const op of found) {
    if (listed.has(op.operationId) || excluded.has(op.operationId)) continue;
    if (op.sortFields.length === 0) {
      throw new Error(
        `search-paging.json: cannot derive a sort for ${op.operationId}, its sort field has no enum. List it in "searches" or "exclude" it.`,
      );
    }
    const timestamp = TIMESTAMP_FIELDS.find((f) => op.sortFields.includes(f));
    derived.push(
      timestamp
        ? {
            operationId: op.operationId,
            sort: { field: timestamp, order: 'DESC' },
            checkOrder: true,
          }
        : {
            operationId: op.operationId,
            sort: { field: op.sortFields[0], order: 'ASC' },
            checkOrder: false,
          },
    );
  }
  return { ...config, searches: [...config.searches, ...derived] };
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
