// Per-slice cross-reference module for `artifactKindsSchema.ts`
// (Lift 5 / #212 + Lift 15 / #255).
//
// Owns invariants whose offending field is `artifactKinds[*].*` or
// `operationArtifactRules[*].rules[*].*`. Both cross slices — they read
// `runtimeStates` / `capabilities` and `semanticTypes` for resolution —
// but the broken row lives in the artifact-kinds ABox, so the check
// lives here.

import type { DomainSemantics } from '../../types.js';
import type { CrossRefIssue, SliceCrossRefModule } from './types.js';
import { declaredStates } from './util.js';

export function checkArtifactKindStateDeclared(d: DomainSemantics): CrossRefIssue[] {
  const declared = declaredStates(d);
  const issues: CrossRefIssue[] = [];
  for (const [kind, spec] of Object.entries(d.artifactKinds ?? {})) {
    for (const state of spec.producesStates ?? []) {
      if (!declared.has(state)) {
        issues.push({
          code: 'artifactKindStateDeclared',
          message: `artifactKinds.${kind}.producesStates references "${state}", which is not declared in runtimeStates or capabilities`,
        });
      }
    }
    // #159: producibleStates carries the same cross-reference invariant
    // as producesStates — the planner's chain-feasibility BFS reads both,
    // so an undeclared state name would silently break the BFS rather
    // than surface as a config error at load time.
    for (const state of spec.producibleStates ?? []) {
      if (!declared.has(state)) {
        issues.push({
          code: 'artifactKindStateDeclared',
          message: `artifactKinds.${kind}.producibleStates references "${state}", which is not declared in runtimeStates or capabilities`,
        });
      }
    }
  }
  // Lift 5 / #212: rule-level overrides on operationArtifactRules carry the
  // same cross-reference invariant as kind-level producesStates — the planner
  // reads them via getEffectiveProducesStates() during chain-feasibility BFS.
  // Without this check, an ABox-introduced (or hand-edited legacy) override
  // pointing at an undeclared state silently breaks the BFS rather than
  // surfacing as a load-time config error.
  for (const [op, spec] of Object.entries(d.operationArtifactRules ?? {})) {
    for (const rule of spec.rules ?? []) {
      const ruleId = rule.id ?? '<unnamed>';
      for (const state of rule.producesStates ?? []) {
        if (!declared.has(state)) {
          issues.push({
            code: 'artifactKindStateDeclared',
            message: `operationArtifactRules.${op}.rules['${ruleId}'].producesStates references "${state}", which is not declared in runtimeStates or capabilities`,
          });
        }
      }
    }
  }
  return issues;
}

export function checkArtifactKindWitnessDeclared(d: DomainSemantics): CrossRefIssue[] {
  const declared = d.semanticTypes ?? {};
  const issues: CrossRefIssue[] = [];
  for (const [kind, spec] of Object.entries(d.artifactKinds ?? {})) {
    for (const type of spec.producesSemantics ?? []) {
      const entry = declared[type];
      if (!entry || typeof entry.witnesses !== 'string' || entry.witnesses.length === 0) {
        issues.push({
          code: 'artifactKindWitnessDeclared',
          message: `artifactKinds.${kind}.producesSemantics references "${type}", which has no semanticTypes.${type}.witnesses declaration`,
        });
      }
    }
  }
  // Lift 5 / #212: same coverage extension as
  // checkArtifactKindStateDeclared — rule-level producesSemantics
  // overrides also reach the planner via getEffectiveProducesSemantics()
  // and a stale/ABox-introduced typo would otherwise pass through.
  for (const [op, spec] of Object.entries(d.operationArtifactRules ?? {})) {
    for (const rule of spec.rules ?? []) {
      const ruleId = rule.id ?? '<unnamed>';
      for (const type of rule.producesSemantics ?? []) {
        const entry = declared[type];
        if (!entry || typeof entry.witnesses !== 'string' || entry.witnesses.length === 0) {
          issues.push({
            code: 'artifactKindWitnessDeclared',
            message: `operationArtifactRules.${op}.rules['${ruleId}'].producesSemantics references "${type}", which has no semanticTypes.${type}.witnesses declaration`,
          });
        }
      }
    }
  }
  return issues;
}

export const ARTIFACT_KINDS_CROSS_REF: SliceCrossRefModule = {
  slice: 'artifactKinds',
  checks: [checkArtifactKindStateDeclared, checkArtifactKindWitnessDeclared],
};
