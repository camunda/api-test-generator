import { describe, expect, it } from 'vitest';
import { generateOptionalSubShapeVariants } from '../../../path-analyser/src/scenarioGenerator.ts';
import type { OperationGraph, OperationNode } from '../../../path-analyser/src/types.ts';

// ---------------------------------------------------------------------------
// Fixture: endpoint-scoped pagination cursors
// ---------------------------------------------------------------------------
//
// Every search op authoritatively returns page cursors AND optionally accepts
// them (page.after / page.before). A cursor is only meaningful to the endpoint
// that issued it, so a cursor variant must source it from a prior call to the
// SAME endpoint. `aaaSearch` sorts first, mirroring `searchAgentDefinitions`,
// which the bundled spec lists first among 57 cursor producers and which was
// being chained into every cursor variant.
function searchOp(operationId: string): OperationNode {
  return {
    operationId,
    method: 'POST',
    path: `/${operationId}`,
    requires: { required: [], optional: ['EndCursor', 'StartCursor'] },
    produces: ['EndCursor', 'StartCursor'],
    providerMap: { EndCursor: true, StartCursor: true },
    optionalSubShapes: [
      {
        rootPath: 'page',
        leaves: [
          { fieldPath: 'page.after', semantic: 'EndCursor' },
          { fieldPath: 'page.before', semantic: 'StartCursor' },
        ],
      },
    ],
  };
}

const fixtureEndpointScopedCursor: OperationGraph = {
  operations: { aaaSearch: searchOp('aaaSearch'), searchJobs: searchOp('searchJobs') },
  producersByType: {
    EndCursor: ['aaaSearch', 'searchJobs'],
    StartCursor: ['aaaSearch', 'searchJobs'],
  },
  producersByState: {},
  responseProducersByType: {
    EndCursor: ['aaaSearch', 'searchJobs'],
    StartCursor: ['aaaSearch', 'searchJobs'],
  },
};

describe('planner contracts: endpoint-authoritative optional leaf is self-sourced', () => {
  it('sources both cursor leaves from a prior call to the same endpoint', () => {
    const variants = generateOptionalSubShapeVariants(fixtureEndpointScopedCursor, 'searchJobs', {
      maxVariantsPerEndpoint: 10,
    });
    expect(variants.scenarios.map((s) => s.variantKey)).toEqual([
      'page::page.after::EndCursor',
      'page::page.before::StartCursor',
    ]);
    for (const s of variants.scenarios) {
      expect(
        s.operations.map((o) => o.operationId),
        s.variantKey,
      ).toEqual(['searchJobs', 'searchJobs']);
    }
  });
});
