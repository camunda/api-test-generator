/**
 * Planner contract fixtures — OPTIONAL clientMintedAttribute sub-shape leaf
 * that ALSO appears in a non-authoritative response echo.
 *
 * Sibling of `planner-client-minted-attribute.test.ts`, which covers the
 * REQUIRED body-leaf case (the pre-BFS missing-gate). This fixture covers the
 * OPTIONAL sub-shape-variant case handled by `generateOptionalSubShapeVariants`.
 *
 * The defect (bundled camunda-oca: `createProcessInstance.tags[]`, semantic
 * `Tag`):
 *
 *   - `Tag` is declared `kind: 'attribute'` + `clientMinted: true`, so it has
 *     NO authoritative producer — `producersByType['Tag']` is empty BY DESIGN.
 *     The ontology `$comment` states the intended contract: "the planner mints
 *     a deterministic value at setter sites (createProcessInstance.tags[])".
 *   - BUT several ops ECHO tags back in their 200 responses with
 *     `provider: false` (`createProcessInstance.tags[]`,
 *     `searchProcessInstances.items[].tags[]`, …). graphLoader's inclusive
 *     index (#37) lists them in `responseProducersByType['Tag']`.
 *   - `generateOptionalSubShapeVariants` resolves producer candidates as
 *     `authoritative.length > 0 ? authoritative : inclusive`. For `Tag`
 *     authoritative is empty, so the inclusive echo list wins and
 *     `tryProducerChainVariant` builds a chain around an op that never SENT a
 *     tag. The extract yields nothing, `tagVar` stays `__PENDING__`, the
 *     emitter substitutes `null`, and the broker 400s:
 *     "The provided tag 'null' is not valid."
 *
 * A `provider: false` response echo is NOT an authoritative producer for a
 * client-minted attribute. The fix routes such a leaf to the existing
 * bare-endpoint fallback, which re-uses `bindSemanticInput` — the same
 * chokepoint the ontology `$comment` names — to mint `fc:cma:<sem>:<suffix>`.
 *
 * Class-scoped invariant: an OPTIONAL sub-shape leaf whose semantic classifies
 * as `clientMintedAttribute` must be MINTED (never `__PENDING__`) and must not
 * schedule a producer chain built from a non-authoritative echo. This holds for
 * every clientMintedAttribute semantic (Tag, BusinessId, HistoryItemId,
 * LoopIterationId) and any future one, not just `Tag`.
 */
import { describe, expect, it } from 'vitest';
import { generateOptionalSubShapeVariants } from '../../../path-analyser/src/scenarioGenerator.ts';
import type {
  OperationGraph,
  OperationNode,
  SemanticTypeSpec,
} from '../../../path-analyser/src/types.ts';

interface NodeOpts {
  required?: string[];
  produces?: string[];
  providerMap?: Record<string, boolean>;
  optionalSubShapes?: OperationNode['optionalSubShapes'];
  responseSemanticLeaves?: OperationNode['responseSemanticLeaves'];
}

function makeOp(operationId: string, opts: NodeOpts = {}): OperationNode {
  return {
    operationId,
    method: 'POST',
    path: `/${operationId}`,
    requires: { required: opts.required ?? [], optional: [] },
    produces: opts.produces ?? [],
    providerMap: opts.providerMap,
    optionalSubShapes: opts.optionalSubShapes,
    responseSemanticLeaves: opts.responseSemanticLeaves,
  };
}

/**
 * Mirrors graphLoader's indexing contract:
 *   - `producersByType`  ← `provider: true` response semantics only (#98).
 *   - `responseProducersByType` ← EVERY 2xx/3xx response leaf, including
 *     `provider: false` echoes (#37). This is the inclusive index that
 *     defeats producer selection for a client-minted attribute.
 */
function makeGraph(
  nodes: OperationNode[],
  semanticTypes: Record<string, SemanticTypeSpec>,
): OperationGraph {
  const operations: Record<string, OperationNode> = {};
  const producersByType: Record<string, string[]> = {};
  const responseProducersByType: Record<string, string[]> = {};
  for (const node of nodes) {
    operations[node.operationId] = node;
    for (const sem of node.produces) {
      if (node.providerMap?.[sem] !== true) continue;
      const list = producersByType[sem] ?? [];
      list.push(node.operationId);
      producersByType[sem] = list;
    }
    for (const leaf of node.responseSemanticLeaves ?? []) {
      if (!/^[23]/.test(leaf.status)) continue;
      const list = responseProducersByType[leaf.semantic] ?? [];
      if (!list.includes(node.operationId)) list.push(node.operationId);
      responseProducersByType[leaf.semantic] = list;
    }
  }
  return {
    operations,
    producersByType,
    responseProducersByType,
    domain: { version: 1, semanticTypes },
  };
}

function opIdsOf(scenario: { operations: { operationId: string }[] }): string[] {
  return scenario.operations.map((o) => o.operationId);
}

/**
 * The `createProcessInstance.tags[]` shape with neutral names:
 *   - `createThing` is the endpoint under test. It has an OPTIONAL scalar-array
 *     sub-shape `tags[]` whose leaf semantic is `Label`.
 *   - `searchThings` ECHOES `Label` in its 200 response with `provider: false`
 *     — a non-authoritative responder, exactly like
 *     `searchProcessInstances.items[].tags[]`.
 *   - `Label` is declared `kind: 'attribute'` + `clientMinted: true`, so it has
 *     no authoritative producer: `producersByType['Label']` is empty while
 *     `responseProducersByType['Label'] === ['searchThings']`.
 *
 * `labelDecl` varies the ABox declaration so the fixtures can probe the
 * classification boundary (a genuinely producer-bound semantic must still chain).
 */
function makeEchoGraph(labelDecl: SemanticTypeSpec | undefined): OperationGraph {
  return makeGraph(
    [
      makeOp('createThing', {
        optionalSubShapes: [{ rootPath: '', leaves: [{ fieldPath: 'tags[]', semantic: 'Label' }] }],
      }),
      makeOp('searchThings', {
        responseSemanticLeaves: [
          { semantic: 'Label', fieldPath: 'items[].tags[]', status: '200', provider: false },
        ],
      }),
    ],
    labelDecl ? { Label: labelDecl } : {},
  );
}

const fixtureClientMintedEcho = makeEchoGraph({ kind: 'attribute', clientMinted: true });

// Negative control: a producer-bound semantic (no clientMinted flag, but a real
// `provider: true` producer) must STILL build a producer chain — the fix is
// scoped to the clientMintedAttribute classification, not a blanket ban on
// inclusive-index producers.
const fixtureProducerBound: OperationGraph = makeGraph(
  [
    makeOp('createThing', {
      optionalSubShapes: [{ rootPath: '', leaves: [{ fieldPath: 'tags[]', semantic: 'Label' }] }],
    }),
    makeOp('mintLabel', {
      produces: ['Label'],
      providerMap: { Label: true },
    }),
  ],
  { Label: { kind: 'attribute' } },
);

describe('planner contracts: optional clientMintedAttribute sub-shape leaf with a non-authoritative echo', () => {
  it('mints the fc:cma: value instead of leaving the binding __PENDING__', () => {
    const variants = generateOptionalSubShapeVariants(fixtureClientMintedEcho, 'createThing', {
      maxVariantsPerEndpoint: 10,
    });
    expect(variants.scenarios.length).toBeGreaterThan(0);
    const variant = variants.scenarios[0];
    const bindings = variant.bindings ?? {};
    // The regression: a producer chain built from a `provider: false` echo
    // never supplies a value, so `labelVar` stayed `__PENDING__` and the
    // emitter sent `null`. A client-minted attribute must be minted.
    expect(bindings.labelVar).not.toBe('__PENDING__');
    expect(bindings.labelVar).toMatch(/^fc:cma:label:/);
  });

  it('does NOT schedule a producer chain around the non-authoritative echo', () => {
    const variants = generateOptionalSubShapeVariants(fixtureClientMintedEcho, 'createThing', {
      maxVariantsPerEndpoint: 10,
    });
    const variant = variants.scenarios[0];
    // `searchThings` only echoes `Label`; it is not an authoritative producer,
    // so it must not appear in the chain for a client-minted leaf. The variant
    // is the bare endpoint (plus whatever its own required semantics need —
    // here, nothing).
    expect(opIdsOf(variant)).not.toContain('searchThings');
    expect(variant.populatesSubShape?.leafSemantics).toEqual(['Label']);
  });

  it('still builds a producer chain for a genuinely producer-bound optional leaf', () => {
    // Negative control: the fix must not suppress producer chaining for a
    // semantic that HAS an authoritative producer. `mintLabel` is
    // `provider: true`, so `Label` classifies as `producerBound` and the chain
    // must include it.
    const variants = generateOptionalSubShapeVariants(fixtureProducerBound, 'createThing', {
      maxVariantsPerEndpoint: 10,
    });
    expect(variants.scenarios.length).toBeGreaterThan(0);
    expect(opIdsOf(variants.scenarios[0])).toContain('mintLabel');
  });
});
