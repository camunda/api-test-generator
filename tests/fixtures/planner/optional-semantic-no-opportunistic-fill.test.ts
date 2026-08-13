/**
 * Body-synthesis contract (#247) — an OPTIONAL semantic-typed top-level field is
 * owned by the variant suite and must never be filled just because a same-named
 * binding happens to exist in the scenario.
 *
 * `buildRequestBodyFromCanonical` derives its fill binding from the field's own
 * leaf name (`tenantId` → `tenantIdVar`). Any prerequisite that mints a binding
 * of that name therefore silently changes an unrelated operation's body shape.
 *
 * Reproduces correlateMessage: once the ABox gave it a prerequisite chain
 * (createDeployment → createProcessInstance → correlateMessage), the multipart
 * `globalContextSeeds` wiring stamped `tenantIdVar` for createDeployment's
 * `fields.tenantId`, and the optional-fill pass then injected
 * `tenantId: '${tenantIdVar}'` into correlateMessage's feature-BASE body —
 * exactly the optional population the #162 PR 4 suite-partition cut moved into
 * `generateOptionalSubShapeVariants`.
 *
 * The two boundary cases below keep the guard scoped: it must key on the
 * semantic-type annotation (non-annotated optionals like `updateUser.password`
 * still fill) and it must not override explicit ABox operator intent.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRequestBodyFromCanonical,
  type CanonicalShape,
} from '../../../path-analyser/src/index.ts';
import type { EndpointScenario, OperationGraph } from '../../../path-analyser/src/types.ts';

// correlateMessage-like body: required `name`, optional semantic-typed
// `tenantId`, optional NON-annotated `password`.
const canonical: Record<string, CanonicalShape> = {
  correlateMessageL2: {
    requestByMediaType: {
      'application/json': [
        { path: 'name', type: 'string', required: true },
        { path: 'tenantId', type: 'string', required: false },
        { path: 'password', type: 'string', required: false },
      ],
    },
  },
};

function graphWith(valueBindings?: Record<string, string>): OperationGraph {
  const graph: OperationGraph = {
    operations: {
      correlateMessageL2: {
        operationId: 'correlateMessageL2',
        method: 'POST',
        path: '/messages/correlation',
        requires: { required: [], optional: ['TenantId'] },
        produces: [],
        // Only `tenantId` carries a semantic-type annotation, and it is
        // OPTIONAL. `password` is deliberately unannotated.
        requestBodySemantics: [{ semantic: 'TenantId', fieldPath: 'tenantId', required: false }],
      },
    },
    producersByType: {},
    producersByState: {},
    responseProducersByType: {},
  };
  if (valueBindings) {
    graph.domain = {
      version: 1,
      operationRequirements: { correlateMessageL2: { valueBindings } },
    };
  }
  return graph;
}

// A chain prerequisite (createDeployment's multipart `fields.tenantId`) already
// minted `tenantIdVar`; `passwordVar` stands in for any ordinary chain binding.
function chainScenario(): EndpointScenario {
  return {
    id: 'feature-1',
    operations: [],
    producedSemanticTypes: [],
    satisfiedSemanticTypes: [],
    strategy: 'featureCoverage',
    variantKey: 'base',
    bindings: { tenantIdVar: '__PENDING__', passwordVar: '__PENDING__' },
  };
}

function templateFor(graph: OperationGraph): Record<string, unknown> {
  const plan = buildRequestBodyFromCanonical(
    'correlateMessageL2',
    chainScenario(),
    graph,
    canonical,
    {},
    /* isEndpoint */ true,
  );
  expect(plan?.kind).toBe('json');
  return plan?.kind === 'json' ? plan.template : {};
}

describe('optional semantic-typed body fields are variant-suite-only (#247)', () => {
  it('does NOT fill an optional semantic-typed field from a same-named chain binding', () => {
    const template = templateFor(graphWith());
    expect(template).toHaveProperty('name'); // required field still synthesised
    expect(template).not.toHaveProperty('tenantId'); // optional semantic → variant suite only
  });

  it('still fills an optional field that carries NO semantic-type annotation', () => {
    // Scope guard: the suppression keys on the semantic-type annotation, not on
    // optionality. `updateUser`'s base body is `{ password: "${passwordVar}" }`
    // and must not collapse to `{}`.
    const template = templateFor(graphWith());
    expect(template.password).toBe('${passwordVar}');
  });

  it('still fills an optional semantic-typed field declared by an ABox valueBinding', () => {
    // Scope guard: an explicit `request.<field>` entry in the ABox is operator
    // intent, not a name collision, and stays honoured.
    const template = templateFor(graphWith({ 'request.tenantId': 'TenantExists.tenantId' }));
    expect(template.tenantId).toBe('${tenantIdVar}');
  });
});
