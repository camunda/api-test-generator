/**
 * Nested filter-scope binding (#408 / #168).
 *
 * A search op with a REQUIRED nested `filter.<key>` scope field whose semantic
 * has a graph producer must bind that field to the produced `${…Var}`, not the
 * synthesised `'placeholder'`. Reproduces camunda-hub `searchVersions`, whose
 * body used to be `{ filter: { fileKey: 'placeholder' } }` even though the
 * chain created a file and extracted `fileKeyVar` — leaving the version search
 * unscoped. `buildRequestBodyFromCanonical` otherwise fills required nested
 * fields via `synthesizeObjectFromPrefix`, which has no binding context.
 *
 * The bind is gated to REQUIRED filter fields with a producer (an optional
 * filter stays unbound — the deferred #168 behaviour) so it can't reference a
 * var the chain never produces.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRequestBodyFromCanonical,
  type CanonicalShape,
} from '../../../path-analyser/src/index.ts';
import type { EndpointScenario, OperationGraph } from '../../../path-analyser/src/types.ts';

// searchVersions-like body: a `filter` object with a nested `filter.fileKey`
// (semantic FileKey). The nested field's `required` flag is the gate the fix
// reads (a required scope field binds; an optional one stays unbound, #168).
function makeCanonical(fileKeyRequired: boolean): Record<string, CanonicalShape> {
  return {
    searchVersions: {
      requestByMediaType: {
        'application/json': [
          { path: 'filter', type: 'object', required: true },
          { path: 'filter.fileKey', type: 'string', required: fileKeyRequired },
        ],
      },
    },
  };
}

function makeGraph(fileKeyProducer: boolean): OperationGraph {
  return {
    operations: {
      searchVersions: {
        operationId: 'searchVersions',
        method: 'POST',
        path: '/versions/search',
        requires: { required: [], optional: [] },
        produces: [],
        requestBodySemantics: [
          { semantic: 'FileKey', fieldPath: 'filter.fileKey', required: true },
        ],
      },
    },
    producersByType: fileKeyProducer ? { FileKey: ['createFile'] } : {},
    producersByState: {},
    responseProducersByType: {},
  };
}

function scenario(): EndpointScenario {
  return {
    id: 'feature-1',
    operations: [],
    producedSemanticTypes: [], // feature scenarios don't carry this — must not gate on it
    satisfiedSemanticTypes: [],
  };
}

function fileKeyValue(opts: { producer: boolean; required: boolean }): unknown {
  const plan = buildRequestBodyFromCanonical(
    'searchVersions',
    scenario(),
    makeGraph(opts.producer),
    makeCanonical(opts.required),
    {},
    /* isEndpoint */ true,
  );
  const template = plan?.kind === 'json' ? plan.template : {};
  const filter = template.filter;
  return isRecord(filter) ? filter.fileKey : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

describe('nested filter-scope binding (#408 / #168)', () => {
  it('binds a required filter.<key> to its produced var (not placeholder)', () => {
    expect(fileKeyValue({ producer: true, required: true })).toBe('${fileKeyVar}');
  });

  it('leaves the field synthesised when the semantic has no producer', () => {
    // No producer → binding it would reference a var the chain never extracts.
    expect(fileKeyValue({ producer: false, required: true })).toBe('placeholder');
  });

  it('leaves an OPTIONAL filter field unbound (preserves #168)', () => {
    // Optional filters are not force-scoped; only required scope fields bind.
    expect(fileKeyValue({ producer: true, required: false })).not.toBe('${fileKeyVar}');
  });

  it('binds a required ARRAY filter field (filter.tags[]) despite the [] suffix', () => {
    // requiredBodyPaths strips the trailing `[]` from the canonical node; the
    // membership check must normalise the semantic fieldPath the same way so an
    // array filter field still matches (else the [] mismatch skips the bind).
    const canonical: Record<string, CanonicalShape> = {
      searchThings: {
        requestByMediaType: {
          'application/json': [
            { path: 'filter', type: 'object', required: true },
            { path: 'filter.tags[]', type: 'string', required: true },
          ],
        },
      },
    };
    const graph: OperationGraph = {
      operations: {
        searchThings: {
          operationId: 'searchThings',
          method: 'POST',
          path: '/things/search',
          requires: { required: [], optional: [] },
          produces: [],
          requestBodySemantics: [{ semantic: 'Tag', fieldPath: 'filter.tags[]', required: true }],
        },
      },
      producersByType: { Tag: ['createTag'] },
      producersByState: {},
      responseProducersByType: {},
    };
    const plan = buildRequestBodyFromCanonical(
      'searchThings',
      scenario(),
      graph,
      canonical,
      {},
      /* isEndpoint */ true,
    );
    const template = plan?.kind === 'json' ? plan.template : {};
    const filter = template.filter;
    expect(isRecord(filter) ? filter.tags : undefined).toEqual(['${tagVar}']);
  });
});

describe('batch-operation "at least one filter criterion" (#403 / A2a)', () => {
  // cancelProcessInstancesBatchOperation-like body: a `filter` object whose
  // sub-properties are ALL optional (so the required-only pass above leaves
  // it `{}`), on an operationId matching the batch-operation heuristic
  // (`isBatchOperationOpId`). Mirrors the real ProcessInstanceFilter shape:
  // a key-typed optional leaf (`processInstanceKey`) alongside a
  // boolean-typed optional leaf (`hasIncident`) — the fix must prefer the
  // boolean, not the key (a key-shaped `${var}` bind with no chained
  // producer step falls back to a random seed string that fails the
  // server's numeric-key format check; verified live against a real
  // broker).
  function makeBatchOpCanonical(): Record<string, CanonicalShape> {
    return {
      cancelProcessInstancesBatchOperation: {
        requestByMediaType: {
          'application/json': [
            { path: 'filter', type: 'object', required: true },
            { path: 'filter.processInstanceKey', type: 'string', required: false },
            { path: 'filter.hasIncident', type: 'boolean', required: false },
          ],
        },
      },
    };
  }

  function batchOpFilter(): unknown {
    const graph: OperationGraph = {
      operations: {
        cancelProcessInstancesBatchOperation: {
          operationId: 'cancelProcessInstancesBatchOperation',
          method: 'POST',
          path: '/process-instances/cancellation',
          requires: { required: [], optional: [] },
          produces: [],
          requestBodySemantics: [],
        },
      },
      producersByType: {},
      producersByState: {},
      responseProducersByType: {},
    };
    const plan = buildRequestBodyFromCanonical(
      'cancelProcessInstancesBatchOperation',
      scenario(),
      graph,
      makeBatchOpCanonical(),
      {},
      /* isEndpoint */ true,
    );
    const template = plan?.kind === 'json' ? plan.template : {};
    return template.filter;
  }

  it('force-fills a boolean filter.* leaf with a literal instead of leaving {}', () => {
    const filter = batchOpFilter();
    expect(isRecord(filter) ? filter.hasIncident : undefined).toBe(true);
  });

  it('does not need (or use) a bound var — the leaf is a plain literal', () => {
    const filter = batchOpFilter();
    // Not a `${...}` placeholder: no scenario.bindings/seedBinding round-trip.
    expect(isRecord(filter) ? filter.processInstanceKey : 'unset').toBeUndefined();
  });

  it('picks the first enum value when only an enum leaf is available', () => {
    const canonical: Record<string, CanonicalShape> = {
      deleteDecisionInstancesBatchOperation: {
        requestByMediaType: {
          'application/json': [
            { path: 'filter', type: 'object', required: true },
            {
              path: 'filter.decisionDefinitionType',
              type: 'string',
              required: false,
              enum: ['DECISION_TABLE', 'LITERAL_EXPRESSION'],
            },
          ],
        },
      },
    };
    const graph: OperationGraph = {
      operations: {
        deleteDecisionInstancesBatchOperation: {
          operationId: 'deleteDecisionInstancesBatchOperation',
          method: 'POST',
          path: '/decision-instances/deletion',
          requires: { required: [], optional: [] },
          produces: [],
          requestBodySemantics: [],
        },
      },
      producersByType: {},
      producersByState: {},
      responseProducersByType: {},
    };
    const plan = buildRequestBodyFromCanonical(
      'deleteDecisionInstancesBatchOperation',
      scenario(),
      graph,
      canonical,
      {},
      /* isEndpoint */ true,
    );
    const template = plan?.kind === 'json' ? plan.template : {};
    const filter = template.filter;
    expect(isRecord(filter) ? filter.decisionDefinitionType : undefined).toBe('DECISION_TABLE');
  });

  it('leaves filter as {} when no boolean/enum leaf is available (nothing safe to fill)', () => {
    const canonical: Record<string, CanonicalShape> = {
      cancelProcessInstancesBatchOperation: {
        requestByMediaType: {
          'application/json': [
            { path: 'filter', type: 'object', required: true },
            { path: 'filter.processInstanceKey', type: 'string', required: false },
          ],
        },
      },
    };
    const graph: OperationGraph = {
      operations: {
        cancelProcessInstancesBatchOperation: {
          operationId: 'cancelProcessInstancesBatchOperation',
          method: 'POST',
          path: '/process-instances/cancellation',
          requires: { required: [], optional: [] },
          produces: [],
          requestBodySemantics: [],
        },
      },
      producersByType: {},
      producersByState: {},
      responseProducersByType: {},
    };
    const plan = buildRequestBodyFromCanonical(
      'cancelProcessInstancesBatchOperation',
      scenario(),
      graph,
      canonical,
      {},
      /* isEndpoint */ true,
    );
    const template = plan?.kind === 'json' ? plan.template : {};
    expect(template.filter).toEqual({});
  });

  it('does NOT force-fill a non-batch-operation search filter (regression guard)', () => {
    // Same shape as the batch-op case above, but `searchThings` doesn't match
    // the `/BatchOperation$/` heuristic — an empty filter is legitimate for a
    // plain search (it means "no filter"), so it must stay {}.
    const canonical: Record<string, CanonicalShape> = {
      searchThings: {
        requestByMediaType: {
          'application/json': [
            { path: 'filter', type: 'object', required: true },
            { path: 'filter.hasIncident', type: 'boolean', required: false },
          ],
        },
      },
    };
    const graph: OperationGraph = {
      operations: {
        searchThings: {
          operationId: 'searchThings',
          method: 'POST',
          path: '/things/search',
          requires: { required: [], optional: [] },
          produces: [],
          requestBodySemantics: [],
        },
      },
      producersByType: {},
      producersByState: {},
      responseProducersByType: {},
    };
    const plan = buildRequestBodyFromCanonical(
      'searchThings',
      scenario(),
      graph,
      canonical,
      {},
      /* isEndpoint */ true,
    );
    const template = plan?.kind === 'json' ? plan.template : {};
    expect(template.filter).toEqual({});
  });
});
