import { describe, expect, test } from 'vitest';
import {
  createJsSdkEmitter,
  jsSuiteFileName,
  renderJsSuite,
} from '../../materializer/src/js-sdk/emitter.js';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.ts';

const SAMPLE_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'getUser', method: 'GET', path: '/users/{username}' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      description: 'Fetch a user by username',
      operations: [{ operationId: 'getUser', method: 'GET', path: '/users/{username}' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'getUser',
          method: 'GET',
          pathTemplate: '/users/{username}',
          pathParams: [{ name: 'widgetId', var: 'widgetIdVar' }],
          expect: { status: 200 },
          extract: [{ fieldPath: 'data.id', bind: 'widgetId' }],
        } satisfies RequestStep,
      ],
    },
  ],
};

const UNMAPPED_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'getNonexistentThing', method: 'GET', path: '/nonexistent/{id}' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      description: 'An operationId with no backing SDK method',
      operations: [
        { operationId: 'getNonexistentThing', method: 'GET', path: '/nonexistent/{id}' },
      ],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'getNonexistentThing',
          method: 'GET',
          pathTemplate: '/nonexistent/{id}',
          pathParams: [{ name: 'id', var: 'idVar' }],
          expect: { status: 200 },
        } satisfies RequestStep,
      ],
    },
  ],
};

describe('JavaScript SDK Emitter', () => {
  test('factory creates emitter with correct metadata', () => {
    const emitter = createJsSdkEmitter();
    expect(emitter.id).toBe('js-sdk');
    expect(emitter.name).toBe('JavaScript SDK');
    expect(emitter.supportedConfigs).toEqual(['*']);
  });

  test('suite file name uses the operationId and feature mode', () => {
    expect(jsSuiteFileName(SAMPLE_COLLECTION)).toBe('getUser/getUser.feature.test.ts');
  });

  test('emitter.emit returns one file with generated suite content', async () => {
    const emitter = createJsSdkEmitter();
    const files = await emitter.emit(SAMPLE_COLLECTION, {
      outDir: '/unused',
      suiteName: 'getUser',
      mode: 'feature',
      configName: 'test',
      emitterConfig: {},
      resolveConfigPath: (rel) => rel,
    });

    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('getUser/getUser.feature.test.ts');
    expect(files[0].content).toContain(
      "import { describe, it, expect, beforeEach } from 'vitest';",
    );
    expect(files[0].content).toContain("import { Camunda8 } from '@camunda8/sdk';");
    expect(files[0].content).toContain("import type { HttpSdkError } from '@camunda8/sdk';");
  });

  test('rendered suite builds a flat input object and renders extract bindings', () => {
    const output = renderJsSuite(SAMPLE_COLLECTION, { mode: 'feature' });

    expect(output).toContain('client = new Camunda8().getOrchestrationClusterApiClientLoose();');
    expect(output).toContain('const input1 = {');
    expect(output).toContain("widgetId: ctx['widgetIdVar'],");
    expect(output).not.toContain('expect(response1.status).toBe(200);');
    expect(output).toContain("ctx['widgetId'] = response1?.data?.id;");
  });

  test('scenario using an operationId with no backing SDK method is emitted as a skipped test', () => {
    const output = renderJsSuite(UNMAPPED_COLLECTION, { mode: 'feature' });

    expect(output).toContain("it.skip(\n    'sc1 - happy path',");
    expect(output).toContain(
      "// SKIPPED: no method 'getNonexistentThing' on installed @camunda8/sdk",
    );
    expect(output).not.toContain('const input1 = {');
    expect(output).not.toContain('client.getNonexistentThing');
  });
});
