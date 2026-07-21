/**
 * Tests for the Python SDK emitter.
 *
 * Commit a8ef2a8 — fixture golden update + byte-identical emit assertion
 * Tests validate that the Python SDK emitter produces deterministic,
 * byte-identical output for the same input scenarios.
 */

import { describe, expect, test } from 'vitest';
import {
  createPythonSdkEmitter,
  pythonSuiteFileName,
  renderPythonBody,
  renderPythonSuite,
} from '../../materializer/src/python-sdk/emitter.js';
import type { EndpointScenarioCollection } from '../../path-analyser/src/types.js';

const SAMPLE_COLLECTION: EndpointScenarioCollection = {
  endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      description: 'Create a widget with a name',
      operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
      requestPlan: [
        {
          operationId: 'createWidget',
          method: 'POST',
          pathTemplate: '/widgets',
          bodyKind: 'json',
          bodyTemplate: { name: 'widget-1' },
          expect: { status: 201 },
        },
      ],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
    },
  ],
};

describe('Python SDK Emitter', () => {
  test('factory creates emitter with correct metadata', () => {
    const emitter = createPythonSdkEmitter(undefined);
    expect(emitter.id).toBe('python-sdk');
    expect(emitter.name).toBe('Python SDK');
    expect(emitter.supportedConfigs).toEqual(['*']);
  });

  test('suite file name follows snake_case convention', () => {
    expect(pythonSuiteFileName(SAMPLE_COLLECTION)).toBe('test_create_widget.py');

    // Test camelCase conversion
    const camelCaseCollection: EndpointScenarioCollection = {
      ...SAMPLE_COLLECTION,
      endpoint: { operationId: 'deployProcessDefinition', method: 'POST', path: '/bpmn' },
    };
    expect(pythonSuiteFileName(camelCaseCollection)).toBe('test_deploy_process_definition.py');
  });

  test('emitter emit returns EmittedFile with correct structure', async () => {
    const emitter = createPythonSdkEmitter(undefined);
    const files = await emitter.emit(SAMPLE_COLLECTION, {
      outDir: '/tmp',
      suiteName: 'createWidget',
      mode: 'feature',
      configName: 'camunda-oca',
      emitterConfig: {},
      resolveConfigPath: (rel) => rel,
    });

    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('test_create_widget.py');
    expect(typeof files[0].content).toBe('string');
    expect(files[0].content.length).toBeGreaterThan(0);
  });

  describe('byte-identical determinism', () => {
    test('same input produces identical output across multiple calls', () => {
      const emitted1 = renderPythonSuite(SAMPLE_COLLECTION);
      const emitted2 = renderPythonSuite(SAMPLE_COLLECTION);
      expect(emitted1).toBe(emitted2);
    });

    test('fixture golden — sample collection produces expected output structure', () => {
      const output = renderPythonSuite(SAMPLE_COLLECTION);

      // Verify header and docstring
      expect(output).toContain('"""');
      expect(output).toContain('Auto-generated tests for createWidget');

      // Verify imports
      expect(output).toContain('import pytest');
      expect(output).toContain('from typing import Any, Dict');

      // Verify test context class
      expect(output).toContain('class TestContext:');
      expect(output).toContain('def get(self, key: str');
      expect(output).toContain('def set(self, key: str, value: Any)');

      // Verify fixture
      expect(output).toContain('@pytest.fixture');
      expect(output).toContain('def ctx() -> TestContext:');

      // Verify test function
      expect(output).toContain('@pytest.mark.asyncio');
      expect(output).toContain('async def test_happy_path(ctx: TestContext)');
      expect(output).toContain('Step 1: createWidget');
    });

    test('multi-scenario collection generates all tests', () => {
      const multiScenarioCollection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          ...SAMPLE_COLLECTION.scenarios,
          {
            id: 'sc2',
            name: 'error case',
            operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
            producedSemanticTypes: [],
            satisfiedSemanticTypes: [],
          },
        ],
      };

      const output = renderPythonSuite(multiScenarioCollection);
      expect(output).toContain('test_happy_path');
      expect(output).toContain('test_error_case');
    });
  });

  describe('Python syntax correctness', () => {
    test('renderPythonBody emits Python booleans/null literals', () => {
      const body = renderPythonBody(
        {
          enabled: true,
          archived: false,
          owner: null,
          labels: ['x', null, true],
          tenantId: `${'${'}tenantIdVar}`,
        },
        {},
      );

      expect(body).toContain("'enabled': True");
      expect(body).toContain("'archived': False");
      expect(body).toContain("'owner': None");
      expect(body).toContain("'labels': ['x', None, True]");
      expect(body).toContain("'tenantId': ctx.get('tenant_id_var')");
      expect(body).not.toContain(': true');
      expect(body).not.toContain(': false');
      expect(body).not.toContain(': null');
    });

    test('generated code contains valid Python syntax markers', () => {
      const output = renderPythonSuite(SAMPLE_COLLECTION);

      // Verify Python syntax elements
      expect(output).toContain('def ');
      expect(output).toContain('class ');
      expect(output).toContain('async def');
      expect(output).toContain('-> ');
      expect(output).toContain('Dict[str, Any]');
      expect(output).toContain('None:');
    });

    test('docstrings use triple quotes', () => {
      const output = renderPythonSuite(SAMPLE_COLLECTION);
      const docstringCount = (output.match(/"""/g) || []).length;
      // Should have multiple docstrings (module, class, functions)
      expect(docstringCount).toBeGreaterThanOrEqual(4);
    });

    test('fixture annotations match pytest conventions', () => {
      const output = renderPythonSuite(SAMPLE_COLLECTION);
      expect(output).toContain('@pytest.fixture');
      expect(output).toContain('def ctx() -> TestContext:');
      expect(output).toContain('return TestContext()');
    });
  });

  describe('test function generation', () => {
    test('test functions are async', () => {
      const output = renderPythonSuite(SAMPLE_COLLECTION);
      expect(output).toContain('async def test_');
    });

    test('test functions accept ctx parameter', () => {
      const output = renderPythonSuite(SAMPLE_COLLECTION);
      expect(output).toContain('(ctx: TestContext)');
    });

    test('test functions include operation steps', () => {
      const output = renderPythonSuite(SAMPLE_COLLECTION);
      expect(output).toContain('# Step 1: createWidget');
    });

    test('uses requestPlan for executable step emission (no TODO placeholders)', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            operations: [{ operationId: 'placeholderOp', method: 'GET', path: '/placeholder' }],
            requestPlan: [
              {
                operationId: 'createWidget',
                method: 'POST',
                pathTemplate: '/widgets/{widgetKey}',
                pathParams: [{ name: 'widgetKey', var: 'widgetKeyVar' }],
                bodyKind: 'json',
                bodyTemplate: {
                  enabled: true,
                  archived: false,
                  owner: null,
                },
                expect: { status: 201 },
              },
            ],
          },
        ],
      };

      const output = renderPythonSuite(collection);

      expect(output).toContain('# Step 1: createWidget');
      expect(output).toContain("url_1 = f'/widgets/{ctx.get('widget_key_var') or 'widgetKey'}'");
      expect(output).toContain("body_1 = {'enabled': True, 'archived': False, 'owner': None}");
      expect(output).toContain('response_1 = await client.create_widget(');
      expect(output).toContain("assert response_1['status'] == 201");
      expect(output).not.toContain('placeholderOp');
      expect(output).not.toContain('pass  # TODO: implement');
    });

    test('scenario name is converted to valid test function name', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            name: 'Complex Scenario With Spaces',
          },
        ],
      };

      const output = renderPythonSuite(collection);
      expect(output).toContain('test_complex_scenario_with_spaces');
    });
  });
});
