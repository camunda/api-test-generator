/**
 * Scenario-template instantiation — subject-source guard.
 *
 * The planner instantiates scenario templates only when a templates ABox is
 * present AND the config ships a subject source. `hasScenarioTemplateSubjectSource`
 * decides the latter: an edges ABox (EdgeLifecycle) and/or an entity-kinds ABox
 * (EntityLifecycle).
 *
 * Regression: the pre-fix guard was `templatesAbox && edgesAbox`, treating an
 * edges ABox as the *only* subject source. An entity-only config (camunda-hub
 * ships File/Folder/Version entity-kinds but declares no edges) therefore got
 * zero lifecycle suites. This asserts an entity-kinds ABox is a sufficient
 * subject source on its own.
 *
 * Class-scoped: all four presence combinations of (edges, entity-kinds).
 */
import { describe, expect, it } from 'vitest';
import { hasScenarioTemplateSubjectSource } from '../../../path-analyser/src/index.ts';

const ABOX = { version: 1 }; // any non-null ABox object; the guard is presence-only

describe('hasScenarioTemplateSubjectSource (template subject-source guard)', () => {
  it('entity-kinds ABox alone is a subject source (NO edges)', () => {
    // The regression case — false under the old edges-only guard.
    expect(hasScenarioTemplateSubjectSource(null, ABOX)).toBe(true);
  });

  it('edges ABox alone is a subject source (NO entity-kinds)', () => {
    expect(hasScenarioTemplateSubjectSource(ABOX, null)).toBe(true);
  });

  it('both sources present (e.g. camunda-oca)', () => {
    expect(hasScenarioTemplateSubjectSource(ABOX, ABOX)).toBe(true);
  });

  it('no subject source → do not instantiate', () => {
    expect(hasScenarioTemplateSubjectSource(null, null)).toBe(false);
  });
});
