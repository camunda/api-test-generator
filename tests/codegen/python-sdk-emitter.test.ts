/**
 * Tests for the Python SDK emitter.
 *
 * Commit a8ef2a8 — fixture golden update + byte-identical emit assertion
 * Tests validate that the Python SDK emitter produces deterministic,
 * byte-identical output for the same input scenarios.
 */

import { describe, expect, test } from 'vitest';
import {
  buildPythonUrlExpression,
  createPythonSdkEmitter,
  pythonSuiteFileName,
  renderPythonBody,
  renderPythonSuite,
} from '../../materializer/src/python-sdk/emitter.js';
import { loadPythonProjectScaffoldingFiles } from '../../materializer/src/python-sdk/materialize-support.js';
import { createOperationMapSourceFromJson } from '../../materializer/src/python-sdk/sdk-mapping.js';
import type {
  EndpointScenarioCollection,
  EventualWaitSpec,
  RequestStep,
} from '../../path-analyser/src/types.js';

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
      expect(output).toContain(
        'async def test_sc1_happy_path(ctx: TestContext, client: httpx.AsyncClient)',
      );
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
            expectedResult: { kind: 'error' },
            requestPlan: [
              {
                operationId: 'createWidget',
                method: 'POST',
                pathTemplate: '/widgets',
                bodyKind: 'json',
                bodyTemplate: {},
                expect: { status: 400 },
              },
            ],
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
      expect(output).toContain('(ctx: TestContext, client: httpx.AsyncClient)');
    });

    test('integration mode injects the shared httpx client fixture', () => {
      const output = renderPythonSuite(SAMPLE_COLLECTION);
      expect(output).toContain('(ctx: TestContext, client: httpx.AsyncClient)');
    });

    test('integration mode never seeds client mocks inside generated tests', () => {
      const output = renderPythonSuite(SAMPLE_COLLECTION);
      expect(output).not.toContain('client = AsyncMock()');
      expect(output).not.toContain('.return_value =');
      expect(output).not.toContain('.side_effect = RuntimeError');
    });

    test('multipart steps resolve @@FILE fixtures instead of nesting file dicts', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
            requestPlan: [
              {
                operationId: 'createDeployment',
                method: 'POST',
                pathTemplate: '/deployments',
                bodyKind: 'multipart',
                multipartTemplate: {
                  fields: { tenantId: 'tenant-1' },
                  files: { resources: '@@FILE:deployments/process.bpmn' },
                },
                expect: { status: 201 },
              },
            ],
          },
        ],
      };

      const output = renderPythonSuite(collection);
      expect(output).toContain('from support.fixtures import resolve_fixture');
      expect(output).toContain("resolve_fixture('deployments/process.bpmn')");
      expect(output).not.toContain("'files': {'resources': '@@FILE:deployments/process.bpmn'}");
      expect(output).not.toContain('files=body_1');
    });

    test('seedBindings emit a seed prologue for pending prerequisite inputs', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            bindings: { passwordVar: '__PENDING__' },
            seedBindings: ['passwordVar'],
            requestPlan: [
              {
                operationId: 'createUser',
                method: 'POST',
                pathTemplate: '/users',
                bodyKind: 'json',
                bodyTemplate: { password: `${'${'}passwordVar}` },
                expect: { status: 201 },
              },
            ],
          },
        ],
      };

      const output = renderPythonSuite(collection);
      expect(output).toContain('from support.seeding import init_spec_salt, seed_binding');
      expect(output).toContain("init_spec_salt('createWidget')");
      expect(output).toContain(
        "ctx.set('passwordVar', ctx.get('passwordVar') if ctx.get('passwordVar') is not None else seed_binding('passwordVar'))",
      );
      expect(output).toContain("'password': ctx.get('passwordVar')");
    });

    // Regression (Copilot PR #573 review): the seedBindings loop had no
    // omitWhenUnbound/unique awareness at all, unlike the csharp-sdk and
    // Playwright emitters -- it always emitted an unconditional
    // seed_binding() call, sending a fabricated value for a consumer
    // scenario that should legitimately leave the binding unseeded, and
    // never passing unique=True for a client-minted/409 producer scenario.
    test('omits a seedBindings entry entirely when it is omitWhenUnbound and not client-minted/unique (consumer case)', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            seedBindings: ['tenantIdVar'],
          },
        ],
      };

      const output = renderPythonSuite(collection, {
        globalContextSeeds: [
          {
            binding: 'tenantIdVar',
            fieldName: 'tenantId',
            seedRule: 'tenantIdVar',
            omitWhenUnbound: true,
          },
        ],
      });

      expect(output).not.toContain("seed_binding('tenantIdVar')");
      expect(output).not.toContain("ctx.set('tenantIdVar'");
    });

    test('adds unique=True to seed_binding when the binding is client-minted and the consuming step declares 409 (producer case)', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            seedBindings: ['tenantIdVar'],
            requestPlan: [
              {
                operationId: 'createWidget',
                method: 'POST',
                pathTemplate: '/widgets',
                bodyKind: 'json',
                bodyTemplate: { tenantId: `${'${'}tenantIdVar}` },
                declares409: true,
                expect: { status: 201 },
              },
            ],
          },
        ],
      };

      const output = renderPythonSuite(collection, {
        globalContextSeeds: [
          {
            binding: 'tenantIdVar',
            fieldName: 'tenantId',
            seedRule: 'tenantIdVar',
            omitWhenUnbound: true,
          },
        ],
      });

      expect(output).toContain(
        "ctx.set('tenantIdVar', ctx.get('tenantIdVar') if ctx.get('tenantIdVar') is not None else seed_binding('tenantIdVar', unique=True))",
      );
    });

    // Regression (Copilot PR #573 review): init_spec_salt() was emitted once
    // at module import time, using whichever operationId happened to render
    // last across the whole run -- every test in every generated module then
    // shared that one salt for its seed_binding() calls. Placing the call
    // inside each test function scopes it correctly.
    test('calls init_spec_salt once per test function, not once at module scope', () => {
      const multiScenarioCollection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            seedBindings: ['passwordVar'],
            requestPlan: [
              {
                operationId: 'createWidget',
                method: 'POST',
                pathTemplate: '/widgets',
                bodyKind: 'json',
                bodyTemplate: { password: `${'${'}passwordVar}` },
                expect: { status: 201 },
              },
            ],
          },
          {
            id: 'sc2',
            name: 'second scenario',
            operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
            producedSemanticTypes: [],
            satisfiedSemanticTypes: [],
            seedBindings: ['passwordVar'],
            requestPlan: [
              {
                operationId: 'createWidget',
                method: 'POST',
                pathTemplate: '/widgets',
                bodyKind: 'json',
                bodyTemplate: { password: `${'${'}passwordVar}` },
                expect: { status: 201 },
              },
            ],
          },
        ],
      };

      const output = renderPythonSuite(multiScenarioCollection);
      const initCalls = output.match(/init_spec_salt\('createWidget'\)/g) ?? [];
      expect(initCalls).toHaveLength(2);
      // Every occurrence must be indented inside a test function body, never
      // flush against the left margin (module scope).
      for (const line of output.split('\n')) {
        if (line.includes('init_spec_salt(')) {
          expect(line.startsWith('    ')).toBe(true);
        }
      }
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
      // Leading '/' is stripped so the URL resolves as relative against the
      // httpx client's base_url path segment (e.g. '/v2') instead of
      // replacing it -- see conftest.py's client fixture.
      expect(output).toContain(
        'url_1 = f\'widgets/{ctx.get("widgetKeyVar") if ctx.get("widgetKeyVar") is not None else "widgetKey"}\'',
      );
      expect(output).toContain("body_1 = {'enabled': True, 'archived': False, 'owner': None}");
      expect(output).toContain('response_1 = await client.post(');
      expect(output).toContain('assert response_1.status_code == 201');
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
      expect(output).toContain(
        'async def test_sc1_createprocessinstance_bpmn_1(ctx: TestContext, client: httpx.AsyncClient)',
      );
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
      expect(output).toContain(
        'async def test_sc1_duplicate_name(ctx: TestContext, client: httpx.AsyncClient)',
      );
      expect(output).toContain(
        'async def test_sc2_duplicate_name(ctx: TestContext, client: httpx.AsyncClient)',
      );
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
      expect(output).toContain('ctx.get("widgetKeyVar")');
      expect(output).not.toContain('widget_key_var');
    });

    // step.pathParams is never populated by path-analyser (mirrors js-sdk's
    // derivePathParamNames gap) — the emitter must derive the ctx var from
    // the path template itself and must not trust a stale/incorrect
    // pathParams entry if one happens to be present.
    test('ignores a stale pathParams mapping and derives the ctx var from the path template', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                operationId: 'getWidget',
                method: 'GET',
                pathTemplate: '/widgets/{widgetKey}',
                pathParams: [{ name: 'widgetKey', var: 'someUnrelatedVar' }],
                expect: { status: 200 },
              },
            ],
          },
        ],
      };

      const output = renderPythonSuite(collection);

      expect(output).toContain('ctx.get("widgetKeyVar")');
      expect(output).not.toContain('someUnrelatedVar');
    });

    // Real path param names are consistently camelCase in this repo's spec,
    // but the derivation must still normalize a leading-uppercase name (the
    // same defensive case js-sdk's `camelCase` helper handles) rather than
    // emitting a ctx key that can never be set.
    test('camelCases a path param name with a capitalized first letter', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                operationId: 'getWidget',
                method: 'GET',
                pathTemplate: '/widgets/{WidgetKey}',
                expect: { status: 200 },
              },
            ],
          },
        ],
      };

      const output = renderPythonSuite(collection);

      expect(output).toContain('ctx.get("widgetKeyVar")');
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
  describe('HTTP method emission', () => {
    test('uses the request step HTTP method when rendering client calls', () => {
      const operationMap = createOperationMapSourceFromJson(
        JSON.stringify({
          createWidget: [
            { file: 'src/client.py', region: 'create_widget_via_sdk', label: 'Create widget' },
          ],
        }),
      );

      const output = renderPythonSuite(SAMPLE_COLLECTION, { operationMap });
      expect(output).toContain('await client.post(');
    });

    test('renders expected status assertions against real HTTP responses', () => {
      const operationMap = createOperationMapSourceFromJson(JSON.stringify({}));
      const output = renderPythonSuite(SAMPLE_COLLECTION, { operationMap });
      expect(output).toContain('assert response_1.status_code == 201');
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

  // Regression (Copilot PR #573 review): `seed_binding(name, unique=True)`
  // mixed in `os.getenv('TEST_RUN_NONCE', '')` directly — when the env var
  // is unset (the default, outside CI replay), the nonce silently fell back
  // to `''`, making a "unique" seed byte-identical to a deterministic one
  // for the whole process lifetime. That defeats the entire purpose of
  // `unique=True` (client-minted identifiers consumed by an op that
  // declares HTTP 409 collide across separate run invocations against the
  // same broker). Mirrors the `_resolveRunNonce()` per-process cache already
  // used by materializer/src/playwright/support/seeding.ts.
  describe('support/seeding.py nonce caching (#304, python-sdk)', () => {
    test('unique seeds are mixed with a per-process nonce, not a possibly-empty env lookup', () => {
      const files = loadPythonProjectScaffoldingFiles();
      const seeding = files.find((f) => f.relativePath === 'support/seeding.py');
      expect(seeding).toBeDefined();
      expect(seeding?.content).toContain('_resolve_run_nonce()');
      expect(seeding?.content).toContain('import uuid');
      // The regressed line unconditionally read the env var with a '' default
      // as the nonce for `unique=True` calls -- must no longer appear verbatim.
      expect(seeding?.content).not.toContain(
        "nonce = os.getenv('TEST_RUN_NONCE', '') if unique else ''",
      );
    });

    test('falls back to a fresh uuid4 when TEST_RUN_NONCE is unset, not an empty string', () => {
      const files = loadPythonProjectScaffoldingFiles();
      const seeding = files.find((f) => f.relativePath === 'support/seeding.py');
      expect(seeding).toBeDefined();
      expect(seeding?.content).toMatch(/_RUN_NONCE = env if env else uuid\.uuid4\(\)\.hex/);
    });
  });

  // Regression (Copilot PR #573 review): get_nested_value() only split on
  // '.' and treated a purely-numeric segment as a list index -- it never
  // recognized bracket notation (e.g. 'deployments[0].processDefinition.key'),
  // which is the actual field-path convention used across every other
  // emitter (see js-sdk/playwright's toOptionalAccessor, csharp-sdk's
  // ParseFieldPath). A path like 'deployments[0].x' looked up the literal
  // dict key "deployments[0]" instead of indexing the deployments list,
  // silently returning None for every extraction using this convention.
  describe('get_nested_value bracket-notation field paths (Copilot PR #573 review)', () => {
    test('generated helper tokenizes bracket-index segments instead of only dotted digits', () => {
      const output = renderPythonSuite(SAMPLE_COLLECTION);
      expect(output).toContain('import re');
      expect(output).toContain("for part in re.findall(r'[^.\\[\\]]+|\\[[0-9]+\\]', field_path):");
      expect(output).toContain("if part.startswith('[') and part.endswith(']'):");
      expect(output).not.toContain("for part in field_path.split('.'):");
    });

    test('extract call passes the bracket-notation field path through unchanged', () => {
      const collection: EndpointScenarioCollection = {
        ...SAMPLE_COLLECTION,
        scenarios: [
          {
            ...SAMPLE_COLLECTION.scenarios[0],
            requestPlan: [
              {
                operationId: 'createDeployment',
                method: 'POST',
                pathTemplate: '/deployments',
                bodyKind: 'json',
                bodyTemplate: {},
                expect: { status: 200 },
                extract: [
                  {
                    bind: 'processDefinitionKeyVar',
                    fieldPath: 'deployments[0].processDefinition.processDefinitionKey',
                  },
                ],
              },
            ],
          },
        ],
      };

      const output = renderPythonSuite(collection);
      expect(output).toContain(
        "ctx.set('processDefinitionKeyVar', get_nested_value(response_data_1, 'deployments[0].processDefinition.processDefinitionKey'))",
      );
    });
  });

  // Regression (Copilot PR #573 review): OperationMapSource.has() only
  // checked key presence via `in`, but lookup() additionally requires the
  // value to be a non-empty array of valid entries -- an operationId with a
  // present-but-malformed entry (e.g. `[]` or `[{}]`) reported has() === true
  // while lookup() === undefined, an inconsistency callers could rely on
  // incorrectly.
  describe('OperationMapSource.has()/lookup() consistency (Copilot PR #573 review)', () => {
    test('has() returns false for a key with an empty array value', () => {
      const map = createOperationMapSourceFromJson(JSON.stringify({ createWidget: [] }));
      expect(map.has('createWidget')).toBe(false);
      expect(map.lookup('createWidget')).toBeUndefined();
    });

    test('has() returns false for a key whose first entry is not a valid operation-map entry', () => {
      const map = createOperationMapSourceFromJson(JSON.stringify({ createWidget: [{}] }));
      expect(map.has('createWidget')).toBe(false);
      expect(map.lookup('createWidget')).toBeUndefined();
    });

    test('has() returns true only when lookup() would actually succeed', () => {
      const map = createOperationMapSourceFromJson(
        JSON.stringify({
          createWidget: [{ file: 'src/client.py', region: 'create_widget', label: 'Create' }],
        }),
      );
      expect(map.has('createWidget')).toBe(true);
      expect(map.lookup('createWidget')).toBeDefined();
    });
  });

  // Regression (Copilot PR #574 review): a successful scenario only asserted
  // response_N.status_code -- scenario.responseShapeFields (the same
  // planner-derived required/nullable field list the Playwright and C# SDK
  // emitters already assert against on their final step) was never
  // consulted, so a malformed 2xx body passed the generated Python test.
  describe('response shape assertion on the final step (Copilot PR #574 review)', () => {
    const collectionWithShape: EndpointScenarioCollection = {
      ...SAMPLE_COLLECTION,
      scenarios: [
        {
          ...SAMPLE_COLLECTION.scenarios[0],
          responseShapeFields: [
            { name: 'widgetKey', type: 'string', required: true, nullable: false },
            { name: 'tenantId', type: 'string', required: false, nullable: true },
          ],
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
        },
      ],
    };

    test('emits an assert_response_shape helper and calls it on the final step', () => {
      const output = renderPythonSuite(collectionWithShape);
      expect(output).toContain('def assert_response_shape(data: Any, fields: list) -> None:');
      expect(output).toContain(
        "assert_response_shape(response_data_1, [{'name': 'widgetKey', 'required': True, 'nullable': False}, {'name': 'tenantId', 'required': False, 'nullable': True}])",
      );
    });

    test('does not assert shape on a non-final step', () => {
      const multiStep: EndpointScenarioCollection = {
        ...collectionWithShape,
        scenarios: [
          {
            ...collectionWithShape.scenarios[0],
            requestPlan: [
              {
                operationId: 'createWidget',
                method: 'POST',
                pathTemplate: '/widgets',
                bodyKind: 'json',
                bodyTemplate: { name: 'widget-1' },
                expect: { status: 201 },
              },
              {
                operationId: 'getWidget',
                method: 'GET',
                pathTemplate: '/widgets/{widgetKey}',
                expect: { status: 200 },
              },
            ],
          },
        ],
      };

      const output = renderPythonSuite(multiStep);
      expect(output).not.toContain('assert_response_shape(response_data_1,');
      expect(output).toContain('assert_response_shape(response_data_2,');
    });

    test('does not assert shape for an error scenario', () => {
      const errorScenario: EndpointScenarioCollection = {
        ...collectionWithShape,
        scenarios: [
          {
            ...collectionWithShape.scenarios[0],
            expectedResult: { kind: 'error' },
          },
        ],
      };

      const output = renderPythonSuite(errorScenario);
      // The helper's own `def assert_response_shape(...)` is always emitted
      // (unconditional, like get_nested_value) — only the *call* site must
      // be absent for an error-expected scenario.
      expect(output).not.toContain('assert_response_shape(response_data_1,');
    });
  });
});

// Regression (Copilot PR #574 review): embedded `${var}` bindings mixed with
// literal text were only ever resolved when a placeholder occupied the
// entire string — a template like `proc-${a}-${b}` was previously emitted
// as a dead literal Python string, silently dropping both bindings.
// biome-ignore lint/suspicious/noTemplateCurlyInString: describe title intentionally names the literal `${var}` placeholder syntax under test.
describe('mixed literal + embedded ${var} template rendering (Copilot PR #574 review)', () => {
  const MIXED_TEMPLATE_COLLECTION: EndpointScenarioCollection = {
    endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
    requiredSemanticTypes: [],
    optionalSemanticTypes: [],
    scenarios: [
      {
        id: 'sc1',
        name: 'happy path',
        description: 'Create a widget with a composite name',
        operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
        producedSemanticTypes: [],
        satisfiedSemanticTypes: [],
        requestPlan: [
          {
            operationId: 'createWidget',
            method: 'POST',
            pathTemplate: '/widgets',
            bodyKind: 'json',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: literal generator `${var}` placeholder fixture, not JS interpolation.
            bodyTemplate: { name: 'proc-${processInstanceKeyVar}-${tenantIdVar}' },
            expect: { status: 201 },
          } satisfies RequestStep,
        ],
      },
    ],
  };

  test('renders a mixed literal/binding string as an f-string preserving both bindings', () => {
    const output = renderPythonSuite(MIXED_TEMPLATE_COLLECTION);

    expect(output).toContain(
      "'name': 'proc-' + (str(ctx.get('processInstanceKeyVar')) if ctx.get('processInstanceKeyVar') is not None else '') + '-' + (str(ctx.get('tenantIdVar')) if ctx.get('tenantIdVar') is not None else '')",
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal generator placeholder text is absent from the rendered output.
    expect(output).not.toContain('proc-${processInstanceKeyVar}-${tenantIdVar}');
  });

  // Regression (Copilot PR #574 review): `${RANDOM}` is a planner-minted
  // literal runtime seed token (path-analyser/src/scenarioGenerator.ts),
  // not a ctx binding -- it must survive verbatim, not become
  // `ctx.get('RANDOM')` (whole-string) or collapse to '' when unset (mixed).
  // biome-ignore lint/suspicious/noTemplateCurlyInString: describe title/fixture intentionally names the literal `${RANDOM}` token under test.
  test('a whole-string ${RANDOM} token is preserved as a literal, not resolved via ctx.get', () => {
    const collection: EndpointScenarioCollection = {
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
          requestPlan: [
            {
              operationId: 'createWidget',
              method: 'POST',
              pathTemplate: '/widgets',
              bodyKind: 'json',
              // biome-ignore lint/suspicious/noTemplateCurlyInString: literal generator `${RANDOM}` placeholder fixture, not JS interpolation.
              bodyTemplate: { processDefinitionId: '${RANDOM}' },
              expect: { status: 201 },
            } satisfies RequestStep,
          ],
        },
      ],
    };

    const output = renderPythonSuite(collection);

    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal '${RANDOM}' token is preserved verbatim in the emitted source.
    expect(output).toContain("'processDefinitionId': '${RANDOM}'");
    expect(output).not.toContain("ctx.get('RANDOM')");
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: test title intentionally names the literal `${RANDOM}` token under test.
  test('a ${RANDOM} token embedded with literal text and a real binding preserves both', () => {
    const collection: EndpointScenarioCollection = {
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
          requestPlan: [
            {
              operationId: 'createWidget',
              method: 'POST',
              pathTemplate: '/widgets',
              bodyKind: 'json',
              // biome-ignore lint/suspicious/noTemplateCurlyInString: literal generator `${var}`/`${RANDOM}` placeholder fixture, not JS interpolation.
              bodyTemplate: { processDefinitionId: 'proc_${RANDOM}_${tenantIdVar}' },
              expect: { status: 201 },
            } satisfies RequestStep,
          ],
        },
      ],
    };

    const output = renderPythonSuite(collection);

    expect(output).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal '${RANDOM}' token survives verbatim in a plain string-literal segment.
      "'processDefinitionId': 'proc_${RANDOM}_' + (str(ctx.get('tenantIdVar')) if ctx.get('tenantIdVar') is not None else '')",
    );
    expect(output).not.toContain("ctx.get('RANDOM')");
  });

  // Regression (Copilot PR #574 review): the previous version of this test
  // only asserted a negative regex against SAMPLE_COLLECTION's plain literal
  // body, so it would still pass even if whole-string placeholder rendering
  // were completely broken. Exercise a real whole-string `${widgetIdVar}`
  // binding and assert the actual ctx.get(...) lookup it must render as.
  test('a whole-string placeholder renders as the plain ctx.get(...) lookup', () => {
    const collection: EndpointScenarioCollection = {
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
          requestPlan: [
            {
              operationId: 'createWidget',
              method: 'POST',
              pathTemplate: '/widgets',
              bodyKind: 'json',
              // biome-ignore lint/suspicious/noTemplateCurlyInString: literal generator `${var}` placeholder fixture, not JS interpolation.
              bodyTemplate: { widgetId: '${widgetIdVar}' },
              expect: { status: 201 },
            } satisfies RequestStep,
          ],
        },
      ],
    };

    const output = renderPythonSuite(collection);

    expect(output).toContain("'widgetId': ctx.get('widgetIdVar')");
    expect(output).not.toMatch(/f"\{ctx\.get\('widgetIdVar'\)/);
  });

  test('a plain literal string with no placeholder is unaffected', () => {
    const output = renderPythonSuite(SAMPLE_COLLECTION);

    expect(output).toContain("'name': 'widget-1'");
  });

  // Regression (Copilot PR #574 review): `ctx.get(...) or ''` treats a
  // legitimately-bound falsy value (0, False) as missing and silently
  // substitutes '' instead of the real value. Must use `is not None`.
  test('uses ctx.get(...) is not None, not `or`, so a falsy-but-bound value is not dropped', () => {
    const output = renderPythonSuite(MIXED_TEMPLATE_COLLECTION);

    expect(output).not.toContain(" or ''");
  });
});

// Regression (Copilot PR #574 review): `ctx.get(...) or <fallback>` treats a
// legitimately-bound falsy value (0, False) as if the binding were absent,
// silently substituting the fallback text instead of the real value. Must
// use an explicit `is not None` check so only a truly-missing binding falls
// back.
describe('falsy-but-bound values are not mistaken for missing bindings (Copilot PR #574 review)', () => {
  test('buildPythonUrlExpression uses ctx.get(...) is not None, not `or`, for a path param', () => {
    const url = buildPythonUrlExpression('/widgets/{widgetKey}');

    expect(url).toBe(
      'f\'widgets/{ctx.get("widgetKeyVar") if ctx.get("widgetKeyVar") is not None else "widgetKey"}\'',
    );
    expect(url).not.toContain(' or ');
  });
});

// Regression (Copilot PR #574 review): an empty requestPlan previously
// emitted a test body containing only a comment, which pytest reports as a
// silent pass — false endpoint coverage. Materialization must now fail loud.
describe('empty requestPlan refuses to emit a no-op passing test (Copilot PR #574 review)', () => {
  test('throws at generation time instead of emitting a comment-only test body', () => {
    const emptyPlanCollection: EndpointScenarioCollection = {
      endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'happy path',
          description: 'no steps',
          operations: [],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [],
        },
      ],
    };

    expect(() => renderPythonSuite(emptyPlanCollection)).toThrow(/empty requestPlan/);
  });
});

// Regression (Copilot PR #574 review): the eventual-wait witness-polling
// renderer had no dedicated coverage for its URL binding, predicate match,
// timeout, and polling-interval branches.
describe('renderPythonEventualWait witness polling (Copilot PR #574 review)', () => {
  const EVENTUAL_WAIT_COLLECTION: EndpointScenarioCollection = {
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
                } satisfies EventualWaitSpec['witness'],
              },
            ],
          } satisfies RequestStep,
        ],
      },
    ],
  };

  test('emits the asyncio/time imports gated on eventualWaitsAfter presence', () => {
    const output = renderPythonSuite(EVENTUAL_WAIT_COLLECTION);

    expect(output).toContain('import asyncio');
    expect(output).toContain('import time');
  });

  test('emits the witness URL, predicate match, timeout, and poll-interval', () => {
    const output = renderPythonSuite(EVENTUAL_WAIT_COLLECTION);

    expect(output).toContain(
      'witness_url_1_1 = f\'process-instances/{ctx.get("processInstanceKeyVar") if ctx.get("processInstanceKeyVar") is not None else "processInstanceKey"}\'',
    );
    expect(output).toContain(
      "if isinstance(witness_data_1_1, dict) and witness_data_1_1.get('state') == 'ACTIVE':",
    );
    expect(output).toContain(
      'raise AssertionError(f"Eventual consistency timeout for operation \'getProcessInstance\' after {(time.monotonic() - witness_started_1_1) * 1000:.0f}ms")',
    );
    expect(output).toContain('await asyncio.sleep(min(0.25,');
    expect(output).toContain('assert witness_response_1_1.status_code == 200');
  });

  test('omits the asyncio/time imports and witness block for a scenario with no eventual waits', () => {
    const output = renderPythonSuite(SAMPLE_COLLECTION);

    expect(output).not.toContain('import asyncio');
    expect(output).not.toContain('witness_url_');
  });
});
