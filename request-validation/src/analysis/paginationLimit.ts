import type { OperationModel, SchemaFragment, ValidationScenario } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';
import { makeId } from './common.js';

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
 * Search/list bodies model pagination as a `page` property whose schema is
 * `{ allOf: [<oneOf of LimitPagination/OffsetPagination/CursorForward.../
 * CursorBackward...>] }` — two hops below the request body root, and `page`
 * itself typically lives inside one of the root schema's OWN `allOf`
 * branches (e.g. `ProcessInstanceSearchQuery = { allOf: [SearchQueryRequest,
 * {filter...}] }`), not directly on `root.properties` — a third hop. The
 * generic `oneof-*` kinds only look at a root-level `oneOf` (never present
 * here), and the shared walker's `mergeAllOf` bails on the page-level shape
 * (an `allOf` branch with `oneOf` and no `type`), so `page.limit` is
 * invisible to every walker-based kind too (`constraint-violation` included)
 * even though it carries a real `minimum`/`maximum`. `op.requestBodySchema`
 * is already fully dereferenced (see `spec/loader.ts`'s
 * `SwaggerParser.dereference`), so no `$ref`-following is needed here — just
 * unwrap single-entry `allOf` wrappers.
 *
 * Matched by shape, not by schema title: the wrapper is named
 * `SearchQueryPageRequest` in camunda-oca but `SearchQueryPage` in
 * camunda-hub, even though both are the same pagination-family shape.
 */
export function findPaginationLimitField(op: OperationModel): PaginationLimitField | undefined {
  const root = op.requestBodySchema;
  if (!root) return undefined;
  for (const [propName, propSchema] of Object.entries(collectTopLevelProperties(root))) {
    const unwrapped = unwrapSingleAllOf(propSchema);
    if (!unwrapped || !Array.isArray(unwrapped.oneOf)) continue;
    for (const branch of unwrapped.oneOf) {
      const keys = Object.keys(branch.properties ?? {});
      if (keys.length !== 1 || keys[0] !== 'limit') continue;
      const limitSchema = branch.properties?.limit;
      if (typeof limitSchema?.minimum !== 'number' && typeof limitSchema?.maximum !== 'number') {
        continue;
      }
      return { pageProp: propName, minimum: limitSchema?.minimum, maximum: limitSchema?.maximum };
    }
  }
  return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// One level only: every concrete search-request schema observed merges its
// own `filter`/`sort` object directly alongside a shared base (e.g.
// `SearchQueryRequest`) via a flat `allOf: [base, {filter,sort}]` — never a
// nested allOf-of-allOf for the root itself.
function collectTopLevelProperties(root: SchemaFragment): Record<string, SchemaFragment> {
  const props: Record<string, SchemaFragment> = { ...root.properties };
  if (Array.isArray(root.allOf)) {
    for (const branch of root.allOf) {
      if (branch.properties) Object.assign(props, branch.properties);
    }
  }
  return props;
}

function unwrapSingleAllOf(schema: SchemaFragment): SchemaFragment {
  if (Array.isArray(schema.allOf) && schema.allOf.length === 1 && !schema.oneOf) {
    return schema.allOf[0];
  }
  return schema;
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
