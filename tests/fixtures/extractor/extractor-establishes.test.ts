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
const fixtureMalformedNoIdentifiers: OpenAPISpec = {
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
};

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

  it('leaves `establishes` undefined on operations without the annotation', () => {
    const op = extractOp(fixtureNoAnnotation, 'createThingNoAnnotation');
    expect(op.establishes).toBeUndefined();
  });
});
