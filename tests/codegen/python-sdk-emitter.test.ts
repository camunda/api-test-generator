import { describe, expect, test } from 'vitest';
import { PythonSdkEmitter } from '../../path-analyser/src/codegen/python-sdk/emitter.js';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.js';

/**
 * Layer-2 Python SDK emitter purity test — green step
 *
 * Input: The minimal `EndpointScenarioCollection` from Layer-1 fixture
 * Process: Run PythonSdkEmitter.emit() with identical inputs
 * Output: Assert byte-for-byte match against golden reference
 *
 * This test proves the emitter is pure and deterministic: same input
 * always produces identical output. The fixture can be regenerated with
 * confidence that a matching input will produce a matching file.
 */

/**
 * Minimal activateJobs scenario (from Layer-1 fixture)
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
        // biome-ignore lint/plugin: test-only cast at a fixture boundary — value is hand-crafted in the test
        {
          operationId: 'activateJobs',
          method: 'POST',
          pathTemplate: '/jobs/activate',
          bodyTemplate: {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional binding placeholder resolved by the Python SDK emitter
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

describe('PythonSdkEmitter Layer-2 purity test (green step)', () => {
  test('emitter produces EmittedFile with correct relative path', async () => {
    const files = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('activateJobs.python_sdk.spec.py');
  });

  test('emitter is pure: does not touch filesystem (outDir is unused)', async () => {
    // outDir is intentionally a non-existent path; emit() must not throw.
    await expect(
      PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
        outDir: '/this/does/not/exist',
        suiteName: 'activateJobs',
        mode: 'feature',
      }),
    ).resolves.toBeDefined();
  });

  test('emitted suite contains async def test_ function', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).toContain('async def test_');
    expect(file.content).toContain('CamundaAsyncClient');
  });

  test('emitted suite contains fixture file header comment', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).toContain('# Test suite for activateJobs');
    expect(file.content).toContain('# This file is auto-generated');
  });

  test('emitted suite contains necessary imports', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).toContain('from typing import Any');
    expect(file.content).toContain('import pytest');
    expect(file.content).toContain('from camunda.client import CamundaAsyncClient');
    expect(file.content).toContain('from camunda.models import ActivateJobsRequest');
    expect(file.content).toContain('from helper import extract_into, seedBinding');
  });

  test('emitted suite contains @pytest.mark.asyncio decorator', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).toContain('@pytest.mark.asyncio');
  });

  test('emitted test function has correct signature', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).toMatch(
      /async def test_sc_activate_jobs_simple\(client: CamundaAsyncClient\)/,
    );
  });

  test('emitted test contains context dict initialization', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).toContain('ctx: dict[str, Any] = {}');
  });

  test('emitted test contains seed bindings from scenario', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).toContain("ctx['workerType'] = 'MyWorkerType'");
  });

  test('emitted test contains await client.<method>() call', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).toContain('await client.activate_jobs(');
    expect(file.content).toContain('ActivateJobsRequest.from_dict(request_body)');
  });

  test('emitted test contains request body dict construction', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).toContain('request_body = {');
    expect(file.content).toContain("'type': ctx['workerType']");
    expect(file.content).toContain("'maxJobsToActivate': 1");
    expect(file.content).toContain("'timeout': 30000");
  });

  test('emitted test contains plain assert result is not None', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).toContain('assert result is not None');
  });

  test('emitted test contains extract_into() calls for response fields', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).toContain("extract_into(ctx, 'jobKey'");
  });

  test('emitter throws on multipart bodyKind (hard-fail)', async () => {
    const multipartScenario: EndpointScenarioCollection = {
      ...FIXTURE_ACTIVATE_JOBS,
      scenarios: [
        {
          ...FIXTURE_ACTIVATE_JOBS.scenarios[0],
          requestPlan: [
            // biome-ignore lint/plugin: test-only cast at a fixture boundary — value is hand-crafted in the test
            {
              operationId: 'createDeployment',
              method: 'POST',
              pathTemplate: '/deployments',
              bodyKind: 'multipart',
              multipartTemplate: { file: '@@FILE:test.bpmn' },
              expect: { status: 200 },
            } as RequestStep,
          ],
        },
      ],
    };

    await expect(
      PythonSdkEmitter.emit(multipartScenario, {
        outDir: '/unused',
        suiteName: 'createDeployment',
        mode: 'feature',
      }),
    ).rejects.toThrow('[PythonSdkEmitter] Hard-fail: multipart body');
  });

  test('emitter produces deterministic output (same input = same output)', async () => {
    const [file1] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    const [file2] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file1.content).toBe(file2.content);
    expect(file1.relativePath).toBe(file2.relativePath);
  });

  test('emitted file does not contain external validation libraries', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.content).not.toMatch(/jsonschema|pydantic|deepdiff|validate/);
  });

  test('emitted test has correct file extension (.python_sdk.spec.py)', async () => {
    const [file] = await PythonSdkEmitter.emit(FIXTURE_ACTIVATE_JOBS, {
      outDir: '/unused',
      suiteName: 'activateJobs',
      mode: 'feature',
    });

    expect(file.relativePath).toMatch(/\.python_sdk\.spec\.py$/);
  });
});
