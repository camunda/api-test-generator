/**
 * Body-synthesis contract (#757) — a request default declared for an operation
 * fills an OPTIONAL top-level array field.
 *
 * `buildRequestBodyFromCanonical` fills optional scalar fields from a binding or
 * a request default, but an optional array is recorded as `field[]`, so that
 * pass skips it and the field was never sent. Hub's createCredential needs its
 * optional `credentialTemplateSchema` array for every credential template Hub
 * cannot look up, so without it every generated create answered 400.
 *
 * The boundary cases keep the fill scoped to `operations.<opId>` defaults: a
 * `global` array default must not be sent by every operation that happens to
 * declare the field.
 *
 * Uses camunda-oca's real request-defaults.json, which has both kinds:
 * `operations.activateJobs.fetchVariable: []` and the global
 * `fetchVariable: ['*']` / `tenantIds: null`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildRequestBodyFromCanonical,
  type CanonicalShape,
} from '../../../path-analyser/src/index.ts';
import type { EndpointScenario, OperationGraph } from '../../../path-analyser/src/types.ts';

// Pin the config before the first build call: request defaults are loaded on
// first use and cached for the life of this test file's module graph.
vi.stubEnv('CONFIG', 'camunda-oca');

const jobActivationBody = [
  { path: 'type', type: 'string', required: true },
  { path: 'fetchVariable[]', type: 'array', required: false },
  { path: 'tenantIds[]', type: 'array', required: false },
];

const canonical: Record<string, CanonicalShape> = {
  activateJobs: { requestByMediaType: { 'application/json': jobActivationBody } },
  // Same body, but no `operations.<opId>` entry in request-defaults.json.
  activateJobsWithoutDefaults: { requestByMediaType: { 'application/json': jobActivationBody } },
};

function graph(): OperationGraph {
  const operation = (operationId: string) => ({
    operationId,
    method: 'POST',
    path: '/jobs/activation',
    requires: { required: [], optional: [] },
    produces: [],
  });
  return {
    operations: {
      activateJobs: operation('activateJobs'),
      activateJobsWithoutDefaults: operation('activateJobsWithoutDefaults'),
    },
    producersByType: {},
    producersByState: {},
    responseProducersByType: {},
  };
}

function scenario(): EndpointScenario {
  return {
    id: 'feature-1',
    operations: [],
    producedSemanticTypes: [],
    satisfiedSemanticTypes: [],
    strategy: 'featureCoverage',
    variantKey: 'base',
  };
}

function templateFor(opId: string): Record<string, unknown> {
  const plan = buildRequestBodyFromCanonical(
    opId,
    scenario(),
    graph(),
    canonical,
    {},
    /* isEndpoint */ true,
  );
  expect(plan?.kind).toBe('json');
  return plan?.kind === 'json' ? plan.template : {};
}

describe('optional array fields take an operation-level request default (#757)', () => {
  it('fills an optional array from the operation default, not the global one', () => {
    expect(templateFor('activateJobs').fetchVariable).toEqual([]);
  });

  it('does not fill an optional array that only has a global default', () => {
    expect(templateFor('activateJobs')).not.toHaveProperty('tenantIds');
  });

  it('does not fill an optional array for an operation without defaults', () => {
    const template = templateFor('activateJobsWithoutDefaults');
    expect(template).not.toHaveProperty('fetchVariable');
    expect(template).not.toHaveProperty('tenantIds');
  });
});
