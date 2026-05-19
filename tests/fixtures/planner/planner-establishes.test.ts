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

// Cross-endpoint alias-pollution defect class (PR #112 reviewer thread,
// scenarioGenerator.ts:769). When establisher A mints a body identifier
// and the alias loop mirrors the binding under every placeholder name in
// the *entire graph* for that semanticType, the recorded alias slots
// must NOT participate in the body-collision check that gates a *later*
// establisher in the same chain. Otherwise an unrelated endpoint's path
// placeholder name (here: `unrelatedListUsersByName` using `{name}` for
// `Username`) reserves `nameVar` against the Username semantic, and a
// subsequent body-identifier establisher for `RoleName` whose own raw
// body field is also `name` is wrongly skipped — even though the chain
// the BFS is exploring never visits the unrelated endpoint.
const fixtureAliasPollutionAcrossEndpoints: OperationGraph = makeGraph([
  // Body-identifier establisher #1: mints Username via body field
  // `username`, so the primary slot it reserves is `usernameVar`. The
  // alias loop will additionally mirror this value under any other
  // placeholder name carrying semanticType=Username — including the
  // unrelated endpoint below, whose `{name}` path param maps to
  // `Username`, reserving `nameVar`.
  makeOp('createUser', 'POST', '/users', {
    produces: ['Username'],
    establishes: {
      kind: 'User',
      identifiedBy: [{ in: 'body', name: 'username', semanticType: 'Username' }],
    },
  }),
  // Unrelated endpoint that the consumer below never needs. It exists
  // ONLY to bait the alias loop into reserving `nameVar` for Username.
  makeOp('unrelatedListUsersByName', 'GET', '/users/by-name/{name}', {
    required: ['Username'],
    pathParameters: [{ name: 'name', semanticType: 'Username' }],
  }),
  // Body-identifier establisher #2: mints RoleName via body field
  // `name` → primary slot `nameVar`, semantic RoleName. With the
  // pre-fix behaviour, `nameVar` is already occupied by Username from
  // the alias loop above; the body-collision guard then aborts this
  // candidate and the consumer becomes unreachable.
  makeOp('createRole', 'POST', '/roles', {
    produces: ['RoleName'],
    establishes: {
      kind: 'Role',
      identifiedBy: [{ in: 'body', name: 'name', semanticType: 'RoleName' }],
    },
  }),
  // Consumer needs both Username (path: `userKey`) and RoleName (path:
  // `roleName`). Crucially, neither path placeholder is named `name`,
  // so the consumer itself does not exercise the polluted slot — only
  // the unrelated endpoint above does.
  makeOp('assignUserToRole', 'PUT', '/roles/{roleName}/users/{userKey}', {
    required: ['Username', 'RoleName'],
    pathParameters: [
      { name: 'roleName', semanticType: 'RoleName' },
      { name: 'userKey', semanticType: 'Username' },
    ],
  }),
]);

describe('planner contracts: x-semantic-establishes (#104)', () => {
  describe('simple establisher chain (createUser → getUser)', () => {
    it('produces a satisfied chain whose first step is the establisher', () => {
      const result = generateScenariosForEndpoint(fixtureSimpleEstablisherChain, 'getUser', {
        maxChainAlternatives: 10,
      });
      expect(result.unsatisfied).toBeFalsy();
      expect(result.scenarios.length).toBeGreaterThan(0);
      const ops = opIdsOf(result.scenarios[0]);
      expect(ops).toEqual(['createUser', 'getUser']);
    });

    it('seeds a shared usernameVar binding consumed by both steps', () => {
      const result = generateScenariosForEndpoint(fixtureSimpleEstablisherChain, 'getUser', {
        maxChainAlternatives: 10,
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
        maxChainAlternatives: 10,
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
        { maxChainAlternatives: 10 },
      );
      expect(result.unsatisfied).toBeFalsy();
      const ops = opIdsOf(result.scenarios[0]);
      expect(ops).toEqual(['createTenantClusterVariable', 'getTenantClusterVariable']);
    });

    it('seeds bindings for both identifier names (tenantIdVar, nameVar)', () => {
      const result = generateScenariosForEndpoint(
        fixtureCompositeEstablisherChain,
        'getTenantClusterVariable',
        { maxChainAlternatives: 10 },
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
        { maxChainAlternatives: 10 },
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
        maxChainAlternatives: 10,
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
        { maxChainAlternatives: 10 },
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
        { maxChainAlternatives: 10 },
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

  describe('cross-endpoint alias pollution does not gate body-collision check', () => {
    it('chains both body-id establishers when only an unrelated endpoint exposes the colliding placeholder name', () => {
      // Class-scoped guard for the alias-pollution defect identified in
      // PR #112 review (scenarioGenerator.ts:769). The alias loop must
      // not write into the same map the body-collision guard consults
      // — otherwise an unrelated endpoint elsewhere in the graph using
      // `{name}` for one semanticType reserves `nameVar` against that
      // semantic and silently aborts a later body-id establisher whose
      // own raw body field happens to be `name` for a different
      // semantic, even though the chain the BFS is exploring never
      // visits the unrelated endpoint.
      const result = generateScenariosForEndpoint(
        fixtureAliasPollutionAcrossEndpoints,
        'assignUserToRole',
        { maxChainAlternatives: 20 },
      );
      expect(result.unsatisfied).toBeFalsy();
      const satisfied = result.scenarios.find((s) => {
        const ops = opIdsOf(s);
        return ops.includes('createUser') && ops.includes('createRole');
      });
      expect(satisfied).toBeDefined();
      const bindings = satisfied?.bindings ?? {};
      // Both primary slots must be present and hold distinct values —
      // the body builder will read `usernameVar` for createUser and
      // `nameVar` for createRole at codegen time.
      expect(bindings.usernameVar).toBeDefined();
      expect(bindings.nameVar).toBeDefined();
      expect(bindings.usernameVar).not.toBe(bindings.nameVar);
      // After the stale-alias overwrite at the primary slot, any alias
      // mirrored from the same identifier (here: `roleNameVar` from
      // the consumer's path placeholder for RoleName) must hold the
      // FRESH primary value — not the stale `value` that was computed
      // from `bindingsDraft[primaryVar]` *before* the overwrite. A
      // mismatch means the URL emitter would render the consumer's
      // `{roleName}` placeholder with the polluted Username value.
      expect(bindings.roleNameVar).toBe(bindings.nameVar);
    });
  });

  // Issue #134 / camunda/camunda#52322: bimodal entity sources. An edge
  // endpoint whose `identifiedBy` member carries `acceptsExternal: true`
  // may be satisfied by a client-minted ID when no in-API producer is
  // reachable. Class-scoped properties:
  //   1. Producer-preference is preserved when a producer DOES exist
  //      (no regression for today's `createGroup → assignGroupToRole`).
  //   2. When the producer is missing AND the component is bimodal,
  //      the planner mints a deterministic ID, satisfies the chain,
  //      and tags `externalEntitySites` with the semantic so the
  //      negative-suite can suppress unknown-id assertions.
  //   3. Partial bimodality (one component bimodal, one not) still
  //      surfaces the non-bimodal component as missing.
  describe('bimodal edge — acceptsExternal client-mint fallback (#134)', () => {
    // Edge endpoint requires GroupId+RoleId; only the GroupId tuple is
    // bimodal. createRole exists; createGroup does NOT — so GroupId is
    // unreachable via producer/establisher. The planner must fall
    // back to a client-minted GroupId.
    const fixtureBimodalNoProducer: OperationGraph = makeGraph([
      makeOp('createRole', 'POST', '/roles', {
        produces: ['RoleId'],
        establishes: {
          kind: 'Role',
          identifiedBy: [{ in: 'body', name: 'roleId', semanticType: 'RoleId' }],
        },
      }),
      makeOp('assignGroupToRole', 'PUT', '/roles/{roleId}/groups/{groupId}', {
        required: ['RoleId', 'GroupId'],
        pathParameters: [
          { name: 'roleId', semanticType: 'RoleId' },
          { name: 'groupId', semanticType: 'GroupId' },
        ],
        establishes: {
          kind: 'RoleGroupMembership',
          shape: 'edge',
          identifiedBy: [
            { in: 'path', name: 'roleId', semanticType: 'RoleId' },
            { in: 'path', name: 'groupId', semanticType: 'GroupId', acceptsExternal: true },
          ],
        },
      }),
    ]);

    // Same shape, but with createGroup present in the graph. Producer-
    // preference must win — no fallback, no externalEntitySites tag.
    const fixtureBimodalWithProducer: OperationGraph = makeGraph([
      makeOp('createGroup', 'POST', '/groups', {
        produces: ['GroupId'],
        establishes: {
          kind: 'Group',
          identifiedBy: [{ in: 'body', name: 'groupId', semanticType: 'GroupId' }],
        },
      }),
      makeOp('createRole', 'POST', '/roles', {
        produces: ['RoleId'],
        establishes: {
          kind: 'Role',
          identifiedBy: [{ in: 'body', name: 'roleId', semanticType: 'RoleId' }],
        },
      }),
      makeOp('assignGroupToRole', 'PUT', '/roles/{roleId}/groups/{groupId}', {
        required: ['RoleId', 'GroupId'],
        pathParameters: [
          { name: 'roleId', semanticType: 'RoleId' },
          { name: 'groupId', semanticType: 'GroupId' },
        ],
        establishes: {
          kind: 'RoleGroupMembership',
          shape: 'edge',
          identifiedBy: [
            { in: 'path', name: 'roleId', semanticType: 'RoleId' },
            { in: 'path', name: 'groupId', semanticType: 'GroupId', acceptsExternal: true },
          ],
        },
      }),
    ]);

    // Edge requires Username (not bimodal) AND GroupId (bimodal). No
    // producer for either. Username must still surface as missing —
    // the bimodal fallback must NOT silently extend to non-bimodal
    // components.
    const fixturePartialBimodalNoProducers: OperationGraph = makeGraph([
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
            { in: 'path', name: 'groupId', semanticType: 'GroupId', acceptsExternal: true },
            { in: 'path', name: 'username', semanticType: 'Username' },
          ],
        },
      }),
    ]);

    it('mints a client-side GroupId and tags externalEntitySites when no producer exists', () => {
      const result = generateScenariosForEndpoint(fixtureBimodalNoProducer, 'assignGroupToRole', {
        maxChainAlternatives: 10,
      });
      expect(result.unsatisfied).toBeFalsy();
      const scenario = result.scenarios[0];
      expect(opIdsOf(scenario)).toEqual(['createRole', 'assignGroupToRole']);
      const bindings = scenario.bindings ?? {};
      expect(bindings.groupIdVar).toBeDefined();
      expect(typeof bindings.groupIdVar).toBe('string');
      expect(bindings.groupIdVar).not.toBe('__PENDING__');
      expect(scenario.externalEntitySites).toContain('GroupId');
    });

    it('prefers the in-graph producer when one exists (no regression, no externalEntitySites tag)', () => {
      const result = generateScenariosForEndpoint(fixtureBimodalWithProducer, 'assignGroupToRole', {
        maxChainAlternatives: 10,
      });
      expect(result.unsatisfied).toBeFalsy();
      const scenario = result.scenarios[0];
      const ops = opIdsOf(scenario);
      // Class-scoped: createGroup MUST appear in every satisfied chain
      // for the bimodal-with-producer case. The fallback path must
      // never short-circuit a reachable producer.
      expect(ops).toContain('createGroup');
      expect(ops).toContain('createRole');
      expect(ops[ops.length - 1]).toBe('assignGroupToRole');
      expect(scenario.externalEntitySites ?? []).not.toContain('GroupId');
    });

    it('does not extend the bimodal fallback to non-bimodal components', () => {
      const result = generateScenariosForEndpoint(
        fixturePartialBimodalNoProducers,
        'assignUserToGroup',
        { maxChainAlternatives: 10 },
      );
      // Username has no producer/establisher AND is not flagged
      // bimodal — the scenario must be unsatisfied with Username
      // (only) in missingSemanticTypes.
      expect(result.unsatisfied).toBe(true);
      const missing = result.scenarios[0].missingSemanticTypes ?? [];
      expect(missing).toContain('Username');
      expect(missing).not.toContain('GroupId');
    });

    // Issue #134 / camunda/camunda#52320 (kind-scoped). When the
    // missing semantic is owned by a kind whose registry shape is
    // `external-entity` (e.g. `ClientId` is owned by
    // `Client { shape: "external-entity" }`), the planner falls back
    // to a client-minted ID even though no per-tuple
    // `acceptsExternal: true` flag is present. Class-scoped: this is
    // the source-of-truth for "no in-API producer by design"; a
    // future identifier added to any external-entity kind must be
    // auto-mintable without an extractor or planner change.
    it('mints a client-side ClientId for external-entity-owned identifiers (kind-scoped)', () => {
      const fixtureKindScoped: OperationGraph = {
        ...makeGraph([
          makeOp('createRole', 'POST', '/roles', {
            produces: ['RoleId'],
            establishes: {
              kind: 'Role',
              identifiedBy: [{ in: 'body', name: 'roleId', semanticType: 'RoleId' }],
            },
          }),
          makeOp('assignRoleToClient', 'PUT', '/roles/{roleId}/clients/{clientId}', {
            required: ['RoleId', 'ClientId'],
            pathParameters: [
              { name: 'roleId', semanticType: 'RoleId' },
              { name: 'clientId', semanticType: 'ClientId' },
            ],
            establishes: {
              kind: 'RoleClientMembership',
              shape: 'edge',
              identifiedBy: [
                { in: 'path', name: 'roleId', semanticType: 'RoleId' },
                // Note: NO acceptsExternal on this tuple. The fallback
                // must trigger via the kind registry alone.
                { in: 'path', name: 'clientId', semanticType: 'ClientId' },
              ],
            },
          }),
        ]),
        externalEntityIdentifiers: new Set(['ClientId']),
      };
      const result = generateScenariosForEndpoint(fixtureKindScoped, 'assignRoleToClient', {
        maxChainAlternatives: 10,
      });
      expect(result.unsatisfied).toBeFalsy();
      const scenario = result.scenarios[0];
      expect(opIdsOf(scenario)).toEqual(['createRole', 'assignRoleToClient']);
      const bindings = scenario.bindings ?? {};
      expect(bindings.clientIdVar).toBeDefined();
      expect(typeof bindings.clientIdVar).toBe('string');
      expect(scenario.externalEntitySites).toContain('ClientId');
    });

    it('mirrors the freshly-minted RoleName value into roleNameVar, not the stale Username alias', () => {
      // Class-scoped guard for PR #112 review thread on
      // scenarioGenerator.ts:833 (stale-alias overwrite branch). When
      // a body-id establisher overwrites a primary slot that was
      // previously held as an alias for a *different* semanticType,
      // the alias-mirroring loop must propagate the FRESH primary
      // value to other placeholder aliases for the new semanticType —
      // not the stale value captured before the overwrite. Otherwise
      // the consumer's URL placeholder for the new semantic (here
      // `{roleName}` → roleNameVar for RoleName) would render with
      // the old Username value, silently breaking the test.
      const result = generateScenariosForEndpoint(
        fixtureAliasPollutionAcrossEndpoints,
        'assignUserToRole',
        { maxChainAlternatives: 20 },
      );
      const satisfied = result.scenarios.find((s) => {
        const ops = opIdsOf(s);
        return ops.includes('createUser') && ops.includes('createRole');
      });
      const bindings = satisfied?.bindings ?? {};
      // The RoleName alias on the consumer's path placeholder must
      // mirror the RoleName primary, not the previously-aliased
      // Username value at the same slot name.
      expect(bindings.roleNameVar).toBeDefined();
      expect(bindings.roleNameVar).toBe(bindings.nameVar);
      expect(bindings.roleNameVar).not.toBe(bindings.usernameVar);
    });
  });

  describe('producersByType immutability across planning (#112)', () => {
    it('does not push establishers into the shared producersByType index', () => {
      // Class-scoped guard for PR #112 review thread on
      // scenarioGenerator.ts:482. The planner used to bind `producers`
      // as a direct reference to `graph.producersByType[targetSemantic]`
      // and then `push()` establishers into it, polluting the global
      // authoritative-producer index across BFS iterations and across
      // calls. The contract for `producersByType` is "authoritative
      // producers only" — establishers must stay in `establishersByType`.
      const graph = fixtureSimpleEstablisherChain;
      const beforeUsername = [...(graph.producersByType.Username ?? [])];
      generateScenariosForEndpoint(graph, 'getUser', { maxChainAlternatives: 10 });
      const afterUsername = graph.producersByType.Username ?? [];
      // The establisher (`createUser`) must NOT have leaked into the
      // global producer index for Username.
      expect(afterUsername).toEqual(beforeUsername);
      expect(afterUsername).not.toContain('createUser');
    });
  });
});
