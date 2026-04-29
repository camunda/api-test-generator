import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface ArtifactKindSpec {
  producesStates?: string[];
}
interface RuntimeStateSpec {
  kind: 'state';
}
interface DomainSemantics {
  artifactKinds?: Record<string, ArtifactKindSpec>;
  runtimeStates?: Record<string, RuntimeStateSpec>;
  capabilities?: Record<string, unknown>;
}

describe('domain-semantics.json — artifactKinds.producesStates declarations', () => {
  it('every state claimed by an artifact kind must be declared in runtimeStates or capabilities (#66 — FormDeployed defect class, also catches DMN)', async () => {
    const file = path.resolve(import.meta.dirname, '../../path-analyser/domain-semantics.json');
    const raw = await readFile(file, 'utf8');
    // biome-ignore lint/plugin: domain-semantics.json is the runtime contract.
    const domain = JSON.parse(raw) as DomainSemantics;

    const declaredInRuntime = Object.keys(domain.runtimeStates ?? {});
    const declaredInCapabilities = Object.keys(domain.capabilities ?? {});
    const declaredStates = new Set([...declaredInRuntime, ...declaredInCapabilities]);

    const claimedByArtifacts: { artifactKind: string; state: string }[] = [];
    for (const [artifactKind, spec] of Object.entries(domain.artifactKinds ?? {})) {
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
