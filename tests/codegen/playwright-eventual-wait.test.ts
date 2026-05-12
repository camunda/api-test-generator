import { describe, expect, test } from 'vitest';
import { renderPlaywrightSuite } from '../../path-analyser/src/codegen/playwright/emitter.ts';
import type { EndpointScenarioCollection } from '../../path-analyser/src/types.ts';

// Layer-2 guards for the eventual-state wait injection (#159 PR B).
//
// The emitter renders a planner-annotated `eventualWaitsAfter` as an
// `awaitEventually(witnessUrl, { predicate })` block immediately after
// the producer step. The tests below pin both the shape of the emitted
// block AND the "import + render in lockstep" contract — the
// `await-eventually` import must be present whenever any step carries
// an eventualWaitsAfter, even when no step is itself an EC read.

function buildCollectionWithWait(): EndpointScenarioCollection {
  return {
    endpoint: { operationId: 'deleteWidget', method: 'POST', path: '/widgets/{id}/deletion' },
    requiredSemanticTypes: [],
    optionalSemanticTypes: [],
    scenarios: [
      {
        id: 'sc1',
        name: 'create then delete with wait',
        operations: [
          { operationId: 'createWidget', method: 'POST', path: '/widgets' },
          { operationId: 'deleteWidget', method: 'POST', path: '/widgets/{id}/deletion' },
        ],
        producedSemanticTypes: [],
        satisfiedSemanticTypes: [],
        requestPlan: [
          {
            operationId: 'createWidget',
            method: 'POST',
            pathTemplate: '/widgets',
            expect: { status: 200 },
            extract: [{ fieldPath: 'id', bind: 'idVar' }],
            eventualWaitsAfter: [
              {
                state: 'WidgetReady',
                witness: {
                  operationId: 'getWidget',
                  method: 'GET',
                  pathTemplate: '/widgets/{id}',
                  predicate: { path: 'state', equals: 'READY' },
                },
              },
            ],
          },
          {
            operationId: 'deleteWidget',
            method: 'POST',
            pathTemplate: '/widgets/{id}/deletion',
            expect: { status: 204 },
          },
        ],
      },
    ],
  };
}

describe('emitter: eventual-state wait injection (#159 PR B)', () => {
  test('renders an awaitEventually block immediately after the producer step', () => {
    const src = renderPlaywrightSuite(buildCollectionWithWait(), {
      suiteName: 'deleteWidget',
      mode: 'feature',
    });
    // The wait must appear in the source AND sit between Step 1 (producer)
    // and Step 2 (consumer). Position is part of the contract — a wait
    // emitted before the producer (or after the consumer) doesn't fix the
    // motivating case.
    const producerIdx = src.indexOf('Step 1: createWidget');
    const consumerIdx = src.indexOf('Step 2: deleteWidget');
    const waitIdx = src.indexOf('await awaitEventually(');
    expect(producerIdx).toBeGreaterThan(0);
    expect(consumerIdx).toBeGreaterThan(producerIdx);
    expect(waitIdx).toBeGreaterThan(producerIdx);
    expect(waitIdx).toBeLessThan(consumerIdx);
  });

  test('imports await-eventually even when no step is itself an EC read', () => {
    // Pre-PR-B the import was gated only on stepNeedsAwait() (read-shape EC
    // ops). A wait-after-producer must lift the import on its own — otherwise
    // the emitted suite references awaitEventually without an import.
    const src = renderPlaywrightSuite(buildCollectionWithWait(), {
      suiteName: 'deleteWidget',
      mode: 'feature',
    });
    expect(src).toContain("import { awaitEventually } from './support/await-eventually';");
  });

  test('emits the witness URL using the ctx-binding rewrite (path param resolves to ctx.<name>Var)', () => {
    // The witness URL must thread through buildUrlExpression so the
    // `{id}` path-param picks up `ctx.idVar` extracted by the producer
    // step (binds the wait to the producer's response).
    const src = renderPlaywrightSuite(buildCollectionWithWait(), {
      suiteName: 'deleteWidget',
      mode: 'feature',
    });
    expect(src).toContain('const witnessUrl = baseUrl +');
    expect(src).toContain('ctx.idVar');
  });

  test('renders a structured predicate that compares the configured path against the configured scalar', () => {
    // The predicate is generated from the structured WitnessPredicate
    // shape, NOT interpolated from a user-supplied string. The emitted
    // function narrows `unknown` to a record, reads the configured
    // top-level field via bracket-access (biome rewrites this to dot
    // access in the regenerated suite, but the emitter outputs the
    // bracket form), and compares with `===`.
    const src = renderPlaywrightSuite(buildCollectionWithWait(), {
      suiteName: 'deleteWidget',
      mode: 'feature',
    });
    // Predicate body shape — `state` and `'READY'` come from the spec above.
    expect(src).toContain("const v = (body as Record<string, unknown>)['state'];");
    // Pre-biome quoting: JSON.stringify produces double quotes; biome
    // rewrites them to single quotes in the regenerated suite. The
    // assertion targets the emitter's raw output.
    expect(src).toContain('return v === "READY";');
  });

  test('captures the awaitEventually response and asserts its status (#159 PR B review)', () => {
    // awaitEventually returns early (without throwing) on hard-fail
    // statuses (401/403/422/5xx etc.) so callers can produce a useful
    // expect-vs-actual diff. Pre-review the emitter ignored the return
    // value — a 401 against the witness would silently let the scenario
    // proceed and the failure would be misattributed to the consumer
    // step. The new shape captures the response, logs the body on
    // mismatch (mirroring the request-step pattern), and asserts 200.
    const src = renderPlaywrightSuite(buildCollectionWithWait(), {
      suiteName: 'deleteWidget',
      mode: 'feature',
    });
    expect(src).toContain('const witnessResp1 = await awaitEventually(');
    expect(src).toContain('if (witnessResp1.status() !== 200)');
    expect(src).toContain("console.error('Witness response body:'");
    expect(src).toContain('expect(witnessResp1.status()).toBe(200);');
  });

  test('omits the wait block (and the await-eventually import gate) when no step has eventualWaitsAfter', () => {
    // Sanity guard: a collection without any wait annotation must NOT
    // emit the wait scaffolding. Catches a regression where the gate
    // accidentally fires for every step.
    const collection: EndpointScenarioCollection = {
      endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'simple',
          operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'createWidget',
              method: 'POST',
              pathTemplate: '/widgets',
              expect: { status: 200 },
            },
          ],
        },
      ],
    };
    const src = renderPlaywrightSuite(collection, { suiteName: 'createWidget', mode: 'feature' });
    expect(src).not.toContain('awaitEventually');
    expect(src).not.toContain("from './support/await-eventually'");
  });
});
