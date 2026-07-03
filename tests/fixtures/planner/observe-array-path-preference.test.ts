import { describe, expect, it } from 'vitest';
import { findMembershipArrayPath } from '../../../path-analyser/src/ontology/observeArrayPath.ts';

/**
 * Layer-2 fixture for the membership-edge observe locator (#421).
 *
 * When a search response echoes MORE than one `identifiedBy` semantic
 * array-nested — e.g. Hub's `searchMembers` items carry both `workspaceKey`
 * (the container) and `email` (the member) — the observe assertion must key on
 * the member, not the container. `findMembershipArrayPath`'s `preferred`
 * argument (the edge's `to`-endpoint identifiers) drives that choice; without
 * it the helper matches the first in iteration order.
 */
function op(entries: { semanticType: string; fieldPath: string }[]) {
  return { responseSemanticTypes: { '200': entries } };
}

// searchMembers-shaped response: container key first, member key second.
const membersOp = op([
  { semanticType: 'WorkspaceKey', fieldPath: 'items[].workspaceKey' },
  { semanticType: 'MemberEmail', fieldPath: 'items[].email' },
]);
const identifiedBy = ['WorkspaceKey', 'MemberEmail'];

describe('findMembershipArrayPath — preferred (to-endpoint) identifier (#421)', () => {
  it('picks the preferred (member) identifier over the container key', () => {
    const loc = findMembershipArrayPath(membersOp, identifiedBy, ['MemberEmail']);
    expect(loc?.membershipSemanticType).toBe('MemberEmail');
    expect(loc?.arrayPath).toEqual(['items']);
    expect(loc?.elementField).toBe('email');
  });

  it('falls back to iteration order when no preferred is given (legacy behaviour)', () => {
    const loc = findMembershipArrayPath(membersOp, identifiedBy);
    expect(loc?.membershipSemanticType).toBe('WorkspaceKey');
  });

  it('falls back to Pass 2 when the preferred semantic is not array-nested', () => {
    // preferred names a semantic that only appears as a scalar (not `[]`), so
    // Pass 1 finds nothing and Pass 2 returns the first array-nested match.
    const loc = findMembershipArrayPath(membersOp, identifiedBy, ['ProjectKey']);
    expect(loc?.membershipSemanticType).toBe('WorkspaceKey');
  });

  it('ignores a preferred semantic that is not in identifiedBy', () => {
    const loc = findMembershipArrayPath(membersOp, ['MemberEmail'], ['WorkspaceKey']);
    // WorkspaceKey is preferred but not in identifiedBy → Pass 1 skips it,
    // Pass 2 returns the only identifiedBy match (email).
    expect(loc?.membershipSemanticType).toBe('MemberEmail');
  });
});
