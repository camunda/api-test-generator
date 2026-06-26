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
  // Membership identifier(s) to prefer — typically the edge's `to`-endpoint
  // identifier(s) (the entity added to the container). When the observation
  // response echoes more than one identifiedBy semantic array-nested (e.g.
  // Hub's searchMembers items carry both `workspaceKey` and `email`), without
  // this the helper would match the FIRST in iteration order and could assert
  // on the container key rather than the member. Empty preserves the prior
  // iteration-order behaviour (e.g. OCA RoleUserMembership → username).
  //
  // Selection rule:
  //   Pass 1 — return the first response entry whose semantic is BOTH in
  //            `preferred` AND in `identifiedBy` and is array-nested.
  //   Pass 2 — only if pass 1 finds nothing (empty `preferred`, or no
  //            preferred semantic is array-nested): return the first
  //            array-nested `identifiedBy` entry in iteration order.
  // So `preferred` overrides iteration order only when it actually resolves
  // to an array-nested, identifiedBy-declared field; otherwise the legacy
  // behaviour is unchanged.
  preferred: readonly string[] = [],
): MembershipArrayPath | null {
  if (!op) return null;
  const responses = op.responseSemanticTypes?.['200'] ?? [];
  const identifiedSet = new Set(identifiedBy);

  const toLocator = (entry: {
    semanticType: string;
    fieldPath: string;
  }): MembershipArrayPath | null => {
    if (!entry.fieldPath.includes('[]')) return null;
    const idx = entry.fieldPath.indexOf('[]');
    const before = entry.fieldPath.slice(0, idx);
    const after = entry.fieldPath.slice(idx + 2);
    // Strip a leading '.' from the post-`[]` remainder so a path like
    // `items[].username` yields elementField='username' not '.username'.
    const elementField = after.startsWith('.') ? after.slice(1) : after;
    if (!elementField) return null;
    const arrayPath = before.split('.').filter((s) => s.length > 0);
    if (arrayPath.length === 0) return null;
    return { arrayPath, elementField, membershipSemanticType: entry.semanticType };
  };

  // Pass 1: prefer the `to`-endpoint membership identifier(s).
  const preferredSet = new Set(preferred);
  if (preferredSet.size > 0) {
    for (const entry of responses) {
      if (!preferredSet.has(entry.semanticType)) continue;
      if (!identifiedSet.has(entry.semanticType)) continue;
      const loc = toLocator(entry);
      if (loc) return loc;
    }
  }
  // Pass 2: any identifiedBy semantic, in iteration order (legacy behaviour).
  for (const entry of responses) {
    if (!identifiedSet.has(entry.semanticType)) continue;
    const loc = toLocator(entry);
    if (loc) return loc;
  }
  return null;
}
