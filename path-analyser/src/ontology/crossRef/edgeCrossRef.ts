// Per-slice cross-reference module for `edgeSchema.ts`
// (Lift 3 / #208 + Lift 15 / #255).
//
// The edges ABox declares typed dataflow / establishes / requires edges
// between operations. Those references resolve against the operation
// graph itself (operationId existence, semantic-type identity) and are
// validated post-overlay in `graphLoader.ts` against `graph.operations`
// — they cannot be checked from a `DomainSemantics`-only view because
// `DomainSemantics` does not surface the edges sub-tree.
//
// This module is therefore an explicit "no cross-ref invariants need to
// run during validateDomainSemantics" declaration, so the build-time
// guard in regression-invariants.test.ts can confirm every slice is
// accounted for. It is NOT a placeholder for future work — edges
// invariants belong with the graph loader, not in the domain-semantics
// composer.

import type { SliceCrossRefModule } from './types.js';

export const EDGES_CROSS_REF: SliceCrossRefModule = {
  slice: 'edge',
  checks: [],
  noChecksRationale:
    'Edge references resolve against the operation graph (operationId, semantic-type identity), not against DomainSemantics. Validation happens in graphLoader post-overlay; see graphLoader.ts validateEdgesAbox + the abox-vs-graph L3 invariants in configs/<config>/regression-invariants.test.ts.',
};
