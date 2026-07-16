import { describe, expect, test } from 'vitest';
import {
  type CsharpOperationMap,
  createCsharpEmitter,
} from '../../materializer/src/csharp-sdk/emitter.js';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.ts';

const SAMPLE_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'createProcessInstance', method: 'POST', path: '/process-instances' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      description: 'Create a process instance',
      operations: [
        { operationId: 'createProcessInstance', method: 'POST', path: '/process-instances' },
      ],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'createProcessInstance',
          method: 'POST',
          pathTemplate: '/process-instances',
          pathParams: [],
          expect: { status: 200 },
        } satisfies RequestStep,
      ],
    },
  ],
};

// Mirrors the committed csharp-sdk/examples/operation-map.json shape:
// operationId -> ordered SDK references, each with a `region` (the method name).
const OPERATION_MAP: CsharpOperationMap = {
  createProcessInstance: [
    {
      file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
      region: 'CreateProcessInstanceAsync',
      label: 'Create process instance',
    },
  ],
};

const EMIT_CTX = {
  outDir: '/unused',
  suiteName: 'createProcessInstance',
  mode: 'feature',
  configName: 'test',
  emitterConfig: {},
  resolveConfigPath: (rel: string) => rel,
} as const;

describe('C# SDK Emitter', () => {
  test('resolves the SDK method name from the operation-map region field', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const files = await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);

    expect(files).toHaveLength(1);
    expect(files[0].content).toContain('await Client.CreateProcessInstanceAsync(');
  });

  test('never emits a stringified object for a mapped operation', async () => {
    // Regression for the array-of-objects map value being interpolated raw,
    // producing `await Client.[object Object](...)`.
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const files = await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);

    expect(files[0].content).not.toContain('[object Object]');
  });

  test('falls back to PascalCase+Async when the operation is absent from the map', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);

    expect(files[0].content).toContain('await Client.CreateProcessInstanceAsync(');
    expect(files[0].content).not.toContain('[object Object]');
  });

  test('renders the RANDOM placeholder through the seeding helper instead of ctx["RANDOM"]', async () => {
    const emitter = createCsharpEmitter({});
    const randomCollection: EndpointScenarioCollection = {
      ...SAMPLE_COLLECTION,
      scenarios: [
        {
          ...SAMPLE_COLLECTION.scenarios[0],
          bindings: {
            processDefinitionIdVar1: ['proc_', '$', '{RANDOM}'].join(''),
          },
        },
      ],
    };

    const files = await emitter.emit(randomCollection, EMIT_CTX);

    expect(files[0].content).toContain('SeedBinding("RANDOM")');
    expect(files[0].content).not.toContain('ctx["RANDOM"]');
  });

  test('imports the RestSdk.Models namespace for generated request types', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);

    expect(files[0].content).toContain('using Camunda.Orchestration.RestSdk.Models;');
  });

  test('uses HttpRequestException for generated error-path assertions', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);

    expect(files[0].content).toContain('Assert.ThrowsAsync<HttpRequestException>');
    expect(files[0].content).toContain('(int?)ex.StatusCode');
    expect(files[0].content).not.toContain('CamundaSdkException');
  });
});
