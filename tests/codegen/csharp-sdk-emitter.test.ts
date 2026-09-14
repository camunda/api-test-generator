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

const SEARCH_PROCESS_DEFINITIONS_REQUEST_STEP: RequestStep = {
  operationId: 'searchProcessDefinitions',
  method: 'POST',
  pathTemplate: '/process-definitions/search',
  bodyKind: 'json',
  expect: { status: 200 },
};

const CREATE_PROCESS_INSTANCE_REQUEST_STEP: RequestStep = {
  operationId: 'createProcessInstance',
  method: 'POST',
  pathTemplate: '/process-instances',
  expect: { status: 400 },
};

const DEPLOYMENT_REQUEST_STEP: RequestStep = {
  operationId: 'createDeployment',
  method: 'POST',
  pathTemplate: '/deployments',
  bodyKind: 'multipart',
  multipartTemplate: {
    fields: { tenantId: '${tenantIdVar}' },
    files: { resources: ['process.bpmn'] },
  },
  expect: { status: 200 },
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
  createDeployment: [
    {
      file: 'Deployment.cs',
      region: 'DeployResourcesFromFilesAsync',
      label: 'Deploy resources from files',
    },
  ],
  searchJobs: [
    {
      file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
      region: 'SearchJobsAsync',
      label: 'Search jobs',
    },
  ],
  searchProcessDefinitions: [
    {
      file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
      region: 'SearchProcessDefinitionsAsync',
      label: 'Search process definitions',
    },
  ],
  cancelProcessInstance: [
    {
      file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
      region: 'CancelProcessInstanceAsync',
      label: 'Cancel process instance',
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

  test('passes an empty query object when a search body template is absent', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const processDefinitionsCollection: EndpointScenarioCollection = {
      endpoint: {
        operationId: 'searchProcessDefinitions',
        method: 'POST',
        path: '/process-definitions/search',
      },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'search process definitions',
          description: 'Search process definitions without filters',
          operations: [
            {
              operationId: 'searchProcessDefinitions',
              method: 'POST',
              path: '/process-definitions/search',
            },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [SEARCH_PROCESS_DEFINITIONS_REQUEST_STEP],
        },
      ],
    };

    const files = await emitter.emit(processDefinitionsCollection, EMIT_CTX);

    expect(files[0].content).toContain('var request1 = new ProcessDefinitionSearchQuery();');
    expect(files[0].content).toContain(
      'await Client.SearchProcessDefinitionsAsync(request1);',
    );
  });

  test('uses RequireStringBinding for deployment tenant IDs', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const deploymentCollection: EndpointScenarioCollection = {
      endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'deploy resources',
          description: 'Deploy resources for a tenant',
          operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [DEPLOYMENT_REQUEST_STEP],
        },
      ],
    };

    const files = await emitter.emit(deploymentCollection, EMIT_CTX);

    expect(files[0].content).toContain(
      'await Client.DeployResourcesFromFilesAsync(resourceFiles, RequireStringBinding(ctx, "tenantIdVar"));',
    );
    expect(files[0].content).not.toContain(
      'await Client.DeployResourcesFromFilesAsync(resourceFiles, RequireBinding(ctx, "tenantIdVar"));',
    );
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

    expect(files[0].content).toContain(
      'await Client.SearchJobsAsync(JobKey.AssumeExists(RequireStringBinding(ctx, "jobKeyVar")), request1);',
    );
    expect(files[0].content).not.toContain('["jobKey"] = RequireBinding(ctx, "jobKeyVar")');
  });

  test('wraps key-typed path parameters in the strongly-typed AssumeExists factory', async () => {
    // Regression: RequireBinding(ctx, ...) returns `object`, but the real SDK's
    // key-typed parameters (JobKey, ProcessInstanceKey, ...) require the
    // strongly-typed struct itself. Passing the bare `object` binding fails to
    // compile with CS1503 ("cannot convert from 'object' to '<KeyType>'") --
    // this was reproduced against the real 9.2.2 Camunda.Orchestration.Sdk
    // package (44 CS1503 errors across every key-typed path parameter).
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

    expect(files[0].content).toContain(
      'await Client.SearchJobsAsync(JobKey.AssumeExists(RequireStringBinding(ctx, "jobKeyVar")), request1);',
    );
    expect(files[0].content).not.toContain('RequireBinding(ctx, "jobKeyVar")');
  });

  test('throws a clear error for a path parameter with no published C# key-type mapping', async () => {
    // Class-scoped guard: any path parameter name absent from
    // CSHARP_PATH_PARAM_KEY_TYPE must fail generation loudly (matching the
    // existing "No published C# SDK method mapping" / "...request DTO
    // mapping" fail-fast style) rather than silently emitting a bare
    // `object` argument that only fails much later, at C# compile time.
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const requestWithUnknownPathParam: EndpointScenarioCollection = {
      endpoint: { operationId: 'searchJobs', method: 'POST', path: '/widgets/{widgetId}/search' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'widget search',
          description: 'Search with an unmapped path parameter',
          operations: [
            { operationId: 'searchJobs', method: 'POST', path: '/widgets/{widgetId}/search' },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              ...SEARCH_JOBS_REQUEST_STEP,
              pathTemplate: '/widgets/{widgetId}/search',
              pathParams: undefined,
            },
          ],
        },
      ],
    };

    await expect(emitter.emit(requestWithUnknownPathParam, EMIT_CTX)).rejects.toThrow(
      /No published C# key-type mapping for path parameter "widgetId"/,
    );
  });

  test('passes path parameters before the request body to SDK methods', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const collection: EndpointScenarioCollection = {
      endpoint: {
        operationId: 'cancelProcessInstance',
        method: 'POST',
        path: '/process-instances/{processInstanceKey}/cancellation',
      },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'cancel process instance',
          description: 'Cancel a process instance',
          operations: [
            {
              operationId: 'cancelProcessInstance',
              method: 'POST',
              path: '/process-instances/{processInstanceKey}/cancellation',
            },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'cancelProcessInstance',
              method: 'POST',
              pathTemplate: '/process-instances/{processInstanceKey}/cancellation',
              pathParams: undefined,
              bodyKind: 'json',
              bodyTemplate: { operationReference: 'cancel-process' },
              expect: { status: 204 },
            },
          ],
        },
      ],
    };

    const files = await emitter.emit(collection, EMIT_CTX);

    expect(files[0].content).toContain(
      'await Client.CancelProcessInstanceAsync(ProcessInstanceKey.AssumeExists(RequireStringBinding(ctx, "processInstanceKeyVar")), request1);',
    );
  });

  test('maps previously-unmapped body operations to their real request DTO instead of throwing', async () => {
    // Regression: 12 operations (completeUserTask, assignUserTask,
    // deleteResource, deleteProcessInstance, createDocumentLink,
    // getJobTypeStatistics, getProcessDefinitionMessageSubscriptionStatistics,
    // getProcessDefinitionStatistics, getProcessDefinitionInstanceStatistics,
    // getProcessInstanceStatisticsByError, modifyProcessInstance,
    // resolveIncident) were absent from CSHARP_REQUEST_TYPE_BY_OPERATION,
    // so the emitter silently dropped the request body argument entirely,
    // producing a real CS7036 ("no argument given for required parameter
    // 'body'") against the real 9.2.2 SDK. resolveIncident stands in for the
    // whole class here.
    const emitter = createCsharpEmitter({
      resolveIncident: [
        {
          file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
          region: 'ResolveIncidentAsync',
          label: 'Resolve incident',
        },
      ],
    });
    const collection: EndpointScenarioCollection = {
      endpoint: {
        operationId: 'resolveIncident',
        method: 'POST',
        path: '/incidents/{incidentKey}/resolution',
      },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'resolve incident',
          description: 'Resolve an incident',
          operations: [
            {
              operationId: 'resolveIncident',
              method: 'POST',
              path: '/incidents/{incidentKey}/resolution',
            },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'resolveIncident',
              method: 'POST',
              pathTemplate: '/incidents/{incidentKey}/resolution',
              bodyKind: 'json',
              expect: { status: 204 },
            },
          ],
        },
      ],
    };

    const files = await emitter.emit(collection, EMIT_CTX);

    expect(files[0].content).toContain('var request1 = new IncidentResolutionRequest();');
    expect(files[0].content).toContain(
      'IncidentKey.AssumeExists(RequireStringBinding(ctx, "incidentKeyVar"))',
    );
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

  test('awaits the client call inside the ThrowsAnyAsync lambda instead of firing-and-forgetting it', async () => {
    // Regression: the JSON error-path branch previously emitted
    // `${renderClientCall(...)};` inside the `async () => { ... }` lambda
    // passed to Assert.ThrowsAnyAsync without an `await`. The call's
    // exception would then surface (if at all) after the lambda's Task had
    // already completed, so ThrowsAnyAsync could not observe it -- a
    // correctness bug that happened to produce no compile error (just an
    // unawaited-call warning) and was never caught by a generated scenario.
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

    expect(files[0].content).toContain('await Client.CreateProcessInstanceAsync(');
    expect(files[0].content).not.toMatch(/async \(\) => \{\s*Client\./);
  });

  test('does not assign the awaited result of a bare-Task SDK method to a variable', async () => {
    // Regression: SDK methods that return a plain `Task` (no response body)
    // -- e.g. CompleteJobAsync, CancelProcessInstanceAsync, ResolveIncidentAsync
    // -- fail to compile with CS0815 ("Cannot assign void to an
    // implicitly-typed variable") when the emitter does
    // `var result1 = await Client.CompleteJobAsync(...)`. Reflecting the
    // real 9.2.2 SDK found 58 such methods; this was previously masked by
    // the CS1503 path-param bug short-circuiting the compiler's diagnostics
    // for the same call.
    const emitter = createCsharpEmitter({
      completeJob: [
        {
          file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
          region: 'CompleteJobAsync',
          label: 'Complete job',
        },
      ],
    });
    const collection: EndpointScenarioCollection = {
      endpoint: { operationId: 'completeJob', method: 'POST', path: '/jobs/{jobKey}/completion' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'complete job',
          description: 'Complete a job',
          operations: [
            { operationId: 'completeJob', method: 'POST', path: '/jobs/{jobKey}/completion' },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'completeJob',
              method: 'POST',
              pathTemplate: '/jobs/{jobKey}/completion',
              bodyKind: 'json',
              expect: { status: 204 },
            },
          ],
        },
      ],
    };

    const files = await emitter.emit(collection, EMIT_CTX);

    expect(files[0].content).toContain(
      'await Client.CompleteJobAsync(JobKey.AssumeExists(RequireStringBinding(ctx, "jobKeyVar")), request1);',
    );
    expect(files[0].content).not.toContain('var result1 = await Client.CompleteJobAsync(');
    expect(files[0].content).not.toContain('AssertExpectedStatus(result1,');
  });

  test('throws when a bare-Task operation has an extraction step (nothing to extract from)', async () => {
    const emitter = createCsharpEmitter({
      completeJob: [
        {
          file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
          region: 'CompleteJobAsync',
          label: 'Complete job',
        },
      ],
    });
    const collection: EndpointScenarioCollection = {
      endpoint: { operationId: 'completeJob', method: 'POST', path: '/jobs/{jobKey}/completion' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'complete job',
          description: 'Complete a job',
          operations: [
            { operationId: 'completeJob', method: 'POST', path: '/jobs/{jobKey}/completion' },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'completeJob',
              method: 'POST',
              pathTemplate: '/jobs/{jobKey}/completion',
              bodyKind: 'json',
              expect: { status: 204 },
              extract: [{ bind: 'somethingVar', fieldPath: 'something' }],
            },
          ],
        },
      ],
    };

    await expect(emitter.emit(collection, EMIT_CTX)).rejects.toThrow(
      /returns no response body/,
    );
  });

  test('resolves deployment resource-file paths via ResolveFixturePath instead of a bare AppContext.BaseDirectory join', async () => {
    // Regression: renderFileArray built resource-file paths with
    // `Path.Combine(AppContext.BaseDirectory, "fixtures", ...)` directly,
    // which only works when the fixtures/ directory happens to be present
    // right next to the test binary. Against a normal `dotnet test` output
    // layout (bin/Debug/net8.0/), it is not, and the deployment step -- a
    // near-universal setup step for every scenario -- throws
    // FileNotFoundException before the SDK call is even made. The base
    // class's ResolveFixturePath already implements the correct multi
    // -candidate fallback (BaseDirectory, three levels up, cwd); reuse it.
    const emitter = createCsharpEmitter(OPERATION_MAP);
    const files = await emitter.emit(
      {
        endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
        requiredSemanticTypes: [],
        optionalSemanticTypes: [],
        scenarios: [
          {
            id: 'sc1',
            name: 'deploy resources',
            description: 'Deploy resources for a tenant',
            operations: [
              { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
            ],
            producedSemanticTypes: [],
            satisfiedSemanticTypes: [],
            requestPlan: [DEPLOYMENT_REQUEST_STEP],
          },
        ],
      },
      EMIT_CTX,
    );

    expect(files[0].content).toContain('ResolveFixturePath("process.bpmn")');
    expect(files[0].content).not.toContain('Path.Combine(AppContext.BaseDirectory, "fixtures"');
  });
});
