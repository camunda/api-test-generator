import { describe, expect, it } from 'vitest';
import {
  bindSemanticInput,
  classifySemantic,
} from '../../../path-analyser/src/bindSemanticInput.ts';
import {
  bindClientMintedAttribute,
  bindModelDerivedFromFixture,
} from '../../../path-analyser/src/index.ts';
import type {
  DomainSemantics,
  EndpointScenario,
  OperationGraph,
  OperationNode,
  RequestStep,
} from '../../../path-analyser/src/types.ts';

/**
 * Classification-dispatch fixtures — Layer 2 of the layered test
 * strategy, for issue #162 PR 3 (unified `bindSemanticInput` chokepoint).
 *
 * Today the 5 value-source classifications described in #162 are
 * dispatched by separate code paths:
 *
 *   1. producer-bound          → BFS in scenarioGenerator.ts
 *   2. client-minted identifier → BFS via `establishersByType`
 *   3. client-minted attribute  → bindClientMintedAttribute (#162 PR 2)
 *   4. external boundary        → BFS via `externalEntityIdentifiers`
 *   5. model-derived            → bindModelDerivedFromFixture (#162 PR 1)
 *
 * PR 3 will route all five through a single `bindSemanticInput` helper
 * with NO behaviour change. This file is the green/green guard step
 * (per AGENTS.md "Coverage analysis before a behaviour-preserving
 * refactor") — synthetic-graph-driven assertions on the dispatch output
 * that pass against current `main` and must continue passing after the
 * refactor.
 *
 * Coverage map for the five classifications:
 *
 *   1. producer-bound          → planner-contracts.test.ts (fixtures
 *                                A, F, G, H) covers chain-shape selection;
 *                                see also planner-establishes.test.ts
 *                                for binding-name discipline.
 *   2. client-minted identifier → planner-establishes.test.ts (fixtures
 *                                for `x-semantic-establishes`).
 *   3. client-minted attribute  → THIS FILE.
 *   4. external boundary        → planner-establishes.test.ts (ClientId
 *                                fixture asserting `externalEntitySites`
 *                                tagging).
 *   5. model-derived            → THIS FILE.
 *
 * (3) and (5) had no L2 guard before this file because their helpers
 * live in index.ts post-BFS, outside the scenarioGenerator entry point
 * the rest of the planner suite calls. Exposing them and pinning their
 * observable behaviour with synthetic inputs lets the PR 3 refactor land
 * with a single, readable diff at the chokepoint instead of having to
 * read the L3 bundled-spec invariants to know what each helper did.
 */

interface NodeOpts {
  required?: string[];
  optional?: string[];
  produces?: string[];
  optionalSubShapes?: OperationNode['optionalSubShapes'];
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
    optionalSubShapes: opts.optionalSubShapes,
    requestBodySemantics: opts.requestBodySemantics,
  };
}

function makeGraph(opts: {
  operations: OperationNode[];
  domain?: DomainSemantics;
}): OperationGraph {
  const operations: Record<string, OperationNode> = {};
  for (const node of opts.operations) operations[node.operationId] = node;
  return {
    operations,
    producersByType: {},
    domain: opts.domain,
  };
}

function makeDeployStep(fixturePath: string): RequestStep {
  return {
    operationId: 'createDeployment',
    method: 'POST',
    pathTemplate: '/deployments',
    bodyKind: 'multipart',
    multipartTemplate: {
      files: { resources: `@@FILE:${fixturePath}` },
    },
    expect: { status: 200 },
  };
}

function makeEndpointStep(operationId: string): RequestStep {
  return {
    operationId,
    method: 'POST',
    pathTemplate: `/${operationId}`,
    expect: { status: 200 },
  };
}

function makeFeatureScenario(overrides: Partial<EndpointScenario> = {}): EndpointScenario {
  return {
    id: 'feature-1',
    operations: [],
    producedSemanticTypes: [],
    satisfiedSemanticTypes: [],
    strategy: 'featureCoverage',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Classification 5 — model-derived (bindModelDerivedFromFixture, #162 PR 1)
// ---------------------------------------------------------------------------
//
// The helper binds a semantic value out-of-band from a deployment
// artifact's `providesValues` map when:
//
//   - scenario.strategy === 'featureCoverage'
//   - domain.semanticTypes[<sem>].kind === 'modelDerived'
//   - the endpoint declares an optional sub-shape whose leaf semantic
//     is <sem>
//   - the chain includes a createDeployment step whose multipart
//     template references a registry entry with providesValues[<sem>]
//
// These tests use `bpmn/service-task.bpmn`, which is a real entry in
// path-analyser/fixtures/deployment-artifacts.json (now
// configs/<config>/fixtures/deployment-artifacts.json) with both ElementId
// and JobType providesValues. The registry contents are themselves
// guarded by the L3 invariants in regression-invariants.test.ts; this
// L2 layer locks in the dispatch behaviour given a known-good registry.

const modelDerivedDomain: DomainSemantics = {
  version: 1,
  semanticTypes: {
    ElementId: { kind: 'modelDerived' },
  },
  operationArtifactRules: {
    createDeployment: { role: 'deploymentGateway' },
  },
};

const endpointWithElementIdSubShape: OperationNode = makeOp('createProcessInstance', {
  required: ['ProcessDefinitionKey'],
  optionalSubShapes: [
    {
      rootPath: 'startInstructions[]',
      leaves: [{ fieldPath: 'startInstructions[].elementId', semantic: 'ElementId' }],
    },
  ],
});

describe('classification 5: model-derived dispatch (#162 PR 1)', () => {
  it('binds <sem>Var from fixture.providesValues[0] when leaf is modelDerived', () => {
    const scenario = makeFeatureScenario();
    const steps: RequestStep[] = [
      makeDeployStep('bpmn/service-task.bpmn'),
      makeEndpointStep('createProcessInstance'),
    ];
    const graph = makeGraph({
      operations: [endpointWithElementIdSubShape],
      domain: modelDerivedDomain,
    });

    bindModelDerivedFromFixture(scenario, steps, graph);

    // service-task.bpmn declares providesValues.ElementId =
    // ['StartEvent_1', 'Activity_06kuv4r', 'Event_0tll3bk']. The helper
    // takes the first entry unconditionally.
    expect(scenario.bindings?.elementIdVar).toBe('StartEvent_1');
    expect(scenario.populatesSubShape?.rootPath).toBe('startInstructions[]');
    expect(scenario.populatesSubShape?.leafPaths).toEqual(['startInstructions[].elementId']);
    expect(scenario.populatesSubShape?.leafSemantics).toEqual(['ElementId']);
  });

  it('is a no-op for non-featureCoverage scenarios (variant suite untouched)', () => {
    // Locks in the suite-scoping contract that #162 PR 4 will lift; PR 3
    // must preserve it.
    const scenario = makeFeatureScenario({ strategy: 'optionalSubShapeVariant' });
    const steps: RequestStep[] = [
      makeDeployStep('bpmn/service-task.bpmn'),
      makeEndpointStep('createProcessInstance'),
    ];
    const graph = makeGraph({
      operations: [endpointWithElementIdSubShape],
      domain: modelDerivedDomain,
    });

    bindModelDerivedFromFixture(scenario, steps, graph);

    expect(scenario.bindings).toBeUndefined();
    expect(scenario.populatesSubShape).toBeUndefined();
  });

  it('is a no-op when the chain has no createDeployment step', () => {
    const scenario = makeFeatureScenario();
    const steps: RequestStep[] = [makeEndpointStep('createProcessInstance')];
    const graph = makeGraph({
      operations: [endpointWithElementIdSubShape],
      domain: modelDerivedDomain,
    });

    bindModelDerivedFromFixture(scenario, steps, graph);

    expect(scenario.bindings).toBeUndefined();
  });

  it('is a no-op when the deployment fixture has no providesValues for the semantic', () => {
    const scenario = makeFeatureScenario();
    const steps: RequestStep[] = [
      // forms/simple.form is a real registry entry with no providesValues
      makeDeployStep('forms/simple.form'),
      makeEndpointStep('createProcessInstance'),
    ];
    const graph = makeGraph({
      operations: [endpointWithElementIdSubShape],
      domain: modelDerivedDomain,
    });

    bindModelDerivedFromFixture(scenario, steps, graph);

    expect(scenario.bindings).toBeUndefined();
  });

  it('is a no-op when the deploy step references an unknown registry path', () => {
    const scenario = makeFeatureScenario();
    const steps: RequestStep[] = [
      makeDeployStep('bpmn/does-not-exist.bpmn'),
      makeEndpointStep('createProcessInstance'),
    ];
    const graph = makeGraph({
      operations: [endpointWithElementIdSubShape],
      domain: modelDerivedDomain,
    });

    bindModelDerivedFromFixture(scenario, steps, graph);

    expect(scenario.bindings).toBeUndefined();
  });

  it('overrides any pre-existing synthetic binding (authoritative)', () => {
    // The featureCoverageGenerator may have stamped a synthetic
    // `fc:pos:elementId:...` placeholder before this helper runs.
    // The modelDerived value wins.
    const scenario = makeFeatureScenario({
      bindings: { elementIdVar: 'fc:pos:elementId:SYNTHETIC' },
    });
    const steps: RequestStep[] = [
      makeDeployStep('bpmn/service-task.bpmn'),
      makeEndpointStep('createProcessInstance'),
    ];
    const graph = makeGraph({
      operations: [endpointWithElementIdSubShape],
      domain: modelDerivedDomain,
    });

    bindModelDerivedFromFixture(scenario, steps, graph);

    expect(scenario.bindings?.elementIdVar).toBe('StartEvent_1');
  });

  it('is a no-op when domain.semanticTypes does not declare the leaf as modelDerived', () => {
    // Class-scoped: leaves declared with other `kind` values (e.g.
    // 'attribute') OR with no kind at all must not be touched. The
    // helper is exclusive to classification 5.
    const scenario = makeFeatureScenario();
    const steps: RequestStep[] = [
      makeDeployStep('bpmn/service-task.bpmn'),
      makeEndpointStep('createProcessInstance'),
    ];
    const graph = makeGraph({
      operations: [endpointWithElementIdSubShape],
      // No kind on ElementId — falls back to producer/establisher chain.
      domain: { version: 1, semanticTypes: { ElementId: {} } },
    });

    bindModelDerivedFromFixture(scenario, steps, graph);

    expect(scenario.bindings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Classification 3 — client-minted attribute (bindClientMintedAttribute,
// #162 PR 2)
// ---------------------------------------------------------------------------
//
// The helper mints a deterministic `fc:cma:<sem>:<suffix>` value and
// stamps a populatesSubShape entry when:
//
//   - scenario.strategy === 'featureCoverage'
//   - domain.semanticTypes[<sem>].kind === 'attribute'
//     && clientMinted === true
//   - the endpoint declares the semantic in requestBodySemantics with a
//     setter-site path (NOT starting with `filter.` / `filter[`)
//
// Setter-site is a pragmatic PR 2 narrowing — filter consumers are
// deferred to #168. PR 3 must preserve that narrowing.

const attributeDomain: DomainSemantics = {
  version: 1,
  semanticTypes: {
    Tag: { kind: 'attribute', clientMinted: true },
  },
};

const setterEndpoint: OperationNode = makeOp('createProcessInstance', {
  requestBodySemantics: [{ semantic: 'Tag', fieldPath: 'tags[]', required: false }],
});

const filterConsumerEndpoint: OperationNode = makeOp('searchProcessInstances', {
  requestBodySemantics: [{ semantic: 'Tag', fieldPath: 'filter.tags[]', required: false }],
});

describe('classification 3: client-minted attribute dispatch (#162 PR 2)', () => {
  it('mints fc:cma:<sem>:<suffix> and populates the sub-shape at a setter site', () => {
    const scenario = makeFeatureScenario();
    const steps: RequestStep[] = [makeEndpointStep('createProcessInstance')];
    const graph = makeGraph({
      operations: [setterEndpoint],
      domain: attributeDomain,
    });

    bindClientMintedAttribute(scenario, steps, graph);

    const tagVar = scenario.bindings?.tagVar;
    expect(tagVar, 'tagVar must be minted').toBeDefined();
    // The prefix is the load-bearing classification marker. The suffix
    // is a deterministicSuffix() of (opId, semantic) — content tested
    // by the L3 invariants; here we only assert the contract shape.
    expect(tagVar).toMatch(/^fc:cma:tag:/);
    expect(scenario.populatesSubShape?.leafPaths).toEqual(['tags[]']);
    expect(scenario.populatesSubShape?.leafSemantics).toEqual(['Tag']);
  });

  it('is deterministic across runs for the same (opId, semantic)', () => {
    // The minted value uses deterministicSuffix to keep snapshot output
    // byte-stable. Two calls with identical inputs must produce
    // identical bindings.
    const sa = makeFeatureScenario();
    const sb = makeFeatureScenario();
    const steps: RequestStep[] = [makeEndpointStep('createProcessInstance')];
    const graph = makeGraph({
      operations: [setterEndpoint],
      domain: attributeDomain,
    });

    bindClientMintedAttribute(sa, steps, graph);
    bindClientMintedAttribute(sb, steps, graph);

    expect(sa.bindings?.tagVar).toBe(sb.bindings?.tagVar);
  });

  it('is a no-op at filter-consumer sites (setter-only scope of PR 2)', () => {
    // Class-scoped: every fieldPath beginning with `filter.` or
    // `filter[` must be skipped. PR 3 must preserve this narrowing
    // because #168's setter-chain-reuse pass has not landed.
    const scenario = makeFeatureScenario();
    const steps: RequestStep[] = [makeEndpointStep('searchProcessInstances')];
    const graph = makeGraph({
      operations: [filterConsumerEndpoint],
      domain: attributeDomain,
    });

    bindClientMintedAttribute(scenario, steps, graph);

    expect(scenario.bindings).toBeUndefined();
    expect(scenario.populatesSubShape).toBeUndefined();
  });

  it('is a no-op for non-featureCoverage scenarios (variant suite untouched)', () => {
    const scenario = makeFeatureScenario({ strategy: 'optionalSubShapeVariant' });
    const steps: RequestStep[] = [makeEndpointStep('createProcessInstance')];
    const graph = makeGraph({
      operations: [setterEndpoint],
      domain: attributeDomain,
    });

    bindClientMintedAttribute(scenario, steps, graph);

    expect(scenario.bindings).toBeUndefined();
  });

  it('is a no-op when kind:attribute but clientMinted is not true', () => {
    // Class-scoped: `kind: 'attribute'` is necessary but not sufficient
    // — clientMinted must be explicitly true. A future server-derived
    // attribute type must not get minted.
    const scenario = makeFeatureScenario();
    const steps: RequestStep[] = [makeEndpointStep('createProcessInstance')];
    const graph = makeGraph({
      operations: [setterEndpoint],
      domain: {
        version: 1,
        semanticTypes: { Tag: { kind: 'attribute' } },
      },
    });

    bindClientMintedAttribute(scenario, steps, graph);

    expect(scenario.bindings).toBeUndefined();
  });

  it('is a no-op when the endpoint has no requestBodySemantics for the type', () => {
    const scenario = makeFeatureScenario();
    const steps: RequestStep[] = [makeEndpointStep('createProcessInstance')];
    const graph = makeGraph({
      // setter endpoint with NO requestBodySemantics array.
      operations: [makeOp('createProcessInstance')],
      domain: attributeDomain,
    });

    bindClientMintedAttribute(scenario, steps, graph);

    expect(scenario.bindings).toBeUndefined();
  });

  it('is a no-op when domain.semanticTypes is undefined', () => {
    const scenario = makeFeatureScenario();
    const steps: RequestStep[] = [makeEndpointStep('createProcessInstance')];
    const graph = makeGraph({
      operations: [setterEndpoint],
      domain: { version: 1 },
    });

    bindClientMintedAttribute(scenario, steps, graph);

    expect(scenario.bindings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// classifySemantic precedence (#162 PR 3)
// ---------------------------------------------------------------------------
//
// The unified chokepoint resolves a semantic to ONE classification using
// a documented precedence: explicit `domain.semanticTypes[T].kind`
// declarations win over graph-index inferences. This block locks the
// precedence in directly so PR 5 (load-time diagnostic on `unclassified`)
// can build on a contract instead of an accident of code order.
//
// Today the bundled spec has no real collisions — every modelDerived /
// clientMintedAttribute semantic is also absent from the producer /
// establisher / external-entity indices. These synthetic tests assert
// the precedence anyway, because the contract matters even if it is
// today unobservable.

describe('classifySemantic precedence (#162 PR 3)', () => {
  function graphWithProducer(semantic: string): OperationGraph {
    return {
      operations: {},
      producersByType: { [semantic]: ['someOp'] },
    };
  }

  it('modelDerived declaration wins over a producersByType entry', () => {
    const graph: OperationGraph = {
      ...graphWithProducer('ElementId'),
      domain: {
        version: 1,
        semanticTypes: { ElementId: { kind: 'modelDerived' } },
      },
    };

    expect(classifySemantic('ElementId', graph)).toBe('modelDerived');
  });

  it('clientMintedAttribute declaration wins over a producersByType entry', () => {
    const graph: OperationGraph = {
      ...graphWithProducer('Tag'),
      domain: {
        version: 1,
        semanticTypes: { Tag: { kind: 'attribute', clientMinted: true } },
      },
    };

    expect(classifySemantic('Tag', graph)).toBe('clientMintedAttribute');
  });

  it('producerBound wins over clientMintedIdentifier when no domain.kind applies', () => {
    const graph: OperationGraph = {
      operations: {},
      producersByType: { ProcessInstanceKey: ['createProcessInstance'] },
      establishersByType: { ProcessInstanceKey: ['someOp'] },
    };

    expect(classifySemantic('ProcessInstanceKey', graph)).toBe('producerBound');
  });

  it('clientMintedIdentifier wins over externalBoundary when no producer applies', () => {
    const graph: OperationGraph = {
      operations: {},
      producersByType: {},
      establishersByType: { TenantId: ['createTenant'] },
      externalEntityIdentifiers: new Set(['TenantId']),
    };

    expect(classifySemantic('TenantId', graph)).toBe('clientMintedIdentifier');
  });

  it('externalBoundary applies when only the external-entities set matches', () => {
    const graph: OperationGraph = {
      operations: {},
      producersByType: {},
      externalEntityIdentifiers: new Set(['ClientId']),
    };

    expect(classifySemantic('ClientId', graph)).toBe('externalBoundary');
  });

  it('returns unclassified when no declaration and no index entry matches', () => {
    const graph: OperationGraph = {
      operations: {},
      producersByType: {},
    };

    expect(classifySemantic('UnknownSemantic', graph)).toBe('unclassified');
  });

  it('attribute declaration without clientMinted does NOT short-circuit producerBound', () => {
    // A declaration of `kind: 'attribute'` without `clientMinted: true`
    // must NOT be treated as clientMintedAttribute — only the explicit
    // `clientMinted === true` flag promotes the semantic into PR 2's
    // chokepoint scope.
    const graph: OperationGraph = {
      ...graphWithProducer('SomeAttr'),
      domain: {
        version: 1,
        semanticTypes: { SomeAttr: { kind: 'attribute' } },
      },
    };

    expect(classifySemantic('SomeAttr', graph)).toBe('producerBound');
  });
});

// ---------------------------------------------------------------------------
// bindSemanticInput modelDerived value-resolution contract (#162 PR 3)
// ---------------------------------------------------------------------------
//
// Reviewer note on PR 179 (copilot-pull-request-reviewer): the chokepoint
// must NOT collapse "modelDerived semantic with missing fixture data" to
// `unclassified`, because PR 5 needs to tell the two cases apart in
// load-time diagnostics. The classification is a property of the
// semantic + graph; the value is a separate question of whether the
// active fixture happens to provide it.

describe('bindSemanticInput modelDerived value-resolution (#162 PR 3)', () => {
  const modelDerivedGraph: OperationGraph = {
    operations: {},
    producersByType: {},
    domain: {
      version: 1,
      semanticTypes: { ElementId: { kind: 'modelDerived' } },
    },
  };

  it('returns modelDerived with the fixture value when providesValues is populated', () => {
    const fixture = {
      kind: 'bpmnProcess',
      path: 'bpmn/service-task.bpmn',
      providesValues: { ElementId: ['service_task_1', 'service_task_2'] },
    };

    const result = bindSemanticInput({
      semantic: 'ElementId',
      operationId: 'createProcessInstance',
      graph: modelDerivedGraph,
      fixture,
    });

    expect(result).toEqual({
      classification: 'modelDerived',
      varName: 'elementIdVar',
      value: 'service_task_1',
    });
  });

  it('returns modelDerived (NOT unclassified) when the fixture lacks providesValues', () => {
    // Defect-class guard for the reviewer note: stable classification
    // even when the value can't be resolved. PR 5 will use this to
    // distinguish "semantic not declared anywhere" from "semantic
    // declared modelDerived but the selected fixture is the wrong file".
    const fixture = {
      kind: 'form',
      path: 'forms/simple.form',
    };

    const result = bindSemanticInput({
      semantic: 'ElementId',
      operationId: 'createProcessInstance',
      graph: modelDerivedGraph,
      fixture,
    });

    expect(result.classification).toBe('modelDerived');
    if (result.classification === 'modelDerived') {
      expect(result.varName).toBe('elementIdVar');
      expect(result.value).toBeUndefined();
    }
  });

  it('returns modelDerived with no value when no fixture is supplied at all', () => {
    const result = bindSemanticInput({
      semantic: 'ElementId',
      operationId: 'createProcessInstance',
      graph: modelDerivedGraph,
      // fixture intentionally omitted
    });

    expect(result.classification).toBe('modelDerived');
    if (result.classification === 'modelDerived') {
      expect(result.value).toBeUndefined();
    }
  });

  it('returns modelDerived with no value when providesValues[<sem>] is an empty array', () => {
    const fixture = {
      kind: 'bpmnProcess',
      path: 'bpmn/service-task.bpmn',
      providesValues: { ElementId: [] },
    };

    const result = bindSemanticInput({
      semantic: 'ElementId',
      operationId: 'createProcessInstance',
      graph: modelDerivedGraph,
      fixture,
    });

    expect(result.classification).toBe('modelDerived');
    if (result.classification === 'modelDerived') {
      expect(result.value).toBeUndefined();
    }
  });

  it('still returns unclassified when the semantic is neither declared nor indexed', () => {
    const result = bindSemanticInput({
      semantic: 'UnknownSemantic',
      operationId: 'createProcessInstance',
      graph: { operations: {}, producersByType: {} },
    });

    expect(result.classification).toBe('unclassified');
  });
});
