/**
 * Planner contract fixtures — x-semantic-establishes
 * (camunda/api-test-generator#104).
 *
 * Each fixture is a hand-built minimal `OperationGraph` that pairs an
 * establisher with a consumer and asserts the chain shape
 * `generateScenariosForEndpoint` must produce.
 *
 * Class-scoped invariant: any consumer whose required semantic type has
 * an establisher must plan a satisfied chain ending in the establisher
 * + consumer, with the consumer's path placeholder bound to the same
 * client-minted value the establisher's request body carries.
 */
import { describe, expect, it } from 'vitest';
import { generateScenariosForEndpoint } from '../../../path-analyser/src/scenarioGenerator.ts';
import type { OperationGraph, OperationNode } from '../../../path-analyser/src/types.ts';

interface NodeOpts {
  required?: string[];
  produces?: string[];
  providerMap?: Record<string, boolean>;
  establishes?: OperationNode['establishes'];
  pathParameters?: OperationNode['pathParameters'];
}

function makeOp(
  operationId: string,
  method: string,
  path: string,
  opts: NodeOpts = {},
): OperationNode {
  return {
    operationId,
    method,
    path,
    requires: { required: opts.required ?? [], optional: [] },
    produces: opts.produces ?? [],
    providerMap: opts.providerMap,
    establishes: opts.establishes,
    pathParameters: opts.pathParameters,
  };
}

function makeGraph(nodes: OperationNode[]): OperationGraph {
  const operations: Record<string, OperationNode> = {};
  const producersByType: Record<string, string[]> = {};
  const establishersByType: Record<string, string[]> = {};
  for (const node of nodes) {
    operations[node.operationId] = node;
    for (const sem of node.produces) {
      const list = producersByType[sem] ?? [];
      list.push(node.operationId);
      producersByType[sem] = list;
    }
    if (node.establishes && node.establishes.shape !== 'edge') {
      for (const id of node.establishes.identifiedBy) {
        const list = establishersByType[id.semanticType] ?? [];
        if (!list.includes(node.operationId)) list.push(node.operationId);
        establishersByType[id.semanticType] = list;
      }
    }
  }
  return {
    operations,
    producersByType,
    establishersByType: Object.keys(establishersByType).length ? establishersByType : undefined,
  };
}

function opIdsOf(scenario: { operations: { operationId: string }[] }): string[] {
  return scenario.operations.map((o) => o.operationId);
}

// Establisher (createUser) + consumer (getUser). The establisher mints
// Username via its body; the consumer needs Username from its path.
const fixtureSimpleEstablisherChain: OperationGraph = makeGraph([
  makeOp('createUser', 'POST', '/users', {
    // Mirrors graphLoader behaviour: the establisher self-satisfies its
    // own body identifier, so `requires` is empty and Username is
    // synthesised into `produces`.
    produces: ['Username'],
    establishes: {
      kind: 'User',
      identifiedBy: [{ in: 'body', name: 'username', semanticType: 'Username' }],
    },
  }),
  makeOp('getUser', 'GET', '/users/{username}', {
    required: ['Username'],
    pathParameters: [{ name: 'username', semanticType: 'Username' }],
  }),
]);

// Composite establisher (createTenantClusterVariable) + consumer
// (getTenantClusterVariable). The establisher mints both identifiers
// even though one is in the path: the BFS still treats the establisher
// as the satisfier for both ClusterVariableName and TenantId, and the
// scenario ends up satisfied without any other prereq op.
const fixtureCompositeEstablisherChain: OperationGraph = makeGraph([
  makeOp('createTenantClusterVariable', 'POST', '/tenants/{tenantId}/cluster-variables', {
    produces: ['TenantId', 'ClusterVariableName'],
    establishes: {
      kind: 'TenantClusterVariable',
      identifiedBy: [
        { in: 'path', name: 'tenantId', semanticType: 'TenantId' },
        { in: 'body', name: 'name', semanticType: 'ClusterVariableName' },
      ],
    },
  }),
  makeOp('getTenantClusterVariable', 'GET', '/cluster-variables/tenants/{tenantId}/{name}', {
    required: ['TenantId', 'ClusterVariableName'],
    pathParameters: [
      { name: 'tenantId', semanticType: 'TenantId' },
      { name: 'name', semanticType: 'ClusterVariableName' },
    ],
  }),
]);

// Edge establisher (assignUserToGroup, shape:'edge'). Components GroupId
// and Username are pre-existing inputs, so the edge does NOT contribute
// to producesByType / establishersByType for either component — they
// must be satisfied by their respective non-edge establishers.
const fixtureEdgeRequiresComponentChains: OperationGraph = makeGraph([
  makeOp('createGroup', 'POST', '/groups', {
    produces: ['GroupId'],
    establishes: {
      kind: 'Group',
      identifiedBy: [{ in: 'body', name: 'groupId', semanticType: 'GroupId' }],
    },
  }),
  makeOp('createUser', 'POST', '/users', {
    produces: ['Username'],
    establishes: {
      kind: 'User',
      identifiedBy: [{ in: 'body', name: 'username', semanticType: 'Username' }],
    },
  }),
  makeOp('assignUserToGroup', 'PUT', '/groups/{groupId}/users/{username}', {
    required: ['GroupId', 'Username'],
    pathParameters: [
      { name: 'groupId', semanticType: 'GroupId' },
      { name: 'username', semanticType: 'Username' },
    ],
    establishes: {
      kind: 'GroupUserMembership',
      shape: 'edge',
      identifiedBy: [
        { in: 'path', name: 'groupId', semanticType: 'GroupId' },
        { in: 'path', name: 'username', semanticType: 'Username' },
      ],
    },
  }),
]);

describe('planner contracts: x-semantic-establishes (#104)', () => {
  describe('simple establisher chain (createUser → getUser)', () => {
    it('produces a satisfied chain whose first step is the establisher', () => {
      const result = generateScenariosForEndpoint(fixtureSimpleEstablisherChain, 'getUser', {
        maxScenarios: 10,
      });
      expect(result.unsatisfied).toBeFalsy();
      expect(result.scenarios.length).toBeGreaterThan(0);
      const ops = opIdsOf(result.scenarios[0]);
      expect(ops).toEqual(['createUser', 'getUser']);
    });

    it('seeds a shared usernameVar binding consumed by both steps', () => {
      const result = generateScenariosForEndpoint(fixtureSimpleEstablisherChain, 'getUser', {
        maxScenarios: 10,
      });
      const scenario = result.scenarios[0];
      expect(scenario.bindings).toBeDefined();
      // Var name is derived from the identifiedBy `name` (the request-body
      // / path-parameter name), not from the semantic type — that lets
      // the body builder and the URL emitter find the same key without
      // any extra alias step.
      expect(scenario.bindings?.usernameVar).toBeDefined();
      expect(typeof scenario.bindings?.usernameVar).toBe('string');
      expect(scenario.bindings?.usernameVar).not.toBe('__PENDING__');
    });
  });

  describe('establisher endpoint plans the trivial chain', () => {
    it('createUser as endpoint plans without chasing a producer for its own Username', () => {
      const result = generateScenariosForEndpoint(fixtureSimpleEstablisherChain, 'createUser', {
        maxScenarios: 10,
      });
      expect(result.unsatisfied).toBeFalsy();
      expect(result.scenarios.length).toBeGreaterThan(0);
      // Establisher self-satisfies its own body identifier — no prereq
      // chain, the scenario consists of the establisher alone.
      expect(opIdsOf(result.scenarios[0])).toEqual(['createUser']);
    });
  });

  describe('composite-identifier establisher (createTenantClusterVariable)', () => {
    it('plans a satisfied chain to getTenantClusterVariable in one establisher step', () => {
      const result = generateScenariosForEndpoint(
        fixtureCompositeEstablisherChain,
        'getTenantClusterVariable',
        { maxScenarios: 10 },
      );
      expect(result.unsatisfied).toBeFalsy();
      const ops = opIdsOf(result.scenarios[0]);
      expect(ops).toEqual(['createTenantClusterVariable', 'getTenantClusterVariable']);
    });

    it('seeds bindings for both identifier names (tenantIdVar, nameVar)', () => {
      const result = generateScenariosForEndpoint(
        fixtureCompositeEstablisherChain,
        'getTenantClusterVariable',
        { maxScenarios: 10 },
      );
      const bindings = result.scenarios[0].bindings ?? {};
      expect(bindings.tenantIdVar).toBeDefined();
      expect(bindings.nameVar).toBeDefined();
    });
  });

  describe('edge establisher (assignUserToGroup) requires component chains', () => {
    it('plans a chain with both component establishers + the edge endpoint', () => {
      const result = generateScenariosForEndpoint(
        fixtureEdgeRequiresComponentChains,
        'assignUserToGroup',
        { maxScenarios: 10 },
      );
      expect(result.unsatisfied).toBeFalsy();
      const ops = opIdsOf(result.scenarios[0]);
      expect(ops).toContain('createGroup');
      expect(ops).toContain('createUser');
      expect(ops[ops.length - 1]).toBe('assignUserToGroup');
    });

    it('does NOT register the edge as an establisher of its component semantics', () => {
      // Class-scoped: the edge's identifiedBy entries are PRE-EXISTING
      // inputs, not values minted by the edge. Without this guard, an
      // edge would compete with the real component establisher and the
      // BFS could pick the edge as a producer for its own consumed
      // component (a self-cycle that drops the chain).
      expect(fixtureEdgeRequiresComponentChains.establishersByType?.GroupId).toEqual([
        'createGroup',
      ]);
      expect(fixtureEdgeRequiresComponentChains.establishersByType?.Username).toEqual([
        'createUser',
      ]);
    });
  });
});
