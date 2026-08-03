import { describe, expect, test } from 'vitest';
import {
  createJsSdkEmitter,
  jsSuiteFileName,
  renderJsSuite,
} from '../../materializer/src/js-sdk/emitter.js';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.ts';

const SAMPLE_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'getWidget', method: 'GET', path: '/widgets/{widgetId}' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      description: 'Fetch a widget by ID',
      operations: [{ operationId: 'getWidget', method: 'GET', path: '/widgets/{widgetId}' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'getWidget',
          method: 'GET',
          pathTemplate: '/widgets/{widgetId}',
          pathParams: [{ name: 'widgetId', var: 'widgetIdVar' }],
          expect: { status: 200 },
          extract: [{ fieldPath: 'data.id', bind: 'widgetId' }],
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
    expect(jsSuiteFileName(SAMPLE_COLLECTION)).toBe('getWidget/getWidget.feature.test.ts');
  });

  test('emitter.emit returns one file with generated suite content', async () => {
    const emitter = createJsSdkEmitter();
    const files = await emitter.emit(SAMPLE_COLLECTION, {
      outDir: '/unused',
      suiteName: 'getWidget',
      mode: 'feature',
      configName: 'test',
      emitterConfig: {},
      resolveConfigPath: (rel) => rel,
    });

    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('getWidget/getWidget.feature.test.ts');
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
});
