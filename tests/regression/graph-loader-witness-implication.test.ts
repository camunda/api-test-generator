import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGraph } from '../../path-analyser/src/graphLoader.ts';

/**
 * Witness-implication gating — class-scoped regression for #95.
 *
 * `domain-semantics.json` declares `semanticTypes[T].witnesses = W` for
 * key-shaped semantic types: producing a value of `T` is taken as
 * evidence that runtime state `W` holds. `graphLoader.ts` lifts this
 * relation by adding every op in `producersByType[T]` to
 * `producersByState[W]` and to that op's `domainProduces`.
 *
 * The defect this test guards against: when the lift runs against
 * *every* producer in `producersByType[T]` — including incidental
 * producers (`provider: false`) whose response merely carries a field
 * of semantic type `T` as metadata — the planner inherits a phantom
 * `domainProduces[W]` claim. BFS then evaluates the candidate, finds
 * `W`'s `runtimeStates.requires` unmet, and silently drops the
 * candidate, blocking otherwise-valid chains (the `getDocument` →
 * `createDocument` symptom in #95).
 *
 * Class-scoped invariant: the witness implication may only flow from
 * **authoritative** producers (`providerMap[T] === true`). An op that
 * carries `T` only as incidental response metadata must NOT be added
 * to `producersByState[W]` or to its own `domainProduces` via the
 * witness path.
 */

describe('graphLoader: witness implication gating (#95)', () => {
  it('an op that produces a witnessed semantic type only incidentally is not added to producersByState[witnessed]', async () => {
    const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
    const baseDir = path.join(REPO_ROOT, 'path-analyser');
    const graph = await loadGraph(baseDir);

    // Guard against vacuous pass: if the domain sidecar fails to load,
    // semanticTypes is empty and the loop below is a no-op. Assert the
    // prerequisite shape so a missing sidecar fails the test loudly.
    expect(graph.domain?.semanticTypes, 'domain.semanticTypes must load').toBeDefined();
    expect(graph.producersByState, 'producersByState must be built').toBeDefined();
    const semanticTypes = graph.domain?.semanticTypes ?? {};
    const witnessedSemantics = Object.values(semanticTypes).filter(
      (s) => typeof s.witnesses === 'string' && s.witnesses.length > 0,
    );
    expect(
      witnessedSemantics.length,
      'at least one semanticType must declare a witness for this invariant to be meaningful',
    ).toBeGreaterThan(0);
    const offenders: { opId: string; semanticType: string; witnessed: string }[] = [];

    for (const [semanticType, spec] of Object.entries(semanticTypes)) {
      const witnessed = spec.witnesses;
      if (typeof witnessed !== 'string' || witnessed.length === 0) continue;

      const producers = graph.producersByType[semanticType] ?? [];
      const witnessProducers = new Set(graph.producersByState?.[witnessed] ?? []);

      for (const opId of producers) {
        const op = graph.operations[opId];
        if (!op) continue;
        const isAuthoritative = op.providerMap?.[semanticType] === true;
        if (isAuthoritative) continue;
        if (witnessProducers.has(opId)) {
          // Allow the case where the op also produces the witnessed state
          // through a non-witness channel (e.g. operationRequirements.produces
          // explicitly lists the state). Only flag ops whose ONLY route to
          // producersByState[W] is the witness implication.
          const declaredViaRequirements =
            (graph.domain?.operationRequirements?.[opId]?.produces ?? []).includes(witnessed) ||
            (graph.domain?.operationRequirements?.[opId]?.implicitAdds ?? []).includes(witnessed);
          const declaredViaRuntimeStates = (
            graph.domain?.runtimeStates?.[witnessed]?.producedBy ?? []
          ).includes(opId);
          const declaredViaCapabilities = (
            graph.domain?.capabilities?.[witnessed]?.producedBy ?? []
          ).includes(opId);
          if (!declaredViaRequirements && !declaredViaRuntimeStates && !declaredViaCapabilities) {
            offenders.push({ opId, semanticType, witnessed });
          }
        }
      }
    }

    expect(
      offenders,
      `incidental producers laundered via witness implication into producersByState (#95): ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('createDocument is not registered as a producer of ProcessInstanceExists (concrete #95 reproducer)', async () => {
    // Concrete instance the class-scoped invariant above subsumes. Kept
    // as a focused reproducer so a regression points at the exact symptom
    // (getDocument planning an empty scenario set) rather than at the
    // abstract invariant.
    const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
    const baseDir = path.join(REPO_ROOT, 'path-analyser');
    const graph = await loadGraph(baseDir);

    // Guard against vacuous pass: optional chaining + ?? [] would hide
    // a missing producersByState or createDocument and still satisfy
    // the not.toContain checks.
    expect(graph.producersByState, 'producersByState must be built').toBeDefined();
    if (!graph.producersByState) throw new Error('unreachable: assertion above');
    const witnessProducers = graph.producersByState.ProcessInstanceExists ?? [];
    expect(witnessProducers).not.toContain('createDocument');
    expect(witnessProducers).not.toContain('createDocuments');

    const createDocument = graph.operations.createDocument;
    expect(createDocument, 'createDocument operation must exist').toBeDefined();
    expect(createDocument.domainProduces ?? []).not.toContain('ProcessInstanceExists');
  });
});
