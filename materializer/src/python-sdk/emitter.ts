/**
 * Python SDK test suite emitter.
 * Lowers scenario collections into executable Python test code using the Camunda Python SDK.
 */

import type { EmitContext, EmittedFile, EmitterStrategy } from '@camunda8/emitter-sdk';
import { assertSafeGlobalContextSeeds } from 'path-analyser/ontology/loader';
import type {
  EndpointScenario,
  EndpointScenarioCollection,
  GlobalContextSeed,
  RequestStep,
} from 'path-analyser/types';
// Reused rather than re-implemented: the Playwright emitter already owns the
// canonical logic for deciding which client-minted bindings need a
// `unique=True` seed (#304 -- client-minted, not extracted from an earlier
// step, and the consuming step declares HTTP 409). See #342 for the
// omitWhenUnbound half of the same contract.
import { computeUniqueBindings } from '../playwright/ctxSeeding.js';
import { camelCase } from '../playwright/stepRenderer.js';
import { type OperationMapSource, toPythonLiteral } from './sdk-mapping.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Build a valid, collision-free Python test-function-name suffix from a
 * scenario. `scenario.name` may contain characters that aren't legal in a
 * Python identifier (spaces, `-`, `#`, ...), so every non `[a-z0-9_]`
 * character is folded to `_`. The scenario's own `id` (unique within a
 * collection, see scenarioGenerator.ts) is always prefixed so scenarios that
 * share a display name still get distinct test functions instead of silently
 * overwriting each other.
 */
function toPythonTestName(scenario: EndpointScenario): string {
  const base = `${scenario.id}_${scenario.name || 'scenario'}`;
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : `scenario_${scenario.id}`;
}

/**
 * Build the file name a scenario collection lowers to.
 * Python test convention: `test_<operation_id>.py`
 */
export function pythonSuiteFileName(collection: EndpointScenarioCollection): string {
  const operationId = collection.endpoint.operationId;
  const snakeCase = toSnakeCase(operationId);
  return `test_${snakeCase}.py`;
}

/**
 * Commit b19de2e — ctx['var'] for path parameters
 *
 * Build the URL expression for a path template, substituting {paramName}
 * with ctx['param_name_var'] (Python bracket notation).
 *
 * Example: '/widgets/{id}' → f'/widgets/{ctx["id_var"] or "{id}"}'
 * The fallback gives the broker a recognizable URL (and a 4xx) when a
 * path-param binding is missing.
 *
 * `pathParams` is accepted for backward compatibility but intentionally
 * ignored: `RequestStep.pathParams` is never populated by path-analyser
 * (see js-sdk's `derivePathParamNames` comment and repo memory item 7), so
 * trusting it here always fell through to the raw, un-suffixed OpenAPI
 * param name — which never matches a real `ctx` key. Every ctx binding for
 * a path param is guaranteed to exist under `${camelCase(paramName)}Var`
 * instead (path-analyser's own `aliasProducerExtractsToPlaceholders`
 * enforces this), matching js-sdk's `derivePathParamNames` + `camelCase`
 * workaround for the same gap.
 */
export function buildPythonUrlExpression(
  pathTemplate: string,
  _pathParams?: { name: string; var: string }[],
): string {
  let result = pathTemplate;
  result = result.replace(/\{([^}]+)\}/g, (_, paramName: string) => {
    const varName = `${camelCase(paramName)}Var`;
    // Double-quote the inner literals: this whole expression is embedded in
    // a single-quoted f-string below, so a single-quoted literal here would
    // close the f-string early and produce a Python SyntaxError.
    return `{ctx.get("${varName}") or "${paramName}"}`;
  });
  return `f'${result}'`;
}

/**
 * Render a Python string literal with proper escaping.
 * Handles quotes, backslashes, and special characters for Python.
 */
export function renderPythonStringLiteral(value: string): string {
  const escaped = toPythonLiteral(value);
  return `'${escaped}'`;
}

/**
 * Render an arbitrary JSON-like value as a valid Python literal.
 * Booleans/None map to Python spelling; whole-string `${var}` placeholders
 * become `ctx.get('snake_var')` lookups; everything else is escaped.
 */
function renderPythonValue(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const whole = /^\$\{([^}]+)\}$/.exec(value);
    if (whole) {
      // ctx keys are the planner's original binding variable names (e.g.
      // tenantIdVar) — must match the ctx.set(...) calls emitted for
      // scenario.bindings verbatim, so no casing transform here (#354).
      return `ctx.get('${whole[1]}')`;
    }
    return renderPythonStringLiteral(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => renderPythonValue(v)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `'${k}': ${renderPythonValue(v)}`);
    return `{${entries.join(', ')}}`;
  }
  return 'None';
}

/**
 * Render request body as a Python dictionary.
 * Substitutes placeholders like "${varName}" with ctx.get('var_name').
 */
export function renderPythonBody(
  bodyTemplate: unknown,
  _bindings: Record<string, string | undefined>,
): string {
  if (!bodyTemplate) return '{}';
  return renderPythonValue(bodyTemplate);
}

/**
 * Render a top-level request-body / multipart-fields dict as statements
 * rather than a single literal expression, deferring any field flagged
 * `omitWhenUnbound` (per the config's global-context-seeds ABox, e.g.
 * `tenantId`) to a runtime-conditional assignment. Without this, a whole-
 * string `${tenantIdVar}` placeholder always renders inline as
 * `ctx.get('tenantIdVar')`, which is `None` when the scenario legitimately
 * never seeded it — sending an explicit JSON/multipart `null` instead of
 * omitting the field and letting the broker apply its own default (#342;
 * mirrors the C#/Playwright emitters' `omitWhenUnboundFields` handling).
 */
function renderPythonDictAssignment(
  varName: string,
  record: Record<string, unknown>,
  omitWhenUnboundFieldNames: ReadonlySet<string>,
): string[] {
  const inlineEntries: string[] = [];
  const deferred: { fieldName: string; binding: string }[] = [];
  for (const [fieldName, fieldValue] of Object.entries(record)) {
    const whole = typeof fieldValue === 'string' ? /^\$\{([^}]+)\}$/.exec(fieldValue) : null;
    if (whole && omitWhenUnboundFieldNames.has(fieldName)) {
      deferred.push({ fieldName, binding: whole[1] });
      continue;
    }
    inlineEntries.push(`'${fieldName}': ${renderPythonValue(fieldValue)}`);
  }
  const lines = [`    ${varName} = {${inlineEntries.join(', ')}}`];
  for (const { fieldName, binding } of deferred) {
    const local = `__${toSnakeCase(fieldName)}_val`;
    lines.push(`    ${local} = ctx.get('${binding}')`);
    lines.push(`    if ${local} is not None:`);
    lines.push(`        ${varName}['${fieldName}'] = ${local}`);
  }
  return lines;
}

/**
 * Main entry point for the Python SDK emitter.
 * Creates and returns the EmitterStrategy implementation.
 *
 * @param operationMap Optional operation map for validating SDK coverage
 */
export function createPythonSdkEmitter(
  operationMap: OperationMapSource | undefined,
): EmitterStrategy {
  return {
    id: 'python-sdk',
    name: 'Python SDK',
    supportedConfigs: ['*'],
    sdkMap: {
      repo: 'camunda/orchestration-cluster-api-python',
      path: 'examples/operation-map.json',
      refEnv: 'PYTHON_SDK_REF',
      out: 'spec/python-sdk/operation-map.json',
    },
    async emit(collection: EndpointScenarioCollection, ctx: EmitContext): Promise<EmittedFile[]> {
      const content = renderPythonSuite(collection, {
        operationMap,
        globalContextSeeds: ctx.globalContextSeeds,
      });
      return [
        {
          relativePath: pythonSuiteFileName(collection),
          content,
        },
      ];
    },
  };
}

/**
 * Render a complete Python test suite for a scenario collection.
 */
export function renderPythonSuite(
  collection: EndpointScenarioCollection,
  opts: {
    operationMap?: OperationMapSource;
    globalContextSeeds?: readonly GlobalContextSeed[];
  } = {},
): string {
  if (opts.globalContextSeeds !== undefined) {
    assertSafeGlobalContextSeeds(opts.globalContextSeeds);
  }
  const omitWhenUnboundFieldNames = new Set(
    (opts.globalContextSeeds ?? [])
      .filter((seed) => seed.omitWhenUnbound)
      .map((seed) => seed.fieldName),
  );
  // Binding names (not field names) for the same omitWhenUnbound seeds --
  // without this, a scenario whose planner-computed seedBindings named e.g.
  // tenantIdVar would still unconditionally seed_binding() it here, sending
  // a fabricated value instead of leaving the field genuinely unset (#342).
  const omitWhenUnboundBindingNames = new Set(
    (opts.globalContextSeeds ?? [])
      .filter((seed) => seed.omitWhenUnbound)
      .map((seed) => seed.binding),
  );
  const lines: string[] = [];

  // Header and imports
  lines.push('"""');
  lines.push(`Auto-generated tests for ${collection.endpoint.operationId}`);
  lines.push('Generated by api-test-generator');
  lines.push('"""');
  lines.push('');
  lines.push('import pytest');
  lines.push('import httpx');
  const hasMultipartStep = collection.scenarios.some((scenario) =>
    (scenario.requestPlan ?? []).some(
      (step) => step.bodyKind === 'multipart' && step.multipartTemplate !== undefined,
    ),
  );
  const hasSeedBindings = collection.scenarios.some(
    (scenario) => (scenario.seedBindings ?? []).length > 0,
  );
  if (hasMultipartStep) {
    lines.push('from support.fixtures import resolve_fixture');
  }
  if (hasSeedBindings) {
    lines.push('from support.seeding import init_spec_salt, seed_binding');
  }
  lines.push('from typing import Any, Dict');
  lines.push('');

  // Test context setup
  lines.push('class TestContext:');
  lines.push('    """Shared test context for managing state across requests."""');
  lines.push('');
  lines.push('    def __init__(self):');
  lines.push('        self.ctx: Dict[str, Any] = {}');
  lines.push('        self.responses: Dict[str, Any] = {}');
  lines.push('');
  lines.push('    def get(self, key: str, default: Any = None) -> Any:');
  lines.push('        """Get a value from the context."""');
  lines.push('        return self.ctx.get(key, default)');
  lines.push('');
  lines.push('    def set(self, key: str, value: Any) -> None:');
  lines.push('        """Set a value in the context."""');
  lines.push('        self.ctx[key] = value');
  lines.push('');

  // Test fixtures
  lines.push('@pytest.fixture');
  lines.push('def ctx() -> TestContext:');
  lines.push('    """Provide a fresh test context for each test."""');
  lines.push('    return TestContext()');
  lines.push('');
  lines.push('def get_nested_value(value: Any, field_path: str) -> Any:');
  lines.push('    """Safely navigate dotted field paths on dict/list payloads."""');
  lines.push('    current = value');
  lines.push("    for part in field_path.split('.'):");
  lines.push('        if current is None:');
  lines.push('            return None');
  lines.push('        if part.isdigit():');
  lines.push('            if not isinstance(current, list):');
  lines.push('                return None');
  lines.push('            index = int(part)');
  lines.push('            if index >= len(current):');
  lines.push('                return None');
  lines.push('            current = current[index]');
  lines.push('            continue');
  lines.push('        if isinstance(current, dict):');
  lines.push('            current = current.get(part)');
  lines.push('            continue');
  lines.push('        return None');
  lines.push('    return current');
  lines.push('');

  // Test scenarios
  for (const scenario of collection.scenarios) {
    const testName = toPythonTestName(scenario);
    lines.push(`@pytest.mark.asyncio`);
    lines.push(`async def test_${testName}(ctx: TestContext, client: httpx.AsyncClient) -> None:`);
    lines.push(`    """`);
    lines.push(`    ${scenario.name || scenario.id}`);
    if (scenario.description) {
      lines.push(`    ${scenario.description}`);
    }
    lines.push(`    """`);

    if (hasSeedBindings) {
      // Set immediately before this test's own seeding, not once at module
      // import time: pytest imports every generated operation module before
      // running any test, so a module-level call left the salt reflecting
      // whichever module was imported last, and every test's seed_binding()
      // calls (across every suite) collided on that one salt.
      lines.push(`    init_spec_salt('${collection.endpoint.operationId}')`);
    }

    const bindings = scenario.bindings ?? {};
    for (const [key, value] of Object.entries(bindings)) {
      if (value === '__PENDING__') continue;
      lines.push(`    ctx.set('${key}', ${renderPythonValue(value)})`);
    }

    const uniqueBindings = computeUniqueBindings(
      scenario.requestPlan,
      scenario.modelDerivedLiteralBindings,
    );
    for (const seedName of scenario.seedBindings ?? []) {
      if (omitWhenUnboundBindingNames.has(seedName) && !uniqueBindings.has(seedName)) continue;
      const uniqueArg = uniqueBindings.has(seedName) ? ', unique=True' : '';
      lines.push(
        `    ctx.set('${seedName}', ctx.get('${seedName}') if ctx.get('${seedName}') is not None else seed_binding('${seedName}'${uniqueArg}))`,
      );
    }

    const requestPlan = scenario.requestPlan ?? [];
    for (let i = 0; i < requestPlan.length; i++) {
      renderPythonRequestStep(lines, requestPlan[i], i, omitWhenUnboundFieldNames);
    }

    if (requestPlan.length === 0) {
      lines.push('    # No request plan available for this scenario');
    }

    lines.push('');
  }

  return lines.join('\n');
}

function renderPythonRequestStep(
  lines: string[],
  step: RequestStep,
  index: number,
  omitWhenUnboundFieldNames: ReadonlySet<string>,
): void {
  const stepNum = index + 1;
  const responseVar = `response_${stepNum}`;
  const methodName = step.method.toLowerCase();
  const responseDataVar = `response_data_${stepNum}`;
  const payloadTemplate =
    step.bodyKind === 'multipart'
      ? (step.multipartTemplate ?? step.bodyTemplate)
      : step.bodyTemplate;
  const requestArgs: string[] = [];

  lines.push(`    # Step ${stepNum}: ${step.operationId}`);

  if (step.pathTemplate) {
    const urlExpr = buildPythonUrlExpression(step.pathTemplate, step.pathParams);
    lines.push(`    url_${stepNum} = ${urlExpr}`);
    requestArgs.push(`url_${stepNum}`);
  }

  if (payloadTemplate !== undefined) {
    if (step.bodyKind === 'multipart' && isRecord(payloadTemplate)) {
      const fieldsTemplate = payloadTemplate.fields;
      const filesTemplate = payloadTemplate.files;
      if (fieldsTemplate !== undefined) {
        if (isRecord(fieldsTemplate)) {
          lines.push(
            ...renderPythonDictAssignment(
              `data_${stepNum}`,
              fieldsTemplate,
              omitWhenUnboundFieldNames,
            ),
          );
        } else {
          lines.push(`    data_${stepNum} = ${renderPythonValue(fieldsTemplate)}`);
        }
        requestArgs.push(`data=data_${stepNum}`);
      }
      if (filesTemplate !== undefined) {
        lines.push(`    files_${stepNum} = ${renderPythonMultipartFiles(filesTemplate)}`);
        requestArgs.push(`files=files_${stepNum}`);
      }
    } else if (isRecord(payloadTemplate)) {
      lines.push(
        ...renderPythonDictAssignment(
          `body_${stepNum}`,
          payloadTemplate,
          omitWhenUnboundFieldNames,
        ),
      );
      requestArgs.push(`json=body_${stepNum}`);
    } else {
      const bodyExpr = renderPythonBody(payloadTemplate, {});
      lines.push(`    body_${stepNum} = ${bodyExpr}`);
      requestArgs.push(`json=body_${stepNum}`);
    }
  }

  lines.push(`    ${responseVar} = await client.${methodName}(`);
  for (const arg of requestArgs) {
    lines.push(`        ${arg},`);
  }
  lines.push('    )');
  lines.push(`    assert ${responseVar}.status_code == ${step.expect.status}`);

  if (step.extract && step.extract.length > 0) {
    lines.push(`    ${responseDataVar}: Any = None`);
    lines.push('    try:');
    lines.push(`        ${responseDataVar} = ${responseVar}.json()`);
    lines.push('    except ValueError:');
    lines.push('        pass');
    for (const extract of step.extract) {
      lines.push(
        `    ctx.set('${extract.bind}', get_nested_value(${responseDataVar}, '${extract.fieldPath}'))`,
      );
    }
  }
}

function renderPythonMultipartFiles(filesTemplate: unknown): string {
  if (!isRecord(filesTemplate)) {
    return renderPythonValue(filesTemplate);
  }
  const entries = Object.entries(filesTemplate).map(([key, value]) => {
    if (typeof value === 'string' && value.startsWith('@@FILE:')) {
      const fixturePath = value.slice('@@FILE:'.length);
      const filename = fixturePath.split('/').pop() || key;
      return `'${key}': (${renderPythonStringLiteral(filename)}, resolve_fixture('${fixturePath}'))`;
    }
    return `'${key}': ${renderPythonValue(value)}`;
  });
  return `{${entries.join(', ')}}`;
}
