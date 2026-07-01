/**
 * Body-synthesis contract (#416) — a sub-shape variant exercises its leaf
 * ONLY on the endpoint under test, never on a prerequisite step.
 *
 * `mergePopulatesSubShapeIntoFinalBody` injects the exercised leaf into the
 * final (endpoint) step. A prerequisite step that happens to expose an
 * OPTIONAL field of the same leaf must NOT opportunistically fill it from the
 * variant's binding: that binding is `__PENDING__` (or resolved only by a
 * later producer step), so the prerequisite would send a not-yet-created key
 * and 4xx.
 *
 * Reproduces updateFile's folderKey variant: the chain runs
 * createFile → createFolder → updateFile, and `createFile` also has an
 * optional `folderKey`. Before the fix, `createFile`'s body carried
 * `${folderKeyVar}` (seeded, folder not yet created) → 403.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRequestBodyFromCanonical,
  type CanonicalShape,
} from '../../../path-analyser/src/index.ts';
import type { EndpointScenario, OperationGraph } from '../../../path-analyser/src/types.ts';

// createFile-like body: required `name`, optional `folderKey`.
const canonical: Record<string, CanonicalShape> = {
  createFile: {
    requestByMediaType: {
      'application/json': [
        { path: 'name', type: 'string', required: true },
        { path: 'folderKey', type: 'string', required: false },
      ],
    },
  },
};

const graph: OperationGraph = {
  operations: {
    createFile: {
      operationId: 'createFile',
      method: 'POST',
      path: '/files',
      requires: { required: [], optional: [] },
      produces: [],
    },
  },
  producersByType: {},
  producersByState: {},
  responseProducersByType: {},
};

function variantScenario(): EndpointScenario {
  return {
    id: 'variant-2',
    operations: [],
    producedSemanticTypes: [],
    satisfiedSemanticTypes: [],
    // The variant leaf binding exists in the scenario (installed for the
    // endpoint step) — this is exactly what used to leak into the prereq.
    bindings: { folderKeyVar: '__PENDING__' },
    populatesSubShape: {
      rootPath: '',
      leafPaths: ['folderKey'],
      leafSemantics: ['FolderKey'],
    },
  };
}

describe('variant leaf-population is endpoint-scoped (#416)', () => {
  it('does NOT fill the exercised leaf into a prerequisite body', () => {
    const plan = buildRequestBodyFromCanonical(
      'createFile',
      variantScenario(),
      graph,
      canonical,
      {},
      /* isEndpoint */ false,
    );
    expect(plan?.kind).toBe('json');
    const template = plan?.kind === 'json' ? plan.template : {};
    expect(template).toHaveProperty('name'); // required field still synthesised
    expect(template).not.toHaveProperty('folderKey'); // leaf must not leak into prereq
  });

  it('still fills the optional leaf when the step IS the endpoint', () => {
    // Guard is scoped to prerequisites: the endpoint may opportunistically
    // carry the leaf (redundant with mergePopulatesSubShapeIntoFinalBody).
    const plan = buildRequestBodyFromCanonical(
      'createFile',
      variantScenario(),
      graph,
      canonical,
      {},
      /* isEndpoint */ true,
    );
    const template = plan?.kind === 'json' ? plan.template : {};
    expect(template).toHaveProperty('folderKey');
  });
});
