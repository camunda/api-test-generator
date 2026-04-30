import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGraph } from '../../path-analyser/src/graphLoader.ts';

/**
 * `produces` fallback tightening — class-scoped regression for #97.
 *
 * Follow-up to #95 / #96. The witness-implication gate landed in #96
 * prevents incidental response semantics from being laundered into
 * `producersByState[witnessed]`, but the upstream cause — the
 * `produces` fallback in `graphLoader.ts` — was left in place because
 * tightening it ripples through more chains than the targeted #95 fix
 * warranted.
 *
 * The defect this test guards against: when an op's response carries
 * semantic types but **no** field is flagged `provider: true`, the
 * fallback used to add every response semantic to `op.produces` (and
 * thus to `producersByType[T]`). That is what put `createDocument`
 * into `producersByType["ProcessInstanceKey"]` in the first place —
 * its 201 response carries `metadata.processInstanceKey` purely as
 * bookkeeping (`provider: false`), but because the response declared
 * no authoritative provider at all, the fallback claimed the whole
 * response surface as produced output.
 *
 * Class-scoped invariant (canonical signal only): for every op `O`
 * and every semantic type `T`, if `O ∈ producersByType[T]`, then there
 * must be canonical evidence — either
 *   (a) at least one response field of type `T` carries `provider: true`, or
 *   (b) the op declares `T` via an explicit
 *       `produces` / `producesSemanticTypes` / `producesSemanticType` /
 *       `outputsSemanticTypes` field on its raw graph entry, or
 *   (c) `domain.operationRequirements[O]` lists `T` in its `produces`
 *       or `implicitAdds` (sidecar-declared, surfaced into
 *       `producersByType` per #56).
 *
 * Empirically the upstream OpenAPI spec is under-annotated (see
 * camunda/camunda#52169). Until those annotations land, dropping the
 * fallback shrinks `producersByType` for several ops; that regression
 * is honest — those entries were built on phantom inferences.
 */

describe('graphLoader: produces fallback tightening (#97)', () => {
  it('every op in producersByType[T] has canonical evidence (provider:true or explicit produces)', async () => {
    const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
    const baseDir = path.join(REPO_ROOT, 'path-analyser');
    const graph = await loadGraph(baseDir);

    // Guard against vacuous pass.
    expect(graph.producersByType, 'producersByType must be built').toBeDefined();
    const totalProducers = Object.values(graph.producersByType).reduce(
      (acc, ids) => acc + (ids?.length ?? 0),
      0,
    );
    expect(
      totalProducers,
      'producersByType must contain at least some entries for this invariant to be meaningful',
    ).toBeGreaterThan(0);

    // We need to consult the *raw* op JSON to see explicit `produces` /
    // `producesSemanticTypes` declarations, since `normalizeOp` collapses
    // them into the same `produces` array as the response-derived ones.
    const fs = await import('node:fs');
    const rawGraphPath = path.join(
      REPO_ROOT,
      'semantic-graph-extractor',
      'dist',
      'output',
      'operation-dependency-graph.json',
    );
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const rawGraph = JSON.parse(fs.readFileSync(rawGraphPath, 'utf8')) as {
      operations: Array<{
        operationId: string;
        produces?: unknown;
        producesSemanticType?: unknown;
        producesSemanticTypes?: unknown;
        outputsSemanticTypes?: unknown;
        responseSemanticTypes?: Record<
          string,
          Array<{ semanticType?: unknown; provider?: unknown }>
        >;
      }>;
    };
    const rawByOpId = new Map<string, (typeof rawGraph.operations)[number]>();
    for (const op of rawGraph.operations) rawByOpId.set(op.operationId, op);

    const collectStrings = (v: unknown): string[] => {
      if (typeof v === 'string') return [v];
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
      return [];
    };

    const offenders: { opId: string; semanticType: string }[] = [];

    for (const [semanticType, opIds] of Object.entries(graph.producersByType)) {
      for (const opId of opIds ?? []) {
        const raw = rawByOpId.get(opId);
        if (!raw) {
          // Op missing from raw graph — flag rather than silently allow.
          offenders.push({ opId, semanticType });
          continue;
        }
        // Canonical evidence (a): at least one response field of this
        // semantic type carries provider:true.
        let hasProviderFlag = false;
        for (const arr of Object.values(raw.responseSemanticTypes ?? {})) {
          if (!Array.isArray(arr)) continue;
          for (const entry of arr) {
            if (entry?.semanticType === semanticType && entry?.provider === true) {
              hasProviderFlag = true;
              break;
            }
          }
          if (hasProviderFlag) break;
        }
        if (hasProviderFlag) continue;

        // Canonical evidence (b): explicit produces declaration.
        const explicit = new Set([
          ...collectStrings(raw.produces),
          ...collectStrings(raw.producesSemanticType),
          ...collectStrings(raw.producesSemanticTypes),
          ...collectStrings(raw.outputsSemanticTypes),
        ]);
        if (explicit.has(semanticType)) continue;

        // Canonical evidence (c): domain-semantics sidecar declares
        // produces / implicitAdds (surfaced into producersByType per #56).
        const opReqs = graph.domain?.operationRequirements?.[opId];
        const sidecarProduces = new Set([
          ...(opReqs?.produces ?? []),
          ...(opReqs?.implicitAdds ?? []),
        ]);
        if (sidecarProduces.has(semanticType)) continue;

        offenders.push({ opId, semanticType });
      }
    }

    expect(
      offenders,
      `ops appearing in producersByType[T] without canonical evidence (#97): ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('createDocument does not produce ProcessInstanceKey or ProcessDefinitionId (concrete #97 reproducer)', async () => {
    // Concrete instance the class-scoped invariant above subsumes.
    // `createDocument`'s 201 response carries
    //   metadata.processInstanceKey  (semanticType: ProcessInstanceKey, provider:false)
    //   metadata.processDefinitionId (semanticType: ProcessDefinitionId, provider:false)
    // purely as bookkeeping. Neither is an authoritative production of
    // createDocument; the fallback laundered them into
    // producersByType[ProcessInstanceKey] / [ProcessDefinitionId].
    const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
    const baseDir = path.join(REPO_ROOT, 'path-analyser');
    const graph = await loadGraph(baseDir);

    expect(graph.producersByType, 'producersByType must be built').toBeDefined();
    const procInstKeyProducers = graph.producersByType.ProcessInstanceKey ?? [];
    const procDefIdProducers = graph.producersByType.ProcessDefinitionId ?? [];
    expect(procInstKeyProducers).not.toContain('createDocument');
    expect(procInstKeyProducers).not.toContain('createDocuments');
    expect(procDefIdProducers).not.toContain('createDocument');
    expect(procDefIdProducers).not.toContain('createDocuments');
  });
});
