// Role-hook provider for the deploymentGateway role on the Playwright
// emitter. Co-located with this role's templates so the materializer can
// discover it via the per-config role-bundle walk (Lift 19 / #261) — the
// orchestrator no longer carries any OCA-specific knowledge.
//
// The `extracts` payload is consumed by `materializeRoleSupportFiles`
// (`materializer/src/playwright/materialize-support.ts`) when it renders
// the role's `support.ts.tmpl` against this provider's extras map — the
// spec-derived `EXTRACTS` list is baked into the vendored
// `<outDir>/support/deploymentGateway.ts` once per codegen run instead
// of being threaded through every `deploy(...)` call-site literal
// (#243).

import path from 'node:path';
import type { RoleHookProvider } from '@camunda8/emitter-sdk';
import { getActiveConfigName } from 'path-analyser/configResolver';
import { loadGraph } from 'path-analyser/graphLoader';
import { deriveArtifactKindsViews } from 'path-analyser/ontology/loader';
import {
  DEPLOYMENT_GATEWAY_ROLE,
  findDeploymentGatewayOpId,
} from 'path-analyser/ontology/operationRoles';
import type { OperationNode } from 'path-analyser/types';

/**
 * Stable hook name declared by Playwright (`roleHooks: ['deployment']`).
 * Exported so the emitter can reference the same constant rather than a
 * stringly-typed literal.
 */
export const DEPLOYMENT_HOOK = 'deployment';

export interface DeploymentExtract {
  /** ctx binding name (e.g. `processDefinitionKeyVar`). */
  varName: string;
  /**
   * Path segments to walk on the deploy response JSON. String entries are
   * object property names; number entries are array indices.
   */
  segments: (string | number)[];
}

function semanticToVarName(semantic: string): string {
  // Match scenarioGenerator.ts:semanticToVarName — lowercase first char,
  // append `Var`. E.g. `ProcessDefinitionKey` -> `processDefinitionKeyVar`.
  if (!semantic) return 'unknownVar';
  return `${semantic.charAt(0).toLowerCase()}${semantic.slice(1)}Var`;
}

function fieldPathToSegments(fieldPath: string): (string | number)[] {
  // `deployments[].processDefinition.processDefinitionKey`
  //   -> ['deployments', 0, 'processDefinition', 'processDefinitionKey']
  const out: (string | number)[] = [];
  for (const part of fieldPath.split('.')) {
    const m = part.match(/^([^[]+)(\[\])?$/);
    if (!m) {
      out.push(part);
      continue;
    }
    out.push(m[1]);
    if (m[2] === '[]') out.push(0);
  }
  return out;
}

/**
 * Derive the spec-driven response-extracts list for a deployment-gateway-style
 * operation (Lift 12 / #231).
 *
 * Filtering rules (mirrors the legacy hard-coded set so this is
 * behaviour-preserving):
 *   - keep leaves whose `provider === true`
 *   - also keep top-level leaves (no `.` and no `[` in `fieldPath`) so the
 *     two depth-1 fields the legacy helper extracted (`deploymentKey`,
 *     `tenantId`) still land in ctx even though they are flagged
 *     `provider: false` in the spec
 *   - skip paths containing `.resource.` — these are the oneOf-flattened
 *     `ResourceKey` projections, which double up on values the planner reads
 *     from the typed `processDefinition`/`decisionDefinition`/`form` siblings
 *   - convert `[]` array markers to literal `[0]` index — the legacy helper
 *     only ever read the first deployments[] entry, so preserve that
 *   - dedup by `varName`, keeping the first occurrence under the
 *     deterministic sort below
 *
 * Returns `[]` when `op` is undefined (no deployment-gateway role active in
 * the ABox, or the role-bound op carries no response leaves). The materialized
 * helper then runs through an empty extract loop and the test simply skips
 * extraction — which is the correct behaviour for a config that hasn't
 * declared a deployment gateway.
 */
export function computeDeploymentExtracts(op: OperationNode | undefined): DeploymentExtract[] {
  const leaves = op?.responseSemanticLeaves ?? [];
  const candidates = leaves
    .filter((l) => l.status === '200')
    .filter((l) => l.provider || !(l.fieldPath.includes('.') || l.fieldPath.includes('[')))
    .filter((l) => !l.fieldPath.includes('.resource.'))
    .map((l) => ({
      varName: semanticToVarName(l.semantic),
      segments: fieldPathToSegments(l.fieldPath),
    }));

  // Sort candidates so the "preferred" path wins during dedup: shorter
  // segment paths first (top-level wins over nested), then lexicographic
  // JSON of segments as a deterministic tie-breaker, then varName. Without
  // the explicit length comparison, lexicographic JSON ordering does not
  // guarantee shorter arrays sort earlier (e.g. ["a",0,"b"] compares
  // before ["a",0] because `,` < `]`).
  candidates.sort((a, b) => {
    if (a.segments.length !== b.segments.length) {
      return a.segments.length - b.segments.length;
    }
    const aS = JSON.stringify(a.segments);
    const bS = JSON.stringify(b.segments);
    if (aS !== bS) return aS < bS ? -1 : 1;
    return a.varName < b.varName ? -1 : a.varName > b.varName ? 1 : 0;
  });

  const seen = new Set<string>();
  const result: DeploymentExtract[] = [];
  for (const c of candidates) {
    if (seen.has(c.varName)) continue;
    seen.add(c.varName);
    result.push(c);
  }
  // Final sort by varName for stable emission regardless of input ordering.
  result.sort((a, b) => (a.varName < b.varName ? -1 : a.varName > b.varName ? 1 : 0));
  return result;
}

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

export default DeploymentRoleHookProvider;
