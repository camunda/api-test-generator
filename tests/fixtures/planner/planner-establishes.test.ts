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
    // Mirror graphLoader after #104: synthesised semantics from
    // `establishes.identifiedBy` stay on `node.produces` (so BFS
    // produced-set propagation still marks them satisfied once the
    // establisher is scheduled), but are EXCLUDED from the global
    // `producersByType` index — the authoritative-producer contract.
    // Without this exclusion these fixtures would expose establishers
    // as ordinary producers, and the tests would stay green even if
    // `scenarioGenerator` stopped consulting `establishersByType` —
    // exactly the regression they are supposed to guard.
    const synthesisedFromEstablishes = new Set<string>();
    if (node.establishes && node.establishes.shape !== 'edge') {
      for (const id of node.establishes.identifiedBy) {
        synthesisedFromEstablishes.add(id.semanticType);
      }
    }
    for (const sem of node.produces) {
      if (synthesisedFromEstablishes.has(sem)) continue;
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

// Placeholder-name mismatch: establisher mints `username` (body), but
// the consumer's URL uses a *different* placeholder name (`{userKey}`)
// that maps to the same semanticType `Username`. The planner must
// alias the establisher's value under the consumer-derived var name
// (`userKeyVar`) so the URL emitter resolves it directly.
const fixturePlaceholderNameMismatch: OperationGraph = makeGraph([
  makeOp('createUser', 'POST', '/users', {
    produces: ['Username'],
    establishes: {
      kind: 'User',
      identifiedBy: [{ in: 'body', name: 'username', semanticType: 'Username' }],
    },
  }),
  makeOp('getUserByKey', 'GET', '/users/{userKey}', {
    required: ['Username'],
    pathParameters: [{ name: 'userKey', semanticType: 'Username' }],
  }),
]);

// Same-name body collision across two different semanticTypes: both
// establishers mint a body identifier called `name`, but one is
// `ThingName` and the other is `WidgetName`. The body builder
// (path-analyser/src/index.ts) emits `${nameVar}` from the raw field
// name with no per-step override, so silently sharing one binding
// would feed the second establisher the first's value. The planner
// must skip the second candidate rather than emit a broken test.
const fixtureBodyCollisionSameName: OperationGraph = makeGraph([
  makeOp('createThing', 'POST', '/things', {
    produces: ['ThingName'],
    establishes: {
      kind: 'Thing',
      identifiedBy: [{ in: 'body', name: 'name', semanticType: 'ThingName' }],
    },
  }),
  makeOp('createWidget', 'POST', '/widgets', {
    produces: ['WidgetName'],
    establishes: {
      kind: 'Widget',
      identifiedBy: [{ in: 'body', name: 'name', semanticType: 'WidgetName' }],
    },
  }),
  // Consumer that needs both — planner has to chain both establishers,
  // but their body-field collision must be detected and the second
  // candidate skipped.
  makeOp('linkThingToWidget', 'POST', '/links', {
    required: ['ThingName', 'WidgetName'],
  }),
]);

// Same-name PATH collision across two different semanticTypes: both
// establishers mint a *path* identifier called `id`, but one is
// `ThingId` and the other is `WidgetId`. Unlike body collisions, the
// URL emitter goes through the alias loop, so the planner can
// numerically suffix the second binding (`idVar2`) and the consumer
// resolves correctly via its own placeholder names.
const fixturePathSuffixSameName: OperationGraph = makeGraph([
  makeOp('createThingViaPath', 'PUT', '/things/{id}', {
    produces: ['ThingId'],
    pathParameters: [{ name: 'id', semanticType: 'ThingId' }],
    establishes: {
      kind: 'Thing',
      identifiedBy: [{ in: 'path', name: 'id', semanticType: 'ThingId' }],
    },
  }),
  makeOp('createWidgetViaPath', 'PUT', '/widgets/{id}', {
    produces: ['WidgetId'],
    pathParameters: [{ name: 'id', semanticType: 'WidgetId' }],
    establishes: {
      kind: 'Widget',
      identifiedBy: [{ in: 'path', name: 'id', semanticType: 'WidgetId' }],
    },
  }),
  makeOp('linkThingToWidgetByIds', 'POST', '/links/{thingId}/{widgetId}', {
    required: ['ThingId', 'WidgetId'],
    pathParameters: [
      { name: 'thingId', semanticType: 'ThingId' },
      { name: 'widgetId', semanticType: 'WidgetId' },
    ],
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

  describe('placeholder-name mismatch (establisher mints `username`, consumer uses `{userKey}`)', () => {
    it('aliases the establisher value under the consumer-derived path-placeholder var', () => {
      const result = generateScenariosForEndpoint(fixturePlaceholderNameMismatch, 'getUserByKey', {
        maxScenarios: 10,
      });
      expect(result.unsatisfied).toBeFalsy();
      expect(result.scenarios.length).toBeGreaterThan(0);
      const scenario = result.scenarios[0];
      expect(opIdsOf(scenario)).toEqual(['createUser', 'getUserByKey']);
      const bindings = scenario.bindings ?? {};
      // Both names point at the same value — the URL emitter looks up
      // by placeholder name (`userKeyVar`), the establisher minted
      // under its identifier name (`usernameVar`). Without the alias
      // loop the URL would render with a literal `${userKeyVar}`.
      expect(bindings.usernameVar).toBeDefined();
      expect(bindings.userKeyVar).toBeDefined();
      expect(bindings.userKeyVar).toBe(bindings.usernameVar);
    });
  });

  describe('same-name body collision across different semanticTypes', () => {
    it('does NOT chain two body-identifier establishers under the same body field name', () => {
      // Class-scoped guard for the body-builder limitation: when the
      // body builder cannot disambiguate `${nameVar}` per step, the
      // planner must refuse to chain a second establisher whose body
      // identifier collides with an already-minted different-semantic
      // binding. The consumer becomes unreachable rather than getting
      // a silently-wrong test.
      const result = generateScenariosForEndpoint(
        fixtureBodyCollisionSameName,
        'linkThingToWidget',
        { maxScenarios: 10 },
      );
      // No satisfied chain should contain BOTH establishers — that
      // would imply they shared the `nameVar` slot.
      const offending = result.scenarios.filter((s) => {
        const ops = opIdsOf(s);
        return ops.includes('createThing') && ops.includes('createWidget');
      });
      expect(offending).toEqual([]);
    });
  });

  describe('same-name path collision across different semanticTypes', () => {
    it('numerically suffixes the second binding so both path values survive', () => {
      const result = generateScenariosForEndpoint(
        fixturePathSuffixSameName,
        'linkThingToWidgetByIds',
        { maxScenarios: 10 },
      );
      expect(result.unsatisfied).toBeFalsy();
      const scenario = result.scenarios.find((s) => {
        const ops = opIdsOf(s);
        return ops.includes('createThingViaPath') && ops.includes('createWidgetViaPath');
      });
      expect(scenario).toBeDefined();
      const bindings = scenario?.bindings ?? {};
      // Both establishers minted under `idVar`/`idVar2`; the alias
      // loop mirrors them under the consumer's placeholder names.
      expect(bindings.thingIdVar).toBeDefined();
      expect(bindings.widgetIdVar).toBeDefined();
      expect(bindings.thingIdVar).not.toBe(bindings.widgetIdVar);
    });
  });
});
