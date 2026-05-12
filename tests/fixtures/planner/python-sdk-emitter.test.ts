import { describe, expect, it } from 'vitest';
import type {
  EndpointScenarioCollection,
  RequestStep,
} from '../../../path-analyser/src/types.ts';

/**
 * Layer-1 Python SDK emitter fixture — red step
 *
 * Hand-built minimal `EndpointScenarioCollection` for a simple endpoint
 * paired with the expected golden Python test file output.
 *
 * This fixture proves that when PythonSdkEmitter.emit() is implemented,
 * it produces a byte-identical `.py` file matching the golden output.
 *
 * The test deliberately FAILS until the emitter is implemented (red step
 * in red/green/class-scoped discipline). Layer-2 will depend on this
 * fixture to verify emitter purity via byte-comparison.
 */

/**
 * Golden fixture: minimal activateJobs scenario (no prerequisites)
 *
 * Scenario structure:
 *   - Endpoint: activateJobs (POST /jobs/activate)
 *   - Request body: { type: "MyWorkerType" }
 *   - Response: activateJobsResponse
 *   - Extract: jobs[0].key as jobKey
 */
const FIXTURE_ACTIVATE_JOBS: EndpointScenarioCollection = {
  endpoint: {
    operationId: 'activateJobs',
    method: 'POST',
    path: '/jobs/activate',
  },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc-activate-jobs-simple',
      name: 'activate jobs and extract key',
      description: 'Activates jobs of a given type and extracts the first job key',
      operations: [{ operationId: 'activateJobs', method: 'POST', path: '/jobs/activate' }],
      producedSemanticTypes: ['JobKey'],
      satisfiedSemanticTypes: [],
      bindings: {
        workerType: 'MyWorkerType',
      },
      requestPlan: [
        {
          operationId: 'activateJobs',
          method: 'POST',
          pathTemplate: '/jobs/activate',
          bodyTemplate: {
            type: '${workerType}',
            maxJobsToActivate: 1,
            timeout: 30000,
          },
          bodyKind: 'json',
          expect: { status: 200 },
          extract: [
            {
              fieldPath: 'jobs[0].key',
              bind: 'jobKey',
              semantic: 'JobKey',
              note: 'Primary job key from response',
            },
          ],
        } as RequestStep,
      ],
      seedBindings: ['workerType'],
    },
  ],
};

/**
 * Expected golden Python test file output
 *
 * This is the byte-for-byte output that PythonSdkEmitter.emit() should
 * produce when given FIXTURE_ACTIVATE_JOBS. The fixture proves the emitter
 * works correctly when this matches.
 *
 * Key patterns to verify:
 *   - async def test_<operationId>_<variant>(client)
 *   - ctx initialization and seed binding
 *   - from_dict() for request body model instantiation
 *   - await client.<snake_case_method>() call
 *   - Response field extraction via extract_into() helper
 *   - Plain assert result is not None smoke test
 */
const GOLDEN_ACTIVATE_JOBS_PY = `# Test for activateJobs
# This file is auto-generated. Do not edit.

from typing import Any
import pytest
from camunda.client import CamundaAsyncClient
from helper import extract_into, seedBinding


@pytest.mark.asyncio
async def test_sc_activate_jobs_simple(client: CamundaAsyncClient) -> None:
  """Activates jobs of a given type and extracts the first job key"""
  
  ctx: dict[str, Any] = {}
  
  # Seed scenario bindings
  ctx['workerType'] = 'MyWorkerType'
  
  # Seed runtime-generated bindings
  if 'workerType' not in ctx:
    ctx['workerType'] = seedBinding('workerType')
  
  # Step 1: activateJobs
  request_body = {
    'type': ctx['workerType'],
    'maxJobsToActivate': 1,
    'timeout': 30000
  }
  result = await client.activate_jobs(data=ActivateJobsRequest.from_dict(request_body))
  assert result is not None, 'activateJobs must return a response'
  
  # Extract response fields
  extract_into(ctx, 'jobKey', result['jobs'][0]['key'])
`;

describe('PythonSdkEmitter Layer-1 fixture (red step)', () => {
  it('fixture has correct scenario structure for activateJobs', () => {
    expect(FIXTURE_ACTIVATE_JOBS.endpoint.operationId).toBe('activateJobs');
    expect(FIXTURE_ACTIVATE_JOBS.scenarios).toHaveLength(1);
    const scenario = FIXTURE_ACTIVATE_JOBS.scenarios[0];
    expect(scenario.requestPlan).toHaveLength(1);
    expect(scenario.requestPlan![0].operationId).toBe('activateJobs');
    expect(scenario.requestPlan![0].extract).toHaveLength(1);
  });

  it('fixture scenario has seed binding for workerType', () => {
    const scenario = FIXTURE_ACTIVATE_JOBS.scenarios[0];
    expect(scenario.seedBindings).toContain('workerType');
    expect(scenario.bindings?.workerType).toBe('MyWorkerType');
  });

  it('fixture request step uses json bodyKind (not multipart)', () => {
    const step = FIXTURE_ACTIVATE_JOBS.scenarios[0].requestPlan![0];
    expect(step.bodyKind).toBe('json');
    expect(step.multipartTemplate).toBeUndefined();
  });

  it('golden Python output contains required async def test signature', () => {
    expect(GOLDEN_ACTIVATE_JOBS_PY).toMatch(
      /^async def test_sc_activate_jobs_simple\(client: CamundaAsyncClient\) -> None:/m,
    );
  });

  it('golden output contains from_dict() call (not raw dict)', () => {
    expect(GOLDEN_ACTIVATE_JOBS_PY).toContain(
      'ActivateJobsRequest.from_dict(request_body)',
    );
  });

  it('golden output contains await client.<snake_case>() call', () => {
    expect(GOLDEN_ACTIVATE_JOBS_PY).toContain('await client.activate_jobs(');
  });

  it('golden output contains plain assert result is not None (SDK throws on error)', () => {
    expect(GOLDEN_ACTIVATE_JOBS_PY).toContain(
      "assert result is not None, 'activateJobs must return a response'",
    );
  });

  it('golden output contains extract_into() helper for response fields', () => {
    expect(GOLDEN_ACTIVATE_JOBS_PY).toContain("extract_into(ctx, 'jobKey',");
  });

  it('golden output does not use external validation libs (no jsonschema, pydantic, deepdiff)', () => {
    expect(GOLDEN_ACTIVATE_JOBS_PY).not.toMatch(/jsonschema|pydantic|deepdiff/);
  });

  it('golden output contains seed binding call for workerType', () => {
    expect(GOLDEN_ACTIVATE_JOBS_PY).toContain(
      "seedBinding('workerType')",
    );
  });

  it('fixture scenario bindings and seedBindings are aligned', () => {
    const scenario = FIXTURE_ACTIVATE_JOBS.scenarios[0];
    const seedBindings = scenario.seedBindings ?? [];
    const bindings = scenario.bindings ?? {};
    for (const name of seedBindings) {
      expect(bindings).toHaveProperty(name);
    }
  });

  it('fixture has correct request body template with placeholders', () => {
    const step = FIXTURE_ACTIVATE_JOBS.scenarios[0].requestPlan![0];
    expect(step.bodyTemplate).toEqual({
      type: '${workerType}',
      maxJobsToActivate: 1,
      timeout: 30000,
    });
  });
});
