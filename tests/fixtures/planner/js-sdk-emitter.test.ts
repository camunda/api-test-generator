import { describe, expect, it } from 'vitest';
import {
  jsSdkSuiteFileName,
  renderJsSdkSuite,
} from '../../../path-analyser/src/codegen/js-sdk/emitter.ts';
import { FallbackMappingSource } from '../../../path-analyser/src/codegen/js-sdk/sdk-mapping.ts';
import type { EndpointScenarioCollection } from '../../../path-analyser/src/types.ts';

/**
 * Layer-1 JS SDK emitter fixture.
 *
 * Hand-built minimal `EndpointScenarioCollection` paired with structural
 * assertions on the emitted Vitest source. One `it` = one emitter property.
 *
 * These fixtures are the regression guard: a change to the emitter that breaks
 * the generated contract surfaces as an exact failing assertion here rather
 * than as a silent output diff. The scoping is class-level: the fixture
 * proves structural invariants that hold for ALL collections, not just the
 * named instance.
 */

const FALLBACK_MAPPING = new FallbackMappingSource();

/**
 * Minimal no-body scenario: getTopology (no prerequisites, no request body).
 */
const FIXTURE_GET_TOPOLOGY: EndpointScenarioCollection = {
  endpoint: { operationId: 'getTopology', method: 'GET', path: '/topology' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc-topology-simple',
      name: 'get cluster topology',
      description: 'Fetches the current Zeebe cluster topology',
      operations: [{ operationId: 'getTopology', method: 'GET', path: '/topology' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
    },
  ],
};

/**
 * JSON body scenario: activateJobs (POST with request body and response extraction).
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
      bindings: { workerType: 'MyWorkerType' },
      requestPlan: [
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
        },
      ],
      seedBindings: ['workerType'],
    },
  ],
};

describe('JsSdkEmitter Layer-1 fixture: filename contract', () => {
  it('jsSdkSuiteFileName returns <operationId>.feature.test.ts in feature mode', () => {
    expect(jsSdkSuiteFileName(FIXTURE_GET_TOPOLOGY, 'feature')).toBe('getTopology.feature.test.ts');
  });

  it('jsSdkSuiteFileName returns <operationId>.integration.test.ts in integration mode', () => {
    expect(jsSdkSuiteFileName(FIXTURE_GET_TOPOLOGY, 'integration')).toBe(
      'getTopology.integration.test.ts',
    );
  });

  it('jsSdkSuiteFileName uses operationId from the collection endpoint (not suiteName)', () => {
    expect(jsSdkSuiteFileName(FIXTURE_ACTIVATE_JOBS, 'feature')).toBe(
      'activateJobs.feature.test.ts',
    );
  });

  it('jsSdkSuiteFileName uses .test.ts suffix — not .spec.ts (Playwright convention)', () => {
    const name = jsSdkSuiteFileName(FIXTURE_GET_TOPOLOGY, 'feature');
    expect(name).toMatch(/\.test\.ts$/);
    expect(name).not.toMatch(/\.spec\.ts$/);
  });
});

describe('JsSdkEmitter Layer-1 fixture: suite skeleton', () => {
  it('emitted suite imports createCamundaClient from the SDK package', () => {
    const src = renderJsSdkSuite(FIXTURE_GET_TOPOLOGY, FALLBACK_MAPPING, { mode: 'feature' });
    expect(src).toContain("import createCamundaClient from '@camunda8/orchestration-cluster-api'");
  });

  it('emitted suite imports extractInto and seedBinding from ./support/seeding', () => {
    const src = renderJsSdkSuite(FIXTURE_GET_TOPOLOGY, FALLBACK_MAPPING, { mode: 'feature' });
    expect(src).toContain("import { extractInto, seedBinding } from './support/seeding'");
  });

  it('emitted suite wraps all scenarios in a describe block named after the operationId', () => {
    const src = renderJsSdkSuite(FIXTURE_GET_TOPOLOGY, FALLBACK_MAPPING, { mode: 'feature' });
    expect(src).toMatch(/describe\('getTopology'/);
  });

  it('emitted suite wraps each scenario in a test() block', () => {
    const src = renderJsSdkSuite(FIXTURE_GET_TOPOLOGY, FALLBACK_MAPPING, { mode: 'feature' });
    expect(src).toMatch(/test\(/);
  });

  it('emitted suite creates a shared client via createCamundaClient()', () => {
    const src = renderJsSdkSuite(FIXTURE_GET_TOPOLOGY, FALLBACK_MAPPING, { mode: 'feature' });
    expect(src).toContain('const client = createCamundaClient()');
  });
});

describe('JsSdkEmitter Layer-1 fixture: no-body scenario (getTopology)', () => {
  it('no-body scenario with no requestPlan emits a // No request plan available comment', () => {
    const src = renderJsSdkSuite(FIXTURE_GET_TOPOLOGY, FALLBACK_MAPPING, { mode: 'feature' });
    expect(src).toContain('// No request plan available');
  });

  it('no-body scenario does not emit an args object', () => {
    const src = renderJsSdkSuite(FIXTURE_GET_TOPOLOGY, FALLBACK_MAPPING, { mode: 'feature' });
    expect(src).not.toContain('const args1');
  });
});

describe('JsSdkEmitter Layer-1 fixture: JSON body scenario (activateJobs)', () => {
  it('activateJobs emits ctx seed for workerType binding from scenario.bindings', () => {
    const src = renderJsSdkSuite(FIXTURE_ACTIVATE_JOBS, FALLBACK_MAPPING, { mode: 'feature' });
    expect(src).toContain("ctx['workerType']");
  });

  it('activateJobs body template ${workerType} resolves to ctx["workerType"] in the args object', () => {
    const src = renderJsSdkSuite(FIXTURE_ACTIVATE_JOBS, FALLBACK_MAPPING, { mode: 'feature' });
    expect(src).toContain('ctx["workerType"]');
  });

  it('activateJobs emits await client.activateJobs(args1)', () => {
    const src = renderJsSdkSuite(FIXTURE_ACTIVATE_JOBS, FALLBACK_MAPPING, { mode: 'feature' });
    expect(src).toContain('client.activateJobs(args1)');
  });

  it('activateJobs emits extractInto call for jobKey extraction', () => {
    const src = renderJsSdkSuite(FIXTURE_ACTIVATE_JOBS, FALLBACK_MAPPING, { mode: 'feature' });
    expect(src).toContain("extractInto(ctx, 'jobKey'");
  });

  it('emitted suite contains no unresolved ${...} placeholder strings (Bug A guard)', () => {
    const src = renderJsSdkSuite(FIXTURE_ACTIVATE_JOBS, FALLBACK_MAPPING, { mode: 'feature' });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal regex check for unresolved template placeholder syntax in emitted output
    expect(src).not.toMatch(/\$\{[^}]+\}/);
  });

  it('fixture scenario bindings and seedBindings are aligned', () => {
    const scenario = FIXTURE_ACTIVATE_JOBS.scenarios[0];
    const seedBindings = scenario.seedBindings ?? [];
    const bindings = scenario.bindings ?? {};
    for (const name of seedBindings) {
      expect(bindings).toHaveProperty(name);
    }
  });
});
