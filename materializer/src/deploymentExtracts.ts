// Derive the spec-driven response-extracts list for a deployment-gateway-style
// operation (Lift 12 / #231).
//
// Replaces the hard-coded sequence of `extractInto(ctx, '...Var', json?...)`
// lines inside the vendored `deploy()` helper with a list computed from the
// role-bound operation's `responseSemanticLeaves` (harvested at load time by
// the semantic-graph extractor from the spec's `x-semantic-type` /
// `x-semantic-provider` annotations).
//
// Filtering rules (mirrors the legacy hard-coded set so this is
// behaviour-preserving):
//   - keep leaves whose `provider === true`
//   - also keep top-level leaves (no `.` and no `[` in `fieldPath`) so the
//     two depth-1 fields the legacy helper extracted (`deploymentKey`,
//     `tenantId`) still land in ctx even though they are flagged
//     `provider: false` in the spec
//   - skip paths containing `.resource.` — these are the oneOf-flattened
//     `ResourceKey` projections, which double up on values the planner reads
//     from the typed `processDefinition`/`decisionDefinition`/`form` siblings
//   - convert `[]` array markers to literal `[0]` index — the legacy helper
//     only ever read the first deployments[] entry, so preserve that
//   - dedup by `varName`, keeping the first occurrence under the
//     deterministic sort below (so an extract is bound to exactly one path)
//   - sort by `JSON.stringify(segments)`, then varName, so the
//     shortest/lexicographically-earliest path comes first during dedup;
//     then stabilize the final deduplicated list with a second varName sort
//     so the emitted JSON literal is byte-stable across runs and machines
//     regardless of the order that responseSemanticLeaves are delivered
//
// `varName = <camelLower(semanticType)>Var` matches the convention used
// throughout the planner (see `scenarioGenerator.ts:semanticToVarName()`)
// so the extracted bindings flow into the same `ctx['...Var']` keys
// downstream consumers expect.

import type { OperationNode } from 'path-analyser/types';

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
 * Compute the deterministic, deduplicated list of `(varName, segments)`
 * tuples the deploy() helper should extract for the given role-bound op.
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
