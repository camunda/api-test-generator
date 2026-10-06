import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  buildCsharpDiscriminatorTable,
  type CsharpDiscriminatorTable,
} from '../../materializer/src/csharp-sdk/discriminators.js';
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
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ctx-binding placeholder fixture value (matches production RequestStep template syntax, not a JS template literal)
    fields: { tenantId: '${tenantIdVar}' },
    files: { resources: ['process.bpmn'] },
  },
  expect: { status: 200 },
};

function singleStepCollection(step: RequestStep): EndpointScenarioCollection {
  const endpoint = { operationId: step.operationId, method: step.method, path: step.pathTemplate };
  return {
    endpoint,
    requiredSemanticTypes: [],
    optionalSemanticTypes: [],
    scenarios: [
      {
        id: 'sc1',
        name: 'single step',
        description: 'single step',
        operations: [endpoint],
        producedSemanticTypes: [],
        satisfiedSemanticTypes: [],
        requestPlan: [step],
      },
    ],
  };
}

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
  completeJob: [
    {
      file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
      region: 'CompleteJobAsync',
      label: 'Complete job',
    },
  ],
  modifyProcessInstance: [
    {
      file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
      region: 'ModifyProcessInstanceAsync',
      label: 'Modify process instance',
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
  getUser: [
    {
      file: 'User.cs',
      region: 'GetUserAsync',
      label: 'Get user',
    },
  ],
  getGlobalTaskListener: [
    {
      file: 'GlobalTaskListener.cs',
      region: 'GetGlobalTaskListenerAsync',
      label: 'Get global task listener',
    },
  ],
  migrateProcessInstance: [
    {
      file: 'Migration.cs',
      region: 'MigrateProcessInstanceAsync',
      label: 'Migrate process instance',
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

// The generic, structure-focused tests in this file (operation-map
// resolution, path parameters, consistency blocks, SDK method binding,
// etc.) never need a REAL discriminator — `createSpecEmitter`'s default
// table here is an empty synthetic one, so this file no longer depends on
// the OCA bundle having been fetched at module-import time (PR #668
// review: a module-level `readFileSync` of `spec/camunda-oca/bundled/
// rest-api.bundle.json` threw `ENOENT` and failed to COLLECT this entire
// file under `CONFIG=camunda-hub`, where only the Hub bundle exists).
// Tests that assert specific real-spec discriminator shapes (JobResult
// userTask/adHocSubProcess, sourceType byId/byKey, ...) live in their own
// `describe.skipIf` block below, guarded on the OCA bundle actually being
// present on disk, and read the real bundle lazily there instead.
const SYNTHETIC_DISCRIMINATORS: CsharpDiscriminatorTable = {};

function createSpecEmitter(mapping: CsharpOperationMap = OPERATION_MAP) {
  return createCsharpEmitter(mapping, { discriminators: SYNTHETIC_DISCRIMINATORS });
}

describe('C# SDK Emitter', () => {
  test('does not resolve lazy discriminators until the first emit', async () => {
    let resolveCount = 0;
    const emitter = createCsharpEmitter(OPERATION_MAP, {
      discriminators: () => {
        resolveCount += 1;
        return SYNTHETIC_DISCRIMINATORS;
      },
    });

    expect(resolveCount).toBe(0);
    await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);
    expect(resolveCount).toBe(1);
  });

  test('caches lazy discriminators across emits', async () => {
    let resolveCount = 0;
    const emitter = createCsharpEmitter(OPERATION_MAP, {
      discriminators: () => {
        resolveCount += 1;
        return SYNTHETIC_DISCRIMINATORS;
      },
    });

    await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);
    await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);
    expect(resolveCount).toBe(1);
  });

  test('resolves the SDK method name from the operation-map region field', async () => {
    const emitter = createSpecEmitter();
    const files = await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);

    expect(files).toHaveLength(1);
    expect(files[0].content).toContain('await Client.CreateProcessInstanceAsync(');
  });

  test('never emits a stringified object for a mapped operation', async () => {
    // Regression for the array-of-objects map value being interpolated raw,
    // producing `await Client.[object Object](...)`.
    const emitter = createSpecEmitter();
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
    const emitter = createSpecEmitter();
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
    const emitter = createSpecEmitter();
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
      'await Client.SearchProcessDefinitionsAsync(request1, consistency: new() { WaitUpToMs = 10_000, PollIntervalMs = 500 });',
    );
  });

  test('uses a nullable GetStringBindingOrNull lookup for deployment tenant IDs', async () => {
    // Regression (Copilot PR #573 review): deployment's tenantId is always
    // optional at the SDK/broker level. RequireStringBinding threw before
    // the request could even be sent when a consumer scenario legitimately
    // never seeded tenantIdVar; a nullable lookup preserves null and lets
    // the broker apply its default instead.
    const emitter = createSpecEmitter();
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
      'await Client.DeployResourcesFromFilesAsync(resourceFiles, GetStringBindingOrNull(ctx, "tenantIdVar"));',
    );
    expect(files[0].content).not.toContain(
      'await Client.DeployResourcesFromFilesAsync(resourceFiles, RequireStringBinding(ctx, "tenantIdVar"));',
    );
    expect(files[0].content).not.toContain(
      'await Client.DeployResourcesFromFilesAsync(resourceFiles, RequireBinding(ctx, "tenantIdVar"));',
    );
  });

  // Regression (Copilot PR #573 review): `SeedEnv.Generate` special-cased
  // `tenantIdVar` to a hardcoded `"<default>"` sentinel, and the emitter's
  // `seedBindingsList` filter only excluded globally-seeded (non-
  // omitWhenUnbound) names — an `omitWhenUnbound` binding named in a
  // scenario's `seedBindings` was still routed through the legacy
  // `SeedBindingIfMissing` call, sending the literal string `"<default>"`
  // instead of leaving the field genuinely unset. Mirrors the canonical
  // `emitCtxSeeding`/`omitWhenUnbound` contract already covered for
  // Playwright in tests/codegen/emit-ctx-seeding.test.ts (#342).
  describe('omitWhenUnbound + unique-binding seeding (#342 / #304, csharp-sdk)', () => {
    const OMIT_WHEN_UNBOUND_SEED = {
      binding: 'tenantIdVar',
      fieldName: 'tenantId',
      seedRule: 'tenantIdVar',
      omitWhenUnbound: true,
    };

    test('does not seed an omitWhenUnbound binding via SeedBindingIfMissing when it is not client-minted/unique (consumer case)', async () => {
      const emitter = createSpecEmitter();
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            // Planner-computed seedBindings still names tenantIdVar, exactly
            // as the real reported bug scenario did — the fix must exclude it
            // here rather than relying on requestPlan shape alone.
            seedBindings: ['tenantIdVar'],
          },
        ],
      };

      const files = await emitter.emit(collection, {
        ...EMIT_CTX,
        globalContextSeeds: [OMIT_WHEN_UNBOUND_SEED],
      });

      expect(files[0].content).not.toContain('SeedBindingIfMissing(ctx, "tenantIdVar"');
    });

    test('seeds an omitWhenUnbound binding with unique: true when it is client-minted and the consuming step declares 409 (producer case)', async () => {
      const emitter = createSpecEmitter();
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            seedBindings: ['tenantIdVar'],
            requestPlan: [
              {
                operationId: 'createProcessInstance',
                method: 'POST',
                pathTemplate: '/process-instances',
                bodyKind: 'json',
                // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ctx-binding placeholder fixture value (matches production RequestStep template syntax, not a JS template literal)
                bodyTemplate: { tenantId: '${tenantIdVar}' },
                declares409: true,
                expect: { status: 200 },
              } satisfies RequestStep,
            ],
          },
        ],
      };

      const files = await emitter.emit(collection, {
        ...EMIT_CTX,
        globalContextSeeds: [OMIT_WHEN_UNBOUND_SEED],
      });

      expect(files[0].content).toContain(
        'SeedBindingIfMissing(ctx, "tenantIdVar", "tenantIdVar", unique: true);',
      );
    });

    // Regression (Copilot PR #573 review): the JSON body renderer had no
    // omitWhenUnbound awareness at all -- every top-level field was rendered
    // via RequireBinding unconditionally, throwing for a consumer scenario
    // that never seeded an optional binding instead of omitting the field.
    test('omits a JSON body field with an unbound omitWhenUnbound binding instead of throwing via RequireBinding (consumer case)', async () => {
      const emitter = createSpecEmitter();
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                operationId: 'createProcessInstance',
                method: 'POST',
                pathTemplate: '/process-instances',
                bodyKind: 'json',
                // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ctx-binding placeholder fixture value (matches production RequestStep template syntax, not a JS template literal)
                bodyTemplate: { tenantId: '${tenantIdVar}' },
                expect: { status: 200 },
              } satisfies RequestStep,
            ],
          },
        ],
      };

      const files = await emitter.emit(collection, {
        ...EMIT_CTX,
        globalContextSeeds: [OMIT_WHEN_UNBOUND_SEED],
      });

      expect(files[0].content).toContain(
        'var __tenantIdVal = GetBindingOrNull(ctx, "tenantIdVar");',
      );
      expect(files[0].content).toContain(
        'if (__tenantIdVal is not null) request1Data["tenantId"] = __tenantIdVal;',
      );
      expect(files[0].content).not.toContain('RequireBinding(ctx, "tenantIdVar")');
    });

    // Regression (Copilot PR #573 review): the multipart fields null-guard
    // computed its "unbound" local via renderCsharpValue, which lowers a
    // whole `${binding}` placeholder to RequireBinding -- throwing before
    // the `if (local is not null)` check could ever run. Only a genuinely
    // null-tolerant lookup lets the field be omitted.
    test('uses a nullable GetBindingOrNull lookup (not a throwing RequireBinding) for an unbound omitWhenUnbound multipart field', async () => {
      const emitter = createSpecEmitter();
      const collection: EndpointScenarioCollection = {
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

      const files = await emitter.emit(collection, {
        ...EMIT_CTX,
        globalContextSeeds: [OMIT_WHEN_UNBOUND_SEED],
      });

      expect(files[0].content).toContain(
        'var __tenantIdVal = GetBindingOrNull(ctx, "tenantIdVar");',
      );
      expect(files[0].content).toContain(
        'if (__tenantIdVal is not null) fields1["tenantId"] = __tenantIdVal;',
      );
      expect(files[0].content).not.toContain('RequireBinding(ctx, "tenantIdVar")');
    });
  });

  test('derives request path parameters from the path template when step.pathParams is absent', async () => {
    const emitter = createSpecEmitter();
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
      'await Client.SearchJobsAsync(JobKey.AssumeExists(RequireStringBinding(ctx, "jobKeyVar")), request1, consistency: new() { WaitUpToMs = 10_000, PollIntervalMs = 500 });',
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
    const emitter = createSpecEmitter();
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
      'await Client.SearchJobsAsync(JobKey.AssumeExists(RequireStringBinding(ctx, "jobKeyVar")), request1, consistency: new() { WaitUpToMs = 10_000, PollIntervalMs = 500 });',
    );
    expect(files[0].content).not.toContain('RequireBinding(ctx, "jobKeyVar")');
  });

  test('wraps id only for global task listener operations', async () => {
    const emitter = createCsharpEmitter({
      ...OPERATION_MAP,
      getUser: [
        {
          file: 'User.cs',
          region: 'GetUserAsync',
        },
      ],
      getGlobalTaskListener: [
        {
          file: 'GlobalTaskListener.cs',
          region: 'GetGlobalTaskListenerAsync',
        },
      ],
    });
    const user = await emitter.emit(
      {
        ...SAMPLE_COLLECTION,
        endpoint: { operationId: 'getUser', method: 'GET', path: '/users/{id}' },
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                operationId: 'getUser',
                method: 'GET',
                pathTemplate: '/users/{id}',
                expect: { status: 200 },
              },
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(user[0].content).toContain('RequireStringBinding(ctx, "idVar")');
    expect(user[0].content).not.toContain('GlobalListenerId.AssumeExists');

    const listener = await emitter.emit(
      {
        ...SAMPLE_COLLECTION,
        endpoint: {
          operationId: 'getGlobalTaskListener',
          method: 'GET',
          path: '/global-task-listeners/{id}',
        },
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                operationId: 'getGlobalTaskListener',
                method: 'GET',
                pathTemplate: '/global-task-listeners/{id}',
                expect: { status: 200 },
              },
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(listener[0].content).toContain('GlobalListenerId.AssumeExists');
  });

  test('adds consistency to a successful 2xx read whose status is not 200', async () => {
    const emitter = createSpecEmitter();
    const files = await emitter.emit(
      {
        ...SAMPLE_COLLECTION,
        endpoint: { operationId: 'getUser', method: 'GET', path: '/users/{username}' },
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                operationId: 'getUser',
                method: 'GET',
                pathTemplate: '/users/{username}',
                expect: { status: 201 },
              },
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(files[0].content).toContain('consistency: new()');
  });

  test('covers usage and global statistics time windows and the terminate converter', async () => {
    const emitter = createCsharpEmitter({
      ...OPERATION_MAP,
      getUsageMetrics: [{ file: 'Usage.cs', region: 'GetUsageMetricsAsync' }],
    });
    const usage = await emitter.emit(
      {
        ...SAMPLE_COLLECTION,
        endpoint: { operationId: 'getUsageMetrics', method: 'GET', path: '/usage' },
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                operationId: 'getUsageMetrics',
                method: 'GET',
                pathTemplate: '/usage',
                expect: { status: 200 },
              },
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(usage[0].content).toContain(
      'startTime: DateTimeOffset.UtcNow.AddDays(-1), endTime: DateTimeOffset.UtcNow',
    );
    expect(
      readFileSync(
        new URL(
          '../../materializer/src/csharp-sdk/project-templates/TestFixtureBase.cs',
          import.meta.url,
        ),
        'utf8',
      ),
    ).toContain('ProcessInstanceModificationTerminateInstructionConverterFactory');
  });

  test('falls back to a plain string binding for a path parameter with no published C# key-type mapping', async () => {
    // Regression (Copilot PR #573 review): not every path parameter is a
    // strongly-typed key struct -- e.g. the real getUser operation's
    // `/users/{username}` takes a plain string. Throwing on every unmapped
    // name made generation fail entirely for such operations instead of
    // emitting the (perfectly valid) string-argument call.
    const emitter = createSpecEmitter();
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

    const files = await emitter.emit(requestWithUnknownPathParam, EMIT_CTX);

    expect(files[0].content).toContain(
      'await Client.SearchJobsAsync(RequireStringBinding(ctx, "widgetIdVar"), request1, consistency: new() { WaitUpToMs = 10_000, PollIntervalMs = 500 });',
    );
  });

  test('passes path parameters before the request body to SDK methods', async () => {
    const emitter = createSpecEmitter();
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

  test('maps createUser/createTenant/createGroup/createMappingRule to their real request DTOs', async () => {
    // Regression: these 4 operations were absent from
    // CSHARP_REQUEST_TYPE_BY_OPERATION, so `resolveRequestTypeName` returned
    // undefined and `requireRequestType` threw "No published C# request DTO
    // mapping found" for every one of them. Confirmed the real DTO names via
    // reflection against the installed Camunda.Orchestration.Sdk 9.2.2:
    // CreateUserAsync(UserRequest), CreateTenantAsync(TenantCreateRequest),
    // CreateGroupAsync(GroupCreateRequest), CreateMappingRuleAsync(MappingRuleCreateRequest).
    const cases: Array<{ operationId: string; path: string; requestType: string }> = [
      { operationId: 'createUser', path: '/users', requestType: 'UserRequest' },
      { operationId: 'createTenant', path: '/tenants', requestType: 'TenantCreateRequest' },
      { operationId: 'createGroup', path: '/groups', requestType: 'GroupCreateRequest' },
      {
        operationId: 'createMappingRule',
        path: '/mapping-rules',
        requestType: 'MappingRuleCreateRequest',
      },
    ];

    for (const { operationId, path, requestType } of cases) {
      const emitter = createCsharpEmitter({
        [operationId]: [
          {
            file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
            region: `${operationId[0].toUpperCase()}${operationId.slice(1)}Async`,
            label: operationId,
          },
        ],
      });
      const collection: EndpointScenarioCollection = {
        endpoint: { operationId, method: 'POST', path },
        requiredSemanticTypes: [],
        optionalSemanticTypes: [],
        scenarios: [
          {
            id: 'sc1',
            name: operationId,
            description: operationId,
            operations: [{ operationId, method: 'POST', path }],
            producedSemanticTypes: [],
            satisfiedSemanticTypes: [],
            requestPlan: [
              {
                operationId,
                method: 'POST',
                pathTemplate: path,
                bodyKind: 'json',
                bodyTemplate: { name: 'test' },
                expect: { status: 201 },
              },
            ],
          },
        ],
      };

      const files = await emitter.emit(collection, EMIT_CTX);
      expect(files[0].content).toContain(`BuildRequest<${requestType}>(`);
    }
  });

  test('feature and variant suites for the same operationId emit distinct C# class names', async () => {
    // Regression: a feature suite and a variant suite for the same
    // operationId previously both emitted `public class
    // CreateProcessInstanceTests`, which is a CS0101 duplicate-type error
    // once both files are compiled into the same project (C# classes
    // share one namespace across all files, unlike Playwright's
    // file-scoped `test.describe` blocks).
    const emitter = createSpecEmitter();
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
    const emitter = createSpecEmitter();
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
    const emitter = createSpecEmitter();
    const files = await emitter.emit(SAMPLE_COLLECTION, EMIT_CTX);

    expect(files[0].content).not.toContain('using Camunda.Orchestration.RestSdk.Models;');
  });

  test('uses CamundaSdkException for generated error-path assertions', async () => {
    const emitter = createSpecEmitter();
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
    const emitter = createSpecEmitter();
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

    await expect(emitter.emit(collection, EMIT_CTX)).rejects.toThrow(/returns no response body/);
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
    const emitter = createSpecEmitter();
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
            operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
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

  test('renders eventual-state witness polling after a producer step (#159)', async () => {
    const mapWithWitness: CsharpOperationMap = {
      ...OPERATION_MAP,
      getProcessInstance: [
        {
          file: 'src/Camunda.Orchestration.RestSdk/Client/OrchestrationClusterClient.cs',
          region: 'GetProcessInstanceAsync',
          label: 'Get process instance',
        },
      ],
    };
    const emitter = createCsharpEmitter(mapWithWitness);
    const collection: EndpointScenarioCollection = {
      endpoint: {
        operationId: 'createProcessInstance',
        method: 'POST',
        path: '/process-instances',
      },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'happy path',
          description: 'Create a process instance and wait for it to become active',
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
              expect: { status: 200 },
              eventualWaitsAfter: [
                {
                  state: 'ACTIVE',
                  witness: {
                    operationId: 'getProcessInstance',
                    method: 'GET',
                    pathTemplate: '/process-instances/{processInstanceKey}',
                    predicate: { path: 'state', equals: 'ACTIVE' },
                    waitUpToMs: 5000,
                    pollIntervalMs: 250,
                  },
                },
              ],
            } satisfies RequestStep,
          ],
        },
      ],
    };

    const files = await emitter.emit(collection, EMIT_CTX);

    expect(files[0].content).toContain('AwaitEventuallyWitness(');
    expect(files[0].content).toContain('await Client.GetProcessInstanceAsync(');
    expect(files[0].content).toContain('WitnessPredicateMatches(b, "state", "ACTIVE")');
    expect(files[0].content).toContain('"getProcessInstance"');
    expect(files[0].content).toContain('5000');
    expect(files[0].content).toContain('250');
  });

  test('throws when a witness operationId has no published C# SDK method mapping', async () => {
    const emitter = createSpecEmitter();
    const collection: EndpointScenarioCollection = {
      endpoint: {
        operationId: 'createProcessInstance',
        method: 'POST',
        path: '/process-instances',
      },
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
              expect: { status: 200 },
              eventualWaitsAfter: [
                {
                  state: 'ACTIVE',
                  witness: {
                    operationId: 'getProcessInstance',
                    method: 'GET',
                    pathTemplate: '/process-instances/{processInstanceKey}',
                    predicate: { path: 'state', equals: 'ACTIVE' },
                  },
                },
              ],
            } satisfies RequestStep,
          ],
        },
      ],
    };

    await expect(emitter.emit(collection, EMIT_CTX)).rejects.toThrow(
      /No published C# SDK method mapping found for operationId getProcessInstance/,
    );
  });
});

/**
 * These assertions genuinely need the REAL bundled OCA spec's discriminator
 * shapes (JobResult's `userTask`/`adHocSubProcess`, `sourceType`
 * `byId`/`byKey`, the ancestor-scope discriminator, ...) — a synthetic
 * fixture replicating them would just be a second, drifting copy of the
 * same spec facts. Guarding this block on the OCA bundle actually being on
 * disk (rather than reading it at module scope, unconditionally, for the
 * WHOLE file) means a `CONFIG=camunda-hub` run — where only the Hub bundle
 * has been fetched — can still collect and run every other test in this
 * file; only this block is skipped (PR #668 review).
 */
const OCA_BUNDLE_URL = new URL(
  '../../spec/camunda-oca/bundled/rest-api.bundle.json',
  import.meta.url,
);
const OCA_BUNDLE_AVAILABLE = existsSync(OCA_BUNDLE_URL);

describe.skipIf(!OCA_BUNDLE_AVAILABLE)('C# SDK Emitter — real OCA bundle discriminators', () => {
  const OCA_DISCRIMINATORS: CsharpDiscriminatorTable = OCA_BUNDLE_AVAILABLE
    ? buildCsharpDiscriminatorTable(JSON.parse(readFileSync(OCA_BUNDLE_URL, 'utf8')))
    : {};

  function createOcaSpecEmitter(mapping: CsharpOperationMap = OPERATION_MAP) {
    return createCsharpEmitter(mapping, { discriminators: OCA_DISCRIMINATORS });
  }

  test('preserves the supported JobResult userTask discriminator', async () => {
    const emitter = createOcaSpecEmitter();
    const collection = {
      ...SAMPLE_COLLECTION,
      scenarios: [
        {
          ...SAMPLE_COLLECTION.scenarios[0],
          requestPlan: [
            {
              ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
              operationId: 'completeJob',
              bodyKind: 'json',
              bodyTemplate: { result: { denied: true } },
              expect: { status: 200 },
            } satisfies RequestStep,
          ],
        },
      ],
    };
    const files = await emitter.emit(collection, EMIT_CTX);
    expect(files[0].content).toContain('["type"] = "userTask"');
  });

  test('preserves the supported JobResult adHocSubProcess discriminator', async () => {
    const emitter = createOcaSpecEmitter();
    const collection = {
      ...SAMPLE_COLLECTION,
      scenarios: [
        {
          ...SAMPLE_COLLECTION.scenarios[0],
          requestPlan: [
            {
              ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
              operationId: 'completeJob',
              bodyKind: 'json',
              bodyTemplate: { result: { activateElements: [] } },
              expect: { status: 200 },
            } satisfies RequestStep,
          ],
        },
      ],
    };
    const files = await emitter.emit(collection, EMIT_CTX);
    expect(files[0].content).toContain('["type"] = "adHocSubProcess"');
  });

  test('preserves the creation terminate discriminator', async () => {
    const emitter = createOcaSpecEmitter();
    const collection = {
      ...SAMPLE_COLLECTION,
      scenarios: [
        {
          ...SAMPLE_COLLECTION.scenarios[0],
          requestPlan: [
            {
              ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
              bodyKind: 'json',
              bodyTemplate: { runtimeInstructions: [{ afterElementId: 'element-1' }] },
              expect: { status: 200 },
            } satisfies RequestStep,
          ],
        },
      ],
    };
    const files = await emitter.emit(collection, EMIT_CTX);
    expect(files[0].content).toContain('["type"] = "TERMINATE_PROCESS_INSTANCE"');
  });

  test('preserves sourceType byId and byKey discriminators', async () => {
    const emitter = createOcaSpecEmitter();
    const collection = {
      ...SAMPLE_COLLECTION,
      scenarios: [
        {
          ...SAMPLE_COLLECTION.scenarios[0],
          requestPlan: [
            {
              ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
              operationId: 'modifyProcessInstance',
              bodyKind: 'json',
              bodyTemplate: {
                moveInstructions: [{ sourceElementInstruction: { sourceElementId: 'element-1' } }],
              },
              expect: { status: 200 },
            } satisfies RequestStep,
          ],
        },
      ],
    };
    const files = await emitter.emit(collection, EMIT_CTX);
    expect(files[0].content).toContain('["sourceType"] = "byId"');
    const byKeyFiles = await emitter.emit(
      {
        ...collection,
        scenarios: [
          {
            ...collection.scenarios[0],
            requestPlan: [
              {
                ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
                operationId: 'modifyProcessInstance',
                bodyKind: 'json',
                bodyTemplate: {
                  moveInstructions: [
                    { sourceElementInstruction: { sourceElementInstanceKey: '1' } },
                  ],
                },
                expect: { status: 200 },
              } satisfies RequestStep,
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(byKeyFiles[0].content).toContain('["sourceType"] = "byKey"');
  });

  test('preserves the direct ancestor scope discriminator', async () => {
    const emitter = createOcaSpecEmitter();
    const collection = {
      ...SAMPLE_COLLECTION,
      scenarios: [
        {
          ...SAMPLE_COLLECTION.scenarios[0],
          requestPlan: [
            {
              ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
              operationId: 'modifyProcessInstance',
              bodyKind: 'json',
              bodyTemplate: {
                moveInstructions: [
                  { ancestorScopeInstruction: { ancestorElementInstanceKey: '1' } },
                ],
              },
              expect: { status: 200 },
            } satisfies RequestStep,
          ],
        },
      ],
    };
    const files = await emitter.emit(collection, EMIT_CTX);
    expect(files[0].content).toContain('["ancestorScopeType"] = "direct"');
  });

  test('does not add a JobResult discriminator to a searchJobs filter', async () => {
    const files = await createOcaSpecEmitter().emit(
      singleStepCollection({
        operationId: 'searchJobs',
        method: 'POST',
        pathTemplate: '/jobs/search',
        bodyKind: 'json',
        bodyTemplate: { filter: { deniedReason: 'not allowed' } },
        expect: { status: 200 },
      }),
      EMIT_CTX,
    );
    expect(files[0].content).toContain('["deniedReason"]');
    expect(files[0].content).not.toContain('["type"]');
  });

  test('does not add an ancestor discriminator to an activate instruction', async () => {
    const files = await createOcaSpecEmitter().emit(
      singleStepCollection({
        operationId: 'modifyProcessInstance',
        method: 'POST',
        pathTemplate: '/process-instances/{processInstanceKey}/modification',
        bodyKind: 'json',
        bodyTemplate: {
          activateInstructions: [{ elementId: 'task-1', ancestorElementInstanceKey: '1' }],
        },
        expect: { status: 204 },
      }),
      EMIT_CTX,
    );
    expect(files[0].content).toContain('["ancestorElementInstanceKey"]');
    expect(files[0].content).not.toContain('["ancestorScopeType"]');
  });

  test('does not add a source discriminator to a migration mapping', async () => {
    const files = await createOcaSpecEmitter().emit(
      singleStepCollection({
        operationId: 'migrateProcessInstance',
        method: 'POST',
        pathTemplate: '/process-instances/{processInstanceKey}/migration',
        bodyKind: 'json',
        bodyTemplate: {
          targetProcessDefinitionKey: '1',
          mappingInstructions: [{ sourceElementId: 'a', targetElementId: 'b' }],
        },
        expect: { status: 204 },
      }),
      EMIT_CTX,
    );
    expect(files[0].content).toContain('["sourceElementId"]');
    expect(files[0].content).not.toContain('["sourceType"]');
  });
});

/**
 * Regression coverage for PR #668 review finding (round 5): a nested
 * discriminator table entry sharing its `path` with a SIBLING union
 * branch's own entry had no record of which branch it belonged to, so
 * `renderCsharpValue`/`chooseCsharpDiscriminator` could apply one branch's
 * mapping while actually rendering a DIFFERENT branch's value — either
 * tagging a plain, non-polymorphic sibling property with a foreign
 * discriminator, or picking the wrong one of two CONFLICTING same-path
 * mappings. The `ownerRef`/`ownerChain` fix (discriminators.ts) scopes each
 * nested entry to the branch ref that must have been selected for it to
 * apply.
 */
describe('C# SDK Emitter — discriminators scoped to the selected union branch (PR #668 review, round 5)', () => {
  const SUCCESS_REF = '#/components/schemas/Success';
  const FAILURE_REF = '#/components/schemas/Failure';

  test("does not tag a non-polymorphic sibling branch property with another branch's nested discriminator", async () => {
    // `result` is itself discriminated by `status` into `Success`/`Failure`.
    // `Success.payload` is polymorphic (tagged `kind`); `Failure.payload` is
    // a plain object and has NO corresponding table entry at all. Before the
    // fix, the lone `result.payload` entry (owned by `Success`) matched by
    // `path` alone regardless of which branch `result.status` actually
    // selected.
    const discriminators: CsharpDiscriminatorTable = {
      createProcessInstance: [
        {
          path: 'result',
          propertyName: 'status',
          subtypes: [
            { value: 'Success', properties: ['status', 'payload'], required: [], ref: SUCCESS_REF },
            { value: 'Failure', properties: ['status', 'payload'], required: [], ref: FAILURE_REF },
          ],
        },
        {
          path: 'result.payload',
          propertyName: 'kind',
          ownerRef: SUCCESS_REF,
          subtypes: [{ value: 'Text', properties: ['text'], required: ['text'] }],
        },
      ],
    };
    const emitter = createCsharpEmitter(OPERATION_MAP, { discriminators });
    const files = await emitter.emit(
      {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
                bodyKind: 'json',
                // `status` is already explicit (selects `Failure`); `payload`
                // is a plain object that must NOT receive Success's `kind` tag.
                bodyTemplate: { result: { status: 'Failure', payload: { text: 'message' } } },
                expect: { status: 200 },
              } satisfies RequestStep,
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(files[0].content).toContain('["text"] = "message"');
    expect(files[0].content).not.toContain('["kind"]');
  });

  test("picks the owning branch's mapping, not a conflicting sibling branch's same-path mapping", async () => {
    // Both `Success.payload` and `Failure.payload` are polymorphic, sharing
    // the SAME path ("result.payload") and the SAME required shape
    // (`value`), but tagging a DIFFERENT subtype name. The `Failure`-owned
    // entry is listed FIRST so a path-only (owner-blind) selection would
    // tie-break onto it.
    const discriminators: CsharpDiscriminatorTable = {
      createProcessInstance: [
        {
          path: 'result',
          propertyName: 'status',
          subtypes: [
            { value: 'Success', properties: ['status', 'payload'], required: [], ref: SUCCESS_REF },
            { value: 'Failure', properties: ['status', 'payload'], required: [], ref: FAILURE_REF },
          ],
        },
        {
          path: 'result.payload',
          propertyName: 'kind',
          ownerRef: FAILURE_REF,
          subtypes: [{ value: 'FailurePayload', properties: ['value'], required: ['value'] }],
        },
        {
          path: 'result.payload',
          propertyName: 'kind',
          ownerRef: SUCCESS_REF,
          subtypes: [{ value: 'SuccessPayload', properties: ['value'], required: ['value'] }],
        },
      ],
    };
    const emitter = createCsharpEmitter(OPERATION_MAP, { discriminators });
    const files = await emitter.emit(
      {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
                bodyKind: 'json',
                bodyTemplate: { result: { status: 'Success', payload: { value: 'x' } } },
                expect: { status: 200 },
              } satisfies RequestStep,
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(files[0].content).toContain('["kind"] = "SuccessPayload"');
    expect(files[0].content).not.toContain('["kind"] = "FailurePayload"');
  });
});

describe('C# SDK Emitter — discriminators at the request root (PR #668 review, round 6)', () => {
  const SUCCESS_REF = '#/components/schemas/Success';
  const FAILURE_REF = '#/components/schemas/Failure';

  // `emitJsonRequestDataLines` renders every top-level request field
  // separately (one `data[field] = ...` statement per field) and never
  // calls `renderCsharpValue` on the whole body, so a discriminator table
  // entry at path `''` -- the request body ITSELF being the union, not a
  // nested property -- was never selected: neither implicit injection nor
  // an explicit root tag was recognised, and every field started with an
  // empty owner chain, dropping any nested discriminator scoped to the
  // branch the root actually selected.
  const DISCRIMINATORS: CsharpDiscriminatorTable = {
    createProcessInstance: [
      {
        path: '',
        propertyName: 'status',
        subtypes: [
          { value: 'Success', properties: ['status', 'payload'], required: [], ref: SUCCESS_REF },
          { value: 'Failure', properties: ['status', 'payload'], required: [], ref: FAILURE_REF },
        ],
      },
      {
        path: 'payload',
        propertyName: 'kind',
        ownerRef: SUCCESS_REF,
        subtypes: [{ value: 'Text', properties: ['text'], required: ['text'] }],
      },
    ],
  };

  test('injects the root discriminator and scopes a root-selected branch field to it (implicit)', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP, { discriminators: DISCRIMINATORS });
    const files = await emitter.emit(
      {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
                bodyKind: 'json',
                // `status` is omitted -- shape inference must select
                // `Success` (the only matching subtype) at the request
                // root and inject it, same as a nested polymorphic field.
                bodyTemplate: { payload: { text: 'hi' } },
                expect: { status: 200 },
              } satisfies RequestStep,
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(files[0].content).toContain('["status"] = "Success"');
    expect(files[0].content).toContain('["kind"] = "Text"');
  });

  test('recognises an explicit root tag and scopes its nested field to the selected branch', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP, { discriminators: DISCRIMINATORS });
    const files = await emitter.emit(
      {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
                bodyKind: 'json',
                // `status` is explicit -- nothing to inject at the root,
                // but `payload`'s nested `kind` discriminator (owned by
                // `Success`) must still be recognised as in-branch.
                bodyTemplate: { status: 'Success', payload: { text: 'hi' } },
                expect: { status: 200 },
              } satisfies RequestStep,
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(files[0].content).toContain('["kind"] = "Text"');
  });
});

/**
 * Regression coverage for PR #668 review finding (round 7): a single
 * `renderCsharpValue`/`emitJsonRequestDataLines` resolution pass can never
 * see a discriminator whose `ownerRef` that SAME pass is about to add to the
 * chain -- so a wrapper's own discriminator (`family`) and a SECOND
 * discriminator the SELECTED branch declares on the SAME object (`kind`)
 * were never both resolved: only `family` was injected/recognised, and
 * `kind` -- gated on `family`'s own branch ref -- was silently dropped even
 * though it shares the wrapper's object, not a child field.
 * `resolveCsharpDiscriminatorChain` loops both resolvers at the same path
 * until a pass adds no new owner ref, so a chain of same-object
 * discriminators resolves fully regardless of depth.
 */
describe('C# SDK Emitter — chained same-object discriminators (PR #668 review, round 7)', () => {
  const SUCCESS_REF = '#/components/schemas/Success';
  const TEXT_REF = '#/components/schemas/TextKind';

  // `result` is tagged `family`; the `Success` branch it selects ALSO
  // declares its OWN `kind` discriminator on that SAME `result` object (not
  // a nested property) -- and `Text`'s own `tag` discriminator chains a
  // THIRD level deep, same object again, to prove the resolver isn't
  // hardcoded to exactly two levels.
  //
  // NOTE: these `properties` lists are NOT hand-flattened to include a
  // nested subtype's own fields (e.g. `Success` does not list `text`,
  // which belongs only to `Text`) -- `collectProperties`/`collectSubtypes`
  // never produce that shape (they merge a WRAPPER's own sibling
  // properties into its direct subtypes, never a nested `oneOf` branch's
  // fields). `chooseCsharpDiscriminator` sees past this transitively via
  // `collectChainedSubtypeProperties` (PR #668 review, round 8 /
  // adversarial finding, process round 5) -- a hand-flattened fixture here
  // would mask exactly the bug that finding caught.
  const DISCRIMINATORS: CsharpDiscriminatorTable = {
    createProcessInstance: [
      {
        path: 'result',
        propertyName: 'family',
        subtypes: [
          {
            value: 'Success',
            properties: ['family', 'kind'],
            required: [],
            ref: SUCCESS_REF,
          },
          { value: 'Failure', properties: ['family'], required: [] },
        ],
      },
      {
        path: 'result',
        propertyName: 'kind',
        ownerRef: SUCCESS_REF,
        subtypes: [
          {
            value: 'Text',
            properties: ['kind', 'tag'],
            required: [],
            ref: TEXT_REF,
          },
        ],
      },
      {
        path: 'result',
        propertyName: 'tag',
        ownerRef: TEXT_REF,
        subtypes: [{ value: 'Plain', properties: ['tag', 'text'], required: ['text'] }],
      },
    ],
  };

  test('implicitly injects a chain of same-object discriminators, three levels deep', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP, { discriminators: DISCRIMINATORS });
    const files = await emitter.emit(
      {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
                bodyKind: 'json',
                // None of `family`, `kind`, `tag` are explicit: shape
                // inference must select `Success` -> `Text` -> `Plain` and
                // inject all three tags onto the SAME `result` object.
                bodyTemplate: { result: { text: 'hi' } },
                expect: { status: 200 },
              } satisfies RequestStep,
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(files[0].content).toContain('["family"] = "Success"');
    expect(files[0].content).toContain('["kind"] = "Text"');
    expect(files[0].content).toContain('["tag"] = "Plain"');
  });

  test('recognises an explicit outer tag and still resolves the rest of the same-object chain', async () => {
    const emitter = createCsharpEmitter(OPERATION_MAP, { discriminators: DISCRIMINATORS });
    const files = await emitter.emit(
      {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
                bodyKind: 'json',
                // `family` is explicit; `kind`/`tag` must still be resolved
                // from the branch it selects.
                bodyTemplate: { result: { family: 'Success', text: 'hi' } },
                expect: { status: 200 },
              } satisfies RequestStep,
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(files[0].content).toContain('["kind"] = "Text"');
    expect(files[0].content).toContain('["tag"] = "Plain"');
  });

  test('resolves a chained same-object discriminator at the request root too', async () => {
    const rootDiscriminators: CsharpDiscriminatorTable = {
      createProcessInstance: [
        {
          path: '',
          propertyName: 'family',
          subtypes: [
            {
              value: 'Success',
              properties: ['family', 'kind'],
              required: [],
              ref: SUCCESS_REF,
            },
          ],
        },
        {
          path: '',
          propertyName: 'kind',
          ownerRef: SUCCESS_REF,
          subtypes: [{ value: 'Text', properties: ['kind', 'text'], required: ['text'] }],
        },
      ],
    };
    const emitter = createCsharpEmitter(OPERATION_MAP, { discriminators: rootDiscriminators });
    const files = await emitter.emit(
      {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                ...CREATE_PROCESS_INSTANCE_REQUEST_STEP,
                bodyKind: 'json',
                bodyTemplate: { text: 'hi' },
                expect: { status: 200 },
              } satisfies RequestStep,
            ],
          },
        ],
      },
      EMIT_CTX,
    );
    expect(files[0].content).toContain('["family"] = "Success"');
    expect(files[0].content).toContain('["kind"] = "Text"');
  });
});
