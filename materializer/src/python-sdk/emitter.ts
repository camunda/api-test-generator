/**
 * Python SDK test suite emitter.
 * Lowers scenario collections into executable Python test code using the Camunda Python SDK.
 */

import type { EmitContext, EmittedFile, EmitterStrategy } from '@camunda8/emitter-sdk';
import type { EndpointScenario, EndpointScenarioCollection, RequestStep } from 'path-analyser/types';
import { type OperationMapSource, toPythonLiteral } from './sdk-mapping.js';

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
 */
export function buildPythonUrlExpression(
  pathTemplate: string,
  pathParams?: { name: string; var: string }[],
): string {
  const varByName = new Map((pathParams ?? []).map((p) => [p.name, p.var]));

  let result = pathTemplate;
  result = result.replace(/\{([^}]+)\}/g, (_, paramName: string) => {
    // ctx keys are the planner's original binding variable names (e.g.
    // widgetKeyVar) — this must match the ctx.set(...) calls emitted for
    // scenario.bindings verbatim, so no casing transform here (#354).
    const varName = varByName.get(paramName) ?? paramName;
    // Use f-string syntax with Python bracket notation
    return `{ctx.get('${varName}') or '${paramName}'}`;
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
    async emit(collection: EndpointScenarioCollection, _ctx: EmitContext): Promise<EmittedFile[]> {
      const content = renderPythonSuite(collection, { operationMap });
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
  } = {},
): string {
  const lines: string[] = [];

  // Header and imports
  lines.push('"""');
  lines.push(`Auto-generated tests for ${collection.endpoint.operationId}`);
  lines.push('Generated by api-test-generator');
  lines.push('"""');
  lines.push('');
  lines.push('import pytest');
  lines.push('from typing import Any, Dict');
  lines.push('from unittest.mock import AsyncMock');
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
    lines.push(`async def test_${testName}(ctx: TestContext) -> None:`);
    lines.push(`    """`);
    lines.push(`    ${scenario.name || scenario.id}`);
    if (scenario.description) {
      lines.push(`    ${scenario.description}`);
    }
    lines.push(`    """`);
    lines.push('    client = AsyncMock()');

    const bindings = scenario.bindings ?? {};
    for (const [key, value] of Object.entries(bindings)) {
      if (value === '__PENDING__') continue;
      lines.push(`    ctx.set('${key}', ${renderPythonValue(value)})`);
    }

    const requestPlan = scenario.requestPlan ?? [];
    for (let i = 0; i < requestPlan.length; i++) {
      renderPythonRequestStep(lines, requestPlan[i], i, opts.operationMap);
    }

    if (requestPlan.length === 0) {
      lines.push('    # No request plan available for this scenario');
    }

    lines.push('');
  }

  return lines.join('\n');
}

function resolvePythonMethodName(operationId: string, operationMap?: OperationMapSource): string {
  const entry = operationMap?.lookup(operationId);
  if (entry && entry.region.length > 0) {
    return entry.region;
  }
  return toSnakeCase(operationId);
}

function renderPythonRequestStep(
  lines: string[],
  step: RequestStep,
  index: number,
  operationMap?: OperationMapSource,
): void {
  const stepNum = index + 1;
  const responseVar = `response_${stepNum}`;
  const methodName = resolvePythonMethodName(step.operationId, operationMap);
  const payloadTemplate =
    step.bodyKind === 'multipart'
      ? (step.multipartTemplate ?? step.bodyTemplate)
      : step.bodyTemplate;
  const requestArgs: string[] = [];

  lines.push(`    # Step ${stepNum}: ${step.operationId}`);

  if (step.pathTemplate) {
    const urlExpr = buildPythonUrlExpression(step.pathTemplate, step.pathParams);
    lines.push(`    url_${stepNum} = ${urlExpr}`);
    requestArgs.push(`path=url_${stepNum}`);
  }

  if (payloadTemplate !== undefined) {
    const bodyExpr = renderPythonBody(payloadTemplate, {});
    lines.push(`    body_${stepNum} = ${bodyExpr}`);
    const payloadKey = step.bodyKind === 'multipart' ? 'multipart' : 'body';
    requestArgs.push(`${payloadKey}=body_${stepNum}`);
  }

  if (step.expect.status >= 400) {
    lines.push(
      `    client.${methodName}.side_effect = RuntimeError('Expected ${step.expect.status}')`,
    );
    lines.push('    with pytest.raises(RuntimeError):');
    lines.push(`        await client.${methodName}(`);
    for (const arg of requestArgs) {
      lines.push(`            ${arg},`);
    }
    lines.push('        )');
    return;
  }

  lines.push(
    `    client.${methodName}.return_value = {'status': ${step.expect.status}, 'data': {}}`,
  );
  lines.push(`    ${responseVar} = await client.${methodName}(`);
  for (const arg of requestArgs) {
    lines.push(`        ${arg},`);
  }
  lines.push('    )');
  lines.push(`    assert ${responseVar}['status'] == ${step.expect.status}`);

  if (step.extract && step.extract.length > 0) {
    for (const extract of step.extract) {
      lines.push(
        `    ctx.set('${extract.bind}', get_nested_value(${responseVar}.get('data'), '${extract.fieldPath}'))`,
      );
    }
  }
}
