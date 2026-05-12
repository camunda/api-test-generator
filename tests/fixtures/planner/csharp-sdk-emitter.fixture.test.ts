import { describe, expect, it } from 'vitest';
import { renderCsharpSdkSuite } from '../../../path-analyser/src/codegen/csharp-sdk/emitter.ts';
import { FallbackMappingSource } from '../../../path-analyser/src/codegen/csharp-sdk/sdk-mapping.ts';
import type { EndpointScenarioCollection } from '../../../path-analyser/src/types.ts';

/**
 * Layer-1 fixture — C# SDK emitter.
 *
 * Asserts one concrete lowering from a hand-built scenario collection to
 * emitted C# source. This fixture is the regression guard for the emitter's
 * binding/seeding contract.
 */

describe('csharp-sdk emitter fixture', () => {
  it('seeds pending bindings and emits request calls', () => {
    const collection: EndpointScenarioCollection = {
      endpoint: {
        operationId: 'cancelProcessInstance',
        method: 'POST',
        path: '/process-instances',
      },
      requiredSemanticTypes: ['ProcessInstanceKey'],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'cancel instance',
          operations: [
            {
              operationId: 'cancelProcessInstance',
              method: 'POST',
              path: '/process-instances/{processInstanceKey}/cancellation',
            },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: ['ProcessInstanceKey'],
          bindings: { processInstanceKeyVar: '__PENDING__' },
          seedBindings: ['processInstanceKeyVar'],
          requestPlan: [
            {
              operationId: 'cancelProcessInstance',
              method: 'POST',
              pathTemplate: '/process-instances/{processInstanceKey}/cancellation',
              pathParams: [{ name: 'processInstanceKey', var: 'processInstanceKeyVar' }],
              expect: { status: 200 },
            },
          ],
        },
      ],
    };

    const src = renderCsharpSdkSuite(collection, new FallbackMappingSource(), {
      suiteName: 'cancelProcessInstance',
      mode: 'feature',
    });

    expect(src).toContain('SeedBindingIfMissing(ctx, "processInstanceKeyVar"');
    expect(src).toContain('Client.CancelProcessInstanceAsync');
    expect(src).toContain('["processInstanceKey"] = ctx["processInstanceKeyVar"]');
  });
});
