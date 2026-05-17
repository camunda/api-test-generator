// RoleHookProvider (#233 Step 6) for the Playwright emitter's
// `deployment` hook. Extracted from materializer/src/index.ts so the
// orchestrator no longer hard-codes deployment-gateway knowledge: the
// emitter declares `roleHooks: ['deployment']`, this provider registers
// for that hook, and the generic hook loop in the orchestrator pulls
// `extracts` into `ctx.roleExtras[DEPLOYMENT_GATEWAY_ROLE]`.
//
// Lift 12 Phase 5 grep-invariant unblocker: with this extraction, the
// only references to `computeDeploymentExtracts` and to the
// `DEPLOYMENT_GATEWAY_ROLE` literal in the orchestrator surface live
// behind the SDK hook contract.

import path from 'node:path';
import type { RoleHookProvider } from '@camunda8/emitter-sdk';
import { getActiveConfigName } from 'path-analyser/configResolver';
import { loadGraph } from 'path-analyser/graphLoader';
import { deriveArtifactKindsViews } from 'path-analyser/ontology/loader';
import {
  DEPLOYMENT_GATEWAY_ROLE,
  findDeploymentGatewayOpId,
} from 'path-analyser/ontology/operationRoles';
import { computeDeploymentExtracts } from '../../deploymentExtracts.js';

/**
 * Stable hook name declared by Playwright (`roleHooks: ['deployment']`).
 * Exported so the emitter can reference the same constant rather than a
 * stringly-typed literal.
 */
export const DEPLOYMENT_HOOK = 'deployment';

export const DeploymentRoleHookProvider: RoleHookProvider = {
  hook: DEPLOYMENT_HOOK,
  role: DEPLOYMENT_GATEWAY_ROLE,
  async compute({
    repoRoot,
    configName,
  }: {
    repoRoot: string;
    configName: string;
  }): Promise<Record<string, unknown> | undefined> {
    // Defensive: orchestrator only invokes hooks for the active config,
    // but assert here so a future caller can't silently pass a stale name.
    if (configName !== getActiveConfigName(repoRoot)) {
      throw new Error(
        `DeploymentRoleHookProvider.compute: configName ${JSON.stringify(
          configName,
        )} does not match the active config ${JSON.stringify(getActiveConfigName(repoRoot))}.`,
      );
    }
    const artifactViews = deriveArtifactKindsViews(repoRoot);
    const deploymentGatewayOpId = findDeploymentGatewayOpId(
      artifactViews ? { operationArtifactRules: artifactViews.operationArtifactRules } : undefined,
    );
    if (!deploymentGatewayOpId) return undefined;
    // loadGraph reads the dependency graph emitted by path-analyser into
    // <repoRoot>/path-analyser/.../operation-dependency-graph.json. It
    // computes the rest of the layout from `path.resolve(baseDir, '..')`,
    // so the `baseDir` argument must be `<repoRoot>/path-analyser` to
    // match the convention the orchestrator already uses.
    const baseDir = path.join(repoRoot, 'path-analyser');
    const graph = await loadGraph(baseDir);
    const deployOp = graph.operations[deploymentGatewayOpId];
    const extracts = computeDeploymentExtracts(deployOp);
    return { extracts: JSON.stringify(extracts) };
  },
};
