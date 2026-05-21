// Per-slice cross-reference module for `entityKindsSchema.ts`
// (Lift 4 / #210 + Lift 15 / #255).
//
// The entity-kinds ABox declares the external-entity identifier
// vocabulary. Its sub-tree (`kinds`) is not surfaced on
// `DomainSemantics` — the loader projects it into
// `graph.externalEntityIdentifiers` directly. Cross-references against
// the bundled spec (identifier types existing on operations) are
// L3-invariant-enforced in regression-invariants.test.ts and not
// reachable from a `DomainSemantics`-only view.
//
// This module is an explicit "no cross-ref invariants need to run
// during validateDomainSemantics" declaration, so the build-time guard
// in regression-invariants.test.ts can confirm every slice is
// accounted for.

import type { SliceCrossRefModule } from './types.js';

export const ENTITY_KINDS_CROSS_REF: SliceCrossRefModule = {
  slice: 'entityKinds',
  checks: [],
  noChecksRationale:
    'Entity-kind references resolve against the operation graph (per-op kindRegistry alignment), not against DomainSemantics. Validation happens in graphLoader and the abox-vs-graph L3 invariants in configs/<config>/regression-invariants.test.ts.',
};
