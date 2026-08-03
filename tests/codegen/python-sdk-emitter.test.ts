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
import { loadPythonProjectScaffoldingFiles } from '../../materializer/src/python-sdk/materialize-support.js';
import { createOperationMapSourceFromJson } from '../../materializer/src/python-sdk/sdk-mapping.js';
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
      // #<naming-fix>: prefixed with the scenario's own id (unique within a
      // collection) so scenarios sharing a display name don't collide.
      expect(output).toContain('async def test_sc1_happy_path(ctx: TestContext)');
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
      expect(output).toContain('test_sc1_happy_path');
      expect(output).toContain('test_sc2_error_case');
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
      // #354: ctx keys must be the planner's original binding name (unchanged
      // casing), not snake_cased — this must match ctx.set('tenantIdVar', ...).
      expect(body).toContain("'tenantId': ctx.get('tenantIdVar')");
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
      // #354: ctx key must be the planner's original binding name (widgetKeyVar),
      // matching whatever ctx.set(...) would use for the same binding.
      expect(output).toContain("url_1 = f'/widgets/{ctx.get('widgetKeyVar') or 'widgetKey'}'");
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
      expect(output).toContain('test_sc1_complex_scenario_with_spaces');
    });

    test('non-identifier characters in scenario name are folded to underscores (invalid Python identifier bug)', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            name: 'createProcessInstance - bpmn #1',
          },
        ],
      };

      const output = renderPythonSuite(collection);
      expect(output).toContain('async def test_sc1_createprocessinstance_bpmn_1(ctx: TestContext)');
      expect(output).not.toMatch(/async def test_\S*[^\w\s(].*\(/);
    });

    test('scenarios sharing the same display name still get distinct test functions', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          { ...SAMPLE_COLLECTION.scenarios[0], id: 'sc1', name: 'duplicate name' },
          { ...SAMPLE_COLLECTION.scenarios[0], id: 'sc2', name: 'duplicate name' },
        ],
      };

      const output = renderPythonSuite(collection);
      expect(output).toContain('async def test_sc1_duplicate_name(ctx: TestContext)');
      expect(output).toContain('async def test_sc2_duplicate_name(ctx: TestContext)');
    });
  });

  // #354 gap 4: ctx.set(...) (scenario.bindings) must use the exact same key
  // as ctx.get(...) (path-param / body-placeholder lookups). The planner
  // keys bindings by their original variable name (e.g. widgetKeyVar); the
  // emitter must not snake_case one side and not the other.
  describe('binding-key resolution (#354)', () => {
    test('ctx.set and ctx.get use the same unmodified key for path params', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            bindings: { widgetKeyVar: 'seed-widget-1' },
            requestPlan: [
              {
                operationId: 'getWidget',
                method: 'GET',
                pathTemplate: '/widgets/{widgetKey}',
                pathParams: [{ name: 'widgetKey', var: 'widgetKeyVar' }],
                expect: { status: 200 },
              },
            ],
          },
        ],
      };

      const output = renderPythonSuite(collection);

      expect(output).toContain("ctx.set('widgetKeyVar', 'seed-widget-1')");
      expect(output).toContain("ctx.get('widgetKeyVar')");
      expect(output).not.toContain('widget_key_var');
    });

    test('ctx.set and ctx.get use the same unmodified key for body placeholders', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            bindings: { tenantIdVar: 'acme' },
            requestPlan: [
              {
                operationId: 'createWidget',
                method: 'POST',
                pathTemplate: '/widgets',
                bodyKind: 'json',
                bodyTemplate: { tenantId: `${'${'}tenantIdVar}` },
                expect: { status: 201 },
              },
            ],
          },
        ],
      };

      const output = renderPythonSuite(collection);

      expect(output).toContain("ctx.set('tenantIdVar', 'acme')");
      expect(output).toContain("ctx.get('tenantIdVar')");
      expect(output).not.toContain('tenant_id_var');
    });
  });

  // #354 gap 6: the real upstream operation-map.json shapes each entry as an
  // array of { file, region, label } (see csharp-sdk/examples/operation-map.json
  // for the reference format shared across emitters), not a single
  // { package, method, qualifiedName } object.
  describe('operation map resolution (#354)', () => {
    test('resolves the SDK method name from the real op-map shape (array of {file,region,label})', () => {
      const operationMap = createOperationMapSourceFromJson(
        JSON.stringify({
          createWidget: [
            { file: 'src/client.py', region: 'create_widget_via_sdk', label: 'Create widget' },
          ],
        }),
      );

      const output = renderPythonSuite(SAMPLE_COLLECTION, { operationMap });
      expect(output).toContain('await client.create_widget_via_sdk(');
    });

    test('falls back to snake_case(operationId) when the operation is not in the map', () => {
      const operationMap = createOperationMapSourceFromJson(JSON.stringify({}));
      const output = renderPythonSuite(SAMPLE_COLLECTION, { operationMap });
      expect(output).toContain('await client.create_widget(');
    });
  });

  // The emitted pyproject.toml must pin a real, installable release of the
  // upstream SDK. PyPI's highest stable camunda-orchestration-sdk release is
  // 9.0.1 (10.x only exists as unlisted dev pre-releases pip excludes by
  // default), so `>=10.0.0` can never resolve: `pip install -e .` fails with
  // "No matching distribution found" for every consumer, on every OS.
  describe('pyproject.toml scaffolding (dependency pin)', () => {
    test('pins an installable camunda-orchestration-sdk release', () => {
      const files = loadPythonProjectScaffoldingFiles();
      const pyproject = files.find((f) => f.relativePath === 'pyproject.toml');
      expect(pyproject).toBeDefined();
      expect(pyproject?.content).toContain('camunda-orchestration-sdk>=9.0.0');
      expect(pyproject?.content).not.toMatch(/camunda-orchestration-sdk>=10\./);
    });

    // The suite is a flat collection of test_*.py files with no importable
    // package of its own. Without package-mode = false, poetry-core's build
    // backend tries to build/install a "camunda-sdk-tests" package, finds no
    // matching module/folder, and `pip install -e .` fails with
    // ModuleOrPackageNotFoundError (confirmed via a real pip install).
    test('disables poetry package-mode so the dependency-only project builds', () => {
      const files = loadPythonProjectScaffoldingFiles();
      const pyproject = files.find((f) => f.relativePath === 'pyproject.toml');
      expect(pyproject).toBeDefined();
      expect(pyproject?.content).toMatch(/\[tool\.poetry\][^[]*package-mode\s*=\s*false/);
    });
  });
});
