// Shared helpers for per-slice cross-reference modules.
//
// Anything imported by more than one slice module lives here so the
// resolution rules (e.g. what counts as a "declared state") cannot drift
// between invariants — addresses the same anti-drift property the
// per-slice split was filed to defend (Lift 15 / #255).

import type { DomainSemantics } from '../../types.js';

// The set of identifiers a witness/disjunction member is allowed to
// resolve to. `runtimeStates` and `capabilities` are both treated as
// declarable state names by the planner; any check that asks "does this
// reference resolve?" must consult both. Centralised so a slice that
// later widens the resolution set (e.g. adds a third sub-tree) updates
// every invariant at once.
export function declaredStates(d: DomainSemantics): Set<string> {
  return new Set([...Object.keys(d.runtimeStates ?? {}), ...Object.keys(d.capabilities ?? {})]);
}
