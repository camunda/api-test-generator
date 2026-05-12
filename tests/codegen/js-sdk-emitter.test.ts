import { describe, expect, it } from 'vitest';
import {
  createJsSdkEmitter,
  jsSdkSuiteFileName,
  renderJsSdkSuite,
} from '../../path-analyser/src/codegen/js-sdk/emitter.ts';
import {
  FallbackMappingSource,
  OperationMapJsonSource,
} from '../../path-analyser/src/codegen/js-sdk/sdk-mapping.ts';
import type { EndpointScenarioCollection } from '../../path-analyser/src/types.ts';

/**
 * Layer-1 fixture — JS SDK emitter.
 *
 * Each `it` block asserts one property of the lowering from a hand-built
 * `EndpointScenarioCollection` to emitted Vitest source. The fixtures here
 * are the regression guard: if the emitter changes the generated output in a
 * breaking way, exactly the affected assertion fails.
 */

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

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
          // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal — generator template placeholder
          bodyTemplate: { name: '${processDefNameVar}' },
          expect: { status: 200 },
          extract: [{ fieldPath: 'key', bind: 'processDefinitionKeyVar' }],
        },
        {
          operationId: 'createProcessInstance',
          method: 'POST',
          pathTemplate: '/process-instances',
          bodyKind: 'json',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal — generator template placeholder
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
  it('resolves a known operationId to the camelCased region', () => {
    const src = OperationMapJsonSource.fromJson(
      JSON.stringify({
        createDeployment: [
          { file: 'deployment.ts', region: 'DeployResourcesFromFiles', label: 'Deploy' },
        ],
      }),
    );
    expect(src.resolveMethod('createDeployment')).toBe('deployResourcesFromFiles');
  });

  it('falls back to operationId when no mapping entry exists', () => {
    const src = OperationMapJsonSource.fromJson(JSON.stringify({}));
    expect(src.resolveMethod('unknownOp')).toBe('unknownOp');
  });

  it('returns knownOperationIds matching the keys of the map', () => {
    const src = OperationMapJsonSource.fromJson(
      JSON.stringify({
        getTopology: [{ file: 'client.ts', region: 'GetTopology', label: 'Topology' }],
        createUser: [{ file: 'user.ts', region: 'CreateUser', label: 'User' }],
      }),
    );
    expect(src.knownOperationIds().sort()).toEqual(['createUser', 'getTopology']);
  });

  it('picks the FIRST entry when multiple variants exist', () => {
    const src = OperationMapJsonSource.fromJson(
      JSON.stringify({
        createProcessInstance: [
          { file: 'process-instance.ts', region: 'CreateProcessInstanceById', label: 'By ID' },
          { file: 'process-instance.ts', region: 'CreateProcessInstanceByKey', label: 'By key' },
        ],
      }),
    );
    // First entry wins: "CreateProcessInstanceById" → "createProcessInstanceById"
    expect(src.resolveMethod('createProcessInstance')).toBe('createProcessInstanceById');
  });
});

// ---------------------------------------------------------------------------
// FallbackMappingSource
// ---------------------------------------------------------------------------

describe('FallbackMappingSource', () => {
  it('returns the operationId unchanged', () => {
    expect(FALLBACK_MAPPING.resolveMethod('createWidget')).toBe('createWidget');
  });

  it('returns an empty knownOperationIds list', () => {
    expect(FALLBACK_MAPPING.knownOperationIds()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// jsSdkSuiteFileName
// ---------------------------------------------------------------------------

describe('jsSdkSuiteFileName', () => {
  it('produces a .test.ts file in feature mode', () => {
    expect(jsSdkSuiteFileName(MINIMAL_COLLECTION, 'feature')).toBe('getTopology.feature.test.ts');
  });

  it('produces a .test.ts file in variant mode', () => {
    expect(jsSdkSuiteFileName(MINIMAL_COLLECTION, 'variant')).toBe('getTopology.variant.test.ts');
  });
});

// ---------------------------------------------------------------------------
// renderJsSdkSuite — suite preamble
// ---------------------------------------------------------------------------

describe('renderJsSdkSuite — preamble', () => {
  it('emits vitest imports (not Playwright)', () => {
    const src = renderJsSdkSuite(MINIMAL_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain("import { describe, test } from 'vitest'");
    expect(src).not.toContain('@playwright/test');
  });

  it('imports createCamundaClient from the SDK package', () => {
    const src = renderJsSdkSuite(MINIMAL_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain("import createCamundaClient from '@camunda8/orchestration-cluster-api'");
  });

  it('imports seeding utilities from ./support/seeding', () => {
    const src = renderJsSdkSuite(MINIMAL_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain("import { extractInto, seedBinding } from './support/seeding'");
  });

  it('creates a shared client at module scope', () => {
    const src = renderJsSdkSuite(MINIMAL_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain('const client = createCamundaClient()');
  });

  it('wraps scenarios in a describe block keyed by suiteName', () => {
    const src = renderJsSdkSuite(MINIMAL_COLLECTION, FALLBACK_MAPPING, {
      suiteName: 'getTopology',
    });
    expect(src).toContain("describe('getTopology'");
  });
});

// ---------------------------------------------------------------------------
// renderJsSdkSuite — no-arg operation
// ---------------------------------------------------------------------------

describe('renderJsSdkSuite — no-arg operation', () => {
  it('emits client.<method>() with no args when no body or path params', () => {
    const noArgCollection: EndpointScenarioCollection = {
      ...MINIMAL_COLLECTION,
      scenarios: [
        {
          ...MINIMAL_COLLECTION.scenarios[0],
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
    const src = renderJsSdkSuite(noArgCollection, FALLBACK_MAPPING, {});
    expect(src).toContain('client.getTopology()');
  });
});

// ---------------------------------------------------------------------------
// renderJsSdkSuite — JSON body
// ---------------------------------------------------------------------------

describe('renderJsSdkSuite — JSON body', () => {
  it('emits client.<method>(args) with body fields resolved from ctx', () => {
    const src = renderJsSdkSuite(JSON_BODY_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain('client.createProcessDefinition(args1)');
    expect(src).toContain('ctx["processDefNameVar"]');
  });

  it('emits extract calls from the typed response (no .json())', () => {
    const src = renderJsSdkSuite(JSON_BODY_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain("extractInto(ctx, 'processDefinitionKeyVar', result1.key)");
    expect(src).not.toContain('.json()');
  });

  it('uses the mapped method symbol from the operation-map', () => {
    const mapping = OperationMapJsonSource.fromJson(
      JSON.stringify({
        createProcessDefinition: [
          { file: 'def.ts', region: 'CreateProcessDefinitionById', label: 'By ID' },
        ],
        createProcessInstance: [
          { file: 'pi.ts', region: 'CreateProcessInstanceById', label: 'By ID' },
        ],
      }),
    );
    const src = renderJsSdkSuite(JSON_BODY_COLLECTION, mapping, {});
    expect(src).toContain('client.createProcessDefinitionById(args1)');
    expect(src).toContain('client.createProcessInstanceById(args2)');
  });
});

// ---------------------------------------------------------------------------
// renderJsSdkSuite — path parameters
// ---------------------------------------------------------------------------

describe('renderJsSdkSuite — path parameters', () => {
  it('includes path parameters in the args object', () => {
    const src = renderJsSdkSuite(PATH_PARAM_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain("processInstanceKey: ctx['processInstanceKeyVar']");
  });

  it('emits client.<method>(args) (not a bare ctx lookup)', () => {
    const src = renderJsSdkSuite(PATH_PARAM_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain('client.cancelProcessInstance(args1)');
  });
});

// ---------------------------------------------------------------------------
// renderJsSdkSuite — bindings & seeding
// ---------------------------------------------------------------------------

describe('renderJsSdkSuite — bindings', () => {
  it('seeds __PENDING__ bindings via seedBinding()', () => {
    const src = renderJsSdkSuite(PATH_PARAM_COLLECTION, FALLBACK_MAPPING, {});
    expect(src).toContain("seedBinding('processInstanceKeyVar')");
  });

  it('emits literal bindings as ctx assignments', () => {
    const withLiteral: EndpointScenarioCollection = {
      ...MINIMAL_COLLECTION,
      scenarios: [
        {
          ...MINIMAL_COLLECTION.scenarios[0],
          bindings: { tenantIdVar: 'my-tenant' },
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
    const src = renderJsSdkSuite(withLiteral, FALLBACK_MAPPING, {});
    expect(src).toContain('ctx[\'tenantIdVar\'] = "my-tenant"');
  });
});

// ---------------------------------------------------------------------------
// renderJsSdkSuite — multipart hard-fail
// ---------------------------------------------------------------------------

describe('renderJsSdkSuite — multipart hard-fail', () => {
  it('throws when a step has bodyKind=multipart', () => {
    const multipartCollection: EndpointScenarioCollection = {
      endpoint: {
        operationId: 'createDeployment',
        method: 'POST',
        path: '/deployments',
      },
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
    expect(() => renderJsSdkSuite(multipartCollection, FALLBACK_MAPPING, {})).toThrow(/multipart/);
  });
});

// ---------------------------------------------------------------------------
// JsSdkEmitter (Emitter contract)
// ---------------------------------------------------------------------------

describe('JsSdkEmitter (Emitter contract)', () => {
  const emitter = createJsSdkEmitter();

  it('has id "js-sdk" and a descriptive name', () => {
    expect(emitter.id).toBe('js-sdk');
    expect(emitter.name).toMatch(/javascript.*sdk/i);
  });

  it('returns one EmittedFile per collection with a .test.ts extension', async () => {
    const files = await emitter.emit(MINIMAL_COLLECTION, {
      outDir: '/unused',
      suiteName: 'getTopology',
      mode: 'feature',
    });
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('getTopology.feature.test.ts');
    expect(files[0].relativePath).toBe(jsSdkSuiteFileName(MINIMAL_COLLECTION, 'feature'));
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

  it('renderJsSdkSuite is byte-identical to the EmittedFile content', async () => {
    const [file] = await emitter.emit(MINIMAL_COLLECTION, {
      outDir: '/unused',
      suiteName: 'getTopology',
      mode: 'feature',
    });
    const direct = renderJsSdkSuite(MINIMAL_COLLECTION, new FallbackMappingSource(), {
      suiteName: 'getTopology',
      mode: 'feature',
    });
    expect(file.content).toBe(direct);
  });

  it('variant mode produces a .variant.test.ts file name', async () => {
    const files = await emitter.emit(MINIMAL_COLLECTION, {
      outDir: '/unused',
      suiteName: 'getTopology',
      mode: 'variant',
    });
    expect(files[0].relativePath).toBe('getTopology.variant.test.ts');
  });
});
