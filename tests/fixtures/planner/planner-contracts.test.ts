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
  requestBodySemantics?: OperationNode['requestBodySemantics'];
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
    requestBodySemantics: opts.requestBodySemantics,
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
  return generateScenariosForEndpoint(graph, endpointOpId, { maxChainAlternatives: 10 });
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
      maxVariantsPerEndpoint: 10,
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
// is in a 4xx/5xx response (#37)
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

describe('planner contracts: variant planner respects success-status producer filter (#37)', () => {
  it('does not surface 4xx-only response leaves in responseProducersByType', () => {
    expect(fixtureErrorOnlyProducer.responseProducersByType?.ProductId).toBeUndefined();
  });

  it('falls back to a bare-endpoint variant when the only candidate producer surfaces the leaf in a 4xx response (#162 PR 4)', () => {
    // Pre-#162-PR-4 this case emitted ZERO variants. The PR-4 cut moves
    // ALL populated-optional coverage into the variant suite, so when
    // the producer-chain path cannot satisfy the leaf the planner falls
    // back to a bare-endpoint scenario with a synthetic placeholder
    // (see `resolveFallbackValue` in scenarioGenerator.ts). The
    // 4xx-only producer must NOT appear in the chain — the variant has
    // exactly one operation (the endpoint itself).
    const variants = generateOptionalSubShapeVariants(fixtureErrorOnlyProducer, 'placeOrder', {
      maxVariantsPerEndpoint: 10,
    });
    expect(variants.scenarios).toHaveLength(1);
    const [scenario] = variants.scenarios;
    expect(scenario.strategy).toBe('optionalSubShapeVariant');
    expect(scenario.variantKey).toBe('addons[]::addons[].productId::ProductId');
    expect(scenario.operations.map((o) => o.operationId)).toEqual(['placeOrder']);
  });
});

// ---------------------------------------------------------------------------
// Fixture J: variant planner caps emission at opts.maxVariantsPerEndpoint (#37)
// ---------------------------------------------------------------------------
//
// Endpoint `bulkCreate` has THREE semantic-typed optional leaves under
// the same sub-shape. Without the cap, the planner emits one variant
// per leaf (3 variants). With `maxVariantsPerEndpoint: 2`, only the first 2
// are emitted.
//
// Class-scoped guarantee: a future endpoint with N semantic-typed
// optional leaves cannot produce more than `opts.maxVariantsPerEndpoint`
// variant scenario files.
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

describe('planner contracts: variant emission respects maxVariantsPerEndpoint cap (#37)', () => {
  it('uncapped (maxVariantsPerEndpoint = 10) emits one variant per semantic leaf', () => {
    const variants = generateOptionalSubShapeVariants(fixtureMaxVariantsCap, 'bulkCreate', {
      maxVariantsPerEndpoint: 10,
    });
    expect(variants.scenarios.length).toBe(3);
  });

  it('caps emission at maxVariantsPerEndpoint = 2', () => {
    const variants = generateOptionalSubShapeVariants(fixtureMaxVariantsCap, 'bulkCreate', {
      maxVariantsPerEndpoint: 2,
    });
    expect(variants.scenarios.length).toBe(2);
  });

  it('caps emission at maxVariantsPerEndpoint = 0 (emit nothing)', () => {
    const variants = generateOptionalSubShapeVariants(fixtureMaxVariantsCap, 'bulkCreate', {
      maxVariantsPerEndpoint: 0,
    });
    expect(variants.scenarios).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fixture K: variant planner falls back to non-overlap producers (#37)
// ---------------------------------------------------------------------------
//
// Endpoint `createOrder` requires `OrderId` (produced authoritatively by
// `mintOrderId`) and produces `OrderInstanceKey`. It has an optional
// sub-shape `addons[].tagId : Tag`.
//
// `mintTag` authoritatively produces `Tag` and requires NOTHING — in
// particular, it does NOT need any of `createOrder`'s outputs. There is
// no overlap between `mintTag.requires` and `createOrder.produces`, so
// no warm-up of `createOrder` is forced.
//
// Class-scoped guarantee: when the only candidate producer of an optional
// leaf semantic is independent of the endpoint's outputs (no overlap),
// the variant planner must still emit a positive variant — a simple
// `producer → endpoint` chain with no warm-up. Without the fallback,
// independent-producer leaves receive zero variant coverage and the only
// way to populate them is via base scenarios (which by design never do —
// the leaves are opportunistic).
const fixtureNonOverlapVariant: OperationGraph = makeGraph([
  makeOp('mintOrderId', {
    produces: ['OrderId'],
    providerMap: { OrderId: true },
  }),
  makeOp('mintTag', {
    produces: ['Tag'],
    providerMap: { Tag: true },
  }),
  makeOp('createOrder', {
    required: ['OrderId'],
    produces: ['OrderInstanceKey'],
    providerMap: { OrderInstanceKey: true },
    optionalSubShapes: [
      {
        rootPath: 'addons[]',
        leaves: [{ fieldPath: 'addons[].tagId', semantic: 'Tag' }],
      },
    ],
  }),
]);

// ---------------------------------------------------------------------------
// Fixture L: producerBound semantics must not receive synthetic literals
// ---------------------------------------------------------------------------
//
// When `createDeployment` is selected as an authoritative producer for
// `ProcessDefinitionKey`, the planner used to assign a synthetic literal
// (`processDefinitionKey_<suffix>`) to `bindingsDraft.processDefinitionKeyVar`
// via the Key heuristic and `ensureArtifactBindings`. This caused the emitter
// to emit `ctx.processDefinitionKeyVar = 'processDefinitionKey_dadq'` on the
// line *before* the deployment call that actually establishes the value —
// the synthetic pre-seed was immediately overwritten at runtime.
//
// Class-scoped rule: any semantic that has an authoritative producer in
// `graph.producersByType` is `producerBound` — its value is server-established
// at runtime via the producer's response. Its binding must be `'__PENDING__'`
// in the planned scenario, never a synthetic literal. `__PENDING__` causes
// the emitter to skip the literal assignment; `deploy()` / `extractInto()`
// then populate the binding at runtime with the real server-assigned value.
const fixtureProducerBoundBinding: OperationGraph = makeGraph([
  makeOp('createDeployment', {
    produces: ['ProcessDefinitionKey'],
    providerMap: { ProcessDefinitionKey: true },
  }),
  makeOp('searchAuditLogs', {
    required: ['ProcessDefinitionKey'],
  }),
]);

describe('planner contracts: producerBound semantics must be __PENDING__ in bindings', () => {
  it('ProcessDefinitionKey binding is __PENDING__ when createDeployment is the authoritative producer', () => {
    // Reproducer: prior to the fix the planner emitted
    // `processDefinitionKeyVar: 'processDefinitionKey_<suffix>'`.
    // The emitter then output a redundant literal assignment that was
    // overwritten by the deployment helper at runtime.
    const collection = plan(fixtureProducerBoundBinding, 'searchAuditLogs');
    expect(collection.scenarios.length).toBeGreaterThan(0);
    const scenario = collection.scenarios[0];
    expect(scenario.bindings?.processDefinitionKeyVar).toBe('__PENDING__');
  });

  it('class-scoped: no scenario for any endpoint has a synthetic literal for a producerBound Key semantic', () => {
    // Any semantic ending in 'Key' that has an authoritative producer must
    // have ALL its vars (including suffixed allocations like processDefinitionKeyVar2)
    // set to __PENDING__, not a synthetic `<sem>_<suffix>`.
    // The pattern ^<base>Var\d*$ catches the primary slot and any overflow
    // slots that semanticToVarName allocates when the primary is already taken.
    const graph = fixtureProducerBoundBinding;
    const authoritative = Object.keys(graph.producersByType).filter(
      (s) => s.endsWith('Key') && (graph.producersByType[s]?.length ?? 0) > 0,
    );
    const collection = plan(graph, 'searchAuditLogs');
    for (const scenario of collection.scenarios) {
      for (const sem of authoritative) {
        const baseVarName = `${sem.charAt(0).toLowerCase()}${sem.slice(1)}Var`;
        const pattern = new RegExp(`^${baseVarName}\\d*$`);
        const bindings = scenario.bindings ?? {};
        const matchingKeys = Object.keys(bindings).filter((k) => pattern.test(k));
        // The primary var must exist (the planner must allocate a slot for it)
        expect(
          matchingKeys.length,
          `expected at least one binding matching ${pattern} for producerBound semantic ${sem}`,
        ).toBeGreaterThan(0);
        for (const key of matchingKeys) {
          expect(bindings[key], `${key} should be __PENDING__, not a synthetic literal`).toBe(
            '__PENDING__',
          );
        }
      }
    }
  });
});

describe('planner contracts: variant planner non-overlap producer fallback (#37)', () => {
  it('emits a producer→endpoint variant with no warm-up when the producer needs nothing from the endpoint', () => {
    const variants = generateOptionalSubShapeVariants(fixtureNonOverlapVariant, 'createOrder', {
      maxVariantsPerEndpoint: 10,
    });
    expect(variants.scenarios.length).toBeGreaterThan(0);
    const variant = variants.scenarios[0];
    const ops = opIdsOf(variant);
    // createOrder appears exactly once (no warm-up).
    expect(ops.filter((id) => id === 'createOrder').length).toBe(1);
    // mintTag (the non-overlap producer) is in the chain.
    expect(ops).toContain('mintTag');
    // Final step is the endpoint under test.
    expect(ops[ops.length - 1]).toBe('createOrder');
    expect(variant.strategy).toBe('optionalSubShapeVariant');
    expect(variant.populatesSubShape?.rootPath).toBe('addons[]');
    expect(variant.populatesSubShape?.leafSemantics).toEqual(['Tag']);
  });

  it('does NOT alter base scenarios for the same endpoint', () => {
    const base = plan(fixtureNonOverlapVariant, 'createOrder');
    expect(base.scenarios.length).toBeGreaterThan(0);
    for (const s of base.scenarios) {
      // mintTag is opportunistic — base planning must not pull it in.
      expect(opIdsOf(s)).not.toContain('mintTag');
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture: runtimeEmission semantic triggers produce→discover→bind sub-chain
// (#305 Phase 3 — UserTaskKey pilot)
// ---------------------------------------------------------------------------
//
// A semantic declared `kind: 'runtimeEmission'` must NOT dead-end on the
// missing-producers check. The planner must:
//   1. Satisfy the `emittedBy.predecessor` runtime state via the BFS
//      domain-prereq chain (here: createProcessInstance for
//      ProcessInstanceExists).
//   2. Inject the `discoveredVia.operationId` (here: searchUserTasks)
//      into the chain after the predecessor.
//   3. Treat the discovery op's response field (`extractKey`) as the
//      authoritative binding for the runtimeEmission semantic, so the
//      endpoint-under-test consumes it as a producer-bound var.
//
// Before Phase 3 lands the planner classifies `runtimeEmission`-kinded
// types as `unclassified` (because they have no producers / establishers
// / external-entity entry) and emits `{ id: 'unsatisfied' }` —
// reproducing exactly the `updateUserTask` scenario shape today.

const fixtureRuntimeEmissionUserTaskKey: OperationGraph = (() => {
  const graph = makeGraph([
    makeOp('createDeployment', {
      produces: ['ProcessDefinitionKey'],
      providerMap: { ProcessDefinitionKey: true },
      domainProduces: ['ProcessDefinitionDeployed', 'ModelHasUserTask'],
    }),
    makeOp('createProcessInstance', {
      required: ['ProcessDefinitionKey'],
      produces: ['ProcessInstanceKey'],
      providerMap: { ProcessInstanceKey: true },
      domainRequiresAll: ['ProcessDefinitionDeployed'],
      domainProduces: ['ProcessInstanceExists'],
    }),
    makeOp('searchUserTasks', {
      // The runtimeEmission ABox declares this as the discovery op;
      // the planner injects it from the domain declaration, NOT from
      // producersByType. So we deliberately leave UserTaskKey OUT of
      // searchUserTasks.produces — the test will fail differently
      // (false-positive via producersByType) if the planner relies on
      // the graph index rather than the ABox declaration.
      required: [],
      produces: [],
      // #309 Phase A — the body builder resolves `fromBinding` by
      // looking up which semantic the `filterBy` field carries; the
      // BFS needs that index on the discovery node to stamp a
      // discoveryIntent on the inserted step.
      requestBodySemantics: [
        { semantic: 'ProcessInstanceKey', fieldPath: 'filter.processInstanceKey', required: false },
      ],
    }),
    makeOp('updateUserTask', {
      required: ['UserTaskKey'],
    }),
  ]);
  graph.domain = {
    version: 1,
    semanticTypes: {
      UserTaskKey: {
        kind: 'runtimeEmission',
        emittedBy: {
          predecessor: 'ProcessInstanceExists',
          guardedBy: ['ModelHasUserTask'],
        },
        discoveredVia: {
          operationId: 'searchUserTasks',
          filterBy: 'processInstanceKey',
          extractKey: 'userTaskKey',
          consistency: 'eventual',
        },
      },
    },
    runtimeStates: {
      ProcessDefinitionDeployed: { kind: 'state', producedBy: ['createDeployment'] },
      ProcessInstanceExists: { kind: 'state', producedBy: ['createProcessInstance'] },
    },
    capabilities: {
      ModelHasUserTask: {
        kind: 'capability',
        parameter: 'userTaskElementId',
        producedBy: ['createDeployment'],
        dependsOn: ['ProcessDefinitionDeployed'],
      },
    },
    identifiers: {},
  };
  return graph;
})();

describe('planner contracts: runtimeEmission semantic produces discover-and-bind chain (#305 Phase 3)', () => {
  it('plans deploy → createProcessInstance → searchUserTasks → updateUserTask for an endpoint that consumes a runtimeEmission semantic', () => {
    const collection = plan(fixtureRuntimeEmissionUserTaskKey, 'updateUserTask');
    expect(collection.unsatisfied).not.toBe(true);
    expect(collection.scenarios.length).toBeGreaterThan(0);
    const ops = opIdsOf(collection.scenarios[0]);
    expect(ops).toEqual([
      'createDeployment',
      'createProcessInstance',
      'searchUserTasks',
      'updateUserTask',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Fixture extension: discoveryIntent stamped on the inserted discovery step
// (#309 Phase A — intentional discovery body wrapping)
// ---------------------------------------------------------------------------
//
// Once Phase 3 puts the discovery op in the chain, Phase A must stamp a
// `discoveryIntent` on the OperationRef for that step. The body builder
// reads the intent to emit `{ filter: { [filterBy]: '${fromBinding}' } }`
// instead of the generic top-level scalar shape — without this the
// chain runs but the discovery filter is wrong and the test passes for
// the wrong reason (see #309 issue context).
describe('planner contracts: discoveryIntent stamped on inserted runtimeEmission discovery step (#309 Phase A)', () => {
  it('stamps discoveryIntent on the searchUserTasks OperationRef with filterBy + fromBinding + extractKey + consistency', () => {
    const collection = plan(fixtureRuntimeEmissionUserTaskKey, 'updateUserTask');
    const scenario = collection.scenarios[0];
    const discoveryRef = scenario.operations.find((o) => o.operationId === 'searchUserTasks');
    expect(discoveryRef).toBeDefined();
    expect(discoveryRef?.discoveryIntent).toEqual({
      filterBy: 'processInstanceKey',
      fromSemantic: 'ProcessInstanceKey',
      fromBinding: 'processInstanceKeyVar',
      extractKey: 'userTaskKey',
      extractInto: 'userTaskKeyVar',
      consistency: 'eventual',
    });
  });

  it('does NOT stamp discoveryIntent on the upstream producer or the endpoint-under-test', () => {
    const collection = plan(fixtureRuntimeEmissionUserTaskKey, 'updateUserTask');
    const scenario = collection.scenarios[0];
    for (const op of scenario.operations) {
      if (op.operationId === 'searchUserTasks') continue;
      expect(
        op.discoveryIntent,
        `${op.operationId} must not carry discoveryIntent`,
      ).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture: IncidentKey runtimeEmission produces deploy → instance → search
// → getIncident chain (#305 Phase 5a)
// ---------------------------------------------------------------------------
//
// Mirrors the UserTaskKey pilot fixture but for IncidentKey, gated by the
// new ModelEmitsIncident capability and discovered via searchIncidents.
// The L2 guards that the planner machinery applies generically to any
// runtimeEmission key (not just UserTaskKey) and that #309 Phase A's
// discoveryIntent stamping carries through with the IncidentKey extract
// shape.
const fixtureRuntimeEmissionIncidentKey: OperationGraph = (() => {
  const graph = makeGraph([
    makeOp('createDeployment', {
      produces: ['ProcessDefinitionKey'],
      providerMap: { ProcessDefinitionKey: true },
      domainProduces: ['ProcessDefinitionDeployed', 'ModelEmitsIncident'],
    }),
    makeOp('createProcessInstance', {
      required: ['ProcessDefinitionKey'],
      produces: ['ProcessInstanceKey'],
      providerMap: { ProcessInstanceKey: true },
      domainRequiresAll: ['ProcessDefinitionDeployed'],
      domainProduces: ['ProcessInstanceExists'],
    }),
    makeOp('searchIncidents', {
      required: [],
      produces: [],
      requestBodySemantics: [
        { semantic: 'ProcessInstanceKey', fieldPath: 'filter.processInstanceKey', required: false },
      ],
    }),
    makeOp('getIncident', {
      required: ['IncidentKey'],
    }),
  ]);
  graph.domain = {
    version: 1,
    semanticTypes: {
      IncidentKey: {
        kind: 'runtimeEmission',
        emittedBy: {
          predecessor: 'ProcessInstanceExists',
          guardedBy: ['ModelEmitsIncident'],
        },
        discoveredVia: {
          operationId: 'searchIncidents',
          filterBy: 'processInstanceKey',
          extractKey: 'incidentKey',
          consistency: 'eventual',
        },
      },
    },
    runtimeStates: {
      ProcessDefinitionDeployed: { kind: 'state', producedBy: ['createDeployment'] },
      ProcessInstanceExists: { kind: 'state', producedBy: ['createProcessInstance'] },
    },
    capabilities: {
      ModelEmitsIncident: {
        kind: 'capability',
        parameter: 'incidentEmittingElementId',
        producedBy: ['createDeployment'],
        dependsOn: ['ProcessDefinitionDeployed'],
      },
    },
    identifiers: {},
  };
  return graph;
})();

describe('planner contracts: IncidentKey runtimeEmission discover-and-bind chain (#305 Phase 5a)', () => {
  it('plans deploy → createProcessInstance → searchIncidents → getIncident for an endpoint that consumes IncidentKey', () => {
    const collection = plan(fixtureRuntimeEmissionIncidentKey, 'getIncident');
    expect(collection.unsatisfied).not.toBe(true);
    expect(collection.scenarios.length).toBeGreaterThan(0);
    const ops = opIdsOf(collection.scenarios[0]);
    expect(ops).toEqual([
      'createDeployment',
      'createProcessInstance',
      'searchIncidents',
      'getIncident',
    ]);
  });

  it('stamps discoveryIntent on the searchIncidents OperationRef with IncidentKey extract shape', () => {
    const collection = plan(fixtureRuntimeEmissionIncidentKey, 'getIncident');
    const scenario = collection.scenarios[0];
    const discoveryRef = scenario.operations.find((o) => o.operationId === 'searchIncidents');
    expect(discoveryRef).toBeDefined();
    expect(discoveryRef?.discoveryIntent).toEqual({
      filterBy: 'processInstanceKey',
      fromSemantic: 'ProcessInstanceKey',
      fromBinding: 'processInstanceKeyVar',
      extractKey: 'incidentKey',
      extractInto: 'incidentKeyVar',
      consistency: 'eventual',
    });
  });
});

// ---------------------------------------------------------------------------
// Fixture P: variant planner enumerates polymorphic semantic-type siblings on
// the same field (#324)
// ---------------------------------------------------------------------------
//
// Mirrors the `evaluateExpression.scopeKey` shape exposed by the spec
// bump in #322: a single optional flat top-level field that carries
// MULTIPLE semantic-type annotations (e.g. `ScopeKey`,
// `ProcessInstanceKey`, `ElementInstanceKey`). Pre-fix the planner's
// variant dedup key was `${rootPath}::${fieldPath}` which collapsed all
// polymorphic siblings into the first semantic — emitting one variant
// instead of N.
//
// Class-scoped guarantee: for any optional field with N distinct
// semantic-type annotations, the variant planner emits N variants —
// one per `(rootPath, fieldPath, semantic)` triple — each carrying its
// own `populatesSubShape.leafSemantics` value.
const fixturePolymorphicSemanticSiblings: OperationGraph = makeGraph([
  makeOp('mintScopeKey', {
    produces: ['ScopeKey'],
    providerMap: { ScopeKey: true },
  }),
  makeOp('mintProcessInstanceKey', {
    produces: ['ProcessInstanceKey'],
    providerMap: { ProcessInstanceKey: true },
  }),
  makeOp('mintElementInstanceKey', {
    produces: ['ElementInstanceKey'],
    providerMap: { ElementInstanceKey: true },
  }),
  makeOp('evaluateExpression', {
    optionalSubShapes: [
      {
        rootPath: '',
        leaves: [
          { fieldPath: 'scopeKey', semantic: 'ScopeKey' },
          { fieldPath: 'scopeKey', semantic: 'ProcessInstanceKey' },
          { fieldPath: 'scopeKey', semantic: 'ElementInstanceKey' },
        ],
      },
    ],
  }),
]);

describe('planner contracts: variant planner enumerates polymorphic semantic-type siblings (#324)', () => {
  it('emits one variant per (fieldPath, semantic) for a flat optional with three semantic-type annotations', () => {
    const variants = generateOptionalSubShapeVariants(
      fixturePolymorphicSemanticSiblings,
      'evaluateExpression',
      { maxVariantsPerEndpoint: 10 },
    );
    // Class-scoped: three distinct semantic-type annotations on the
    // same field => three variant scenarios. Pre-#324 only the first
    // (ScopeKey) was emitted because the dedup key ignored semantic.
    const triples = variants.scenarios.map((s) => ({
      variantKey: s.variantKey,
      leafSemantics: s.populatesSubShape?.leafSemantics,
    }));
    expect(triples).toEqual([
      { variantKey: '::scopeKey::ScopeKey', leafSemantics: ['ScopeKey'] },
      { variantKey: '::scopeKey::ProcessInstanceKey', leafSemantics: ['ProcessInstanceKey'] },
      { variantKey: '::scopeKey::ElementInstanceKey', leafSemantics: ['ElementInstanceKey'] },
    ]);
  });

  it('still dedupes true duplicates: the same (fieldPath, semantic) pair appearing twice emits one variant', () => {
    // Construct a fixture where the extractor emitted the same
    // (fieldPath, semantic) pair twice in `requestBodySemanticTypes`
    // (a legitimate occurrence — e.g. a field referenced from two
    // oneOf branches that both annotate the same semantic). Pre- and
    // post-#324 must both dedupe these.
    const fixtureDuplicate: OperationGraph = makeGraph([
      makeOp('mintScopeKey', {
        produces: ['ScopeKey'],
        providerMap: { ScopeKey: true },
      }),
      makeOp('evaluateExpression', {
        optionalSubShapes: [
          {
            rootPath: '',
            leaves: [
              { fieldPath: 'scopeKey', semantic: 'ScopeKey' },
              { fieldPath: 'scopeKey', semantic: 'ScopeKey' },
            ],
          },
        ],
      }),
    ]);
    const variants = generateOptionalSubShapeVariants(fixtureDuplicate, 'evaluateExpression', {
      maxVariantsPerEndpoint: 10,
    });
    expect(variants.scenarios.length).toBe(1);
    expect(variants.scenarios[0].variantKey).toBe('::scopeKey::ScopeKey');
  });
});
