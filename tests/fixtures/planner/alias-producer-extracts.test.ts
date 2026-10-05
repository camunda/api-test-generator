import { describe, expect, it } from 'vitest';
import { aliasProducerExtractsToPlaceholders } from '../../../path-analyser/src/index.ts';
import type {
  EndpointScenario,
  OperationGraph,
  RequestStep,
} from '../../../path-analyser/src/types.ts';

// The path placeholder {id} is bound under idVar, while the producer extracts the key under the
// semantic type's variable (thingKeyVar). The helper adds an alias extract so the URL resolves.
// biome-ignore lint/plugin: the fixture only populates the fields under test
const graph = {
  operations: {
    createThing: { operationId: 'createThing', pathParameters: [] },
    updateThing: {
      operationId: 'updateThing',
      pathParameters: [{ name: 'id', semanticType: 'ThingKey' }],
    },
    getThing: {
      operationId: 'getThing',
      pathParameters: [{ name: 'id', semanticType: 'ThingKey' }],
    },
  },
} as unknown as OperationGraph;

const step = (
  operationId: string,
  pathTemplate: string,
  extra: Partial<RequestStep> = {},
): RequestStep => ({
  operationId,
  method: 'GET',
  pathTemplate,
  expect: { status: 200 },
  ...extra,
});

const create = () =>
  step('createThing', '/things', { extract: [{ fieldPath: 'thingKey', bind: 'thingKeyVar' }] });

const scenario = (targetIndex?: number): EndpointScenario => ({
  id: 's',
  operations: [],
  producedSemanticTypes: [],
  satisfiedSemanticTypes: [],
  ...(targetIndex === undefined
    ? {}
    : { optionalFields: { body: {}, echo: {}, targetIndex, readBackEcho: { a: 1 } } }),
});

const aliasesOn = (s: RequestStep) =>
  (s.extract ?? []).filter((e) => e.note === 'placeholderAlias').map((e) => e.bind);

describe('aliasProducerExtractsToPlaceholders', () => {
  it('aliases for the last step of an ordinary chain', () => {
    const steps = [create(), step('getThing', '/things/{id}')];
    aliasProducerExtractsToPlaceholders(scenario(), steps, graph);
    expect(aliasesOn(steps[0])).toEqual(['idVar']);
  });

  it('with a read-back, aliases for the logical target as well as the read-back', () => {
    // create, update (the target, index 1), then get (the read-back)
    const steps = [
      create(),
      step('updateThing', '/things/{id}', { method: 'PATCH' }),
      step('getThing', '/things/{id}'),
    ];
    aliasProducerExtractsToPlaceholders(scenario(1), steps, graph);
    // one alias on the producer serves both consumers and is added once
    expect(aliasesOn(steps[0])).toEqual(['idVar']);
  });

  it('with a read-back, aliases the target even when only it needs the placeholder', () => {
    const steps = [
      create(),
      step('updateThing', '/things/{id}', { method: 'PATCH' }),
      step('createThing', '/things'),
    ];
    aliasProducerExtractsToPlaceholders(scenario(1), steps, graph);
    expect(aliasesOn(steps[0])).toEqual(['idVar']);
  });

  it('does nothing when the placeholder variable already matches the semantic one', () => {
    // biome-ignore lint/plugin: the fixture only populates the fields under test
    const g = {
      operations: {
        ...graph.operations,
        getThing: {
          operationId: 'getThing',
          pathParameters: [{ name: 'thingKey', semanticType: 'ThingKey' }],
        },
      },
    } as unknown as OperationGraph;
    const steps = [create(), step('getThing', '/things/{thingKey}')];
    aliasProducerExtractsToPlaceholders(scenario(), steps, g);
    expect(aliasesOn(steps[0])).toEqual([]);
  });
});
