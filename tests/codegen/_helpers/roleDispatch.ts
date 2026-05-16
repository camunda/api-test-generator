// Test helper: load the active config's role bundles and produce the
// EmitContext fields the Playwright emitter needs for role dispatch.
// Replaces the pre-Lift-12 `deploymentGatewayOpId: 'createDeployment'`
// shorthand with the role-aware plumbing.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDeploymentExtracts } from '../../../materializer/src/deploymentExtracts.ts';
import {
  type LoadedRoleBundle,
  loadRoleBundlesForActiveConfig,
} from '../../../materializer/src/playwright/roleRenderer.ts';
import { deriveArtifactKindsViews } from '../../../path-analyser/src/ontology/loader.ts';
import {
  DEPLOYMENT_GATEWAY_ROLE,
  getRoleForOperation,
} from '../../../path-analyser/src/ontology/operationRoles.ts';
import type { OperationNode } from '../../../path-analyser/src/types.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface RoleDispatchFixture {
  getRoleForOperation: (opId: string) => string | undefined;
  roleBundles: Map<string, LoadedRoleBundle>;
  roleExtras: Map<string, Record<string, unknown>>;
}

/**
 * Build a {getRoleForOperation, roleBundles, roleExtras} bundle mimicking the
 * production codegen orchestrator, but with caller-supplied opId → role
 * overrides and an optional deployment-gateway extracts list.
 *
 * Most tests just want "treat opId X as the deployment gateway with the
 * default empty extracts list" — pass `{ [opId]: 'deploymentGateway' }`.
 */
export function buildRoleDispatch(
  opIdToRole: Record<string, string>,
  opts: { deployOp?: OperationNode } = {},
): RoleDispatchFixture {
  const roleBundles = loadRoleBundlesForActiveConfig(repoRoot);
  const roleExtras = new Map<string, Record<string, unknown>>();
  const extracts = computeDeploymentExtracts(opts.deployOp);
  roleExtras.set(DEPLOYMENT_GATEWAY_ROLE, { extracts: JSON.stringify(extracts) });
  return {
    getRoleForOperation: (opId: string) => opIdToRole[opId],
    roleBundles,
    roleExtras,
  };
}

/**
 * Build a role-dispatch fixture that mirrors the real camunda-oca ABox —
 * uses `getRoleForOperation(domain, opId)` over the production
 * `artifact-kinds.json` rather than a caller-supplied map. Useful for
 * tests that want the real `createDeployment → deploymentGateway` mapping
 * without re-encoding it in the test.
 */
export function buildRoleDispatchFromActiveAbox(
  opts: { deployOp?: OperationNode } = {},
): RoleDispatchFixture {
  const artifactViews = deriveArtifactKindsViews(repoRoot);
  const domain = artifactViews
    ? { operationArtifactRules: artifactViews.operationArtifactRules }
    : undefined;
  const roleBundles = loadRoleBundlesForActiveConfig(repoRoot);
  const roleExtras = new Map<string, Record<string, unknown>>();
  const extracts = computeDeploymentExtracts(opts.deployOp);
  roleExtras.set(DEPLOYMENT_GATEWAY_ROLE, { extracts: JSON.stringify(extracts) });
  return {
    getRoleForOperation: (opId: string) => getRoleForOperation(domain, opId),
    roleBundles,
    roleExtras,
  };
}
