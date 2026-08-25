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

const SEARCH_JOBS_REQUEST_STEP: RequestStep = {
  operationId: 'searchJobs',
  method: 'POST',
  pathTemplate: '/jobs/search',
  bodyKind: 'json',
  bodyTemplate: {
    worker: 'test-worker',
  },
  expect: { status: 200 },
};

const CREATE_PROCESS_INSTANCE_REQUEST_STEP: RequestStep = {
  operationId: 'createProcessInstance',
  method: 'POST',
  pathTemplate: '/process-instances',
  expect: { status: 400 },
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
  searchJobs: [
    {
      file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
      region: 'SearchJobsAsync',
      label: 'Search jobs',
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

  test('throws when the operation is absent from the published C# SDK map', async () => {
    const emitter = createCsharpEmitter({});
    await expect(emitter.emit(SAMPLE_COLLECTION, EMIT_CTX)).rejects.toThrow(
      'No published C# SDK method mapping found for operationId createProcessInstance',
    );
  });

  test('uses the published request DTO name instead of the mechanical operationId name', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const jobsCollection: EndpointScenarioCollection = {
      endpoint: { operationId: 'searchJobs', method: 'POST', path: '/jobs/search' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'job search',
          description: 'Search jobs',
          operations: [{ operationId: 'searchJobs', method: 'POST', path: '/jobs/search' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [SEARCH_JOBS_REQUEST_STEP],
        },
      ],
    };

    const files = await emitter.emit(jobsCollection, EMIT_CTX);

    expect(files[0].content).toContain('BuildRequest<JobSearchQuery>(');
    expect(files[0].content).not.toContain('BuildRequest<SearchJobsRequest>(');
  });

  test('derives request path parameters from the path template when step.pathParams is absent', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const requestWithPathParam: EndpointScenarioCollection = {
      endpoint: { operationId: 'searchJobs', method: 'POST', path: '/jobs/{jobKey}/search' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'job search',
          description: 'Search jobs with a path placeholder',
          operations: [
            { operationId: 'searchJobs', method: 'POST', path: '/jobs/{jobKey}/search' },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              ...SEARCH_JOBS_REQUEST_STEP,
              pathTemplate: '/jobs/{jobKey}/search',
              pathParams: undefined,
            },
          ],
        },
      ],
    };

    const files = await emitter.emit(requestWithPathParam, EMIT_CTX);

    expect(files[0].content).toContain('["jobKey"] = RequireBinding(ctx, "jobKeyVar")');
  });

  test('feature and variant suites for the same operationId emit distinct C# class names', async () => {
    // Regression: a feature suite and a variant suite for the same
    // operationId previously both emitted `public class
    // CreateProcessInstanceTests`, which is a CS0101 duplicate-type error
    // once both files are compiled into the same project (C# classes
    // share one namespace across all files, unlike Playwright's
    // file-scoped `test.describe` blocks).
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const featureFiles = await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);
    const variantFiles = await emitter.emit(SAMPLE_COLLECTION, { ...EMIT_CTX, mode: 'variant' });

    const classNameOf = (content: string): string | null => {
      const match = /public class (\w+) : TestFixtureBase/.exec(content);
      return match ? match[1] : null;
    };

    const featureClassName = classNameOf(featureFiles[0].content);
    const variantClassName = classNameOf(variantFiles[0].content);

    expect(featureClassName).toBe('CreateProcessInstanceTests');
    expect(variantClassName).not.toBeNull();
    expect(variantClassName).not.toBe(featureClassName);
  });

  test('renders the RANDOM placeholder through the seeding helper instead of ctx["RANDOM"]', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP);
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

  test('does not import the obsolete RestSdk.Models namespace', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const files = await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);

    expect(files[0].content).not.toContain('using Camunda.Orchestration.RestSdk.Models;');
  });

  test('uses CamundaSdkException for generated error-path assertions', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const errorCollection: EndpointScenarioCollection = {
      ...SAMPLE_COLLECTION,
      scenarios: [
        {
          ...SAMPLE_COLLECTION.scenarios[0],
          requestPlan: [{ ...CREATE_PROCESS_INSTANCE_REQUEST_STEP }],
        },
      ],
    };

    const files = await emitter.emit(errorCollection, EMIT_CTX);

    expect(files[0].content).toContain('Assert.ThrowsAnyAsync<CamundaSdkException>');
    expect(files[0].content).toContain('(int?)ex.Status');
  });
});
