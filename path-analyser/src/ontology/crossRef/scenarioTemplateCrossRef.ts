// Per-slice cross-reference module for `scenarioTemplateSchema.ts`
// (#268 Phase 1 / #269).
//
// Phase 1 ships templates as **encoding only** — no planner consumer
// yet (#270 follows up). Cross-reference invariants between scenario
// templates and other slices of `DomainSemantics` are therefore
// deliberately deferred to Phase 2, where they live in
// `configs/<config>/regression-invariants.test.ts` alongside the new
// planner / emitter behaviours they guard (template-derived scenario
// output, ObserveStep response-array locator feasibility, etc.).
//
// One Phase-1-shaped cross-ref invariant *does* exist today — the
// per-edge × per-Observe-step observability check landed in
// `configs/camunda-oca/regression-invariants.test.ts` under the
// `'scenario-templates ABox (#268 Phase 1 / #269)'` describe block.
// That check ranges over the dependency graph, not the merged
// `DomainSemantics` view, so it lives at the L3 layer rather than in
// this composer pipeline.
//
// This stub exists so the Lift 15 / #255 build-time guard ("every
// `*Schema.ts` slice has a matching `crossRef/*CrossRef.ts`
// registered in `CROSS_REF_MODULES`") passes. Without it, the guard
// fires on every TBox addition — exactly the drift it was filed to
// prevent. Promoting any cross-slice invariant to this module is the
// natural way to fold a #270-introduced check into the merged-domain
// validator if one materialises.

import type { SliceCrossRefModule } from './types.js';

export const SCENARIO_TEMPLATE_CROSS_REF: SliceCrossRefModule = {
  slice: 'scenarioTemplate',
  checks: [],
  noChecksRationale:
    'Phase 1 ships scenario templates as encoding only — no planner consumer yet (#270 follows up). The one currently-needed cross-reference invariant (edge × Observe-step observability feasibility against the dependency graph) lives as an L3 invariant in configs/<config>/regression-invariants.test.ts because it ranges over OperationGraph, not over the merged DomainSemantics view this composer validates. Promote a check here only when #270 introduces a cross-slice invariant naturally expressed over DomainSemantics.',
};
