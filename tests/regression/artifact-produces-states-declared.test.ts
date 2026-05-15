import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveArtifactKindsViews,
  deriveRuntimeStatesViews,
  deriveSemanticsViews,
} from '../../path-analyser/src/ontology/loader.js';

describe('domain ABox — artifactKinds.producesStates declarations', () => {
  it('every state claimed by an artifact kind must be declared in runtimeStates or capabilities (#66 — FormDeployed defect class, also catches DMN)', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../..');
    const artifactViews = deriveArtifactKindsViews(repoRoot);
    const runtimeViews = deriveRuntimeStatesViews(repoRoot);
    const semanticsViews = deriveSemanticsViews(repoRoot);
    if (!artifactViews) throw new Error('artifact-kinds ABox missing');
    if (!runtimeViews) throw new Error('runtime-states ABox missing');
    if (!semanticsViews) throw new Error('semantics ABox missing');

    const declaredStates = new Set([
      ...Object.keys(runtimeViews.runtimeStates),
      ...Object.keys(semanticsViews.capabilities),
    ]);

    const claimedByArtifacts: { artifactKind: string; state: string }[] = [];
    for (const [artifactKind, spec] of Object.entries(artifactViews.artifactKinds)) {
      for (const state of spec.producesStates ?? []) {
        claimedByArtifacts.push({ artifactKind, state });
      }
    }

    const undeclared = claimedByArtifacts.filter(({ state }) => !declaredStates.has(state));

    expect(
      undeclared,
      `artifactKinds claim producesStates that are not declared in runtimeStates or capabilities: ${JSON.stringify(undeclared, null, 2)}`,
    ).toEqual([]);
  });
});
