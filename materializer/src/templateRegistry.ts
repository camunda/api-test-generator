// Scenario-template registry (#333).
//
// Single source of truth for the materializer's knowledge of which
// scenario templates exist and where their emitted Playwright suites
// live. Consumed by:
//
//   - `materializer/src/index.ts` — the template emission loop reads
//     this registry to wire `emitTemplateSuites` per template, instead
//     of open-coding one block per template.
//   - `materializer/src/coverage.ts` — `buildCoverage` reads this
//     registry to map template-name → emitted output directory when
//     computing the per-endpoint feature-spec suppression set (#331).
//
// Adding a new ScenarioTemplate normally requires two coordinated edits:
//
//   1. Add an ABox row in `configs/<config>/ontology/scenario-templates.json`.
//   2. Add one entry here.
//
// The TBox in `path-analyser/src/ontology/scenarioTemplateSchema.ts`
// is name-agnostic (template names are just strings), so it only needs
// updating when the ABox row *shape* changes (a new step kind, a new
// `appliesTo` kind, etc.). Likewise, `emitTemplateSuites` only needs
// extending when the new template's rendered shape genuinely differs
// from the lifecycle templates it already handles.
//
// No other site in the orchestrator needs to know about the new
// template. The guard in `tests/codegen/template-registry.test.ts`
// asserts symmetric equality between the active config's ABox and
// this registry so an ABox row without a registry entry (or vice
// versa) fails red.
//
// Step 2 of #333 (deriving the registry directly from the ABox) is
// deferred; that requires teaching the materializer to dispatch
// emitters by name when future templates need shapes beyond the
// universal `emitTemplateSuites` renderer.

export interface TemplateBinding {
  /** Template name as declared in `scenarioTemplateSchema.ts` and as
   *  the subdirectory name under `generated/<config>/scenarios/templates/`. */
  name: string;
  /** Output subdirectory relative to the Playwright suite root,
   *  i.e. `generated/<config>/playwright/<outputDir>/`. */
  outputDir: string;
}

export const TEMPLATE_REGISTRY: readonly TemplateBinding[] = [
  { name: 'EdgeLifecycle', outputDir: 'edges' },
  { name: 'EntityLifecycle', outputDir: 'entities' },
  { name: 'UpdatedFieldVisibleOnReadBack', outputDir: 'runtime-entities' },
  { name: 'StateTransitionVisibleAfterAction', outputDir: 'state-transitions' },
];
