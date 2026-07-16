import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createJsSdkEmitter, jsSuiteFileName, renderJsSuite } from '../../materializer/src/js-sdk/emitter.js';
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
        } as RequestStep,
      ],
    },
  ],
};

describe('JavaScript SDK Emitter', () => {
  test('factory creates emitter with correct metadata', () => {
    const emitter = createJsSdkEmitter(undefined);
    expect(emitter.id).toBe('js-sdk');
    expect(emitter.name).toBe('JavaScript SDK');
    expect(emitter.supportedConfigs).toEqual(['*']);
  });

  test('suite file name uses the operationId and feature mode', () => {
    expect(jsSuiteFileName(SAMPLE_COLLECTION)).toBe('getWidget/getWidget.feature.test.ts');
  });

  test('emitter.emit returns one file with generated suite content', async () => {
    const emitter = createJsSdkEmitter(undefined);
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
    expect(files[0].content).toContain("import { describe, it, expect, beforeEach } from 'vitest';");
    expect(files[0].content).toContain("import { createApiClient } from '@camunda8/sdk';");
    expect(files[0].content).toContain(
      "import type { ApiClient, RestClientError } from '@camunda8/sdk';",
    );
  });

  test('rendered suite substitutes path params and renders extract bindings', () => {
    const output = renderJsSuite(SAMPLE_COLLECTION, { mode: 'feature' });

    expect(output).toContain("const url1 = `/widgets/${ctx['widgetIdVar'] ?? '{widgetId}'}`;"
    );
    expect(output).toContain('expect(response1.status).toBe(200);');
    expect(output).toContain("ctx['widgetId'] = response1.data?.data?.id;");
  });

  test('js SDK generation script builds the emitter before generation', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.['codegen:js-sdk:all']).toContain('build:emitter-sdk');
  });
});
