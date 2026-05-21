import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { TEMPLATE_REGISTRY } from '../../materializer/src/templateRegistry.ts';
import { loadScenarioTemplatesAbox } from '../../path-analyser/src/ontology/loader.ts';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Registry / ABox symmetry guard (#333).
 *
 * Locks in the invariant that the active config's scenario-templates
 * ABox and the materializer's `TEMPLATE_REGISTRY` agree on which
 * templates exist. Drift in either direction is a real defect:
 *
 *  - Template in ABox but not in registry → planner emits scenario
 *    JSONs that the orchestrator never renders to a spec, and
 *    `buildCoverage` silently skips them. Adding a template would
 *    appear to do nothing.
 *  - Template in registry but not in ABox → orchestrator wipes and
 *    re-creates an output dir for a template whose scenarios the
 *    planner never produced; the dir stays empty and `buildCoverage`
 *    sees no scenarios. Effectively dead wiring.
 *
 * The single registry file (`materializer/src/templateRegistry.ts`)
 * is the only place to wire a new template into the orchestrator.
 */
describe('TEMPLATE_REGISTRY ↔ scenario-templates ABox symmetry (#333)', () => {
  test('every ABox template has a registry entry, and vice versa', () => {
    const abox = loadScenarioTemplatesAbox(REPO_ROOT);
    if (!abox) {
      throw new Error(
        'scenario-templates ABox missing for the active config — cannot verify registry symmetry',
      );
    }
    const aboxNames = abox.templates.map((t) => t.name).sort();
    const registryNames = TEMPLATE_REGISTRY.map((t) => t.name).sort();
    expect(registryNames).toEqual(aboxNames);
  });

  test('registry outputDirs are distinct (no two templates clobber the same subdir)', () => {
    const outputDirs = TEMPLATE_REGISTRY.map((t) => t.outputDir);
    const unique = new Set(outputDirs);
    expect(unique.size).toBe(outputDirs.length);
  });
});
