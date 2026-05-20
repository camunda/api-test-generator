import { describe, expect, it } from 'vitest';
import { instantiateAllTemplates } from '../../../path-analyser/src/scenarioTemplateInstantiator.ts';
import type {
  EndpointScenario,
  OperationGraph,
  OperationNode,
  RequestStep,
} from '../../../path-analyser/src/types.ts';

/**
 * #305 Phase 4 — Layer-2 fixtures for the
 * `UpdatedFieldVisibleOnReadBack` compiler. Each `it` is one chain
 * statement about how a `runtime-entity` ABox row + mutator/fetcher
 * canonical pair flows through `instantiateAllTemplates`.
 *
 * The fixture hand-builds a minimal `OperationGraph` (mutator +
 * fetcher) and a minimal canonical map (one EndpointScenario per op),
 * then asserts on the emitted TemplateScenario's step list and
 * fieldEquals fields.
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

describe('UpdatedFieldVisibleOnReadBack compiler — Layer 2 contract', () => {
  const graph: OperationGraph = {
    operations: {
      mutateThing: makeOp('mutateThing', {
        method: 'PATCH',
        path: '/things/{thingKey}',
        requires: { required: ['ThingKey'], optional: [] },
      }),
      getThing: makeOp('getThing', {
        method: 'GET',
        path: '/things/{thingKey}',
        requires: { required: ['ThingKey'], optional: [] },
        responseLeafPaths: {
          '200': ['thingKey', 'priority', 'dueDate', 'unrelatedField'],
        },
      }),
    },
    producersByType: {},
    establishersByType: {},
  };

  const mutatorBody = {
    changeset: { priority: 99, dueDate: '2099-01-01', notReadable: 'x' },
    action: 'customUpdate',
  };
  const canonical = new Map<string, EndpointScenario>([
    [
      'mutateThing',
      makeScenario('mutateThing', [
        makeStep('mutateThing', {
          method: 'PATCH',
          pathTemplate: '/things/{thingKey}',
          bodyTemplate: mutatorBody,
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
        name: 'UpdatedFieldVisibleOnReadBack',
        appliesTo: { kind: 'RuntimeEntity' as const },
        description: 'test',
        steps: [],
      },
    ],
  };
  const entityKinds = {
    kinds: [
      {
        '@type': 'EntityKind' as const,
        name: 'Thing',
        shape: 'runtime-entity' as const,
        identifiers: ['ThingKey'],
        mutators: ['mutateThing'],
        fetcher: 'getThing',
        description: 'test',
      },
    ],
  };
  const edges = { version: 1, edges: [] };

  // entityKinds also requires version
  const entityKindsArg = { version: 1, kinds: entityKinds.kinds };

  const result = instantiateAllTemplates(graph, templates, edges, canonical, entityKindsArg);

  it('emits exactly one scenario per (runtime-entity × mutator) pair', () => {
    expect(result).toHaveLength(1);
    expect(result[0].subjectKind).toBe('RuntimeEntity');
    expect(result[0].subjectName).toBe('Thing.mutateThing');
  });

  it('emits the 3-step shape (prereqChain → invoke → observe)', () => {
    const steps = result[0].scenario.steps;
    expect(steps.map((s) => s.kind)).toEqual(['prereqChain', 'invoke', 'observe']);
  });

  it('emits a fieldEquals assertion with one field per body-leaf / response-leaf name match', () => {
    const observe = result[0].scenario.steps[2];
    if (observe.kind !== 'observe' || observe.assertion.kind !== 'fieldEquals') {
      throw new Error('expected observe.fieldEquals');
    }
    const names = observe.assertion.fields.map((f) => f.leafName).sort();
    // priority + dueDate match; notReadable and action do not appear in
    // the fetcher response and must be skipped.
    expect(names).toEqual(['dueDate', 'priority']);
  });

  it('preserves the nested body path in requestBodyPath and the response path in responseBodyPath', () => {
    const observe = result[0].scenario.steps[2];
    if (observe.kind !== 'observe' || observe.assertion.kind !== 'fieldEquals') {
      throw new Error('expected observe.fieldEquals');
    }
    const priority = observe.assertion.fields.find((f) => f.leafName === 'priority');
    expect(priority?.requestBodyPath).toEqual(['changeset', 'priority']);
    expect(priority?.responseBodyPath).toEqual(['priority']);
  });

  it('throws (loud failure) when the mutator body has no leaves matching any fetcher response leaf', () => {
    const goodGetThing = canonical.get('getThing');
    if (!goodGetThing) throw new Error('test setup: getThing canonical missing');
    const badCanonical = new Map<string, EndpointScenario>([
      [
        'mutateThing',
        makeScenario('mutateThing', [
          makeStep('mutateThing', {
            method: 'PATCH',
            pathTemplate: '/things/{thingKey}',
            bodyTemplate: { onlyAction: 'x' },
            expect: { status: 204 },
          }),
        ]),
      ],
      ['getThing', goodGetThing],
    ]);
    expect(() =>
      instantiateAllTemplates(graph, templates, edges, badCanonical, entityKindsArg),
    ).toThrow(/empty field intersection/);
  });
});
