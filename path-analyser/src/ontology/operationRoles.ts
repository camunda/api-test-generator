// Operation-role accessors over the artifact-kinds ABox (Lift 9 / #225).
//
// The artifact-kinds ABox declares an optional `role` per operation rule
// (see `artifactKindsSchema.ts` and
// `configs/<config>/ontology/artifact-kinds.json`). Roles let the planner
// and Playwright emitter discriminate special-case behaviour against the
// ABox instead of against a hard-coded operationId, so a second API
// config (with a deployment operation under a different name) can wire
// the same machinery purely via configuration.
//
// `deploymentGateway` is the only role consumed today: it identifies the
// multipart deploy operation whose response surfaces deployed artifact
// identifiers (in camunda-oca, `createDeployment`). The planner uses it
// to gate `applyArtifactRuleSelection`, the per-step
// modelsDraft/bindingsDraft fallback, and the
// `computeDeploymentRequiredStates` cross-step state diff; the
// Playwright emitter uses it to route 200-expected multipart steps
// through the `deploy()` helper instead of the inline multipart path.
//
// All accessors are pure and tolerant of `undefined`/missing ABoxes —
// callers can safely thread `graph.domain` (which is itself optional)
// directly through.

import type { DomainSemantics } from '../types.js';

/**
 * Subset of `DomainSemantics` consumed by the role accessors. Accepting
 * the narrow shape (instead of the full `DomainSemantics`) lets callers
 * supply a partially-derived view (e.g. directly from
 * `deriveArtifactKindsViews`) without having to fabricate the unrelated
 * top-level fields.
 */
type RoleSource = Pick<DomainSemantics, 'operationArtifactRules'>;

export const DEPLOYMENT_GATEWAY_ROLE = 'deploymentGateway';

/**
 * Look up the ontological role declared for `opId` in the active ABox,
 * or `undefined` when the op is absent or the rule has no role.
 */
export function getRoleForOperation(
  domain: RoleSource | undefined,
  opId: string,
): string | undefined {
  return domain?.operationArtifactRules?.[opId]?.role;
}

/**
 * Whether `opId` is the deployment-gateway operation per the ABox.
 *
 * Returns `false` when the ABox is absent — callers that need to
 * special-case deployment routing should fall back to "no special
 * casing" rather than to a hard-coded operationId.
 */
export function isDeploymentGatewayOp(domain: RoleSource | undefined, opId: string): boolean {
  return getRoleForOperation(domain, opId) === DEPLOYMENT_GATEWAY_ROLE;
}

/**
 * Find the operationId carrying the given role in the active ABox.
 *
 * Returns the first match (declaration order in the ABox). Returns
 * `undefined` when the ABox is absent or no rule declares the role.
 *
 * `findDeploymentGatewayOpId` is a convenience for the common case.
 */
export function findOpIdByRole(domain: RoleSource | undefined, role: string): string | undefined {
  const rules = domain?.operationArtifactRules;
  if (!rules) return undefined;
  for (const [opId, spec] of Object.entries(rules)) {
    if (spec?.role === role) return opId;
  }
  return undefined;
}

export function findDeploymentGatewayOpId(domain: RoleSource | undefined): string | undefined {
  return findOpIdByRole(domain, DEPLOYMENT_GATEWAY_ROLE);
}
