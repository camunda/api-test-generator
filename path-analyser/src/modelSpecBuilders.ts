// Per-`modelKind` constructor helpers for `GeneratedModelSpec`.
//
// The planner needs to mint model-spec entries from two distinct sources:
//   1. The ABox-driven `ensureArtifactBindings` path, which knows the
//      semantic identifier var name minted for a given semantic type and
//      the `modelKind` declared on the matching artifact-kind ABox entry.
//   2. A small set of legacy heuristic fallbacks in `scenarioGenerator.ts`
//      that fire when no ABox path produced models for the deployment-
//      gateway operation (e.g. a chain that never asserted a
//      `ProcessDefinitionKey` requirement but still needs a deployment).
//
// Both paths used to spell out `{ kind: 'bpmn', processDefinitionIdVar: …,
// serviceTasks: … }` inline. After Lift 13 (#253) the shape lives behind
// these helpers so:
//   - the per-kind binding-role names (`processDefinitionId`, `formKey`)
//     have a single declaration site, and
//   - adding a new kind (e.g. `dmn`) is a one-line registry update rather
//     than a new branch in `ensureArtifactBindings`.

import type { GeneratedModelSpec } from './types.js';

/**
 * Per-kind primary binding-role name. The role is the key under
 * `GeneratedModelSpec.bindings` that carries the "main" identifier var for
 * that kind (the one downstream test code uses to refer to the deployed
 * model). New kinds fall back to `'identifier'`.
 */
const PRIMARY_BINDING_ROLE: Record<string, string> = {
  bpmn: 'processDefinitionId',
  form: 'formKey',
};

/**
 * Resolve the primary binding-role for a given `modelKind`. Used by the
 * planner to find / dedupe an existing spec for that kind+var pair.
 */
export function primaryBindingRoleFor(kind: string): string {
  return PRIMARY_BINDING_ROLE[kind] ?? 'identifier';
}

/**
 * Build a generic `GeneratedModelSpec` for `kind` whose primary binding
 * role maps to `varName`. Used by the ABox-driven path in
 * `ensureArtifactBindings`.
 */
export function buildModelSpec(kind: string, varName: string): GeneratedModelSpec {
  return { kind, bindings: { [primaryBindingRoleFor(kind)]: varName } };
}

/**
 * Build a BPMN `GeneratedModelSpec` with optional `serviceTasks` metadata.
 * Used by the legacy deployment-gateway fallback heuristics that mint a
 * `processDefinitionIdVar1` placeholder when no ABox path drove model
 * selection.
 */
export function buildBpmnModelSpec(
  processDefinitionIdVar: string,
  serviceTasks?: { id: string; typeVar: string }[],
): GeneratedModelSpec {
  const spec: GeneratedModelSpec = {
    kind: 'bpmn',
    bindings: { processDefinitionId: processDefinitionIdVar },
  };
  if (serviceTasks?.length) spec.metadata = { serviceTasks };
  return spec;
}

/**
 * Locate an existing spec in `drafts` whose `kind` and primary binding
 * role's variable name match. Used to dedupe before appending.
 */
export function findModelSpec(
  drafts: GeneratedModelSpec[],
  kind: string,
  varName: string,
): GeneratedModelSpec | undefined {
  const role = primaryBindingRoleFor(kind);
  return drafts.find((m) => m.kind === kind && m.bindings[role] === varName);
}
