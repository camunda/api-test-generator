// Per-slice cross-reference module for `runtimeStatesSchema.ts`
// (Lift 6 / #214 + Lift 15 / #255).
//
// Owns invariants whose offending field is in `runtimeStates[*]` or
// `operationRequirements[*]` — the two sub-trees the runtime-states
// ABox publishes. Several invariants cross into `semanticTypes` /
// `capabilities` for resolution; the broken row lives here, so the
// check lives here.

import type { DomainSemantics } from '../../types.js';
import type { CrossRefIssue, SliceCrossRefModule } from './types.js';
import { declaredStates } from './util.js';

function witnessOf(d: DomainSemantics): Map<string, string> {
  const m = new Map<string, string>();
  for (const [type, spec] of Object.entries(d.semanticTypes ?? {})) {
    if (typeof spec.witnesses === 'string' && spec.witnesses.length > 0) {
      m.set(type, spec.witnesses);
    }
  }
  return m;
}

export function checkSemanticBindingTargetResolves(d: DomainSemantics): CrossRefIssue[] {
  const declared = new Set(Object.keys(d.semanticTypes ?? {}));
  const issues: CrossRefIssue[] = [];
  for (const [op, req] of Object.entries(d.operationRequirements ?? {})) {
    for (const [field, rhs] of Object.entries(req.valueBindings ?? {})) {
      if (!rhs.startsWith('semantic:')) continue;
      const ref = rhs.slice('semantic:'.length);
      if (!declared.has(ref)) {
        issues.push({
          code: 'semanticBindingTargetResolves',
          message: `operationRequirements.${op}.valueBindings["${field}"] references semantic type "${ref}", which is not declared in semanticTypes`,
        });
      }
    }
  }
  return issues;
}

export function checkDisjunctionNotWitnessRedundant(d: DomainSemantics): CrossRefIssue[] {
  const witness = witnessOf(d);
  const issues: CrossRefIssue[] = [];
  for (const [op, req] of Object.entries(d.operationRequirements ?? {})) {
    for (const group of req.disjunctions ?? []) {
      for (const member of group) {
        const w = witness.get(member);
        if (w && group.includes(w)) {
          issues.push({
            code: 'disjunctionNotWitnessRedundant',
            message: `operationRequirements.${op}.disjunctions contains both semantic type "${member}" and its witnessed state "${w}" — collapse to requires: ["${w}"]`,
          });
        }
      }
    }
  }
  return issues;
}

export function checkDisjunctionMemberResolves(d: DomainSemantics): CrossRefIssue[] {
  const declared = declaredStates(d);
  const issues: CrossRefIssue[] = [];
  for (const [op, req] of Object.entries(d.operationRequirements ?? {})) {
    for (const group of req.disjunctions ?? []) {
      for (const member of group) {
        if (!declared.has(member)) {
          issues.push({
            code: 'disjunctionMemberResolves',
            message: `operationRequirements.${op}.disjunctions references "${member}", which is not declared in runtimeStates or capabilities`,
          });
        }
      }
    }
  }
  return issues;
}

// #159 PR B: a runtimeState marked `eventual: true` must declare a
// `witness` so the planner has something to wait on. Without this check,
// flipping `eventual` true on a state without a witness would silently
// produce a chain with no wait injected (and the consumer step would
// still race the producer's projection lag).
export function checkEventualStateWitnessShape(d: DomainSemantics): CrossRefIssue[] {
  const issues: CrossRefIssue[] = [];
  for (const [name, spec] of Object.entries(d.runtimeStates ?? {})) {
    const eventual = spec.eventual === true;
    const witness = spec.witness;
    if (eventual && (witness === undefined || witness === null)) {
      issues.push({
        code: 'eventualStateWitnessShape',
        message: `runtimeStates.${name} sets eventual: true but has no witness — the planner would inject no wait. Declare a witness { operationId, predicate } or unset eventual.`,
      });
    }
    if (!eventual && witness !== undefined && witness !== null) {
      issues.push({
        code: 'eventualStateWitnessShape',
        message: `runtimeStates.${name} declares a witness but eventual is not true — the witness will not be used. Set eventual: true or remove the witness.`,
      });
    }
  }
  return issues;
}

export const RUNTIME_STATES_CROSS_REF: SliceCrossRefModule = {
  slice: 'runtimeStates',
  checks: [
    checkSemanticBindingTargetResolves,
    checkDisjunctionNotWitnessRedundant,
    checkDisjunctionMemberResolves,
    checkEventualStateWitnessShape,
  ],
};
