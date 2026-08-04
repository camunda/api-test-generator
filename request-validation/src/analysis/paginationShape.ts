import type { OperationModel, SchemaFragment } from '../model/types.js';

export interface PaginationPage {
  /** The request-body property carrying pagination criteria (usually `page`). */
  pageProp: string;
  /** The oneOf branches of the pagination-mode wrapper (LimitPagination et al). */
  branches: SchemaFragment[];
}

/**
 * Search/list bodies model pagination as a property whose schema is
 * `{ allOf: [<oneOf of LimitPagination/OffsetPagination/CursorForward.../
 * CursorBackward...>] }` — two hops below the request body root, and that
 * property typically lives inside one of the root schema's OWN `allOf`
 * branches (e.g. `ProcessInstanceSearchQuery = { allOf: [SearchQueryRequest,
 * {filter...}] }`), not directly on `root.properties` — a third hop. The
 * generic `oneof-*` kinds only look at a root-level `oneOf` (never present
 * here), and the shared walker's `mergeAllOf` bails on the page-level shape
 * (an `allOf` branch with `oneOf` and no `type`), so every pagination field
 * is invisible to every walker-based kind too (`constraint-violation`
 * included) even though several carry real constraints. `op.requestBodySchema`
 * is already fully dereferenced (see `spec/loader.ts`'s
 * `SwaggerParser.dereference`), so no `$ref`-following is needed here — just
 * unwrap single-entry `allOf` wrappers.
 *
 * Matched by shape, not by schema title: the wrapper is named
 * `SearchQueryPageRequest` in camunda-oca but `SearchQueryPage` in
 * camunda-hub, even though both are the same pagination-family shape.
 */
export function findPaginationPage(op: OperationModel): PaginationPage | undefined {
  const root = op.requestBodySchema;
  if (!root) return undefined;
  for (const [propName, propSchema] of Object.entries(collectTopLevelProperties(root))) {
    const unwrapped = unwrapSingleAllOf(propSchema);
    if (unwrapped && Array.isArray(unwrapped.oneOf)) {
      return { pageProp: propName, branches: unwrapped.oneOf };
    }
  }
  return undefined;
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

/** The `oneOf` branch whose only property is `limit` (the `LimitPagination` shape). */
export function findLimitOnlyBranch(branches: SchemaFragment[]): SchemaFragment | undefined {
  for (const branch of branches) {
    const keys = Object.keys(branch.properties ?? {});
    if (keys.length === 1 && keys[0] === 'limit') return branch;
  }
  return undefined;
}

/** The `oneOf` branch carrying an offset field (`from`) alongside `limit` (`OffsetPagination`). */
export function findOffsetBranch(branches: SchemaFragment[]): SchemaFragment | undefined {
  for (const branch of branches) {
    const keys = Object.keys(branch.properties ?? {});
    if (keys.length === 2 && keys.includes('from') && keys.includes('limit')) return branch;
  }
  return undefined;
}

/** Every cursor field name (`after`/`before`) present across the oneOf branches. */
export function findCursorFields(branches: SchemaFragment[]): string[] {
  const fields = new Set<string>();
  for (const branch of branches) {
    for (const key of Object.keys(branch.properties ?? {})) {
      if (key === 'after' || key === 'before') fields.add(key);
    }
  }
  return [...fields];
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
