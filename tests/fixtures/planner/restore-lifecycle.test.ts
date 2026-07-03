import { describe, expect, it } from 'vitest';
import { instantiateAllTemplates } from '../../../path-analyser/src/scenarioTemplateInstantiator.ts';
import type {
  EndpointScenario,
  OperationGraph,
  OperationNode,
  RequestStep,
} from '../../../path-analyser/src/types.ts';

/**
 * #426 — Layer-2 fixtures for the `RestoreLifecycle` compiler. Each `it`
 * is one chain statement about how a `shape: "entity"` ABox row that
 * declares `restorableVia` flows through `instantiateAllTemplates`.
 *
 * The fixture hand-builds a minimal `OperationGraph` (create / get /
 * delete / restore) and a canonical map (one EndpointScenario per op),
 * then asserts on the emitted TemplateScenario's 7-step shape and the
 * status-only present/absent/present assertions that drive the
 * create → soft-delete → restore lifecycle.
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

describe('RestoreLifecycle compiler — Layer 2 contract', () => {
  const graph: OperationGraph = {
    operations: {
      createThing: makeOp('createThing', {
        method: 'POST',
        path: '/things',
        requires: { required: [], optional: [] },
        responseSemanticLeaves: [
          { semantic: 'ThingKey', fieldPath: 'thingKey', status: '200', provider: true },
        ],
      }),
      getThing: makeOp('getThing', {
        method: 'GET',
        path: '/things/{thingKey}',
        requires: { required: ['ThingKey'], optional: [] },
      }),
      deleteThing: makeOp('deleteThing', {
        method: 'DELETE',
        path: '/things/{thingKey}',
        requires: { required: ['ThingKey'], optional: [] },
      }),
      restoreThing: makeOp('restoreThing', {
        method: 'POST',
        path: '/things/{thingKey}/restoration',
        requires: { required: ['ThingKey'], optional: [] },
      }),
    },
    producersByType: {},
    establishersByType: {},
  };

  const canonical = new Map<string, EndpointScenario>([
    [
      'createThing',
      makeScenario('createThing', [makeStep('createThing', { pathTemplate: '/things' })]),
    ],
    [
      'getThing',
      makeScenario('getThing', [
        makeStep('getThing', { method: 'GET', pathTemplate: '/things/{thingKey}' }),
      ]),
    ],
    [
      'deleteThing',
      makeScenario('deleteThing', [
        makeStep('deleteThing', {
          method: 'DELETE',
          pathTemplate: '/things/{thingKey}',
          expect: { status: 204 },
        }),
      ]),
    ],
    [
      'restoreThing',
      makeScenario('restoreThing', [
        makeStep('restoreThing', {
          method: 'POST',
          pathTemplate: '/things/{thingKey}/restoration',
        }),
      ]),
    ],
  ]);

  const templates = {
    version: 1,
    templates: [
      {
        '@type': 'ScenarioTemplate' as const,
        name: 'RestoreLifecycle',
        appliesTo: { kind: 'Entity' as const },
        description: 'test',
        steps: [],
      },
    ],
  };

  const restorableKind = {
    '@type': 'EntityKind' as const,
    name: 'Thing',
    shape: 'entity' as const,
    identifiers: ['ThingKey'],
    establishedBy: 'createThing',
    observableVia: 'getThing',
    revokedBy: 'deleteThing',
    restorableVia: 'restoreThing',
    description: 'test',
  };
  // A second entity kind with NO restorableVia — RestoreLifecycle must skip it.
  const nonRestorableKind = {
    '@type': 'EntityKind' as const,
    name: 'Widget',
    shape: 'entity' as const,
    identifiers: ['WidgetKey'],
    establishedBy: 'createThing',
    observableVia: 'getThing',
    revokedBy: 'deleteThing',
    description: 'test',
  };
  const entityKinds = { version: 1, kinds: [restorableKind, nonRestorableKind] };
  const edges = { version: 1, edges: [] };

  const result = instantiateAllTemplates(graph, templates, edges, canonical, entityKinds);

  it('emits exactly one scenario — only for the kind that declares restorableVia', () => {
    expect(result).toHaveLength(1);
    expect(result[0].subjectKind).toBe('Entity');
    expect(result[0].subjectName).toBe('Thing');
    expect(result[0].templateName).toBe('RestoreLifecycle');
  });

  it('emits the 7-step shape (prereq → create → present → delete → absent → restore → present)', () => {
    const steps = result[0].scenario.steps;
    expect(steps.map((s) => s.kind)).toEqual([
      'prereqChain',
      'invoke',
      'observe',
      'invoke',
      'observe',
      'invoke',
      'observe',
    ]);
  });

  it('targets create / delete / restore on the three invoke steps', () => {
    const steps = result[0].scenario.steps;
    const invokes = steps.filter((s) => s.kind === 'invoke').map((s) => s.operationId);
    expect(invokes).toEqual(['createThing', 'deleteThing', 'restoreThing']);
  });

  it('asserts present(200) → absent(404) → present(200) via status-only observes on the fetcher', () => {
    const observes = result[0].scenario.steps.filter((s) => s.kind === 'observe');
    expect(observes).toHaveLength(3);
    for (const o of observes) {
      if (o.kind !== 'observe' || o.assertion.kind !== 'statusOnly') {
        throw new Error('expected statusOnly observe');
      }
      expect(o.operationId).toBe('getThing');
    }
    const expectations = observes.map((o) =>
      o.kind === 'observe' && o.assertion.kind === 'statusOnly'
        ? [o.assertion.expect, o.assertion.expectedStatus]
        : null,
    );
    expect(expectations).toEqual([
      ['present', 200],
      ['absent', 404],
      ['present', 200],
    ]);
  });

  it('throws (loud failure) when the restore op has no canonical scenario', () => {
    const badCanonical = new Map(canonical);
    badCanonical.delete('restoreThing');
    expect(() =>
      instantiateAllTemplates(graph, templates, edges, badCanonical, entityKinds),
    ).toThrow(/no canonical scenario for restorableVia='restoreThing'/);
  });
});
