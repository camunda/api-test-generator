/**
 * Python SDK Emitter — generates async pytest test suites for Camunda REST API.
 *
 * Lowers an `EndpointScenarioCollection` to Python test file(s) that use
 * the CamundaAsyncClient from the camunda-orchestration-sdk.
 *
 * Design:
 *   - Pure: no filesystem access (orchestrator handles materialization)
 *   - One async def test_<operationId>_<variant>(client) per scenario
 *   - SDK raises on non-2xx; plain assert result is not None
 *   - extract_into(ctx, 'bind', value) for response field extraction
 *   - Hard-fail on multipart (unsupported in Python SDK integration)
 */

import type {
  EndpointScenarioCollection,
  RequestStep,
  GlobalContextSeed,
} from '../../types.js';
import type { EmitContext, EmittedFile, Emitter } from '../emitter.js';
import {
  camelToSnake,
  createDefaultOperationMapSource,
  type OperationMapJsonSource,
} from './sdk-mapping.js';

/**
 * File name for Python SDK generated test suite.
 *
 * Pattern: <operationId>.python_sdk.spec.py
 */
function pythonSdkFileName(operationId: string): string {
  return `${operationId}.python_sdk.spec.py`;
}

/**
 * Render a scenario as a Python async test function.
 *
 * Structure:
 *   - async def test_<operationId>_<variant>(client, ctx=None)
 *   - ctx initialization and seed binding
 *   - Request plan steps with await client.<method>() calls
 *   - extract_into() for response fields
 *   - Plain assert result is not None
 */
function renderScenarioTest(
  scenario: EndpointScenarioCollection['scenarios'][0],
  operationMapSource: OperationMapJsonSource,
): string {
  const lines: string[] = [];

  // Function signature
  const testName = scenario.id || 'test';
  const testFuncName = `test_${camelToSnake(testName)}`;
  lines.push(`@pytest.mark.asyncio`);
  lines.push(`async def ${testFuncName}(client: CamundaAsyncClient) -> None:`);
  lines.push(`  """${scenario.description || scenario.name || 'Test scenario'}"""`);
  lines.push('');

  // Context dict initialization
  lines.push('  ctx: dict[str, Any] = {}');
  lines.push('');

  // Seed bindings (from scenario.bindings and scenario.seedBindings)
  const bindings = scenario.bindings || {};
  const seedBindings = scenario.seedBindings || [];

  // Emit literal bindings first
  if (Object.keys(bindings).length > 0) {
    lines.push('  # Seed scenario bindings');
    for (const [k, v] of Object.entries(bindings)) {
      if (v === '__PENDING__') continue; // Skip pending markers
      lines.push(`  ctx['${k}'] = ${JSON.stringify(v)}`);
    }
    lines.push('');
  }

  // Emit seedBinding() calls for PENDING bindings
  if (seedBindings.length > 0) {
    lines.push('  # Seed runtime-generated bindings');
    for (const k of seedBindings) {
      if (bindings[k] !== '__PENDING__' && bindings[k] !== undefined) {
        continue; // Already emitted above as literal
      }
      lines.push(`  if '${k}' not in ctx:`);
      lines.push(`    ctx['${k}'] = seedBinding('${k}')`);
    }
    lines.push('');
  }

  // Request plan
  if (!scenario.requestPlan || scenario.requestPlan.length === 0) {
    lines.push('  # No request plan');
    lines.push('  pass');
    return lines.join('\n');
  }

  const requestPlan = scenario.requestPlan;
  for (let stepIdx = 0; stepIdx < requestPlan.length; stepIdx++) {
    const step = requestPlan[stepIdx];
    const isFinal = stepIdx === requestPlan.length - 1;

    // Check for unsupported multipart
    if (step.bodyKind === 'multipart') {
      throw new Error(
        `[PythonSdkEmitter] Hard-fail: multipart body in step ${stepIdx} (${step.operationId}). ` +
          `The Python SDK does not support multipart uploads. ` +
          `This scenario cannot be emitted.`,
      );
    }

    lines.push(`  # Step ${stepIdx + 1}: ${step.operationId}`);

    // Build request body (if present)
    if (step.bodyTemplate && step.bodyKind === 'json') {
      const bodyDict = buildBodyDict(step.bodyTemplate);
      lines.push(`  request_body = ${bodyDict}`);
    }

    // Determine Python method name
    const pythonMethod = operationMapSource.resolvePythonMethod(step.operationId);

    // Build kwargs for the client method call
    const kwargs: string[] = [];
    if (step.bodyTemplate && step.bodyKind === 'json') {
      // Use from_dict() with model class name derived from operationId
      const modelClassName = inferModelClassName(step.operationId);
      kwargs.push(`data=${modelClassName}.from_dict(request_body)`);
    }

    // Add query/path parameters (simplified for now)
    if (step.pathParams && step.pathParams.length > 0) {
      for (const param of step.pathParams) {
        kwargs.push(`${param.name}=ctx.get('${param.var}')`);
      }
    }

    // Build the await call
    const awaitCall = `await client.${pythonMethod}(${kwargs.join(', ')})`;
    lines.push(`  result = ${awaitCall}`);

    // Assert result is not None (SDK raises on non-2xx)
    lines.push(`  assert result is not None, '${step.operationId} must return a response'`);

    // Extract response fields
    if (step.extract && step.extract.length > 0) {
      lines.push('');
      for (const ex of step.extract) {
        const accessor = fieldPathToAccessor(ex.fieldPath);
        lines.push(`  extract_into(ctx, '${ex.bind}', result${accessor})`);
      }
    }

    if (!isFinal) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Build a Python dict representation from a request template.
 *
 * Replaces ${var} placeholders with ctx['var'] lookups.
 * Example:
 *   { type: "${workerType}", maxJobs: 1 }
 *   →
 *   { 'type': ctx['workerType'], 'maxJobs': 1 }
 */
function buildBodyDict(bodyTemplate: unknown): string {
  const json = JSON.stringify(bodyTemplate, null, 2);
  // Replace "${varName}" with f-string interpolation
  const withVars = json.replace(/"\\?\$\{([^}]+)\}"/g, (_, varName) => {
    return `ctx['${varName}']`;
  });
  return withVars;
}

/**
 * Infer a Python model class name from an operationId.
 *
 * Example: activateJobs → ActivateJobsRequest
 *
 * This is a heuristic; the correct model name should be loaded from
 * the SDK's type stubs or operation-map. For now, we use a simple
 * PascalCase + "Request" suffix pattern.
 */
function inferModelClassName(operationId: string): string {
  // Convert camelCase to PascalCase
  const pascal = operationId.charAt(0).toUpperCase() + operationId.slice(1);
  return `${pascal}Request`;
}

/**
 * Convert a field path (e.g., "jobs[0].key") to a Python accessor.
 *
 * Example:
 *   jobs[0].key → ['jobs'][0]['key']
 *   metadata.processInstanceKey → ['metadata']['processInstanceKey']
 */
function fieldPathToAccessor(fieldPath: string): string {
  // Parse field path into segments: field, [index], .field, etc.
  const segments = fieldPath.split(/\.|\[|\]/);
  let accessor = '';

  for (const seg of segments) {
    if (seg === '') continue; // Skip empty parts from split
    if (/^\d+$/.test(seg)) {
      // Numeric index: [0]
      accessor += `[${seg}]`;
    } else {
      // Field name: .fieldName or ['fieldName']
      accessor += `['${seg}']`;
    }
  }

  return accessor;
}

/**
 * Render the full Python test suite as a string.
 */
function renderPythonTestSuite(
  collection: EndpointScenarioCollection,
  operationMapSource: OperationMapJsonSource,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Test suite for ${collection.endpoint.operationId}`);
  lines.push('# This file is auto-generated. Do not edit.');
  lines.push('');

  // Imports
  lines.push('from typing import Any');
  lines.push('import pytest');
  lines.push('from camunda.client import CamundaAsyncClient');
  lines.push('from helper import extract_into, seedBinding');
  lines.push('');

  // Scenarios as test functions
  for (const scenario of collection.scenarios) {
    lines.push(renderScenarioTest(scenario, operationMapSource));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * {@link Emitter} implementation for Python SDK tests.
 *
 * Pure: returns in-memory {@link EmittedFile} list, no filesystem access.
 */
export const PythonSdkEmitter: Emitter = {
  id: 'python-sdk',
  name: 'Python SDK (Async)',

  async emit(
    collection: EndpointScenarioCollection,
    ctx: EmitContext,
  ): Promise<EmittedFile[]> {
    // Use default operation map source (fallback camelToSnake)
    // In production, this would load spec/python-sdk/operation-map.json
    const operationMapSource = createDefaultOperationMapSource();

    const content = renderPythonTestSuite(collection, operationMapSource);

    return [
      {
        relativePath: pythonSdkFileName(collection.endpoint.operationId),
        content,
      },
    ];
  },
};
