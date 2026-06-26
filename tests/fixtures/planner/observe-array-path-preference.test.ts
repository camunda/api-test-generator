import { describe, expect, it } from 'vitest';
import { findMembershipArrayPath } from '../../../path-analyser/src/ontology/observeArrayPath.ts';

/**
 * Focused unit tests for `findMembershipArrayPath`'s identifier-selection
 * rule — Layer 2 of the layered test strategy, pinning the pure helper
 * that both the #269 feasibility invariant and the #270 planner
 * instantiator share for locating the membership identifier in an
 * edge-observation response.
 *
 * # Defect class pinned here
 *
 * When an observation response echoes MORE THAN ONE of the edge's
 * `identifiedBy` semantics array-nested (Hub's `searchMembers` items
 * carry both `workspaceKey` (the container) and `email` (the member)),
 * the membership assertion must key off the MEMBER, not the container —
 * otherwise the EdgeLifecycle observe step asserts on the workspace key,
 * which every item in a workspace-scoped search trivially satisfies, so
 * the present/absent assertion is vacuous.
 *
 * The fix added a `preferred` list (the edge's `to`-endpoint
 * identifier(s)) consulted in pass 1 before the legacy iteration-order
 * scan in pass 2. These fixtures guard both passes:
 *
 *   - pass 1 honours `preferred` even when a non-preferred identifiedBy
 *     semantic appears earlier in the response (the Hub regression);
 *   - pass 2 reproduces the legacy first-in-iteration-order behaviour
 *     when `preferred` is empty or none of the preferred semantics are
 *     array-nested (the OCA `RoleUserMembership → items[].username`
 *     shape, which predates `preferred`).
 *
 * A silent revert of the preference logic — e.g. a refactor that drops
 * pass 1 — flips the Hub membership assertion back onto `workspaceKey`
 * and would be caught here.
 */

// `searchMembers`-shaped response: container key listed BEFORE the member
// key in iteration order, so iteration-order alone would pick the wrong one.
const membersResponse = {
  responseSemanticTypes: {
    '200': [
      { semanticType: 'WorkspaceKey', fieldPath: 'items[].workspaceKey' },
      { semanticType: 'MemberEmail', fieldPath: 'items[].email' },
    ],
  },
};

describe('findMembershipArrayPath identifier selection', () => {
  it('prefers the to-endpoint member identifier over an earlier container key (pass 1)', () => {
    const loc = findMembershipArrayPath(
      membersResponse,
      ['WorkspaceKey', 'MemberEmail'],
      ['MemberEmail'],
    );
    expect(loc).toEqual({
      arrayPath: ['items'],
      elementField: 'email',
      membershipSemanticType: 'MemberEmail',
    });
  });

  it('falls back to first-in-iteration-order when preferred is empty (legacy pass 2)', () => {
    const loc = findMembershipArrayPath(membersResponse, ['WorkspaceKey', 'MemberEmail'], []);
    expect(loc).toEqual({
      arrayPath: ['items'],
      elementField: 'workspaceKey',
      membershipSemanticType: 'WorkspaceKey',
    });
  });

  it('ignores a preferred semantic that is not array-nested and falls through to pass 2', () => {
    // `WorkspaceKey` here is preferred but appears as a scalar (no `[]`),
    // so pass 1 finds nothing and pass 2 selects the first array-nested
    // identifiedBy semantic instead.
    const loc = findMembershipArrayPath(
      {
        responseSemanticTypes: {
          '200': [
            { semanticType: 'WorkspaceKey', fieldPath: 'workspaceKey' },
            { semanticType: 'MemberEmail', fieldPath: 'items[].email' },
          ],
        },
      },
      ['WorkspaceKey', 'MemberEmail'],
      ['WorkspaceKey'],
    );
    expect(loc).toEqual({
      arrayPath: ['items'],
      elementField: 'email',
      membershipSemanticType: 'MemberEmail',
    });
  });

  it('ignores a preferred semantic that is not in identifiedBy (pass 1 requires both)', () => {
    // `MemberEmail` is preferred and array-nested, but NOT declared in
    // identifiedBy — pass 1 must skip it and pass 2 picks the declared one.
    const loc = findMembershipArrayPath(membersResponse, ['WorkspaceKey'], ['MemberEmail']);
    expect(loc).toEqual({
      arrayPath: ['items'],
      elementField: 'workspaceKey',
      membershipSemanticType: 'WorkspaceKey',
    });
  });

  it('parses a nested array path and dotted element field', () => {
    const loc = findMembershipArrayPath(
      {
        responseSemanticTypes: {
          '200': [{ semanticType: 'Username', fieldPath: 'data.items[].member.username' }],
        },
      },
      ['Username'],
    );
    expect(loc).toEqual({
      arrayPath: ['data', 'items'],
      elementField: 'member.username',
      membershipSemanticType: 'Username',
    });
  });

  it('rejects an array marker with no element field', () => {
    const loc = findMembershipArrayPath(
      { responseSemanticTypes: { '200': [{ semanticType: 'Username', fieldPath: 'items[]' }] } },
      ['Username'],
    );
    expect(loc).toBeNull();
  });

  it('returns null when no identifiedBy semantic is array-nested', () => {
    const loc = findMembershipArrayPath(
      {
        responseSemanticTypes: {
          '200': [{ semanticType: 'WorkspaceKey', fieldPath: 'workspaceKey' }],
        },
      },
      ['WorkspaceKey'],
    );
    expect(loc).toBeNull();
  });

  it('returns null for an undefined operation', () => {
    expect(findMembershipArrayPath(undefined, ['WorkspaceKey'])).toBeNull();
  });
});
