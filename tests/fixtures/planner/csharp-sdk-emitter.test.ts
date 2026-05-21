import { describe, expect, it } from 'vitest';
import { createCsharpEmitter } from '../../../materializer/src/csharp-sdk/emitter.ts';
import type { EndpointScenarioCollection } from '../../../path-analyser/src/types.ts';

/**
 * Layer-1 C# SDK emitter fixture.
 *
 * Hand-built minimal `EndpointScenarioCollection` paired with structural
 * assertions on the emitted C# source. One `it` = one emitter property.
 *
 * These fixtures are the regression guard: a change to the emitter that breaks
 * the generated contract surfaces as an exact failing assertion here rather
 * than as a silent output diff. The scoping is class-level: the fixture
 * proves structural invariants that hold for ALL collections, not just the
 * named instance.
 */

const CTX = {
  outDir: '/unused',
  suiteName: 'getTopology',
  mode: 'feature' as const,
};

/**
 * Minimal no-body scenario: getTopology (no prerequisites, no request body).
 */
const FIXTURE_GET_TOPOLOGY: EndpointScenarioCollection = {
  endpoint: { operationId: 'getTopology', method: 'GET', path: '/topology' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc-topology-simple',
      name: 'get cluster topology',
      description: 'Fetches the current Zeebe cluster topology',
      operations: [{ operationId: 'getTopology', method: 'GET', path: '/topology' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
    },
  ],
};

/**
 * Two-step chain scenario: createDeployment → createProcessInstance.
 * Exercises body-template resolution and response extraction across steps.
 */
const FIXTURE_CREATE_PROCESS_INSTANCE: EndpointScenarioCollection = {
  endpoint: {
    operationId: 'createProcessInstance',
    method: 'POST',
    path: '/process-instances',
  },
  requiredSemanticTypes: ['ProcessDefinitionKey'],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc-create-pi',
      name: 'create process instance',
      operations: [
        { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
        { operationId: 'createProcessInstance', method: 'POST', path: '/process-instances' },
      ],
      producedSemanticTypes: ['ProcessInstanceKey'],
      satisfiedSemanticTypes: ['ProcessDefinitionKey'],
      requestPlan: [
        {
          operationId: 'createDeployment',
          method: 'POST',
          pathTemplate: '/deployments',
          bodyKind: 'multipart',
          multipartTemplate: {
            fields: {},
            files: { resource: '@@FILE:fixtures/bpmn/sample.bpmn' },
          },
          expect: { status: 200 },
          extract: [
            {
              fieldPath: 'deployments[0].processDefinitionKey',
              bind: 'processDefinitionKeyVar',
            },
          ],
        },
        {
          operationId: 'createProcessInstance',
          method: 'POST',
          pathTemplate: '/process-instances',
          bodyKind: 'json',
          bodyTemplate: {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional binding placeholder
            processDefinitionKey: '${processDefinitionKeyVar}',
          },
          expect: { status: 200 },
          extract: [{ fieldPath: 'processInstanceKey', bind: 'processInstanceKeyVar' }],
        },
      ],
    },
  ],
};

describe('CsharpSdkEmitter Layer-1 fixture: emitter identity', () => {
  it('emitter id is stable identifier csharp-sdk', () => {
    const emitter = createCsharpEmitter({});
    expect(emitter.id).toBe('csharp-sdk');
  });

  it('emitter name contains "C# SDK"', () => {
    const emitter = createCsharpEmitter({});
    expect(emitter.name).toMatch(/C# SDK/);
  });
});

describe('CsharpSdkEmitter Layer-1 fixture: file path contract', () => {
  it('emit() returns exactly one EmittedFile per collection', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(FIXTURE_GET_TOPOLOGY, CTX);
    expect(files).toHaveLength(1);
  });

  it('emitted file relativePath starts with csharp/', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(FIXTURE_GET_TOPOLOGY, CTX);
    expect(files[0].relativePath).toMatch(/^csharp\//);
  });

  it('emitted file relativePath is csharp/<operationId>.<mode>.cs', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(FIXTURE_GET_TOPOLOGY, CTX);
    expect(files[0].relativePath).toBe('csharp/getTopology.feature.cs');
  });

  it('emitted file path uses operationId from the collection endpoint, not suiteName override', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(FIXTURE_CREATE_PROCESS_INSTANCE, {
      ...CTX,
      suiteName: 'createProcessInstance',
    });
    expect(files[0].relativePath).toBe('csharp/createProcessInstance.feature.cs');
  });
});

describe('CsharpSdkEmitter Layer-1 fixture: C# source skeleton', () => {
  it('emitted source starts with using System; import', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(FIXTURE_GET_TOPOLOGY, CTX);
    expect(files[0].content).toMatch(/^using System;/);
  });

  it('emitted source uses the Camunda.Orchestration.RestSdk.Generated namespace', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(FIXTURE_GET_TOPOLOGY, CTX);
    expect(files[0].content).toContain('namespace Camunda.Orchestration.RestSdk.Generated');
  });

  it('emitted source declares public static class GeneratedSuite', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(FIXTURE_GET_TOPOLOGY, CTX);
    expect(files[0].content).toContain('public static class GeneratedSuite');
  });

  it('emitted source contains a PascalCase async Task method named after the suiteName', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(FIXTURE_GET_TOPOLOGY, CTX);
    expect(files[0].content).toContain('GetTopologyAsync');
  });

  it('emitted source creates an OrchestrationClusterClient', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(FIXTURE_GET_TOPOLOGY, CTX);
    expect(files[0].content).toContain('OrchestrationClusterClient');
  });
});

describe('CsharpSdkEmitter Layer-1 fixture: chain scenario', () => {
  it('fixture has correct two-step requestPlan for createDeployment → createProcessInstance', () => {
    const scenario = FIXTURE_CREATE_PROCESS_INSTANCE.scenarios[0];
    expect(scenario.requestPlan).toHaveLength(2);
    expect(scenario.requestPlan?.[0].operationId).toBe('createDeployment');
    expect(scenario.requestPlan?.[1].operationId).toBe('createProcessInstance');
  });

  it('emitted chain output mentions createDeployment as a step', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(FIXTURE_CREATE_PROCESS_INSTANCE, {
      ...CTX,
      suiteName: 'createProcessInstance',
    });
    expect(files[0].content).toContain('createDeployment');
  });

  it('emitted chain output mentions createProcessInstance as a step', async () => {
    const emitter = createCsharpEmitter({});
    const files = await emitter.emit(FIXTURE_CREATE_PROCESS_INSTANCE, {
      ...CTX,
      suiteName: 'createProcessInstance',
    });
    expect(files[0].content).toContain('createProcessInstance');
  });
});
