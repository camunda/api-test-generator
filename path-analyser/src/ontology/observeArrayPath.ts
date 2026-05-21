import type { OperationNode } from '../types.js';

/**
 * Shared helper for #270 — locating the array-nested response field on
 * an observation operation that carries a membership identifier.
 *
 * The #269 feasibility invariant ("every edge × Observe step is
 * feasible…") and the #270 planner instantiator must compute the same
 * thing: scan the operation's `responseSemanticTypes['200']` entries
 * for one whose `fieldPath` contains a `[]` marker AND whose
 * `semanticType` is one of the edge's `identifiedBy` types. Both
 * consumers live behind this single helper so a future tweak (e.g.
 * allowing 201-only observers) happens in one place instead of two.
 *
 * Returns the membership locator (path into the response body to the
 * carrier array plus the property name on each element) or `null` if
 * no `identifiedBy` type appears array-nested in the response. The
 * planner treats `null` as a hard error at instantiation time; the
 * invariant collects the offenders into a single diagnostic.
 *
 * Field-path parsing: the semantic-graph extractor emits paths like
 *   - `items[].username`              → arrayPath=['items'],        elementField='username'
 *   - `data.items[].member.username`  → arrayPath=['data','items'], elementField='member.username'
 *   - `items[]`                       → arrayPath=['items'],        elementField='' (rejected)
 *
 * Only the first `[]` is used to split: the helper assumes the
 * membership identifier sits on a top-level array of records, which
 * holds for every OCA edge observation op in Phase 1. A second `[]`
 * deeper into the element shape would indicate a nested array of
 * records, which the present/absent assertion cannot meaningfully
 * express without a richer DSL.
 *
 * Ambiguity: when more than one identifiedBy semantic appears
 * array-nested in the same response, the helper returns the FIRST
 * match in iteration order of `responseSemanticTypes['200']`. The
 * regression invariants pin the chosen path for at least one known
 * edge (RoleUserMembership → items / username) so a silent re-shuffle
 * of the heuristic would surface.
 *
 * Accepting a single operation node (rather than the whole
 * OperationGraph + an opId) keeps the helper independent of the
 * planner's graph shape, which means the L3 invariant can call it
 * with the lightweight node shape it already has from
 * `cachedOperationById` without round-tripping through a synthetic
 * graph object.
 */
export interface MembershipArrayPath {
  arrayPath: string[];
  elementField: string;
  membershipSemanticType: string;
}

export function findMembershipArrayPath(
  op:
    | Pick<OperationNode, 'responseSemanticTypes'>
    | { responseSemanticTypes?: Record<string, { semanticType: string; fieldPath: string }[]> }
    | undefined,
  identifiedBy: readonly string[],
): MembershipArrayPath | null {
  if (!op) return null;
  const responses = op.responseSemanticTypes?.['200'] ?? [];
  const identifiedSet = new Set(identifiedBy);
  for (const entry of responses) {
    if (!identifiedSet.has(entry.semanticType)) continue;
    if (!entry.fieldPath.includes('[]')) continue;
    const idx = entry.fieldPath.indexOf('[]');
    const before = entry.fieldPath.slice(0, idx);
    const after = entry.fieldPath.slice(idx + 2);
    // Strip a leading '.' from the post-`[]` remainder so a path like
    // `items[].username` yields elementField='username' not '.username'.
    const elementField = after.startsWith('.') ? after.slice(1) : after;
    if (!elementField) continue;
    const arrayPath = before.split('.').filter((s) => s.length > 0);
    if (arrayPath.length === 0) continue;
    return {
      arrayPath,
      elementField,
      membershipSemanticType: entry.semanticType,
    };
  }
  return null;
}
