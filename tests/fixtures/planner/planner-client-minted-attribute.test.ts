/**
 * Planner contract fixtures — REQUIRED clientMintedAttribute body leaves.
 *
 * A `clientMintedAttribute` semantic (`kind: 'attribute'` +
 * `clientMinted: true` in the ABox) has no `producersByType` entry and no
 * `establishersByType` entry *by design*: no endpoint returns it, and no
 * `x-semantic-establishes` annotation mints it. The planner is the
 * authoritative source of the value — `bindSemanticInput` synthesises a
 * deterministic `fc:cma:<sem>:<suffix>` token for it.
 *
 * Until this fixture landed, the pre-BFS static-missing gate in
 * `generateScenariosForEndpoint` only exempted `runtimeEmission`. A
 * REQUIRED body leaf carrying a clientMintedAttribute semantic therefore
 * fell through as "missing" and the planner returned `unsatisfied: true`
 * before the BFS loop ever ran — so the endpoint's OTHER required
 * semantics (path-parameter keys with real authoritative producers) never
 * got a chain either.
 *
 * The bundled camunda-oca spec exercises this via
 * `POST /process-instances/{processInstanceKey}/business-id-assignment`
 * (`assignProcessInstanceBusinessId`), whose body requires `businessId`
 * (`BusinessId`). Every other one of the 25 `Tag`/`BusinessId` body
 * leaves in that spec is OPTIONAL, which is why the gate went unexercised
 * until the 8.10 spec pin.
 *
 * Class-scoped invariant: a required request input whose semantic
 * classifies as `clientMintedAttribute` must be satisfied by a planner-
 * minted binding, never reported as missing — and must not suppress
 * producer chaining for the endpoint's remaining required semantics.
 */
import { describe, expect, it } from 'vitest';
import { generateScenariosForEndpoint } from '../../../path-analyser/src/scenarioGenerator.ts';
import type {
  OperationGraph,
  OperationNode,
  SemanticTypeSpec,
} from '../../../path-analyser/src/types.ts';

interface NodeOpts {
  required?: string[];
  produces?: string[];
  providerMap?: Record<string, boolean>;
  pathParameters?: OperationNode['pathParameters'];
  requestBodySemantics?: OperationNode['requestBodySemantics'];
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
    pathParameters: opts.pathParameters,
    requestBodySemantics: opts.requestBodySemantics,
  };
}

/**
 * Mirrors graphLoader's indexing contract: only `provider: true` response
 * leaves land in `producersByType` (#98). A clientMintedAttribute
 * semantic appears in NEITHER `producersByType` nor `establishersByType`,
 * which is exactly the state the missing-gate has to tolerate.
 */
function makeGraph(
  nodes: OperationNode[],
  semanticTypes: Record<string, SemanticTypeSpec>,
): OperationGraph {
  const operations: Record<string, OperationNode> = {};
  const producersByType: Record<string, string[]> = {};
  for (const node of nodes) {
    operations[node.operationId] = node;
    for (const sem of node.produces) {
      if (node.providerMap?.[sem] !== true) continue;
      const list = producersByType[sem] ?? [];
      list.push(node.operationId);
      producersByType[sem] = list;
    }
  }
  return { operations, producersByType, domain: { version: 1, semanticTypes } };
}

function opIdsOf(scenario: { operations: { operationId: string }[] }): string[] {
  return scenario.operations.map((o) => o.operationId);
}

/**
 * Builds the `assignProcessInstanceBusinessId` shape with neutral names:
 * a producer for the path-param semantic, plus a setter endpoint whose
 * body REQUIRES an attribute semantic. `labelDecl` varies the ABox
 * declaration so the fixtures can probe the classification boundary.
 */
function makeSetterGraph(labelDecl: SemanticTypeSpec | undefined): OperationGraph {
  return makeGraph(
    [
      makeOp('createThing', 'POST', '/things', {
        produces: ['ThingKey'],
        providerMap: { ThingKey: true },
      }),
      makeOp('assignThingLabel', 'POST', '/things/{thingKey}/label-assignment', {
        required: ['ThingKey', 'Label'],
        pathParameters: [{ name: 'thingKey', semanticType: 'ThingKey' }],
        requestBodySemantics: [{ semantic: 'Label', fieldPath: 'label', required: true }],
      }),
    ],
    labelDecl ? { Label: labelDecl } : {},
  );
}

const fixtureRequiredClientMintedAttribute = makeSetterGraph({
  kind: 'attribute',
  clientMinted: true,
});

// Negative control 1: `kind: 'attribute'` WITHOUT `clientMinted: true`.
// Mirrors the `classifySemantic` precedence contract — only the explicit
// flag promotes into the clientMintedAttribute branch — so this semantic
// stays genuinely unreachable and must still be reported missing.
const fixtureAttributeNotClientMinted = makeSetterGraph({ kind: 'attribute' });

// Negative control 2: no ABox declaration at all (`unclassified`). The
// exemption must be scoped to the classification, not a blanket bypass of
// the missing-gate for every producer-less required body leaf.
const fixtureUndeclaredSemantic = makeSetterGraph(undefined);

describe('planner contracts: required clientMintedAttribute body leaf', () => {
  describe('required clientMintedAttribute (Label) on a setter endpoint', () => {
    it('plans a satisfied chain instead of returning unsatisfied', () => {
      const result = generateScenariosForEndpoint(
        fixtureRequiredClientMintedAttribute,
        'assignThingLabel',
        { maxChainAlternatives: 10 },
      );
      expect(result.unsatisfied).toBeFalsy();
      expect(result.scenarios.length).toBeGreaterThan(0);
      expect(result.scenarios[0].missingSemanticTypes ?? []).toEqual([]);
    });

    it('chains the authoritative producer for the endpoint’s other required semantic', () => {
      // The regression this guards: a missing clientMintedAttribute
      // short-circuited the whole BFS, so ThingKey — which HAS an
      // authoritative producer — never got chained either. The emitted
      // test then seeded a fake key into the URL.
      const result = generateScenariosForEndpoint(
        fixtureRequiredClientMintedAttribute,
        'assignThingLabel',
        { maxChainAlternatives: 10 },
      );
      expect(opIdsOf(result.scenarios[0])).toEqual(['createThing', 'assignThingLabel']);
    });

    it('binds the minted fc:cma: value for the attribute semantic', () => {
      const result = generateScenariosForEndpoint(
        fixtureRequiredClientMintedAttribute,
        'assignThingLabel',
        { maxChainAlternatives: 10 },
      );
      const bindings = result.scenarios[0].bindings ?? {};
      // `bindSemanticInput` owns the value shape; assert the prefix
      // rather than the full token so the deterministic suffix stays an
      // implementation detail.
      expect(bindings.labelVar).toMatch(/^fc:cma:label:/);
    });

    it('reports the attribute semantic as satisfied, not missing', () => {
      const result = generateScenariosForEndpoint(
        fixtureRequiredClientMintedAttribute,
        'assignThingLabel',
        { maxChainAlternatives: 10 },
      );
      expect(result.requiredSemanticTypes).toContain('Label');
      expect(result.scenarios[0].satisfiedSemanticTypes).toContain('Label');
    });
  });

  describe('classification boundary', () => {
    it('kind:attribute WITHOUT clientMinted stays unsatisfied', () => {
      const result = generateScenariosForEndpoint(
        fixtureAttributeNotClientMinted,
        'assignThingLabel',
        { maxChainAlternatives: 10 },
      );
      expect(result.unsatisfied).toBe(true);
      expect(result.scenarios[0].missingSemanticTypes).toEqual(['Label']);
    });

    it('an undeclared (unclassified) required body semantic stays unsatisfied', () => {
      const result = generateScenariosForEndpoint(fixtureUndeclaredSemantic, 'assignThingLabel', {
        maxChainAlternatives: 10,
      });
      expect(result.unsatisfied).toBe(true);
      expect(result.scenarios[0].missingSemanticTypes).toEqual(['Label']);
    });
  });
});
