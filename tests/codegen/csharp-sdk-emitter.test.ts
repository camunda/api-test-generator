import { describe, expect, test } from 'vitest';
import { createCsharpEmitter } from '../../path-analyser/src/codegen/csharp-sdk/emitter.ts';
import type { EndpointScenarioCollection } from '../../path-analyser/src/types.ts';

const COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
    },
  ],
};

const DEPLOYMENT_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'createDeployment',
          method: 'POST',
          pathTemplate: '/deployments',
          bodyKind: 'multipart',
          multipartTemplate: {
            fields: { tenantId: '${tenantIdVar}' },
            files: { resource: '@@FILE:fixtures/bpmn/sample.bpmn' },
          },
          expect: { status: 200 },
        },
      ],
    },
  ],
};

const PROCESS_INSTANCE_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'createProcessInstance', method: 'POST', path: '/process-instances' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      operations: [
        { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
        { operationId: 'createProcessInstance', method: 'POST', path: '/process-instances' },
      ],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'createProcessInstance',
          method: 'POST',
          pathTemplate: '/process-instances',
          bodyKind: 'json',
          bodyTemplate: {
            processDefinitionKey: '${processDefinitionKeyVar}',
            variables: { foo: 'bar' },
          },
          expect: { status: 200 },
          extract: [{ fieldPath: 'processInstanceKey', bind: 'processInstanceKeyVar' }],
        },
      ],
    },
  ],
};

const SEARCH_JOBS_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'searchJobs', method: 'POST', path: '/jobs/search' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      operations: [{ operationId: 'searchJobs', method: 'POST', path: '/jobs/search' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'searchJobs',
          method: 'POST',
          pathTemplate: '/jobs/search',
          bodyKind: 'json',
          bodyTemplate: {
            page: { limit: 5 },
            filter: { type: 'payment' },
          },
          expect: { status: 200 },
        },
      ],
    },
  ],
};

describe('C# SDK emitter (Emitter contract)', () => {
  test('id and name are stable identifiers', () => {
    const emitter = createCsharpEmitter({});
    expect(emitter.id).toBe('csharp-sdk');
    expect(emitter.name).toMatch(/C# SDK/);
  });

  test('returns one EmittedFile with a csharp path', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(COLLECTION, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
    });
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('csharp/createWidget.feature.cs');
  });

  test('emit() is pure: does not touch the filesystem (outDir is unused)', async () => {
    const emitter = createCsharpEmitter({});
    await expect(
      emitter.emit(COLLECTION, {
        outDir: '/this/does/not/exist',
        suiteName: 'createWidget',
        mode: 'feature',
      }),
    ).resolves.toBeDefined();
  });

  test('operation-map entries override the default method name', async () => {
    const emitter = createCsharpEmitter({
      createDeployment: [{ region: 'CreateDeploymentCustomAsync' }],
    });
    const files = await emitter.emit(DEPLOYMENT_COLLECTION, {
      outDir: '/unused',
      suiteName: 'createDeployment',
      mode: 'feature',
    });
    expect(files[0].content).toContain('client.CreateDeploymentCustomAsync');
  });

  test('emits core SDK call scaffolding for createProcessInstance', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(PROCESS_INSTANCE_COLLECTION, {
      outDir: '/unused',
      suiteName: 'createProcessInstance',
      mode: 'feature',
    });
    const content = files[0].content;
    expect(content).toContain('var instanceRequest = FromTemplate<CreateProcessInstanceRequest>');
    expect(content).toContain('client.CreateProcessInstanceAsync');
    expect(content).toContain("ApplyExtract(ctx, createProcessInstanceResponse, 'processInstanceKey', 'processInstanceKeyVar');");
  });

  test('emits SDK call scaffolding for searchJobs', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(SEARCH_JOBS_COLLECTION, {
      outDir: '/unused',
      suiteName: 'searchJobs',
      mode: 'feature',
    });
    const content = files[0].content;
    expect(content).toContain('var searchRequest = FromTemplate<JobSearchRequest>');
    expect(content).toContain('client.SearchJobsAsync');
  });
});
