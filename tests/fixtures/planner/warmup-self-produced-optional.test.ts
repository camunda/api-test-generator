/**
 * Planner contract fixtures — a producer-chain warm-up must not be scheduled
 * for an OPTIONAL input the chosen producer itself authoritatively produces.
 *
 * The defect (bundled camunda-oca: `searchAuditLogs` and 7 sibling filter
 * variants, all of which grew a `searchAgentDefinitions` step 1):
 *
 *   - Every paginated search AUTHORITATIVELY returns the standard `page`
 *     envelope's cursors (`page.startCursor` / `page.endCursor`,
 *     `provider: true`) and OPTIONALLY accepts them (`page.before` /
 *     `page.after`, `provider: false`). So a search is simultaneously a
 *     cursor producer and a cursor consumer.
 *   - `tryProducerChainVariant`'s `buildAdditional` adds every optional input
 *     of the chosen producer that the endpoint also produces. For a paginated
 *     producer that is exactly `{StartCursor, EndCursor}` — which then makes
 *     Pass 1's `overlapsEndpoint` true *purely because of cursors*, and is
 *     handed to BFS as `additionalNeeded`.
 *   - BFS treats `additionalNeeded` as hard needs and schedules a producer for
 *     each. For `StartCursor` / `EndCursor` the first entry of
 *     `producersByType` in spec-path order wins — `searchAgentDefinitions`,
 *     the alphabetically-first paginated resource, and the one resource with
 *     no create operation. Its page can therefore never become non-empty, so
 *     the emitted `await_eventually` wait for items never resolves: the live
 *     test times out. 9 of P3's 10 pass→fail regressions are this.
 *
 * A cursor is only meaningful to the call that issued it, and the chosen
 * producer issues its own call: its response yields the cursor, so no EARLIER
 * producer is required to satisfy it. Scheduling one is pure overhead — and,
 * when the first producer in spec order is a permanently-empty entity, a hard
 * failure.
 *
 * The fix keeps the Pass-1 producer SELECTION untouched (the chosen producer
 * is still the leaf's real producer) and filters only what is handed to BFS:
 * an optional input the chosen producer itself produces is dropped from
 * `additionalNeeded`. The leaf's own semantic is always exempt, so a producer
 * that is the leaf's source is still scheduled.
 *
 * Class-scoped invariant: no variant chain may contain a step whose only
 * contribution is satisfying an optional input that a LATER step in the same
 * chain already produces. This holds for every paginated search pair and every
 * self-produced optional semantic, not just cursors and not just
 * `searchAgentDefinitions`.
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
  optional?: string[];
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
    requires: { required: opts.required ?? [], optional: opts.optional ?? [] },
    produces: opts.produces ?? [],
    providerMap: opts.providerMap,
    optionalSubShapes: opts.optionalSubShapes,
    responseSemanticLeaves: opts.responseSemanticLeaves,
  };
}

/**
 * Mirrors graphLoader's indexing contract:
 *   - `producersByType` ← `provider: true` response semantics only (#98).
 *   - `responseProducersByType` ← EVERY 2xx/3xx response leaf, including
 *     `provider: false` echoes (#37) — the inclusive index a filter-only
 *     semantic (no create API) resolves through.
 *
 * Insertion order is preserved deliberately: `producersByType` order is what
 * BFS walks when picking a producer, so the first-listed cursor producer wins
 * exactly as it does on the bundled spec.
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

/** The standard paginated `page` envelope: authoritative out, optional in. */
const CURSOR_PRODUCES = ['StartCursor', 'EndCursor'];
const CURSOR_PROVIDER_MAP = { StartCursor: true, EndCursor: true };
const CURSOR_RESPONSE_LEAVES: NonNullable<NodeOpts['responseSemanticLeaves']> = [
  { semantic: 'StartCursor', fieldPath: 'page.startCursor', status: '200', provider: true },
  { semantic: 'EndCursor', fieldPath: 'page.endCursor', status: '200', provider: true },
];

/**
 * `aaaSearch` mirrors `searchAgentDefinitions`: it sorts FIRST in spec-path
 * order among cursor producers, is paginated, and has no create operation —
 * so its page can never become non-empty. It is the decoy the warm-up must not
 * schedule. It does NOT echo `WidgetKey`, so it can never be the leaf's
 * producer: its only possible contribution to a chain is cursor semantics.
 */
const aaaSearch = makeOp('aaaSearch', {
  optional: ['StartCursor', 'EndCursor'],
  produces: CURSOR_PRODUCES,
  providerMap: CURSOR_PROVIDER_MAP,
  responseSemanticLeaves: CURSOR_RESPONSE_LEAVES,
});

/**
 * The endpoint under test, mirroring `searchAuditLogs`: a paginated search
 * whose OPTIONAL filter leaf (`filter.widgetKey`, semantic `WidgetKey`) has no
 * create API — `producersByType['WidgetKey']` is empty and only the inclusive
 * echo index lists responders.
 */
const searchWidgets = makeOp('searchWidgets', {
  optional: ['WidgetKey', 'StartCursor', 'EndCursor'],
  produces: CURSOR_PRODUCES,
  providerMap: CURSOR_PROVIDER_MAP,
  optionalSubShapes: [
    { rootPath: 'filter', leaves: [{ fieldPath: 'filter.widgetKey', semantic: 'WidgetKey' }] },
  ],
  responseSemanticLeaves: CURSOR_RESPONSE_LEAVES,
});

/**
 * `getWidget` mirrors `getAuditLog`: the first inclusive-index candidate. It
 * echoes `WidgetKey` but requires it as a path parameter, so it does not
 * overlap the endpoint and Pass 1 skips it — leaving `searchWidgetEvents` as
 * the chosen producer, exactly as on the bundled spec.
 */
const getWidget = makeOp('getWidget', {
  required: ['WidgetKey'],
  responseSemanticLeaves: [
    { semantic: 'WidgetKey', fieldPath: 'widgetKey', status: '200', provider: false },
  ],
});

/**
 * `createWidgetSource` mirrors `createProcessInstance`: the authoritative,
 * prereq-free producer that the leaf producer's own required input resolves
 * through.
 */
const createWidgetSource = makeOp('createWidgetSource', {
  produces: ['WidgetSourceKey'],
  providerMap: { WidgetSourceKey: true },
});

/**
 * `searchWidgetEvents` mirrors `searchUserTaskAuditLogs`: the leaf's real
 * producer. It echoes `WidgetKey` (`provider: false`) and is itself paginated,
 * so `buildAdditional` picks up `{StartCursor, EndCursor}` from its own
 * optional inputs — the spurious need under test.
 *
 * It also REQUIRES `WidgetSourceKey` (as `searchUserTaskAuditLogs` requires
 * `UserTaskKey`), and that is what makes the defect observable: BFS will not
 * reuse a producer that still needs its own prereq to satisfy a cheap cursor
 * need, so it reaches for the prereq-free first-in-spec-order cursor producer
 * instead. Without this required input the fixture does NOT reproduce — BFS
 * satisfies both cursors from `searchWidgetEvents` itself and schedules no
 * warm-up at all.
 */
const searchWidgetEvents = makeOp('searchWidgetEvents', {
  required: ['WidgetSourceKey'],
  optional: ['StartCursor', 'EndCursor'],
  produces: CURSOR_PRODUCES,
  providerMap: CURSOR_PROVIDER_MAP,
  responseSemanticLeaves: [
    { semantic: 'WidgetKey', fieldPath: 'items[].widgetKey', status: '200', provider: false },
    ...CURSOR_RESPONSE_LEAVES,
  ],
});

const fixtureSelfProducedOptional = makeGraph(
  [aaaSearch, searchWidgets, getWidget, createWidgetSource, searchWidgetEvents],
  { WidgetKey: { kind: 'serverEmergent' }, WidgetSourceKey: { kind: 'serverEmergent' } },
);

/**
 * Negative control, mirroring row 1 of the handoff table
 * (`searchAgentInstances` filtering by `agentDefinitionKey`): here the
 * first-in-spec-order paginated search IS the leaf's real producer, so it must
 * STAY in the chain. `aaaGadgetDefs` echoes `GadgetDefKey` and is the only
 * external candidate — dropping it would leave the variant leaf unbound.
 */
const aaaGadgetDefs = makeOp('aaaGadgetDefs', {
  optional: ['GadgetDefKey', 'StartCursor', 'EndCursor'],
  produces: CURSOR_PRODUCES,
  providerMap: CURSOR_PROVIDER_MAP,
  responseSemanticLeaves: [
    { semantic: 'GadgetDefKey', fieldPath: 'items[].gadgetDefKey', status: '200', provider: false },
    ...CURSOR_RESPONSE_LEAVES,
  ],
});

const searchGadgets = makeOp('searchGadgets', {
  optional: ['GadgetDefKey', 'StartCursor', 'EndCursor'],
  produces: CURSOR_PRODUCES,
  providerMap: CURSOR_PROVIDER_MAP,
  optionalSubShapes: [
    {
      rootPath: 'filter',
      leaves: [{ fieldPath: 'filter.gadgetDefKey', semantic: 'GadgetDefKey' }],
    },
  ],
  responseSemanticLeaves: [
    { semantic: 'GadgetDefKey', fieldPath: 'items[].gadgetDefKey', status: '200', provider: false },
    ...CURSOR_RESPONSE_LEAVES,
  ],
});

const fixtureLeafProducerIsFirst = makeGraph([aaaGadgetDefs, searchGadgets], {
  GadgetDefKey: { kind: 'serverEmergent' },
});

describe('planner contracts: warm-up is not scheduled for a self-produced optional input', () => {
  it('does not chain the first-in-spec-order paginated search when it only contributes cursors', () => {
    const variants = generateOptionalSubShapeVariants(
      fixtureSelfProducedOptional,
      'searchWidgets',
      {
        maxVariantsPerEndpoint: 10,
      },
    );
    expect(variants.scenarios.length).toBeGreaterThan(0);
    const variant = variants.scenarios[0];
    expect(variant.populatesSubShape?.leafSemantics).toEqual(['WidgetKey']);
    // The regression: `aaaSearch` was scheduled as step 1 solely to satisfy
    // `StartCursor` / `EndCursor` — semantics the chosen producer
    // (`searchWidgetEvents`) already returns from its own call. It has no
    // create operation, so its page never fills and the emitted
    // `await_eventually` wait times out.
    expect(opIdsOf(variant)).not.toContain('aaaSearch');
  });

  it('still chains the leaf real producer', () => {
    const variants = generateOptionalSubShapeVariants(
      fixtureSelfProducedOptional,
      'searchWidgets',
      {
        maxVariantsPerEndpoint: 10,
      },
    );
    const variant = variants.scenarios[0];
    // The fix must remove only the spurious cursor warm-up, not the producer
    // that actually supplies the variant leaf.
    expect(opIdsOf(variant)).toContain('searchWidgetEvents');
    expect(opIdsOf(variant).at(-1)).toBe('searchWidgets');
  });

  it('keeps a first-in-spec-order search that IS the leaf producer', () => {
    // Negative control (handoff table row 1): when the alphabetically-first
    // paginated search is genuinely the source of the variant leaf, it must
    // remain in the chain — the filter is scoped to self-produced OPTIONAL
    // inputs, never to the leaf semantic itself.
    const variants = generateOptionalSubShapeVariants(fixtureLeafProducerIsFirst, 'searchGadgets', {
      maxVariantsPerEndpoint: 10,
    });
    expect(variants.scenarios.length).toBeGreaterThan(0);
    const variant = variants.scenarios[0];
    expect(variant.populatesSubShape?.leafSemantics).toEqual(['GadgetDefKey']);
    expect(opIdsOf(variant)).toContain('aaaGadgetDefs');
  });
});
