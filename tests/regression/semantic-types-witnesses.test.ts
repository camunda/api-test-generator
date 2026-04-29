import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface ArtifactKindSpec {
  producesStates?: string[];
  producesSemantics?: string[];
}
interface OperationDomainRequirements {
  valueBindings?: Record<string, string>;
}
interface SemanticTypeSpec {
  witnesses?: string;
}
interface DomainSemantics {
  artifactKinds?: Record<string, ArtifactKindSpec>;
  runtimeStates?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  operationRequirements?: Record<string, OperationDomainRequirements>;
  semanticTypes?: Record<string, SemanticTypeSpec>;
}

async function loadDomain(): Promise<DomainSemantics> {
  const file = path.resolve(import.meta.dirname, '../../path-analyser/domain-semantics.json');
  const raw = await readFile(file, 'utf8');
  // biome-ignore lint/plugin: domain-semantics.json is the runtime contract.
  return JSON.parse(raw) as DomainSemantics;
}

describe('domain-semantics.json — semanticTypes.witnesses relation (#70)', () => {
  it('every key-shaped semantic type (artifactKinds.*.producesSemantics) must declare a witnesses edge', async () => {
    const domain = await loadDomain();

    const declaredSemanticTypes = domain.semanticTypes ?? {};

    const keyShaped: { artifactKind: string; semanticType: string }[] = [];
    for (const [artifactKind, spec] of Object.entries(domain.artifactKinds ?? {})) {
      for (const semanticType of spec.producesSemantics ?? []) {
        keyShaped.push({ artifactKind, semanticType });
      }
    }

    const missingWitness = keyShaped.filter(({ semanticType }) => {
      const entry = declaredSemanticTypes[semanticType];
      return !entry || typeof entry.witnesses !== 'string' || entry.witnesses.length === 0;
    });

    expect(
      missingWitness,
      `key-shaped semantic types are missing a semanticTypes[<type>].witnesses declaration: ${JSON.stringify(missingWitness, null, 2)}`,
    ).toEqual([]);
  });

  it('every semanticTypes[X].witnesses target must resolve to a declared runtimeState or capability', async () => {
    const domain = await loadDomain();

    const declaredStates = new Set([
      ...Object.keys(domain.runtimeStates ?? {}),
      ...Object.keys(domain.capabilities ?? {}),
    ]);

    const dangling: { semanticType: string; witnesses: string }[] = [];
    for (const [semanticType, spec] of Object.entries(domain.semanticTypes ?? {})) {
      const w = spec.witnesses;
      if (typeof w !== 'string' || w.length === 0) continue;
      if (!declaredStates.has(w)) dangling.push({ semanticType, witnesses: w });
    }

    expect(
      dangling,
      `semanticTypes.witnesses targets do not resolve to any runtimeStates or capabilities entry: ${JSON.stringify(dangling, null, 2)}`,
    ).toEqual([]);
  });

  it('every valueBindings RHS of the form "semantic:X" must reference a declared semanticType', async () => {
    const domain = await loadDomain();

    const declaredSemanticTypes = new Set(Object.keys(domain.semanticTypes ?? {}));

    const dangling: { operationId: string; field: string; rhs: string }[] = [];
    for (const [operationId, req] of Object.entries(domain.operationRequirements ?? {})) {
      const bindings = req.valueBindings ?? {};
      for (const [field, rhs] of Object.entries(bindings)) {
        if (!rhs.startsWith('semantic:')) continue;
        const ref = rhs.slice('semantic:'.length);
        if (!declaredSemanticTypes.has(ref)) {
          dangling.push({ operationId, field, rhs });
        }
      }
    }

    expect(
      dangling,
      `valueBindings reference semanticTypes that are not declared: ${JSON.stringify(dangling, null, 2)}`,
    ).toEqual([]);
  });

  // Class-scoped guard: no domainProducers[state] entry should contain duplicate
  // opIds. The witness implication (semanticTypes[T].witnesses) re-adds every
  // producer of T as a producer of the witnessed state, which previously
  // double-counted any opId that already produced the witnessed state via
  // runtimeStates.producedBy / capabilities.producedBy /
  // operationRequirements.produces. addProducer() now dedups at the writer so
  // every current AND future callsite is covered.
  it('domainProducers contains no duplicate opIds per state (witness merge dedup)', async () => {
    const { loadGraph } = await import('../../path-analyser/src/graphLoader.ts');
    const baseDir = path.resolve(import.meta.dirname, '../../path-analyser');
    const graph = await loadGraph(baseDir);

    const dupes: { state: string; opId: string; count: number }[] = [];
    for (const [state, opIds] of Object.entries(graph.domainProducers ?? {})) {
      const counts = new Map<string, number>();
      for (const opId of opIds) counts.set(opId, (counts.get(opId) ?? 0) + 1);
      for (const [opId, count] of counts) {
        if (count > 1) dupes.push({ state, opId, count });
      }
    }

    expect(
      dupes,
      `domainProducers must not contain duplicate opIds per state: ${JSON.stringify(dupes, null, 2)}`,
    ).toEqual([]);
  });
});
