import type { EmitContext } from '@camunda8/emitter-sdk';
import { describe, expect, it } from 'vitest';
import { createPythonSdkEmitter } from '../../../materializer/src/python-sdk/emitter.ts';
import type { EndpointScenarioCollection, RequestStep } from '../../../path-analyser/src/types.ts';

/**
 * Layer-1 Python SDK emitter fixture
 *
 * Hand-built minimal `EndpointScenarioCollection` for a simple endpoint
 * paired with the expected golden Python test file output.
 *
 * This fixture proves `PythonSdkEmitter.emit()` produces a byte-identical
 * `.py` file matching the golden output.
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
        // biome-ignore lint/plugin: test-only cast at a fixture boundary — value is hand-crafted in the fixture
        {
          operationId: 'activateJobs',
          method: 'POST',
          pathTemplate: '/jobs/activate',
          bodyTemplate: {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional binding placeholder
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
const GOLDEN_ACTIVATE_JOBS_PY = `# Test suite for activateJobs
# This file is auto-generated. Do not edit.

from typing import Any
import pytest
from camunda.client import CamundaAsyncClient
from camunda.models import ActivateJobsRequest
from helper import extract_into, seedBinding

@pytest.mark.asyncio
async def test_sc_activate_jobs_simple(client: CamundaAsyncClient) -> None:
  """Activates jobs of a given type and extracts the first job key"""

  ctx: dict[str, Any] = {}

  # Seed scenario bindings
  ctx['workerType'] = 'MyWorkerType'

  # Step 1: activateJobs
  request_body = {'type': ctx['workerType'], 'maxJobsToActivate': 1, 'timeout': 30000}
  result = await client.activate_jobs(data=ActivateJobsRequest.from_dict(request_body))
  assert result is not None, 'activateJobs must return a response'

  extract_into(ctx, 'jobKey', result['jobs'][0]['key'])
`;

describe('PythonSdkEmitter Layer-1 fixture', () => {
  it('fixture has correct scenario structure for activateJobs', () => {
    expect(FIXTURE_ACTIVATE_JOBS.endpoint.operationId).toBe('activateJobs');
    expect(FIXTURE_ACTIVATE_JOBS.scenarios).toHaveLength(1);
    const scenario = FIXTURE_ACTIVATE_JOBS.scenarios[0];
    expect(scenario.requestPlan).toHaveLength(1);
    expect(scenario.requestPlan?.[0]?.operationId).toBe('activateJobs');
    expect(scenario.requestPlan?.[0]?.extract).toHaveLength(1);
  });

  it('fixture scenario has seed binding for workerType', () => {
    const scenario = FIXTURE_ACTIVATE_JOBS.scenarios[0];
    expect(scenario.seedBindings).toContain('workerType');
    expect(scenario.bindings?.workerType).toBe('MyWorkerType');
  });

  it('fixture request step uses json bodyKind (not multipart)', () => {
    const step = FIXTURE_ACTIVATE_JOBS.scenarios[0].requestPlan?.[0];
    expect(step?.bodyKind).toBe('json');
    expect(step?.multipartTemplate).toBeUndefined();
  });

  it('golden Python output contains required async def test signature', () => {
    expect(GOLDEN_ACTIVATE_JOBS_PY).toMatch(
      /^async def test_sc_activate_jobs_simple\(client: CamundaAsyncClient\) -> None:/m,
    );
  });

  it('golden output contains from_dict() call (not raw dict)', () => {
    expect(GOLDEN_ACTIVATE_JOBS_PY).toContain('ActivateJobsRequest.from_dict(request_body)');
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

  it('golden output does not emit seedBinding() for a literal binding', () => {
    // workerType has a literal value ('MyWorkerType'), not a __PENDING__ marker,
    // so the emitter must NOT produce a seedBinding() call for it.
    expect(GOLDEN_ACTIVATE_JOBS_PY).not.toContain("seedBinding('workerType')");
  });

  it('emitter produces byte-identical output matching the golden', async () => {
    const ctx: EmitContext = {
      outDir: '/tmp/test',
      suiteName: 'activateJobs',
      mode: 'feature',
      configName: 'test',
      emitterConfig: {},
      resolveConfigPath: (p) => p,
    };
    const files = await createPythonSdkEmitter().emit(FIXTURE_ACTIVATE_JOBS, ctx);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('activateJobs.python_sdk.spec.py');
    expect(files[0].content).toBe(GOLDEN_ACTIVATE_JOBS_PY);
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
    const step = FIXTURE_ACTIVATE_JOBS.scenarios[0].requestPlan?.[0];
    expect(step?.bodyTemplate).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional binding placeholder
      type: '${workerType}',
      maxJobsToActivate: 1,
      timeout: 30000,
    });
  });
});
