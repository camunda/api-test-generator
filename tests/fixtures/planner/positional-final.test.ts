import { describe, expect, it } from 'vitest';
import { buildRequestPlan } from '../../../path-analyser/src/index.ts';
import type { EndpointScenario, OperationGraph } from '../../../path-analyser/src/types.ts';

const ref = (operationId: string, method = 'POST') => ({
  operationId,
  method,
  path: `/${operationId}`,
});

// biome-ignore lint/plugin: the fixture only populates the fields the planner reads here
const graph = {
  operations: {
    createFile: { ...ref('createFile'), requires: { required: [], optional: [] }, produces: [] },
    createVersion: {
      ...ref('createVersion'),
      requires: { required: [], optional: [] },
      produces: [],
    },
  },
} as unknown as OperationGraph;

const scenario = (extra: Partial<EndpointScenario>): EndpointScenario => ({
  id: 's',
  operations: [ref('createFile'), ref('createVersion'), ref('createVersion')],
  producedSemanticTypes: [],
  satisfiedSemanticTypes: [],
  expectedResult: { kind: 'error', code: '409' },
  bindings: {},
  ...extra,
});

const plan = (s: EndpointScenario) =>
  buildRequestPlan(s, undefined, graph, {}, {}, { createFile: 200, createVersion: 200 });

describe('request plan for a scenario whose target is found by position', () => {
  it('only the step at finalStepIndex gets the error status; the earlier call to the same operation keeps its success status', () => {
    const steps = plan(scenario({ finalStepIndex: 2 }));
    expect(steps.map((s) => s.operationId)).toEqual([
      'createFile',
      'createVersion',
      'createVersion',
    ]);
    expect(steps.map((s) => s.expect.status)).toEqual([200, 200, 409]);
  });

  it('without finalStepIndex the old behaviour holds: every call to the last operation is final', () => {
    const steps = plan(scenario({}));
    expect(steps.map((s) => s.expect.status)).toEqual([200, 409, 409]);
  });
});
