/**
 * Construct fixtures for the semantic-graph extractor — x-semantic-establishes
 * (camunda/api-test-generator#104, upstream camunda/camunda#52272).
 *
 * Each fixture isolates ONE shape of the annotation so a failure points at
 * one parser branch, not at the bundled-spec aggregate. The class-scoped
 * regression: any operation whose object satisfies the annotation contract
 * (kind + non-empty identifiedBy) must surface it on `Operation.establishes`,
 * regardless of whether body or path inputs carry the identifier.
 */
import { describe, expect, it } from 'vitest';
import { SchemaAnalyzer } from '../../../semantic-graph-extractor/schema-analyzer.ts';
import type { OpenAPISpec } from '../../../semantic-graph-extractor/types.ts';

function extractOp(spec: OpenAPISpec, opId: string) {
  const ops = new SchemaAnalyzer().extractOperations(spec);
  const op = ops.find((o) => o.operationId === opId);
  if (!op) throw new Error(`fixture: operation ${opId} not present in extracted spec`);
  return op;
}

// Body-identifier establisher (createUser-shaped).
const fixtureBodyIdentifier: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-establishes-body', version: '0.0.0' },
  paths: {
    '/users': {
      post: {
        operationId: 'createUserLike',
        'x-semantic-establishes': {
          kind: 'User',
          identifiedBy: [{ in: 'body', name: 'username', semanticType: 'Username' }],
        },
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username'],
                properties: {
                  username: { type: 'string', 'x-semantic-type': 'Username' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  },
};

// Edge establisher with shape:'edge' and two path identifiers
// (assignUserToGroup-shaped).
const fixtureEdgeMembership: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-establishes-edge', version: '0.0.0' },
  paths: {
    '/groups/{groupId}/users/{username}': {
      put: {
        operationId: 'assignUserToGroupLike',
        'x-semantic-establishes': {
          kind: 'GroupUserMembership',
          shape: 'edge',
          identifiedBy: [
            { in: 'path', name: 'groupId', semanticType: 'GroupId' },
            { in: 'path', name: 'username', semanticType: 'Username' },
          ],
        },
        parameters: [
          {
            name: 'groupId',
            in: 'path',
            required: true,
            schema: { type: 'string', 'x-semantic-type': 'GroupId' },
          },
          {
            name: 'username',
            in: 'path',
            required: true,
            schema: { type: 'string', 'x-semantic-type': 'Username' },
          },
        ],
        responses: { '204': { description: 'no-content' } },
      },
    },
  },
};

// Composite identifier (path + body) — createTenantClusterVariable-shaped.
const fixtureCompositeIdentifier: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-establishes-composite', version: '0.0.0' },
  paths: {
    '/tenants/{tenantId}/cluster-variables': {
      post: {
        operationId: 'createTenantClusterVariableLike',
        'x-semantic-establishes': {
          kind: 'TenantClusterVariable',
          identifiedBy: [
            { in: 'path', name: 'tenantId', semanticType: 'TenantId' },
            { in: 'body', name: 'name', semanticType: 'ClusterVariableName' },
          ],
        },
        parameters: [
          {
            name: 'tenantId',
            in: 'path',
            required: true,
            schema: { type: 'string', 'x-semantic-type': 'TenantId' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', 'x-semantic-type': 'ClusterVariableName' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  },
};

// Malformed annotation: missing identifiedBy. Must NOT surface establishes.
// The cast intentionally bypasses the OpenAPISpec contract — the whole
// point of this fixture is to feed the extractor a malformed annotation
// and assert it is rejected. The runtime extractor is the boundary under
// test; the type cast simulates an upstream spec that violates the
// contract.
// biome-ignore lint/plugin: intentional malformed annotation for negative-test fixture
const fixtureMalformedNoIdentifiers = {
  openapi: '3.0.3',
  info: { title: 'fixture-establishes-malformed', version: '0.0.0' },
  paths: {
    '/things': {
      post: {
        operationId: 'createThingMalformed',
        'x-semantic-establishes': { kind: 'Thing' },
        responses: { '201': { description: 'created' } },
      },
    },
  },
} as unknown as OpenAPISpec;

// Operation without the annotation — must remain `establishes: undefined`.
const fixtureNoAnnotation: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-establishes-absent', version: '0.0.0' },
  paths: {
    '/things': {
      post: {
        operationId: 'createThingNoAnnotation',
        responses: { '201': { description: 'created' } },
      },
    },
  },
};

describe('extractor x-semantic-establishes (#104)', () => {
  it('surfaces a body-identifier establisher with kind, in, name, and semanticType', () => {
    const op = extractOp(fixtureBodyIdentifier, 'createUserLike');
    expect(op.establishes).toEqual({
      kind: 'User',
      shape: undefined,
      identifiedBy: [{ in: 'body', name: 'username', semanticType: 'Username' }],
    });
  });

  it('preserves shape:edge and the full identifiedBy list for membership ops', () => {
    const op = extractOp(fixtureEdgeMembership, 'assignUserToGroupLike');
    expect(op.establishes?.shape).toBe('edge');
    expect(op.establishes?.kind).toBe('GroupUserMembership');
    expect(op.establishes?.identifiedBy).toEqual([
      { in: 'path', name: 'groupId', semanticType: 'GroupId' },
      { in: 'path', name: 'username', semanticType: 'Username' },
    ]);
  });

  it('preserves a composite path+body identifier in declaration order', () => {
    const op = extractOp(fixtureCompositeIdentifier, 'createTenantClusterVariableLike');
    expect(op.establishes?.identifiedBy.map((i) => i.in)).toEqual(['path', 'body']);
    expect(op.establishes?.identifiedBy.map((i) => i.semanticType)).toEqual([
      'TenantId',
      'ClusterVariableName',
    ]);
  });

  it('rejects malformed annotations with no identifiedBy entries (no partial state)', () => {
    const op = extractOp(fixtureMalformedNoIdentifiers, 'createThingMalformed');
    expect(op.establishes).toBeUndefined();
  });

  it('rejects the WHOLE annotation when any identifiedBy member is invalid', () => {
    // Class-scoped strictness: a composite identifier with one valid
    // entry and one invalid `in` value must NOT degrade to a
    // single-identifier establisher. Surfacing the partial subset would
    // silently mislead the planner into minting only one binding for
    // what should be a composite identifier (e.g. tenant cluster
    // variable losing its `name` half).
    // biome-ignore lint/plugin: intentional malformed annotation for negative-test fixture
    const fixturePartialMalformed = {
      openapi: '3.0.3',
      info: { title: 'fixture-establishes-partial-malformed', version: '0.0.0' },
      paths: {
        '/tenants/{tenantId}/things': {
          post: {
            operationId: 'createPartialMalformed',
            'x-semantic-establishes': {
              kind: 'Thing',
              identifiedBy: [
                { in: 'path', name: 'tenantId', semanticType: 'TenantId' },
                // Invalid `in` value — the whole annotation must be
                // rejected, not silently dropped to the first entry.
                { in: 'query', name: 'name', semanticType: 'ThingName' },
              ],
            },
            responses: { '201': { description: 'created' } },
          },
        },
      },
    } as unknown as OpenAPISpec;
    const op = extractOp(fixturePartialMalformed, 'createPartialMalformed');
    expect(op.establishes).toBeUndefined();
  });

  it('leaves `establishes` undefined on operations without the annotation', () => {
    const op = extractOp(fixtureNoAnnotation, 'createThingNoAnnotation');
    expect(op.establishes).toBeUndefined();
  });

  it('rejects the WHOLE annotation when `shape` is an unknown string', () => {
    // Class-scoped strictness: any `shape` value other than the known
    // set (`'edge'` or undefined) must reject the whole annotation.
    // Without this, a typo (e.g. `'edeg'`) would degrade silently to
    // non-edge behaviour, the planner would treat the entries as
    // VALUES MINTED (instead of pre-existing components consumed from
    // the chain), and the test suite would render with the wrong
    // shape of test data.
    // biome-ignore lint/plugin: intentional malformed annotation for negative-test fixture
    const fixtureUnknownShape = {
      openapi: '3.0.3',
      info: { title: 'fixture-establishes-unknown-shape', version: '0.0.0' },
      paths: {
        '/things': {
          post: {
            operationId: 'createThingUnknownShape',
            'x-semantic-establishes': {
              kind: 'Thing',
              shape: 'edeg', // typo of 'edge'
              identifiedBy: [{ in: 'body', name: 'name', semanticType: 'ThingName' }],
            },
            responses: { '201': { description: 'created' } },
          },
        },
      },
    } as unknown as OpenAPISpec;
    const op = extractOp(fixtureUnknownShape, 'createThingUnknownShape');
    expect(op.establishes).toBeUndefined();
  });

  // Issue #134: bimodal entity sources — `acceptsExternal: true` on an
  // edge's `identifiedBy` member declares that the component may be
  // satisfied by either an in-API producer (the canonical local entity)
  // or an externally-minted ID (BYOG / OIDC IdP-supplied IDs). The
  // extractor must round-trip the flag verbatim so the planner can
  // decide chaining policy at scenario time. Strictness mirrors the
  // rest of the annotation: any invalid value rejects the WHOLE
  // annotation rather than degrading silently.
  it('round-trips `acceptsExternal: true` on a single edge identifier', () => {
    const fixtureBimodalEdge: OpenAPISpec = {
      openapi: '3.0.3',
      info: { title: 'fixture-establishes-bimodal-edge', version: '0.0.0' },
      paths: {
        '/roles/{roleId}/groups/{groupId}': {
          put: {
            operationId: 'assignGroupToRoleLike',
            'x-semantic-establishes': {
              kind: 'RoleGroupMembership',
              shape: 'edge',
              identifiedBy: [
                { in: 'path', name: 'roleId', semanticType: 'RoleId' },
                {
                  in: 'path',
                  name: 'groupId',
                  semanticType: 'GroupId',
                  acceptsExternal: true,
                },
              ],
            },
            parameters: [
              {
                name: 'roleId',
                in: 'path',
                required: true,
                schema: { type: 'string', 'x-semantic-type': 'RoleId' },
              },
              {
                name: 'groupId',
                in: 'path',
                required: true,
                schema: { type: 'string', 'x-semantic-type': 'GroupId' },
              },
            ],
            responses: { '204': { description: 'no-content' } },
          },
        },
      },
    };
    const op = extractOp(fixtureBimodalEdge, 'assignGroupToRoleLike');
    expect(op.establishes?.identifiedBy).toEqual([
      { in: 'path', name: 'roleId', semanticType: 'RoleId' },
      {
        in: 'path',
        name: 'groupId',
        semanticType: 'GroupId',
        acceptsExternal: true,
      },
    ]);
  });

  it('omits `acceptsExternal` from the surfaced entry when the spec omits it (no implicit false)', () => {
    // Class-scoped: the planner reads `acceptsExternal === true` as the
    // bimodal trigger. The extractor MUST NOT inject a `false` default
    // — that would noise the on-disk graph JSON and obscure the rare
    // bimodal sites in diff review.
    const op = extractOp(fixtureEdgeMembership, 'assignUserToGroupLike');
    for (const id of op.establishes?.identifiedBy ?? []) {
      expect(Object.hasOwn(id, 'acceptsExternal')).toBe(false);
    }
  });

  it('rejects the WHOLE annotation when `acceptsExternal` is a non-boolean value', () => {
    // Class-scoped strictness: a stringy "true" or any other type must
    // reject the whole annotation. Silently coercing would let an
    // upstream typo enable bimodal fallback at sites that intended a
    // hard chain — undermining the producer-preference contract.
    // biome-ignore lint/plugin: intentional malformed annotation for negative-test fixture
    const fixtureBadAcceptsExternal = {
      openapi: '3.0.3',
      info: { title: 'fixture-establishes-bad-acceptsExternal', version: '0.0.0' },
      paths: {
        '/roles/{roleId}/groups/{groupId}': {
          put: {
            operationId: 'assignGroupToRoleBadFlag',
            'x-semantic-establishes': {
              kind: 'RoleGroupMembership',
              shape: 'edge',
              identifiedBy: [
                { in: 'path', name: 'roleId', semanticType: 'RoleId' },
                {
                  in: 'path',
                  name: 'groupId',
                  semanticType: 'GroupId',
                  acceptsExternal: 'true',
                },
              ],
            },
            responses: { '204': { description: 'no-content' } },
          },
        },
      },
    } as unknown as OpenAPISpec;
    const op = extractOp(fixtureBadAcceptsExternal, 'assignGroupToRoleBadFlag');
    expect(op.establishes).toBeUndefined();
  });
});
