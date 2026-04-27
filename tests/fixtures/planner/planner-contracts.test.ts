import { describe, expect, it } from 'vitest';
import { generateScenariosForEndpoint } from '../../../path-analyser/src/scenarioGenerator.ts';
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
  };
}

function makeGraph(nodes: OperationNode[]): OperationGraph {
  const operations: Record<string, OperationNode> = {};
  const bySemanticProducer: Record<string, string[]> = {};
  for (const node of nodes) {
    operations[node.operationId] = node;
    for (const sem of node.produces) {
      const list = bySemanticProducer[sem] ?? [];
      list.push(node.operationId);
      bySemanticProducer[sem] = list;
    }
  }
  return { operations, bySemanticProducer };
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
// `createDeployment` is annotated provider:true. The planner must pick
// the authoritative producer; the incidental search-style operation
// should not appear in the resulting chain.
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
