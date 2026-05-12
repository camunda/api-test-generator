import { describe, expect, it } from 'vitest';
import {
  createCsharpSdkEmitter,
  csharpSdkSuiteFileName,
  renderCsharpSdkSuite,
} from '../../path-analyser/src/codegen/csharp-sdk/emitter.ts';
import {
  FallbackMappingSource,
  OperationMapJsonSource,
} from '../../path-analyser/src/codegen/csharp-sdk/sdk-mapping.ts';
import type { EndpointScenarioCollection } from '../../path-analyser/src/types.ts';

const FALLBACK_MAPPING = new FallbackMappingSource();

const MINIMAL_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'getTopology', method: 'GET', path: '/topology' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'get topology',
      operations: [{ operationId: 'getTopology', method: 'GET', path: '/topology' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'getTopology',
          method: 'GET',
          pathTemplate: '/topology',
          expect: { status: 200 },
        },
      ],
    },
  ],
};

const JSON_BODY_COLLECTION: EndpointScenarioCollection = {
  endpoint: {
    operationId: 'createProcessInstance',
    method: 'POST',
    path: '/process-instances',
  },
  requiredSemanticTypes: ['ProcessDefinitionKey'],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'create by definition key',
      operations: [
        {
          operationId: 'createProcessDefinition',
          method: 'POST',
          path: '/process-definitions',
        },
        {
          operationId: 'createProcessInstance',
          method: 'POST',
          path: '/process-instances',
        },
      ],
      producedSemanticTypes: ['ProcessInstanceKey'],
      satisfiedSemanticTypes: ['ProcessDefinitionKey'],
      requestPlan: [
        {
          operationId: 'createProcessDefinition',
          method: 'POST',
          pathTemplate: '/process-definitions',
          bodyKind: 'json',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: generator template placeholder
          bodyTemplate: { name: '${processDefNameVar}' },
          expect: { status: 200 },
          extract: [{ fieldPath: 'key', bind: 'processDefinitionKeyVar' }],
        },
        {
          operationId: 'createProcessInstance',
          method: 'POST',
          pathTemplate: '/process-instances',
          bodyKind: 'json',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: generator template placeholder
          bodyTemplate: { processDefinitionKey: '${processDefinitionKeyVar}' },
          expect: { status: 200 },
          extract: [{ fieldPath: 'processInstanceKey', bind: 'processInstanceKeyVar' }],
        },
      ],
    },
  ],
};

const PATH_PARAM_COLLECTION: EndpointScenarioCollection = {
  endpoint: {
    operationId: 'cancelProcessInstance',
    method: 'POST',
    path: '/process-instances/{processInstanceKey}/cancellation',
  },
  requiredSemanticTypes: ['ProcessInstanceKey'],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'cancel instance',
      operations: [
        {
          operationId: 'cancelProcessInstance',
          method: 'POST',
          path: '/process-instances/{processInstanceKey}/cancellation',
        },
      ],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: ['ProcessInstanceKey'],
      bindings: { processInstanceKeyVar: '__PENDING__' },
      seedBindings: ['processInstanceKeyVar'],
      requestPlan: [
        {
          operationId: 'cancelProcessInstance',
          method: 'POST',
          pathTemplate: '/process-instances/{processInstanceKey}/cancellation',
          pathParams: [{ name: 'processInstanceKey', var: 'processInstanceKeyVar' }],
          expect: { status: 200 },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// sdk-mapping: OperationMapJsonSource
// ---------------------------------------------------------------------------

describe('OperationMapJsonSource', () => {
  it('resolves a known operationId to the region with Async suffix', () => {
    const src = OperationMapJsonSource.fromJson(
      JSON.stringify({
        createDeployment: [
          { file: 'deployment.cs', region: 'DeployResourcesFromFiles', label: 'Deploy' },
        ],
      }),
    );
    expect(src.resolveMethod('createDeployment')).toBe('DeployResourcesFromFilesAsync');
  });

  it('falls back to PascalCase operationId + Async when no mapping entry exists', () => {
    const src = OperationMapJsonSource.fromJson(JSON.stringify({}));
    expect(src.resolveMethod('createWidget')).toBe('CreateWidgetAsync');
  });

  it('returns knownOperationIds matching the keys of the map', () => {
    const src = OperationMapJsonSource.fromJson(
      JSON.stringify({
        getTopology: [{ file: 'client.cs', region: 'GetTopology', label: 'Topology' }],
        createUser: [{ file: 'user.cs', region: 'CreateUser', label: 'User' }],
      }),
    );
    expect(src.knownOperationIds().sort()).toEqual(['createUser', 'getTopology']);
  });
});

// ---------------------------------------------------------------------------
// FallbackMappingSource
// ---------------------------------------------------------------------------

describe('FallbackMappingSource', () => {
  it('returns the operationId in PascalCase with Async suffix', () => {
    expect(FALLBACK_MAPPING.resolveMethod('createWidget')).toBe('CreateWidgetAsync');
  });
});

// ---------------------------------------------------------------------------
// csharpSdkSuiteFileName
// ---------------------------------------------------------------------------

describe('csharpSdkSuiteFileName', () => {
  it('produces a per-operation .Tests.cs file in feature mode', () => {
    expect(csharpSdkSuiteFileName(MINIMAL_COLLECTION, 'feature')).toBe(
      'getTopology/getTopology.feature.Tests.cs',
    );
  });

  it('produces a per-operation .Tests.cs file in variant mode', () => {
    expect(csharpSdkSuiteFileName(MINIMAL_COLLECTION, 'variant')).toBe(
      'getTopology/getTopology.variant.Tests.cs',
    );
  });
});

// ---------------------------------------------------------------------------
// renderCsharpSdkSuite — preamble
// ---------------------------------------------------------------------------

describe('renderCsharpSdkSuite — preamble', () => {
  it('emits xUnit imports and a test class', () => {
    const src = renderCsharpSdkSuite(MINIMAL_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain('using Xunit;');
    expect(src).toContain('public class GetTopologyTests : TestFixtureBase');
  });

  it('wraps scenarios in [Fact] async Task methods', () => {
    const src = renderCsharpSdkSuite(MINIMAL_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain('[Fact]');
    expect(src).toContain('public async Task Scenario_sc1_get_topology()');
  });
});

// ---------------------------------------------------------------------------
// renderCsharpSdkSuite — JSON body
// ---------------------------------------------------------------------------

describe('renderCsharpSdkSuite — JSON body', () => {
  it('emits BuildRequest<T> with body fields resolved from ctx', () => {
    const src = renderCsharpSdkSuite(JSON_BODY_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain('BuildRequest<CreateProcessDefinitionRequest>');
    expect(src).toContain('ctx["processDefNameVar"]');
  });

  it('uses the mapped method symbol from the operation-map', () => {
    const mapping = OperationMapJsonSource.fromJson(
      JSON.stringify({
        createProcessDefinition: [
          { file: 'def.cs', region: 'CreateProcessDefinitionById', label: 'By ID' },
        ],
        createProcessInstance: [
          { file: 'pi.cs', region: 'CreateProcessInstanceById', label: 'By ID' },
        ],
      }),
    );
    const src = renderCsharpSdkSuite(JSON_BODY_COLLECTION, mapping, {});
    expect(src).toContain('Client.CreateProcessDefinitionByIdAsync');
    expect(src).toContain('Client.CreateProcessInstanceByIdAsync');
  });
});

// ---------------------------------------------------------------------------
// renderCsharpSdkSuite — path parameters
// ---------------------------------------------------------------------------

describe('renderCsharpSdkSuite — path parameters', () => {
  it('includes path parameters in the request dictionary', () => {
    const src = renderCsharpSdkSuite(PATH_PARAM_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain('["processInstanceKey"] = ctx["processInstanceKeyVar"]');
  });

  it('emits SeedBindingIfMissing for pending bindings', () => {
    const src = renderCsharpSdkSuite(PATH_PARAM_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain('SeedBindingIfMissing(ctx, "processInstanceKeyVar"');
  });
});

// ---------------------------------------------------------------------------
// renderCsharpSdkSuite — multipart hard-fail
// ---------------------------------------------------------------------------

describe('renderCsharpSdkSuite — multipart', () => {
  it('emits multipart support when a step has bodyKind=multipart', () => {
    const multipartCollection: EndpointScenarioCollection = {
      endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'deploy resource',
          operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'createDeployment',
              method: 'POST',
              pathTemplate: '/deployments',
              bodyKind: 'multipart',
              multipartTemplate: { fields: {}, files: { resources: '@@FILE:bpmn/test.bpmn' } },
              expect: { status: 200 },
            },
          ],
        },
      ],
    };
    const src = renderCsharpSdkSuite(multipartCollection, FALLBACK_MAPPING, {});
    expect(src).toContain('BuildMultipart');
    expect(src).toContain('Client.CreateDeploymentAsync');
  });
});

// ---------------------------------------------------------------------------
// CsharpSdkEmitter (Emitter contract)
// ---------------------------------------------------------------------------

describe('CsharpSdkEmitter (Emitter contract)', () => {
  const emitter = createCsharpSdkEmitter();

  it('has id "csharp-sdk" and a descriptive name', () => {
    expect(emitter.id).toBe('csharp-sdk');
    expect(emitter.name).toMatch(/c#.*sdk/i);
  });

  it('returns one EmittedFile per collection with the expected file name', async () => {
    const files = await emitter.emit(MINIMAL_COLLECTION, {
      outDir: '/unused',
      suiteName: 'getTopology',
      mode: 'feature',
    });
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('getTopology/getTopology.feature.Tests.cs');
    expect(files[0].relativePath).toBe(csharpSdkSuiteFileName(MINIMAL_COLLECTION, 'feature'));
  });

  it('emit() is pure: does not touch the filesystem', async () => {
    await expect(
      emitter.emit(MINIMAL_COLLECTION, {
        outDir: '/this/does/not/exist',
        suiteName: 'getTopology',
        mode: 'feature',
      }),
    ).resolves.toBeDefined();
  });

  it('renderCsharpSdkSuite is byte-identical to the EmittedFile content', async () => {
    const [file] = await emitter.emit(MINIMAL_COLLECTION, {
      outDir: '/unused',
      suiteName: 'getTopology',
      mode: 'feature',
    });
    const direct = renderCsharpSdkSuite(MINIMAL_COLLECTION, new FallbackMappingSource(), {
      suiteName: 'getTopology',
      mode: 'feature',
    });
    expect(file.content).toBe(direct);
  });
});
