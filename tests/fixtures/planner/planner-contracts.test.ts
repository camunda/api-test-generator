import { describe, expect, it } from 'vitest';
import {
  generateOptionalSubShapeVariants,
  generateScenariosForEndpoint,
} from '../../../path-analyser/src/scenarioGenerator.ts';
import type {
  EndpointScenarioCollection,
  OperationGraph,
  OperationNode,
} from '../../../path-analyser/src/types.ts';

/**
 * Planner contract fixtures — Layer 2 of the layered test strategy (#36).
 *
 * Each fixture is a hand-built minimal `OperationGraph` paired with a
 * one-line assertion about the chain shape `generateScenariosForEndpoint`
 * must produce. Failures point at one chain rule, not at hundreds of
 * generated scenario files.
 *
 * Add a new fixture whenever a planner bug fix is observable at the
 * chain level (e.g. "must include this op", "must NOT include this op",
 * "providers preferred over incidental producers").
 */

interface NodeOpts {
  required?: string[];
  optional?: string[];
  produces?: string[];
  providerMap?: Record<string, boolean>;
  domainRequiresAll?: string[];
  domainProduces?: string[];
  optionalSubShapes?: OperationNode['optionalSubShapes'];
  responseSemanticLeaves?: OperationNode['responseSemanticLeaves'];
  eventuallyConsistent?: boolean;
}

function makeOp(operationId: string, opts: NodeOpts = {}): OperationNode {
  return {
    operationId,
    method: 'POST',
    path: `/${operationId}`,
    requires: {
      required: opts.required ?? [],
      optional: opts.optional ?? [],
    },
    produces: opts.produces ?? [],
    providerMap: opts.providerMap,
    domainRequiresAll: opts.domainRequiresAll,
    domainProduces: opts.domainProduces,
    optionalSubShapes: opts.optionalSubShapes,
    responseSemanticLeaves: opts.responseSemanticLeaves,
    eventuallyConsistent: opts.eventuallyConsistent,
  };
}

function makeGraph(nodes: OperationNode[]): OperationGraph {
  const operations: Record<string, OperationNode> = {};
  const producersByType: Record<string, string[]> = {};
  const producersByState: Record<string, string[]> = {};
  const responseProducersByType: Record<string, string[]> = {};
  for (const node of nodes) {
    operations[node.operationId] = node;
    for (const sem of node.produces) {
      const list = producersByType[sem] ?? [];
      list.push(node.operationId);
      producersByType[sem] = list;
    }
    for (const ds of node.domainProduces ?? []) {
      const list = producersByState[ds] ?? [];
      list.push(node.operationId);
      producersByState[ds] = list;
    }
    for (const leaf of node.responseSemanticLeaves ?? []) {
      // Mirror graphLoader's success-status filter: only 2xx/3xx leaves
      // populate the inclusive index. A leaf surfaced only in a 4xx/5xx
      // response must NOT be discoverable as a variant producer.
      if (!/^[23]/.test(leaf.status)) continue;
      const list = responseProducersByType[leaf.semantic] ?? [];
      if (!list.includes(node.operationId)) list.push(node.operationId);
      responseProducersByType[leaf.semantic] = list;
    }
  }
  return { operations, producersByType, producersByState, responseProducersByType };
}

function plan(graph: OperationGraph, endpointOpId: string): EndpointScenarioCollection {
  return generateScenariosForEndpoint(graph, endpointOpId, { maxScenarios: 10 });
}

function opIdsOf(scenario: { operations: { operationId: string }[] }): string[] {
  return scenario.operations.map((o) => o.operationId);
}

// ---------------------------------------------------------------------------
// Fixture A: authoritative provider preferred over incidental producer (#34)
// ---------------------------------------------------------------------------
//
// Two operations both produce ProcessDefinitionKey, but only
// `createDeployment` is annotated provider:true. The planner must
// prefer the authoritative producer for the first/canonical scenario;
// additional scenarios may still be generated via the incidental
// search-style operation (the contract is ordering, not suppression).
const fixtureProviderPreference: OperationGraph = makeGraph([
  makeOp('createDeployment', {
    produces: ['ProcessDefinitionKey'],
    providerMap: { ProcessDefinitionKey: true },
  }),
  makeOp('searchProcessDefinitions', {
    produces: ['ProcessDefinitionKey'],
    providerMap: { ProcessDefinitionKey: false },
  }),
  makeOp('createProcessInstance', {
    required: ['ProcessDefinitionKey'],
  }),
]);

// ---------------------------------------------------------------------------
// Fixture B: optional types do NOT force pre-ops (#31, chain-level)
// ---------------------------------------------------------------------------
//
// Endpoint requires ProcessDefinitionKey and optionally accepts ElementId.
// The original #31 symptom in chain form: planner inserted a search-step
// chain to source the "optional" type because it was wrongly classified
// required. Optional types must remain opportunistic.
const fixtureOptionalNoPreOp: OperationGraph = makeGraph([
  makeOp('createDeployment', {
    produces: ['ProcessDefinitionKey'],
    providerMap: { ProcessDefinitionKey: true },
  }),
  makeOp('searchElementInstances', {
    produces: ['ElementId'],
    providerMap: { ElementId: true },
  }),
  makeOp('createProcessInstance', {
    required: ['ProcessDefinitionKey'],
    optional: ['ElementId'],
  }),
]);

// ---------------------------------------------------------------------------
// Fixture C: unsatisfied requirement surfaces explicitly
// ---------------------------------------------------------------------------
//
// Endpoint requires a semantic type with no producer anywhere in the
// graph. The planner must return a single `unsatisfied` scenario with
// the missing type listed, not an empty collection or a silently-broken
// chain.
const fixtureUnsatisfied: OperationGraph = makeGraph([
  makeOp('createProcessInstance', {
    required: ['MissingType'],
  }),
]);

// ---------------------------------------------------------------------------
// Fixture D: trivial endpoint (no requirements) plans a one-op scenario
// ---------------------------------------------------------------------------
//
// Endpoint with no required and no optional semantic types must produce
// exactly one scenario containing only the endpoint itself. Locks in
// the no-pre-op short-circuit path.
const fixtureTrivial: OperationGraph = makeGraph([
  makeOp('listTopology', {
    produces: [],
  }),
]);

// ---------------------------------------------------------------------------
// Fixture E: spurious intermediate steps must not be inserted (#35)
// ---------------------------------------------------------------------------
//
// Two coupled defects, one fixture:
//
//   1. A producer's `optional` requirements must NOT be promoted to
//      hard `needed` after expansion. createDeployment opportunistically
//      accepts TenantId but does not require it; the planner used to
//      add it to `needed`, which then forced BFS to chase a producer.
//
//   2. The candidate getAuditLog incidentally produces TenantId, but its
//      own `requires.required = [AuditLogKey]` is unsatisfiable in the
//      current chain state. The planner must reject any candidate whose
//      required inputs are not produced by an earlier step.
//
// Together these guarantee the planner produces exactly
// [createDeployment, createProcessInstance] — no spurious step that
// would render with a literal `${auditLogKey}` placeholder URL at
// runtime.
const fixtureSpuriousIntermediate: OperationGraph = makeGraph([
  makeOp('createDeployment', {
    produces: ['ProcessDefinitionKey'],
    providerMap: { ProcessDefinitionKey: true },
    optional: ['TenantId'], // opportunistic — must not leak into `needed`
  }),
  makeOp('getAuditLog', {
    // incidental producer of TenantId; required input is unsatisfiable
    produces: ['TenantId', 'AuditLogKey'],
    required: ['AuditLogKey'],
  }),
  makeOp('createProcessInstance', {
    required: ['ProcessDefinitionKey'],
  }),
]);

// ---------------------------------------------------------------------------
// Fixture F: transitive prereqs are discoverable (PR #45 review)
// ---------------------------------------------------------------------------
//
// The #35 prereq guard rejects candidates whose required inputs are not
// yet produced. Without a deferral mechanism, the planner would also drop
// chains where the missing input has its own producer that simply has not
// been planned yet.
//
// Endpoint requires `T`. Producer `A` produces `T` but requires `X`.
// Producer `P` produces `X` and requires nothing. The planner must
// discover the transitive chain `[P, A, endpoint]` rather than failing
// with "unsatisfied".
const fixtureTransitivePrereq: OperationGraph = makeGraph([
  makeOp('produceX', {
    produces: ['X'],
    providerMap: { X: true },
  }),
  makeOp('produceTRequiringX', {
    produces: ['T'],
    required: ['X'],
    providerMap: { T: true },
  }),
  makeOp('endpointRequiringT', {
    required: ['T'],
  }),
]);

describe('planner contracts: provider preference', () => {
  it('first scenario uses the authoritative provider (#34)', () => {
    // The planner explores both authoritative and incidental producers
    // (BFS), but the authoritative producer must come first so it is the
    // canonical scenario downstream consumers see. This is the chain-level
    // mirror of the extractor `provider: true` flag.
    const collection = plan(fixtureProviderPreference, 'createProcessInstance');
    expect(collection.scenarios.length).toBeGreaterThan(0);
    expect(opIdsOf(collection.scenarios[0])).toEqual(['createDeployment', 'createProcessInstance']);
  });

  it('productionMap attributes ProcessDefinitionKey to createDeployment in the first scenario (#34)', () => {
    const collection = plan(fixtureProviderPreference, 'createProcessInstance');
    expect(collection.scenarios[0].productionMap?.ProcessDefinitionKey).toBe('createDeployment');
  });
});

describe('planner contracts: optional types stay opportunistic', () => {
  it('does not insert a producer for the optional-only type (#31, chain-level)', () => {
    const collection = plan(fixtureOptionalNoPreOp, 'createProcessInstance');
    expect(collection.scenarios.length).toBeGreaterThan(0);
    for (const scenario of collection.scenarios) {
      const ops = opIdsOf(scenario);
      expect(ops).not.toContain('searchElementInstances');
    }
  });

  it('still includes the producer for the required type', () => {
    const collection = plan(fixtureOptionalNoPreOp, 'createProcessInstance');
    for (const scenario of collection.scenarios) {
      expect(opIdsOf(scenario)).toContain('createDeployment');
    }
  });
});

describe('planner contracts: unsatisfied requirement', () => {
  it('returns a single unsatisfied scenario listing the missing type', () => {
    const collection = plan(fixtureUnsatisfied, 'createProcessInstance');
    expect(collection.unsatisfied).toBe(true);
    expect(collection.scenarios).toHaveLength(1);
    const [scenario] = collection.scenarios;
    expect(scenario.id).toBe('unsatisfied');
    expect(scenario.missingSemanticTypes).toEqual(['MissingType']);
  });
});

describe('planner contracts: trivial endpoint', () => {
  it('plans exactly one scenario containing only the endpoint', () => {
    const collection = plan(fixtureTrivial, 'listTopology');
    expect(collection.scenarios).toHaveLength(1);
    expect(opIdsOf(collection.scenarios[0])).toEqual(['listTopology']);
  });
});

describe('planner contracts: spurious intermediate steps (#35)', () => {
  it('does not insert a step whose required inputs are unsatisfiable', () => {
    // Class-scoped guard: every step's `requires.required` must be
    // produced by an earlier step. getAuditLog requires AuditLogKey,
    // which nothing in the chain produces — it must not appear in any
    // scenario regardless of its incidental contributions.
    const collection = plan(fixtureSpuriousIntermediate, 'createProcessInstance');
    for (const scenario of collection.scenarios) {
      expect(opIdsOf(scenario), `scenario ${scenario.id}`).not.toContain('getAuditLog');
    }
  });

  it('producer optional requirements do not leak into `needed` (#35 root cause)', () => {
    // createDeployment.optional = [TenantId] is opportunistic. The
    // planner must not promote it to a hard requirement after
    // expansion, otherwise BFS would chase any producer of TenantId
    // (incidental or not).
    const collection = plan(fixtureSpuriousIntermediate, 'createProcessInstance');
    expect(collection.scenarios.length).toBeGreaterThan(0);
    expect(opIdsOf(collection.scenarios[0])).toEqual(['createDeployment', 'createProcessInstance']);
  });

  it('discovers transitive prereqs rather than dropping the chain (#45 review)', () => {
    // The prereq guard rejects `produceTRequiringX` because X is not yet
    // produced, but the planner must still find a chain by deferring and
    // discovering `produceX` first. The expected chain is
    // [produceX, produceTRequiringX, endpointRequiringT].
    const collection = plan(fixtureTransitivePrereq, 'endpointRequiringT');
    expect(collection.unsatisfied).not.toBe(true);
    expect(collection.scenarios.length).toBeGreaterThan(0);
    const firstOps = opIdsOf(collection.scenarios[0]);
    expect(firstOps).toEqual(['produceX', 'produceTRequiringX', 'endpointRequiringT']);
  });
});

// ---------------------------------------------------------------------------
// Fixture G: domain-prereq-blocked authoritative producer (#58)
// ---------------------------------------------------------------------------
//
// Endpoint `consumeFoo` requires `Foo`. The only authoritative producer
// of `Foo` is `produceFoo`, which has `domainRequiresAll: ['BarReady']`.
// `produceBar` is a domain producer for `BarReady` (via `domainProduces`)
// and has no requirements. The planner must discover the chain
// [produceBar, produceFoo, consumeFoo] rather than deadlocking.
//
// On main, BFS skips `produceFoo` outright when its `domainRequiresAll`
// is unmet (semantic-target branch line ~466), and never enters the
// domain-progression branch because semantic remaining > 0. Result:
// scenarios.length === 0. This is the synthetic mirror of the
// `completeJob → activateJobs → ProcessInstanceExists+ModelHasServiceTaskType`
// deadlock observed on the bundled spec.
const fixtureDomainBlockedAuthoritative: OperationGraph = makeGraph([
  makeOp('produceBar', {
    domainProduces: ['BarReady'],
  }),
  makeOp('produceFoo', {
    produces: ['Foo'],
    providerMap: { Foo: true },
    domainRequiresAll: ['BarReady'],
  }),
  makeOp('consumeFoo', {
    required: ['Foo'],
  }),
]);

describe('planner contracts: domain-prereq-blocked authoritative producer (#58)', () => {
  it('produces a chain that satisfies the authoritative producer\u2019s domain prereq', () => {
    const collection = plan(fixtureDomainBlockedAuthoritative, 'consumeFoo');
    expect(collection.unsatisfied).not.toBe(true);
    expect(collection.scenarios.length).toBeGreaterThan(0);
  });

  it('chain order satisfies BarReady before invoking produceFoo', () => {
    const collection = plan(fixtureDomainBlockedAuthoritative, 'consumeFoo');
    expect(
      collection.scenarios.length,
      'expected at least one scenario before indexing scenarios[0]',
    ).toBeGreaterThan(0);
    const firstOps = opIdsOf(collection.scenarios[0]);
    const barIdx = firstOps.indexOf('produceBar');
    const fooIdx = firstOps.indexOf('produceFoo');
    const endpointIdx = firstOps.indexOf('consumeFoo');
    expect(barIdx, 'produceBar must appear in the chain').toBeGreaterThanOrEqual(0);
    expect(fooIdx).toBeGreaterThan(barIdx);
    expect(endpointIdx).toBeGreaterThan(fooIdx);
  });
});

// ---------------------------------------------------------------------------
// Fixture H: optional sub-shape variant scenario (#37)
// ---------------------------------------------------------------------------
//
// Endpoint `createOrder` requires `OrderId` (produced authoritatively by
// `mintOrderId`). It produces `OrderInstanceKey`. It also has an
// OPTIONAL sub-shape `lineItems[]` whose only semantic-typed leaf is
// `lineItems[].productId` carrying a `ProductId`.
//
// `searchProducts` produces `ProductId`. Its optional filter input is
// `OrderInstanceKey` — exactly what the endpoint produces. Variant
// planning must recognise this overlap and force a warm-up endpoint
// call BEFORE searchProducts runs, so the search has something
// meaningful to filter by.
//
// Base scenario for `createOrder` is just `[mintOrderId, createOrder]`
// (the optional sub-shape is omitted, so ProductId is never needed).
//
// Variant scenario must populate `lineItems[].productId`. Expected
// chain:
//
//   [mintOrderId, createOrder (warm-up), searchProducts, createOrder (real)]
//
// `populatesSubShape` and `hasEventuallyConsistent` are propagated.
const fixtureSubShapeVariant: OperationGraph = makeGraph([
  makeOp('mintOrderId', {
    produces: ['OrderId'],
    providerMap: { OrderId: true },
  }),
  makeOp('searchProducts', {
    optional: ['OrderInstanceKey'],
    produces: ['ProductId'],
    providerMap: { ProductId: true },
    eventuallyConsistent: true,
  }),
  makeOp('createOrder', {
    required: ['OrderId'],
    produces: ['OrderInstanceKey'],
    providerMap: { OrderInstanceKey: true },
    optionalSubShapes: [
      {
        rootPath: 'lineItems[]',
        leaves: [{ fieldPath: 'lineItems[].productId', semantic: 'ProductId' }],
      },
    ],
  }),
]);

describe('planner contracts: optional sub-shape variants (#37)', () => {
  it('emits a variant scenario per sub-shape leaf with warm-up + producer + final', () => {
    const variants = generateOptionalSubShapeVariants(fixtureSubShapeVariant, 'createOrder', {
      maxScenarios: 10,
    });
    expect(variants.scenarios.length).toBeGreaterThan(0);
    const variant = variants.scenarios[0];
    expect(opIdsOf(variant)).toEqual([
      'mintOrderId',
      'createOrder',
      'searchProducts',
      'createOrder',
    ]);
    expect(variant.strategy).toBe('optionalSubShapeVariant');
    expect(variant.populatesSubShape?.rootPath).toBe('lineItems[]');
    expect(variant.populatesSubShape?.leafPaths).toEqual(['lineItems[].productId']);
    expect(variant.populatesSubShape?.leafSemantics).toEqual(['ProductId']);
    expect(variant.hasEventuallyConsistent).toBe(true);
    expect(variant.variantKey).toContain('lineItems[]');
  });

  it('does NOT alter base scenarios for the same endpoint', () => {
    // Base planner is unchanged: the optional sub-shape's leaf semantic
    // (`ProductId`) is opportunistic, so no `searchProducts` step appears.
    const base = plan(fixtureSubShapeVariant, 'createOrder');
    expect(base.scenarios.length).toBeGreaterThan(0);
    for (const s of base.scenarios) {
      expect(opIdsOf(s)).not.toContain('searchProducts');
    }
    expect(opIdsOf(base.scenarios[0])).toEqual(['mintOrderId', 'createOrder']);
  });
});

// ---------------------------------------------------------------------------
// Fixture I: variant planner ignores producers whose only response leaf
// is in a 4xx/5xx response (#51 review)
// ---------------------------------------------------------------------------
//
// Endpoint `placeOrder` produces `OrderInstanceKey` and has an optional
// sub-shape `addons[].productId : ProductId`.
//
// `errorEcho` emits `ProductId` ONLY in a 4xx error envelope (e.g. an
// "invalid product" response that echoes the offending id back). It is
// not a real producer of `ProductId` — a runtime call would never
// satisfy a downstream consumer.
//
// Class-scoped guarantee: `responseProducersByType` must not surface
// any operation whose ProductId leaf comes only from a non-2xx/3xx
// status. The variant planner therefore has no candidate and emits
// zero variants, rather than constructing a chain that goes through
// `errorEcho` and silently produces no actual id at runtime.
const fixtureErrorOnlyProducer: OperationGraph = makeGraph([
  makeOp('errorEcho', {
    optional: ['OrderInstanceKey'],
    responseSemanticLeaves: [
      // 4xx-only — must be filtered out of the inclusive index.
      { semantic: 'ProductId', fieldPath: 'errors[].productId', status: '400', provider: false },
    ],
  }),
  makeOp('placeOrder', {
    produces: ['OrderInstanceKey'],
    providerMap: { OrderInstanceKey: true },
    optionalSubShapes: [
      {
        rootPath: 'addons[]',
        leaves: [{ fieldPath: 'addons[].productId', semantic: 'ProductId' }],
      },
    ],
  }),
]);

describe('planner contracts: variant planner respects success-status producer filter (#51 review)', () => {
  it('does not surface 4xx-only response leaves in responseProducersByType', () => {
    expect(fixtureErrorOnlyProducer.responseProducersByType?.ProductId).toBeUndefined();
  });

  it('emits zero variants when the only candidate producer surfaces the leaf in a 4xx response', () => {
    const variants = generateOptionalSubShapeVariants(fixtureErrorOnlyProducer, 'placeOrder', {
      maxScenarios: 10,
    });
    expect(variants.scenarios).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fixture J: variant planner caps emission at opts.maxScenarios (#51 review)
// ---------------------------------------------------------------------------
//
// Endpoint `bulkCreate` has THREE semantic-typed optional leaves under
// the same sub-shape. Without the cap, the planner emits one variant
// per leaf (3 variants). With `maxScenarios: 2`, only the first 2 are
// emitted.
//
// Class-scoped guarantee: a future endpoint with N semantic-typed
// optional leaves cannot produce more than `opts.maxScenarios` variant
// scenario files.
const fixtureMaxVariantsCap: OperationGraph = makeGraph([
  makeOp('mintFoo', {
    produces: ['Foo'],
    providerMap: { Foo: true },
  }),
  makeOp('searchA', {
    optional: ['BulkOutKey'],
    produces: ['SemA'],
    providerMap: { SemA: true },
  }),
  makeOp('searchB', {
    optional: ['BulkOutKey'],
    produces: ['SemB'],
    providerMap: { SemB: true },
  }),
  makeOp('searchC', {
    optional: ['BulkOutKey'],
    produces: ['SemC'],
    providerMap: { SemC: true },
  }),
  makeOp('bulkCreate', {
    required: ['Foo'],
    produces: ['BulkOutKey'],
    providerMap: { BulkOutKey: true },
    optionalSubShapes: [
      {
        rootPath: 'items[]',
        leaves: [
          { fieldPath: 'items[].a', semantic: 'SemA' },
          { fieldPath: 'items[].b', semantic: 'SemB' },
          { fieldPath: 'items[].c', semantic: 'SemC' },
        ],
      },
    ],
  }),
]);

describe('planner contracts: variant emission respects maxScenarios cap (#51 review)', () => {
  it('uncapped (maxScenarios = 10) emits one variant per semantic leaf', () => {
    const variants = generateOptionalSubShapeVariants(fixtureMaxVariantsCap, 'bulkCreate', {
      maxScenarios: 10,
    });
    expect(variants.scenarios.length).toBe(3);
  });

  it('caps emission at maxScenarios = 2', () => {
    const variants = generateOptionalSubShapeVariants(fixtureMaxVariantsCap, 'bulkCreate', {
      maxScenarios: 2,
    });
    expect(variants.scenarios.length).toBe(2);
  });

  it('caps emission at maxScenarios = 0 (emit nothing)', () => {
    const variants = generateOptionalSubShapeVariants(fixtureMaxVariantsCap, 'bulkCreate', {
      maxScenarios: 0,
    });
    expect(variants.scenarios).toEqual([]);
  });
});
