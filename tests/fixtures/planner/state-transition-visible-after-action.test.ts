import { describe, expect, it } from 'vitest';
import { instantiateAllTemplates } from '../../../path-analyser/src/scenarioTemplateInstantiator.ts';
import type {
  EndpointScenario,
  OperationGraph,
  OperationNode,
  RequestStep,
} from '../../../path-analyser/src/types.ts';

/**
 * #305 Phase 5d / #189 — Layer-2 fixtures for the
 * `StateTransitionVisibleAfterAction` compiler. Each `it` is one chain
 * statement about how a `runtime-entity` ABox row + transition op +
 * fetcher canonical pair flows through `instantiateAllTemplates`.
 *
 * The fixture hand-builds a minimal `OperationGraph` (transition op +
 * fetcher) and a minimal canonical map (one EndpointScenario per op),
 * then asserts on the emitted TemplateScenario's step list and
 * stateEquals assertion shape.
 */

function makeOp(operationId: string, opts: Partial<OperationNode>): OperationNode {
  return {
    operationId,
    method: 'POST',
    path: `/${operationId}`,
    requires: { required: [], optional: [] },
    produces: [],
    ...opts,
  };
}

function makeStep(operationId: string, opts: Partial<RequestStep>): RequestStep {
  return {
    operationId,
    method: 'POST',
    pathTemplate: `/${operationId}`,
    expect: { status: 200 },
    ...opts,
  };
}

function makeScenario(operationId: string, plan: RequestStep[]): EndpointScenario {
  return {
    id: `s:${operationId}`,
    operations: plan.map((s) => ({
      operationId: s.operationId,
      method: s.method,
      path: s.pathTemplate,
    })),
    producedSemanticTypes: [],
    satisfiedSemanticTypes: [],
    requestPlan: plan,
    bindings: {},
    seedBindings: [],
  };
}

describe('StateTransitionVisibleAfterAction compiler — Layer 2 contract', () => {
  const graph: OperationGraph = {
    operations: {
      resolveThing: makeOp('resolveThing', {
        method: 'POST',
        path: '/things/{thingKey}/resolution',
        requires: { required: ['ThingKey'], optional: [] },
      }),
      getThing: makeOp('getThing', {
        method: 'GET',
        path: '/things/{thingKey}',
        requires: { required: ['ThingKey'], optional: [] },
        responseLeafPaths: {
          '200': ['thingKey', 'state', 'createdAt'],
        },
      }),
    },
    producersByType: {},
    establishersByType: {},
  };

  const canonical = new Map<string, EndpointScenario>([
    [
      'resolveThing',
      makeScenario('resolveThing', [
        makeStep('resolveThing', {
          method: 'POST',
          pathTemplate: '/things/{thingKey}/resolution',
          bodyTemplate: {},
          expect: { status: 204 },
        }),
      ]),
    ],
    [
      'getThing',
      makeScenario('getThing', [
        makeStep('getThing', { method: 'GET', pathTemplate: '/things/{thingKey}' }),
      ]),
    ],
  ]);

  const templates = {
    version: 1,
    templates: [
      {
        '@type': 'ScenarioTemplate' as const,
        name: 'StateTransitionVisibleAfterAction',
        appliesTo: { kind: 'RuntimeEntity' as const },
        description: 'test',
        steps: [],
      },
    ],
  };
  const entityKinds = {
    version: 1,
    kinds: [
      {
        '@type': 'EntityKind' as const,
        name: 'Thing',
        shape: 'runtime-entity' as const,
        identifiers: ['ThingKey'],
        fetcher: 'getThing',
        stateField: 'state',
        transitions: [{ op: 'resolveThing', from: 'ACTIVE', to: 'RESOLVED' }],
        description: 'test',
      },
    ],
  };
  const edges = { version: 1, edges: [] };

  const result = instantiateAllTemplates(graph, templates, edges, canonical, entityKinds);

  it('emits exactly one scenario per (runtime-entity × transition) pair', () => {
    expect(result).toHaveLength(1);
    expect(result[0].subjectKind).toBe('RuntimeEntity');
    expect(result[0].subjectName).toBe('Thing.resolveThing');
  });

  it('emits the 3-step shape (prereqChain → invoke → observe)', () => {
    const steps = result[0].scenario.steps;
    expect(steps.map((s) => s.kind)).toEqual(['prereqChain', 'invoke', 'observe']);
  });

  it('emits a stateEquals assertion with expectedState from transitions[].to and responseBodyPath from stateField', () => {
    const observe = result[0].scenario.steps[2];
    if (observe.kind !== 'observe' || observe.assertion.kind !== 'stateEquals') {
      throw new Error('expected observe.stateEquals');
    }
    expect(observe.assertion.responseBodyPath).toEqual(['state']);
    expect(observe.assertion.expectedState).toBe('RESOLVED');
    expect(observe.assertion.fromState).toBe('ACTIVE');
    expect(observe.assertion.transitionOp).toBe('resolveThing');
  });

  it('targets the fetcher operation on the observe step', () => {
    const observe = result[0].scenario.steps[2];
    if (observe.kind !== 'observe') throw new Error('expected observe step');
    expect(observe.operationId).toBe('getThing');
  });

  it('throws (loud failure) when stateField is not a 2xx response leaf of the fetcher', () => {
    const badEntityKinds = {
      version: 1,
      kinds: [
        {
          '@type': 'EntityKind' as const,
          name: 'Thing',
          shape: 'runtime-entity' as const,
          identifiers: ['ThingKey'],
          fetcher: 'getThing',
          stateField: 'phase',
          transitions: [{ op: 'resolveThing', from: 'ACTIVE', to: 'RESOLVED' }],
          description: 'test',
        },
      ],
    };
    expect(() =>
      instantiateAllTemplates(graph, templates, edges, canonical, badEntityKinds),
    ).toThrow(/stateField='phase' is not a 2xx response leaf/);
  });

  it('throws (loud failure) when the transition op has no canonical scenario', () => {
    const badCanonical = new Map<string, EndpointScenario>([
      // Only getThing in canonical — resolveThing missing.
      [
        'getThing',
        makeScenario('getThing', [
          makeStep('getThing', { method: 'GET', pathTemplate: '/things/{thingKey}' }),
        ]),
      ],
    ]);
    expect(() =>
      instantiateAllTemplates(graph, templates, edges, badCanonical, entityKinds),
    ).toThrow(/no canonical scenario for transition op/);
  });

  it('splits a dotted stateField into responseBodyPath segments (so the emitter walks the object, not a bracket access)', () => {
    const dottedGraph: OperationGraph = {
      operations: {
        resolveThing: graph.operations.resolveThing,
        getThing: makeOp('getThing', {
          method: 'GET',
          path: '/things/{thingKey}',
          requires: { required: ['ThingKey'], optional: [] },
          responseLeafPaths: {
            '200': ['thingKey', 'metadata.state'],
          },
        }),
      },
      producersByType: {},
      establishersByType: {},
    };
    const dottedKinds = {
      version: 1,
      kinds: [
        {
          '@type': 'EntityKind' as const,
          name: 'Thing',
          shape: 'runtime-entity' as const,
          identifiers: ['ThingKey'],
          fetcher: 'getThing',
          stateField: 'metadata.state',
          transitions: [{ op: 'resolveThing', from: 'ACTIVE', to: 'RESOLVED' }],
          description: 'test',
        },
      ],
    };
    const out = instantiateAllTemplates(dottedGraph, templates, edges, canonical, dottedKinds);
    const observe = out[0].scenario.steps[2];
    if (observe.kind !== 'observe' || observe.assertion.kind !== 'stateEquals') {
      throw new Error('expected observe.stateEquals');
    }
    expect(observe.assertion.responseBodyPath).toEqual(['metadata', 'state']);
  });

  it('throws (loud failure) when stateField has empty path segments (leading/trailing/double dot)', () => {
    const emptySegmentGraph: OperationGraph = {
      operations: {
        resolveThing: graph.operations.resolveThing,
        getThing: makeOp('getThing', {
          method: 'GET',
          path: '/things/{thingKey}',
          requires: { required: ['ThingKey'], optional: [] },
          responseLeafPaths: { '200': ['thingKey', '.state'] },
        }),
      },
      producersByType: {},
      establishersByType: {},
    };
    const emptySegmentKinds = {
      version: 1,
      kinds: [
        {
          '@type': 'EntityKind' as const,
          name: 'Thing',
          shape: 'runtime-entity' as const,
          identifiers: ['ThingKey'],
          fetcher: 'getThing',
          stateField: '.state',
          transitions: [{ op: 'resolveThing', from: 'ACTIVE', to: 'RESOLVED' }],
          description: 'test',
        },
      ],
    };
    expect(() =>
      instantiateAllTemplates(emptySegmentGraph, templates, edges, canonical, emptySegmentKinds),
    ).toThrow(/empty path segments/);
  });
});
