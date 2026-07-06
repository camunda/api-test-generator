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
});
