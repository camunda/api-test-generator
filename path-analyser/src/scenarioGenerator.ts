import { bindSemanticInput } from './bindSemanticInput.js';
import { deterministicSuffix } from './deterministicSuffix.js';
import { buildBpmnModelSpec, buildModelSpec, findModelSpec } from './modelSpecBuilders.js';
import { getModelKindForSemantic } from './ontology/artifactModelKinds.js';
import {
  findDeploymentGatewayOpId,
  findJobActivatorOpId,
  isDeploymentGatewayOp,
} from './ontology/operationRoles.js';
import type {
  ArtifactRule,
  DiscoveryIntent,
  EndpointScenario,
  EndpointScenarioCollection,
  ExtendedGenerationOpts,
  GeneratedModelSpec,
  OperationGraph,
  OperationNode,
  OperationRef,
  VariantGenerationOpts,
} from './types.js';
import { PENDING_BINDING } from './types.js';

// Back-compat generation options
interface GenerationOpts {
  maxChainAlternatives: number;
  longChains?: { enabled: boolean; maxPreOps: number };
  // Issue #37: when planning an optional sub-shape variant, the endpoint
  // itself is allowed to appear as a producer in the BFS (i.e. the
  // OUT-exclusion guard is lifted). This is what enables the warm-up +
  // search + final pattern for `createProcessInstance.startInstructions[]`.
  // The existing one-cycle allowance bounds usage to a single warm-up.
  allowEndpointAsProducer?: boolean;
  // Issue #37: extra semantic types added to `initialNeeded` without
  // mutating the endpoint's own `requires.required`. Used to inject the
  // sub-shape's leaf semantic and any warm-up-trigger inputs (producer's
  // optional inputs that the endpoint itself produces). Insertion order
  // matters: warm-up triggers come first so BFS targets them before the
  // leaf semantic via `remaining[0]` selection.
  additionalNeeded?: string[];
}

// BFS state used by generateScenariosForEndpoint and its helpers.
interface State {
  produced: Set<string>; // semantic types produced
  needed: Set<string>; // semantic types still potentially needed (includes optional initially)
  domainStates: Set<string>; // accumulated domain states/capabilities
  ops: string[]; // operations before endpoint
  cycle: boolean;
  productionMap: Map<string, string>; // semanticType -> opId
  modelsDraft?: GeneratedModelSpec[]; // synthesized models (mutable during BFS)
  bindingsDraft?: Record<string, string>; // variable bindings
  // Issue #104: side index recording which semanticType each
  // establisher-minted PRIMARY binding key was issued for. Lets the
  // BFS detect collisions when two establishers in the same chain
  // share a generic identifier `name` (e.g. `name`, `id`) but mint
  // values for *different* semantic types — without it the second
  // establisher would silently reuse the first establisher's value.
  //
  // Strictly tracks **primary** mints (the slot the establisher
  // itself writes to). Cross-endpoint placeholder aliases live in
  // `establisherAliasSemantics` below — they must not pollute this
  // map because the body-collision guard reads only this map and an
  // unrelated endpoint's alias would otherwise abort a legitimate
  // body-id establisher whose primary slot collides with the alias
  // name (PR #112 reviewer thread on scenarioGenerator.ts:769).
  establisherBindingSemantics?: Record<string, string>;
  // Issue #104 / PR #112: side index of placeholder-name aliases
  // mirrored from establisher primaries onto every other path
  // placeholder name in the graph that carries the same
  // semanticType. Kept SEPARATE from `establisherBindingSemantics`
  // so the body-collision guard at the top of the establisher
  // bookkeeping block (which reserves only primaries against
  // future body-id establishers) does not see alias slots reserved
  // for endpoints the current chain may never visit. Consulted
  // (alongside primaries) only by the alias-overwrite check inside
  // the alias loop, to avoid stomping a slot already aliased for a
  // different semantic.
  establisherAliasSemantics?: Record<string, string>;
  providerList?: Record<string, string[]>; // semantic -> all providers
  artifactsApplied?: string[]; // artifact rule ids used so far
  /**
   * #309 Phase A — opId → DiscoveryIntent stamped by
   * `expandRuntimeEmission` on the apply branch. Propagated through
   * every `queue.push` site so the intent survives to scenario
   * finalisation, where it is attached to the matching `OperationRef`
   * for downstream body-builder consumption.
   */
  discoveryIntents?: Record<string, DiscoveryIntent>;
}

/*
Core algorithm:
Maintain a state with:
 - produced semantic types
 - needed semantic types (expands when adding producer operations that themselves have requirements)
 - ordered list of operationIds
 - cycle flag
Expand BFS for breadth ordering (naturally tends toward shorter chains first).
Cycle handling: allow one repeat of any operation already in path (sets cycle flag), then block further repeats of that same op.
Stop when maxChainAlternatives collected or queue empty.
*/
export function generateScenariosForEndpoint(
  graph: OperationGraph,
  endpointOpId: string,
  opts: GenerationOpts | ExtendedGenerationOpts,
): EndpointScenarioCollection {
  const endpoint = graph.operations[endpointOpId];
  const required = [...endpoint.requires.required];
  const optional = [...endpoint.requires.optional];

  // Domain requirements flattening (for initial endpoint) - treat all domainRequiresAll as required states for ranking only (not gating existing logic yet)
  const domainRequiredStates = endpoint.domainRequiresAll ? [...endpoint.domainRequiresAll] : [];
  const domainDisjunctions = endpoint.domainDisjunctions ? [...endpoint.domainDisjunctions] : [];
  // Only treat required semantics as blocking; optional ones are opportunistic and won't force extra pre-ops.
  // Issue #37: variant planning may inject `additionalNeeded` (the
  // sub-shape leaf's semantic plus warm-up triggers) WITHOUT mutating
  // the endpoint's own `requires.required` — this preserves the
  // endpoint's prereq set for when it appears as a warm-up step.
  const initialNeeded = new Set([...required, ...(opts.additionalNeeded ?? [])]);

  // Trivial endpoint (no semantic AND no domain requirements). Return a single scenario containing only the endpoint.
  if (
    initialNeeded.size === 0 &&
    domainRequiredStates.length === 0 &&
    domainDisjunctions.length === 0
  ) {
    const trivial: EndpointScenario = {
      id: 'scenario-1',
      operations: [toRef(endpoint)],
      producedSemanticTypes: [...endpoint.produces],
      satisfiedSemanticTypes: [],
      productionMap: {},
      hasEventuallyConsistent: endpoint.eventuallyConsistent || undefined,
      eventuallyConsistentCount: endpoint.eventuallyConsistent ? 1 : undefined,
      domainStatesRequired: domainRequiredStates.length ? domainRequiredStates : undefined,
    };
    return {
      endpoint: toRef(endpoint),
      requiredSemanticTypes: required,
      optionalSemanticTypes: optional,
      scenarios: [trivial],
      unsatisfied: false,
    };
  }

  // Determine impossible semantic types (no producer anywhere, excluding endpoint self-production).
  // A semantic counts as reachable if EITHER a producersByType entry exists (authoritative
  // server-returned values) OR an establishersByType entry exists (client-minted values guaranteed
  // by an x-semantic-establishes annotation). Without the establishersByType branch this early
  // gate would short-circuit endpoints whose required semantic is only mintable via an establisher
  // (e.g. getUser/getTenant after the spec is annotated), and the BFS augmentation downstream
  // would never run.
  //
  // Edge-establisher note: an edge op that has `acceptsExternal: true` components is registered in
  // `establishersByType` for those components. When the edge op IS the endpoint being planned, the
  // endpoint cannot self-satisfy — only a DIFFERENT establisher op can chain-produce the semantic.
  // Exclude the endpoint itself from the hasEstablisher check so the `externalEntitySites` fallback
  // (lines below) still fires for the endpoint's own bimodal acceptsExternal components.
  const missing: string[] = [];
  for (const st of initialNeeded) {
    const hasProducer = graph.producersByType[st]?.length;
    const hasEstablisher = graph.establishersByType?.[st]?.some((opId) => opId !== endpointOpId);
    // #305 Phase 3: `runtimeEmission` semantics have no graph-indexed
    // producer (their discovery op is declared in the ABox via
    // `discoveredVia`, not via response provider annotations). They
    // are satisfied at BFS expansion time by the runtimeEmission
    // injection branch below — exempt them from the static-missing
    // gate here so the unsatisfied branch doesn't fire prematurely.
    const isRuntimeEmission =
      graph.domain?.semanticTypes?.[st]?.kind === 'runtimeEmission' &&
      graph.domain.semanticTypes[st].discoveredVia !== undefined &&
      graph.domain.semanticTypes[st].emittedBy !== undefined;
    if (!hasProducer && !hasEstablisher && !isRuntimeEmission) {
      if (!endpoint.produces.includes(st)) missing.push(st);
    }
  }

  // Issue #134 / camunda/camunda#52322 (per-tuple) AND
  // camunda/camunda#52320 (kind-scoped): treat an `identifiedBy`
  // component as automatically client-mintable when EITHER:
  //   (a) the tuple has `acceptsExternal: true` (per-tuple opt-in,
  //       e.g. `assignGroupToRole.groupId`), OR
  //   (b) the component's semantic type is owned by a kind whose
  //       registry shape is `external-entity` (e.g. `ClientId` is
  //       owned by `Client { shape: "external-entity" }` — minted
  //       outside the API by Console / OIDC IdP, no producer by
  //       design).
  // Producer-preference still wins: this block only runs after the
  // early reachability check has classified the semantic as missing
  // (no producer, no establisher). When a producer DOES exist BFS
  // chains it and this block is a no-op.
  const externalEntitySites: string[] = [];
  const externalBindings: Record<string, string> = {};
  if (missing.length > 0) {
    const stillMissing: string[] = [];
    for (const st of missing) {
      // Per-tuple `acceptsExternal: true` only applies on edge
      // establishers. Look it up via the endpoint's own `establishes`.
      const isEdgeEstablisher =
        endpoint.establishes !== undefined && endpoint.establishes.shape === 'edge';
      const idEntry: NonNullable<OperationNode['establishes']>['identifiedBy'][number] | undefined =
        isEdgeEstablisher
          ? endpoint.establishes?.identifiedBy.find(
              (i) => i.semanticType === st && i.acceptsExternal === true,
            )
          : undefined;
      const isKindScopedExternal = graph.externalEntityIdentifiers?.has(st) === true;
      if (idEntry || isKindScopedExternal) {
        // Var-name resolution:
        //   - edge with identifiedBy entry → use that entry's `name`
        //     (matches the edge's request body / path placeholder).
        //   - otherwise (consumer or non-edge), look up the path
        //     parameter on this endpoint whose `semanticType === st`.
        let baseName: string | undefined = idEntry?.name;
        if (!baseName) {
          const param = endpoint.pathParameters?.find((p) => p.semanticType === st);
          baseName = param?.name;
        }
        if (!baseName) {
          // No path parameter binds this semantic — without a name to
          // bind to we cannot mint usefully. Leave it on missing so the
          // unsatisfied branch fires (better diagnostic than silently
          // pretending to satisfy).
          stillMissing.push(st);
          continue;
        }
        const varName = `${camelLower(baseName)}Var`;
        const kindHint = endpoint.establishes?.kind ?? st;
        externalBindings[varName] = `${camelLower(kindHint)}_${deterministicSuffix(
          `external:${endpointOpId}:${st}:${varName}`,
        )}`;
        externalEntitySites.push(st);
      } else {
        stillMissing.push(st);
      }
    }
    // Replace the missing list with whatever the fallback could not
    // cover. If every missing semantic was external-mintable, the
    // unsatisfied branch below MUST NOT fire.
    missing.length = 0;
    missing.push(...stillMissing);
  }

  // BFS planning state subtracts the external-mintable semantics from
  // `initialNeeded` because they are pre-satisfied by the seeded
  // bindings. `initialNeeded` itself stays immutable so downstream
  // reporting (`satisfiedSemanticTypes`) still reflects everything
  // the endpoint required — a scenario that satisfied a need via
  // external mint is not the same as a scenario that did not need
  // it. See PR #140 reviewer thread on initialNeeded mutation.
  const planningNeeded =
    externalEntitySites.length === 0
      ? initialNeeded
      : new Set([...initialNeeded].filter((s) => !externalEntitySites.includes(s)));

  const scenarios: EndpointScenario[] = [];
  const max = opts.maxChainAlternatives;

  if (missing.length > 0) {
    scenarios.push({
      id: 'unsatisfied',
      operations: [toRef(endpoint)],
      producedSemanticTypes: [...endpoint.produces],
      satisfiedSemanticTypes: endpoint.produces.filter((s) => initialNeeded.has(s)),
      missingSemanticTypes: missing,
      hasEventuallyConsistent: endpoint.eventuallyConsistent || undefined,
      eventuallyConsistentCount: endpoint.eventuallyConsistent ? 1 : undefined,
      domainStatesRequired: domainRequiredStates.length ? domainRequiredStates : undefined,
    });
    return {
      endpoint: toRef(endpoint),
      requiredSemanticTypes: required,
      optionalSemanticTypes: optional,
      scenarios,
      unsatisfied: true,
    };
  }

  const initial: State = {
    // Issue #134: seed `produced` with the externally-minted
    // semantics so producer ops whose own `requires.required`
    // includes one of them (consulted by `hasSatisfiedRequiredInputs`
    // / `deferForMissingPrereqs` via `state.produced`) are not
    // wrongly rejected. Externally-minted semantics are satisfied
    // by the seeded binding the same way establisher-minted
    // semantics are.
    produced: new Set(externalEntitySites),
    needed: new Set(planningNeeded),
    domainStates: new Set(),
    ops: [],
    cycle: false,
    productionMap: new Map(),
    providerList: {},
    artifactsApplied: [],
    // Issue #134: pre-seed bindingsDraft with the client-minted IDs
    // synthesised for every bimodal `acceptsExternal` fallback above.
    // The body builder and URL emitter look up by the same key
    // (`${camelLower(name)}Var`), so the seeded value flows through
    // without any per-step override.
    bindingsDraft: Object.keys(externalBindings).length ? { ...externalBindings } : undefined,
  };

  const queue: State[] = [initial];

  const seen = new Set<string>(); // simple dedupe by produced+ops signature
  const completed: Map<string, EndpointScenario> = new Map();

  const longChainsEnabled = !!opts.longChains?.enabled;
  const maxPreOps = opts.longChains?.maxPreOps ?? 25;
  // Lift 9 / #225: the deployment-gateway operationId for the active config
  // (per `artifact-kinds.json#operationRules[].role === "deploymentGateway"`).
  // `undefined` when the ABox is absent or no rule declares the role —
  // every special-case below then collapses to "no op is the deployment
  // gateway". This is a behaviour change relative to the pre-Lift-9 code,
  // which always special-cased the literal `'createDeployment'` opId. Unit
  // tests that build minimal graphs and rely on the deployment special-
  // casing must declare the role on their fixture domain (see
  // `tests/fixtures/planner/classification-dispatch.test.ts`).
  const deploymentGatewayOpId = findDeploymentGatewayOpId(graph.domain);
  // Lift 14 / #254: the job-activator operationId for the active config
  // (per `artifact-kinds.json#operationRules[].role === "jobActivator"`).
  // When the role is declared on an op present in the BFS state, the
  // fallback model-spec draft must include a service task whose `type`
  // is bound to the activator's request `type` filter so the deployed
  // BPMN actually surfaces a job for the activation to pick up.
  const jobActivatorOpId = findJobActivatorOpId(graph.domain);
  while (queue.length && scenarios.length < max) {
    // biome-ignore lint/style/noNonNullAssertion: queue.length is checked in the loop predicate
    const state = queue.shift()!;
    const remaining = [...state.needed].filter((st) => !state.produced.has(st));

    // Domain completion gates
    const endpointDomainRequires = endpoint.domainRequiresAll || [];
    const endpointDisjunctions = endpoint.domainDisjunctions || [];
    const domainRequiresSatisfied = endpointDomainRequires.every((r) => state.domainStates.has(r));
    const domainDisjunctionsSatisfied = endpointDisjunctions.every((group) =>
      group.some((g) => state.domainStates.has(g)),
    );

    if (remaining.length === 0 && domainRequiresSatisfied && domainDisjunctionsSatisfied) {
      // Build scenario
      const opRefs: OperationRef[] = [
        ...state.ops.map((id) => toRef(graph.operations[id])),
        toRef(endpoint),
      ];
      // #309 Phase A — resolve `fromBinding` from the chain's final
      // bindings (mirroring `semanticToVarName`'s suffixing convention),
      // and attach the resolved intent to the matching OperationRef so
      // downstream materialisation can recognise the intentional-
      // discovery shape. When multiple producers of the same semantic
      // are bound in the chain, this picks the latest (`Var2`, `Var3`,
      // …) rather than the un-suffixed base — matching the var name
      // the producer auto-derive at `path-analyser/src/index.ts` will
      // actually allocate for that producer. When the producer is
      // enqueued via a defer path (which doesn't run the identifier-
      // heuristic, so bindingsDraft has no entry yet), fall back to
      // the un-suffixed base — the producer auto-derive will allocate
      // exactly that name at code-emission time.
      if (state.discoveryIntents) {
        const finalBindings = state.bindingsDraft ?? {};
        for (const ref of opRefs) {
          const intent = state.discoveryIntents[ref.operationId];
          if (!intent) continue;
          const resolved =
            findLatestBindingForSemantic(intent.fromSemantic, finalBindings) ??
            `${camelLower(intent.fromSemantic)}Var`;
          ref.discoveryIntent = { ...intent, fromBinding: resolved };
        }
      }
      const producedSemanticTypes = new Set<string>([...state.produced]);
      endpoint.produces.forEach((s) => {
        producedSemanticTypes.add(s);
      });
      const key = state.ops.join('->');
      if (!completed.has(key)) {
        const eventuallyConsistentOps = opRefs.filter((o) => o.eventuallyConsistent).length;
        let models = state.modelsDraft;
        let bindings = state.bindingsDraft;
        // Fallback simple heuristic if drafts absent
        if (!models && deploymentGatewayOpId && state.ops.includes(deploymentGatewayOpId)) {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder consumed by the test runtime
          bindings = { processDefinitionIdVar1: 'proc_${RANDOM}' };
          const includesJobActivator = !!(jobActivatorOpId && state.ops.includes(jobActivatorOpId));
          if (includesJobActivator)
            // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder consumed by the test runtime
            bindings.jobTypeVar1 = 'jobType_${RANDOM}';
          models = [
            buildBpmnModelSpec(
              'processDefinitionIdVar1',
              includesJobActivator ? [{ id: 'task1', typeVar: 'jobTypeVar1' }] : undefined,
            ),
          ];
        }
        const scenario: EndpointScenario = {
          id: `scenario-${completed.size + 1}`,
          name: buildIntegrationScenarioName(
            endpoint.operationId,
            completed.size + 1,
            state,
            opRefs.length - 1,
            planningNeeded.size,
          ),
          description: buildIntegrationScenarioDescription(
            endpoint,
            state,
            opRefs.length - 1,
            planningNeeded.size,
          ),
          operations: opRefs,
          producedSemanticTypes: [...producedSemanticTypes],
          satisfiedSemanticTypes: [...initialNeeded],
          cycleInvolved: state.cycle || undefined,
          productionMap: Object.fromEntries(state.productionMap.entries()),
          providerList: Object.keys(state.providerList || {}).length
            ? state.providerList
            : undefined,
          hasEventuallyConsistent: eventuallyConsistentOps > 0 || undefined,
          eventuallyConsistentCount: eventuallyConsistentOps || undefined,
          domainStatesRequired: domainRequiredStates.length ? domainRequiredStates : undefined,
          domainStatesProduced: state.domainStates.size ? [...state.domainStates] : undefined,
          models,
          bindings,
          artifactsApplied: state.artifactsApplied?.length ? state.artifactsApplied : undefined,
          eventualConsistencyOps: eventuallyConsistentOps
            ? opRefs.filter((o) => o.eventuallyConsistent).map((o) => o.operationId)
            : undefined,
          externalEntitySites: externalEntitySites.length ? [...externalEntitySites] : undefined,
        };
        completed.set(key, scenario);
        scenarios.push(scenario);
      }
      // Continue exploring (long chains) if enabled and pre-op length below cap
      if (!longChainsEnabled || state.ops.length >= maxPreOps) continue;
    }

    // Domain-only progression: if no semantic remaining but domain unsatisfied
    if (remaining.length === 0 && (!domainRequiresSatisfied || !domainDisjunctionsSatisfied)) {
      // Collect transitive closure of prerequisite domain states so we can schedule producers for prerequisites first.
      const directMissing = endpointDomainRequires.filter((r) => !state.domainStates.has(r));
      const missingDomainAll = gatherDomainPrerequisites(graph, directMissing, state.domainStates);
      const unmetDisjunctions = endpointDisjunctions.filter(
        (group) => !group.some((g) => state.domainStates.has(g)),
      );
      const domainCandidates = new Set<string>();
      for (const d of missingDomainAll)
        (graph.producersByState?.[d] || []).forEach((opId) => {
          domainCandidates.add(opId);
        });
      for (const group of unmetDisjunctions) {
        // union producers for each member
        for (const member of group)
          (graph.producersByState?.[member] || []).forEach((opId) => {
            domainCandidates.add(opId);
          });
      }
      // Expand domain producers similar to semantic producers
      for (const producerOpId of domainCandidates) {
        if (producerOpId === endpointOpId) continue;
        const indexInPath = state.ops.indexOf(producerOpId);
        let nextCycle = state.cycle;
        if (indexInPath !== -1) {
          if (state.cycle) continue;
          else nextCycle = true;
        }
        const producerNode = graph.operations[producerOpId];
        if (!producerNode) continue;
        // Domain gating for domain producer expansion
        if (producerNode.domainRequiresAll?.length) {
          const missingDomain = producerNode.domainRequiresAll.filter(
            (ds) => !state.domainStates.has(ds),
          );
          if (missingDomain.length) continue; // enforce strict satisfaction first
        }
        // Issue #35: reject candidates whose semantic prereqs are not yet
        // satisfied (mirror the semantic-targeting branch). PR #45 review:
        // deferral does not apply here — domain producer expansion has no
        // single targetSemantic + provider-preference concept, so we rely
        // on the strict guard.
        if (!hasSatisfiedRequiredInputs(producerNode, state.produced)) continue;
        // Must add at least one new domain state to avoid infinite loops
        const newlyAdds = new Set<string>();
        producerNode.domainProduces?.forEach((d) => {
          if (!state.domainStates.has(d)) newlyAdds.add(d);
        });
        producerNode.domainImplicitAdds?.forEach((d) => {
          if (!state.domainStates.has(d)) newlyAdds.add(d);
        });
        // Enforce domain prerequisite chains for newly added states/capabilities
        if (newlyAdds.size) {
          let prereqFailed = false;
          for (const d of newlyAdds) {
            const rs = graph.domain?.runtimeStates?.[d];
            if (rs?.requires) {
              for (const req of rs.requires) {
                if (!state.domainStates.has(req) && !newlyAdds.has(req)) {
                  prereqFailed = true;
                  break;
                }
              }
              if (prereqFailed) break;
            }
            const cap = graph.domain?.capabilities?.[d];
            if (cap?.dependsOn) {
              for (const dep of cap.dependsOn) {
                if (!state.domainStates.has(dep) && !newlyAdds.has(dep)) {
                  prereqFailed = true;
                  break;
                }
              }
              if (prereqFailed) break;
            }
          }
          if (prereqFailed) continue;
        }
        if (newlyAdds.size === 0) continue;
        const newProduced = new Set(state.produced);
        producerNode.produces.forEach((s) => {
          newProduced.add(s);
        });
        const newNeeded = new Set(state.needed);
        producerNode.requires.required.forEach((s) => {
          newNeeded.add(s);
        });
        // Issue #35: producer `optional` requirements stay opportunistic
        // (mirror the semantic-targeting branch below).
        const newOps = [...state.ops, producerOpId];
        const newProductionMap = new Map(state.productionMap);
        producerNode.produces.forEach((s) => {
          if (!newProductionMap.has(s)) newProductionMap.set(s, producerOpId);
        });
        const newDomainStates = new Set(state.domainStates);
        newlyAdds.forEach((d) => {
          newDomainStates.add(d);
        });
        const sig = signature(newOps, newProduced, newNeeded, nextCycle);
        if (seen.has(sig)) continue;
        seen.add(sig);
        queue.push({
          produced: newProduced,
          needed: newNeeded,
          domainStates: newDomainStates,
          ops: newOps,
          cycle: nextCycle,
          productionMap: newProductionMap,
          modelsDraft: state.modelsDraft,
          bindingsDraft: state.bindingsDraft,
          discoveryIntents: state.discoveryIntents,
        });
      }
      continue;
    }

    // Choose a semantic type to target next.
    //
    // #388 — prefer a target that can make immediate progress over the
    // bare `remaining[0]`. The naive pick dead-ends when `remaining[0]`'s
    // only producer has a required input that is ALSO still in `needed`:
    // `deferForMissingPrereqs` then skips it without re-enqueueing (the
    // deferred signature would equal the current one), and because the
    // loop only ever targets `remaining[0]`, the unblocking prerequisite
    // is never expanded. Example: `updateAgentInstance` needs
    // `AgentInstanceKey` (producer `createAgentInstance`, which itself
    // requires `ElementInstanceKey`) AND `ElementInstanceKey` (a
    // runtimeEmission). Targeting `AgentInstanceKey` first dead-ends;
    // targeting the runtimeEmission first builds the job context, after
    // which `createAgentInstance` becomes chainable.
    //
    // A target is "actionable" when it is a runtimeEmission (always
    // expandable via discovery) or has a producer/establisher whose
    // required semantic inputs are already produced. This only reorders
    // when `remaining[0]` is itself blocked, so endpoints whose first
    // target is already actionable are unaffected.
    const isActionableTarget = (st: string): boolean => {
      const decl = graph.domain?.semanticTypes?.[st];
      if (decl?.kind === 'runtimeEmission' && decl.discoveredVia && decl.emittedBy) return true;
      const candidates = [
        ...(graph.producersByType[st] ?? []),
        // Exclude the endpoint itself: an edge op cannot self-satisfy its own
        // acceptsExternal components via a preceding call to itself.
        ...(graph.establishersByType?.[st] ?? []).filter((id) => id !== endpointOpId),
      ];
      return candidates.some((opId) => {
        const node = graph.operations[opId];
        return !!node && hasSatisfiedRequiredInputs(node, state.produced);
      });
    };
    const targetSemantic = remaining.find(isActionableTarget) ?? remaining[0];

    // #305 Phase 3 — `runtimeEmission` semantics declare a discovery
    // operation (ABox `discoveredVia.operationId`) that surfaces the
    // key at runtime, gated by a predecessor runtime state + optional
    // capability guards (`emittedBy.predecessor`, `emittedBy.guardedBy`).
    // They're deliberately NOT in `producersByType[target]` — the
    // authoritative-producer index only carries statically-annotated
    // providers. Synthesise the producer chain here; if the helper
    // dispatches a state into the queue (apply branch or defer branch),
    // skip the regular producer loop for this iteration. Otherwise
    // fall through and the BFS will drain the queue → `unsatisfied`.
    const targetDecl = targetSemantic ? graph.domain?.semanticTypes?.[targetSemantic] : undefined;
    if (
      targetSemantic &&
      targetDecl?.kind === 'runtimeEmission' &&
      targetDecl.discoveredVia &&
      targetDecl.emittedBy
    ) {
      const expanded = expandRuntimeEmission(
        graph,
        targetSemantic,
        targetDecl,
        state,
        seen,
        queue,
        endpointOpId,
      );
      if (expanded) continue;
      // Fall through to the regular producer loop when the discovery
      // chain could not be applied (missing/self-referential discovery
      // op, discovery op's required inputs not yet satisfied, cycle, or
      // already-seen successor signature). Without the fall-through the
      // BFS would `continue` here, drain the queue without enqueuing
      // anything for `targetSemantic`, and return `unsatisfied` — which
      // hides a legitimate producer path. (PR #308 review.)
    }

    // Shallow-copy the producer list before any local augmentation —
    // `graph.producersByType[targetSemantic]` is the shared
    // authoritative-producer index and must remain immutable across
    // BFS candidate evaluation and across `generateScenariosForEndpoint`
    // calls. Direct-reference + push() pollutes the index with
    // establishers (#104) or any future locally-added candidates and
    // leaks across endpoints, breaking the "producersByType is
    // authoritative only" contract.
    let producers: string[] = targetSemantic
      ? [...(graph.producersByType[targetSemantic] ?? [])]
      : [];

    // #104: establishers are kept out of `producersByType` to preserve
    // the "authoritative-producer only" contract that the rest of the
    // analyser (variant planning, provider preference, missing-producer
    // diagnostics) reads from that map. Augment the BFS candidate set
    // here, where the planner explicitly needs a satisfier — the
    // produced-set propagation downstream still works because the
    // establisher's `op.produces` carries the synthesised semantic.
    if (targetSemantic) {
      const establishers = graph.establishersByType?.[targetSemantic];
      if (establishers?.length) {
        const seenIds = new Set(producers);
        for (const e of establishers) {
          if (!seenIds.has(e)) {
            producers.push(e);
            seenIds.add(e);
          }
        }
      }
    }

    // Provider preference & incidental suppression
    if (targetSemantic) {
      const providerSet = new Set<string>();
      for (const opId of producers) {
        const node = graph.operations[opId];
        if (node?.providerMap?.[targetSemantic]) providerSet.add(opId);
      }
      if (providerSet.size) {
        const authoritative = producers.filter((p) => providerSet.has(p));
        const incidental = producers.filter((p) => !providerSet.has(p));
        const filteredIncidental = incidental.filter((p) => {
          const node = graph.operations[p];
          if (!node) return false;
          return node.produces.some((st) => state.needed.has(st) && !state.produced.has(st));
        });
        producers = [...authoritative, ...filteredIncidental];
      }
    }

    for (const producerOpId of producers) {
      if (producerOpId === endpointOpId && !opts.allowEndpointAsProducer) continue; // don't pre-run endpoint
      // Issue #37 variant planning: when allowEndpointAsProducer is set,
      // the endpoint may legitimately appear as a warm-up step. The
      // existing cycle handling below caps it at one repeat.

      // Cycle detection logic
      const indexInPath = state.ops.indexOf(producerOpId);
      let nextCycle = state.cycle;
      if (indexInPath !== -1) {
        if (state.cycle) continue; // already consumed cycle allowance
        nextCycle = true; // allow one repeat
      }

      const producerNode = graph.operations[producerOpId];
      if (!producerNode) continue;
      // Domain gating for semantic producer expansion
      if (producerNode.domainRequiresAll?.length) {
        const missingDomain = producerNode.domainRequiresAll.filter(
          (ds) => !state.domainStates.has(ds),
        );
        if (missingDomain.length) {
          // Issue #58: when an authoritative semantic producer is blocked
          // solely by missing domain prereqs, defer it by scheduling the
          // domain producers first. Without this branch BFS silently
          // drops the candidate — the domain-progression branch above
          // only fires when no semantic remains, so endpoints whose
          // single authoritative producer is domain-gated would never
          // receive a chain (cf. completeJob → activateJobs gated on
          // ProcessInstanceExists+ModelHasServiceTaskType).
          //
          // Limited to authoritative producers (mirroring the
          // deferForMissingPrereqs rule) to avoid spurious incidental
          // chains. The helper's return value is informational; the
          // semantic candidate is skipped either way (we wait until the
          // domain states surface on a later iteration).
          deferForMissingDomainPrereqs(
            graph,
            producerNode,
            targetSemantic,
            state,
            seen,
            queue,
            endpointOpId,
          );
          continue; // wait until domain states present
        }
      }
      // Issue #35: reject candidates whose own required semantic inputs
      // are not produced by an earlier step. Without this guard the
      // candidate is appended anyway and emits code that falls back to
      // a literal `${...}` placeholder URL at runtime. PR #45 review:
      // also enqueue a deferred state so transitive prereq producers can
      // still be discovered (see deferForMissingPrereqs docstring).
      if (deferForMissingPrereqs(producerNode, targetSemantic, state, seen, queue)) continue;

      const newProduced = new Set(state.produced);
      const newDomainStates = new Set(state.domainStates);
      // applyArtifactRuleSelection / ensureArtifactBindings mutate
      // state.artifactsApplied, state.bindingsDraft, and state.modelsDraft
      // (and may allocate fresh arrays/objects via `state.x ||= …` when
      // those fields are undefined). The producer-candidate loop iterates
      // multiple producers against the same parent BFS frame, so passing
      // the parent `state` directly leaks artifact/model mutations from
      // one createDeployment candidate into sibling candidates evaluated
      // later in the same loop. Only the createDeployment path triggers
      // those mutations — clone artifactsApplied/modelsDraft only there
      // to avoid extra allocations on the common non-deployment path.
      // bindingsDraft is cloned unconditionally because the identifier
      // heuristic below writes to it for every producer.
      const workingBindingsDraft = { ...(state.bindingsDraft || {}) };
      let workingState: State;
      if (isDeploymentGatewayOp(graph.domain, producerOpId)) {
        const workingArtifactsApplied = state.artifactsApplied
          ? [...state.artifactsApplied]
          : undefined;
        const workingModelsDraft = state.modelsDraft ? [...state.modelsDraft] : undefined;
        workingState = {
          ...state,
          artifactsApplied: workingArtifactsApplied,
          bindingsDraft: workingBindingsDraft,
          modelsDraft: workingModelsDraft,
        };
        applyArtifactRuleSelection(graph, producerNode, workingState, newProduced, newDomainStates);
      } else {
        workingState = { ...state, bindingsDraft: workingBindingsDraft };
        producerNode.produces.forEach((s) => {
          newProduced.add(s);
        });
        producerNode.domainProduces?.forEach((d) => {
          newDomainStates.add(d);
        });
        producerNode.domainImplicitAdds?.forEach((d) => {
          newDomainStates.add(d);
        });
      }
      // Enforce domain prerequisite chains for any newly added domain states after semantic expansion
      const domainAddedNow = [...newDomainStates].filter((d) => !state.domainStates.has(d));
      if (domainAddedNow.length) {
        let prereqFailed = false;
        for (const d of domainAddedNow) {
          const rs = graph.domain?.runtimeStates?.[d];
          if (rs?.requires) {
            for (const req of rs.requires) {
              if (!newDomainStates.has(req)) {
                prereqFailed = true;
                break;
              }
            }
            if (prereqFailed) break;
          }
          const cap = graph.domain?.capabilities?.[d];
          if (cap?.dependsOn) {
            for (const dep of cap.dependsOn) {
              if (!newDomainStates.has(dep)) {
                prereqFailed = true;
                break;
              }
            }
            if (prereqFailed) break;
          }
        }
        if (prereqFailed) continue; // skip expansion; prerequisites not yet satisfied
      }
      const newNeeded = new Set(state.needed);
      producerNode.requires.required.forEach((s) => {
        newNeeded.add(s);
      });
      // Issue #35: producer `optional` requirements are opportunistic and
      // must NOT be promoted to `needed`, otherwise BFS chases an
      // arbitrary producer for them and inserts a spurious step.
      const newOps = [...state.ops, producerOpId];
      const newProductionMap = new Map(state.productionMap);
      // Only record productionMap entries for semantics that actually
      // landed in `newProduced`. For createDeployment, applyArtifactRuleSelection
      // intentionally limits the produced set based on the selected
      // artifact bundle; recording the full declared `producerNode.produces`
      // would make productionMap claim semantics (Decision*/Form keys, etc.)
      // that the candidate didn't actually produce in this scenario
      // (mirrors the gate in deferForMissingDomainPrereqs).
      producerNode.produces.forEach((s) => {
        if (newProduced.has(s) && !newProductionMap.has(s)) {
          newProductionMap.set(s, producerOpId);
        }
      });
      // (newDomainStates already updated above)

      // Draft models & bindings — read post-call from workingState so any
      // models/bindings allocated by applyArtifactRuleSelection /
      // ensureArtifactBindings (`state.x ||= …`) flow into the enqueued
      // child without leaking into sibling candidates.
      let modelsDraft = workingState.modelsDraft;
      const bindingsDraft = workingState.bindingsDraft ?? {};
      if (isDeploymentGatewayOp(graph.domain, producerOpId) && !modelsDraft) {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder consumed by the test runtime
        bindingsDraft.processDefinitionIdVar1 = 'proc_${RANDOM}';
        modelsDraft = [buildBpmnModelSpec('processDefinitionIdVar1')];
      }
      // Identifier heuristic: assign vars for newly added semantics ending with 'Key'.
      // Only applies to semantics that have no authoritative producer — producerBound
      // semantics (those with a producer in graph.producersByType) receive __PENDING__
      // because their value is server-established at runtime via the response.
      const newlyAddedSemantics = [...newProduced].filter((s) => !state.produced.has(s));
      for (const s of newlyAddedSemantics) {
        if (/Key$/.test(s)) {
          const varName = semanticToVarName(s, bindingsDraft);
          if (!bindingsDraft[varName]) {
            const isProducerBound = (graph.producersByType[s]?.length ?? 0) > 0;
            bindingsDraft[varName] = isProducerBound
              ? PENDING_BINDING
              : `${camelLower(s)}_${deterministicSuffix(`sg:key:${s}:${varName}`)}`;
          }
        }
      }
      // Issue #104: when the producer is an establisher, mint a fresh
      // client-minted binding for each `identifiedBy` entry. The primary
      // varName matches what the request-body builder computes for a
      // body field of the same `name` (`${camelCase(name)}Var`) AND
      // what the emitter computes for a path placeholder of the same
      // `name` (`buildUrlExpression`: `{name}` → `ctx.${camelCase(name)}Var`).
      // That single shared key threads the same value into the
      // establisher's request and into any downstream consumer's URL
      // without any extract step. Pre-populating bindingsDraft is
      // sufficient because the body builder only writes a placeholder
      // when the binding key is absent.
      //
      // Disambiguation: when two establishers in the same chain share
      // a generic identifier `name` (e.g. `name`, `id`) but mint
      // values for *different* semantic types, blindly reusing the
      // existing binding would silently hand the second resource the
      // first resource's identifier. Track the semanticType minted
      // under each varName in `establisherBindingSemantics`; on
      // collision with a different semantic, mint under a numerically
      // suffixed name (`nameVar2`, `nameVar3`, …). The suffixed key
      // ensures the *value* is unique and is correctly threaded
      // through the URL alias loop below for any consumer placeholder
      // that resolves by `semanticType` rather than by `name`. (The
      // request-body builder still resolves placeholders by raw field
      // name and may reuse the primary key for the second establisher
      // — that's a separate body-builder limitation tracked
      // independently and out of scope for #104.)
      //
      // Establishers don't produce a response extract, so the alias
      // mechanism in `aliasProducerExtractsToPlaceholders` (issue #61)
      // can't help when the consumer's path placeholder name differs
      // from the establisher's identifier `name` (e.g. establisher
      // mints `username` but consumer uses `/users/{userKey}` with
      // semanticType `Username`). Pre-populate the same value under
      // every distinct placeholder name found in the graph for the
      // same semanticType so the URL emitter resolves it directly.
      //
      // Edge establishers (`shape: 'edge'`) are skipped — their
      // `identifiedBy` entries are pre-existing components consumed
      // from the chain, not values minted here.
      let establisherBindingSemantics = workingState.establisherBindingSemantics;
      let establisherAliasSemantics = workingState.establisherAliasSemantics;
      if (producerNode.establishes && producerNode.establishes.shape !== 'edge') {
        // Pre-flight: for each *body* identifier, the request-body
        // builder (`buildRequestBodyFromCanonical` in path-analyser/
        // src/index.ts) emits `${${camelCase(name)}Var}` from the raw
        // field name with no per-step override. If a previously
        // chained establisher already minted a different semantic at
        // that exact var name, the second establisher's request body
        // would render with the FIRST establisher's value — silently
        // wrong. Numeric-suffix disambiguation (below) only saves the
        // URL path because aliasing covers placeholder lookup; the
        // body builder has no equivalent hook. Skip the candidate
        // wholesale rather than emit a broken test. Path-only
        // identifiers don't share this hazard because the placeholder-
        // alias loop below threads the value under every placeholder
        // name the URL emitter uses.
        let bodyBindingClash = false;
        for (const id of producerNode.establishes.identifiedBy) {
          if (id.in !== 'body') continue;
          const bodyVar = `${camelLower(id.name)}Var`;
          const existingSemantic = establisherBindingSemantics?.[bodyVar];
          if (existingSemantic && existingSemantic !== id.semanticType) {
            bodyBindingClash = true;
            break;
          }
        }
        if (bodyBindingClash) continue;
        for (const id of producerNode.establishes.identifiedBy) {
          const baseVar = `${camelLower(id.name)}Var`;
          // For BODY identifiers we never suffix — see clash check
          // above. For PATH identifiers the URL emitter goes through
          // the alias loop, so a numeric suffix is safe.
          let primaryVar = baseVar;
          if (id.in === 'path') {
            let suffix = 2;
            while (
              establisherBindingSemantics?.[primaryVar] &&
              establisherBindingSemantics[primaryVar] !== id.semanticType
            ) {
              primaryVar = `${baseVar}${suffix++}`;
            }
          }
          const value =
            bindingsDraft[primaryVar] ??
            `${camelLower(producerNode.establishes.kind)}_${deterministicSuffix(`establish:${producerNode.operationId}:${id.semanticType}:${primaryVar}`)}`;
          // A primary mint always wins over a stale alias that an
          // earlier establisher in the same chain reserved for a
          // *different* semanticType. Without this overwrite the
          // alias value (e.g. a Username minted under `nameVar` for
          // some unrelated endpoint) would silently bleed into the
          // primary slot of a later body-id establisher whose own
          // raw field is also `name` but for a different semantic
          // (e.g. RoleName) — exactly the defect class guarded by
          // the cross-endpoint alias-pollution fixture.
          const aliasSemanticAtPrimary = establisherAliasSemantics?.[primaryVar];
          const staleAlias =
            aliasSemanticAtPrimary !== undefined && aliasSemanticAtPrimary !== id.semanticType;
          if (staleAlias) {
            const fresh = `${camelLower(producerNode.establishes.kind)}_${deterministicSuffix(`establish:${producerNode.operationId}:${id.semanticType}:${primaryVar}`)}`;
            bindingsDraft[primaryVar] = fresh;
            const { [primaryVar]: _drop, ...rest } = establisherAliasSemantics ?? {};
            establisherAliasSemantics = rest;
          } else if (!bindingsDraft[primaryVar]) {
            bindingsDraft[primaryVar] = value;
          }
          // Re-read the primary value AFTER the stale-alias overwrite
          // so the alias-mirroring loop below propagates the freshly-
          // minted value rather than the stale alias value captured
          // pre-overwrite. Otherwise an unrelated endpoint elsewhere
          // in the graph that aliased `primaryVar` for a different
          // semanticType would bleed its value into the new
          // semantic's other placeholder aliases — see PR #112
          // reviewer thread on the stale-alias overwrite branch.
          const aliasValue = bindingsDraft[primaryVar];
          establisherBindingSemantics = {
            ...(establisherBindingSemantics ?? {}),
            [primaryVar]: id.semanticType,
          };
          // Mirror the binding under every other placeholder-derived
          // var name used by any operation in the graph for this same
          // semanticType. Cheap one-time scan per identifier; harmless
          // if the consumer ends up not being chained.
          //
          // Aliases write to `establisherAliasSemantics` rather than
          // `establisherBindingSemantics`. The body-collision guard
          // (above) consults only the latter, so an alias reserved
          // here for an unrelated endpoint cannot abort a future
          // body-id establisher in the same chain whose primary slot
          // collides with the alias name — see PR #112 reviewer
          // thread on this file. The overwrite check below still
          // consults BOTH maps so we don't stomp a slot already
          // aliased for a different semanticType.
          for (const consumer of Object.values(graph.operations)) {
            for (const param of consumer.pathParameters ?? []) {
              if (param.semanticType !== id.semanticType) continue;
              const aliasVar = `${camelLower(param.name)}Var`;
              if (aliasVar === primaryVar) continue;
              // Only alias when the slot is free OR was previously
              // recorded (primary or alias) for this same
              // semanticType.
              const existingSemantic =
                establisherBindingSemantics?.[aliasVar] ?? establisherAliasSemantics?.[aliasVar];
              if (existingSemantic && existingSemantic !== id.semanticType) continue;
              if (!bindingsDraft[aliasVar]) {
                bindingsDraft[aliasVar] = aliasValue;
                establisherAliasSemantics = {
                  ...(establisherAliasSemantics ?? {}),
                  [aliasVar]: id.semanticType,
                };
              }
            }
          }
        }
      }

      const sig = signature(newOps, newProduced, newNeeded, nextCycle);
      if (seen.has(sig)) continue;
      seen.add(sig);

      queue.push({
        produced: newProduced,
        needed: newNeeded,
        domainStates: newDomainStates,
        ops: newOps,
        cycle: nextCycle,
        productionMap: newProductionMap,
        modelsDraft,
        bindingsDraft,
        establisherBindingSemantics,
        establisherAliasSemantics,
        providerList: updateProviderList(
          state.providerList || {},
          producerNode,
          newProductionMap,
          newProduced,
        ),
        artifactsApplied: workingState.artifactsApplied,
        discoveryIntents: state.discoveryIntents,
      });
    }
  }

  scenarios.sort((a, b) => {
    return a.operations.length - b.operations.length;
  });

  // BFS-give-up guard: if the search loop exhausted its queue without
  // completing any scenario (typically because every producer for a
  // required semantic type self-cycles or its own prerequisites are
  // unreachable), surface that as `unsatisfied: true` rather than a
  // silent `{ scenarios: [], unsatisfied: false }` — the latter would
  // mislead every downstream consumer that trusts `unsatisfied: false`
  // (orchestrator logs, codegen, Layer-3 invariants). The early return
  // above only catches the simpler case where `producersByType` is
  // empty for a required type; this branch covers "producers exist but
  // BFS cannot reach a terminal state from them". Mirror the early
  // return's shape so downstream code paths handle both uniformly.
  if (scenarios.length === 0) {
    scenarios.push({
      id: 'unsatisfied',
      operations: [toRef(endpoint)],
      producedSemanticTypes: [...endpoint.produces],
      satisfiedSemanticTypes: [],
      // Report every required semantic type as missing — including any
      // the endpoint self-produces. The early-return branch above filters
      // out endpoint-self-produced types because they will exist after
      // the call for downstream consumers; here we are signalling the
      // BFS could not build a *prerequisite* chain, and an endpoint
      // cannot be its own prerequisite (it cannot bind its own URL
      // placeholder from its own response).
      missingSemanticTypes: [...initialNeeded],
      hasEventuallyConsistent: endpoint.eventuallyConsistent || undefined,
      eventuallyConsistentCount: endpoint.eventuallyConsistent ? 1 : undefined,
      domainStatesRequired: domainRequiredStates.length ? domainRequiredStates : undefined,
    });
    return {
      endpoint: toRef(endpoint),
      requiredSemanticTypes: required,
      optionalSemanticTypes: optional,
      scenarios,
      unsatisfied: true,
    };
  }

  return {
    endpoint: toRef(endpoint),
    requiredSemanticTypes: required,
    optionalSemanticTypes: optional,
    scenarios,
    unsatisfied: false,
  };
}

function toRef(op: {
  operationId: string;
  method: string;
  path: string;
  eventuallyConsistent?: boolean;
}): OperationRef {
  return {
    operationId: op.operationId,
    method: op.method,
    path: op.path,
    eventuallyConsistent: op.eventuallyConsistent,
  };
}

function signature(
  ops: string[],
  produced: Set<string>,
  needed: Set<string>,
  cycle: boolean,
): string {
  return `${cycle ? 1 : 0}|${ops.join(',')}|p:${[...produced].sort().join(',')}|n:${[...needed].sort().join(',')}`;
}

// Issue #35: shared prereq guard. The semantic-producer and
// domain-producer expansion branches both need to reject candidates
// whose own required semantic inputs are not yet produced. Centralising
// the check keeps both branches in sync.
function hasSatisfiedRequiredInputs(
  producerNode: OperationNode,
  produced: ReadonlySet<string>,
): boolean {
  return producerNode.requires.required.every((s) => produced.has(s));
}

// Issue #35 follow-up (PR #45 review): when a candidate producer is
// rejected because its own required inputs are not yet produced, do not
// silently drop it — enqueue a *deferred* state that adds those missing
// inputs to `needed` (without appending the candidate). Subsequent BFS
// iterations can then plan a producer for the missing prereq and revisit
// the candidate once the input is satisfied. Without this, valid
// transitive chains like `[producer(X), A, endpoint]` (when A requires X
// and X has its own producer not yet planned) would be unreachable.
//
// Only authoritative providers (`providerMap[targetSemantic] === true`)
// are deferred. Deferring incidental producers would generate spurious
// scenarios where the incidental's output is unused, because the
// authoritative producer is already being explored in the same iteration
// and yields the canonical chain. Limiting deferral to authoritative
// providers preserves the #35 spirit (no spurious steps) while still
// recovering otherwise-valid transitive chains.
//
// The missing prereqs are inserted at the *front* of the deferred
// `needed` set so BFS targets them first (`remaining[0]` selection),
// rather than re-targeting the original semantic and looping on the
// same dead-end candidate.
//
// Returns true when the caller should `continue` (either the candidate
// was deferred or was already covered by an existing seen state).
function deferForMissingPrereqs(
  producerNode: OperationNode,
  targetSemantic: string | undefined,
  state: State,
  seen: Set<string>,
  queue: State[],
): boolean {
  if (hasSatisfiedRequiredInputs(producerNode, state.produced)) return false;
  // Only defer for authoritative providers. Incidental producers without
  // satisfied prereqs are skipped outright — the authoritative provider
  // (explored earlier in the same producer loop, courtesy of provider
  // preference ordering) yields the canonical chain.
  const isAuthoritative = !!targetSemantic && producerNode.providerMap?.[targetSemantic] === true;
  if (!isAuthoritative) return true;
  const missing = producerNode.requires.required.filter((s) => !state.produced.has(s));
  // If every missing prereq is already in `needed`, BFS would loop on
  // this same dead-end candidate. Just skip without re-enqueueing.
  if (missing.every((s) => state.needed.has(s))) return true;
  // Front-load missing prereqs so BFS targets them first.
  const deferredNeeded = new Set<string>(missing);
  for (const s of state.needed) deferredNeeded.add(s);
  const sig = signature(state.ops, state.produced, deferredNeeded, state.cycle);
  if (!seen.has(sig)) {
    seen.add(sig);
    queue.push({ ...state, needed: deferredNeeded });
  }
  return true;
}

// Issue #58: when an authoritative semantic producer is rejected because
// its `domainRequiresAll` is unmet, schedule domain producers for any
// missing state in the transitive closure (gatherDomainPrerequisites)
// so the candidate can be revisited on a subsequent BFS iteration.
//
// Only authoritative providers (`providerMap[targetSemantic] === true`)
// are deferred. Deferring incidental producers would generate spurious
// scenarios where the incidental's output is unused, mirroring the
// rationale in `deferForMissingPrereqs`.
//
// For each candidate domain producer we enqueue a state with that op
// appended and the domain state added. Cycle detection and domain
// prereq chains are handled identically to the dedicated
// domain-progression branch.
//
// Returns true when at least one deferred state was enqueued (the
// caller should `continue` either way; this is informational).
function deferForMissingDomainPrereqs(
  graph: OperationGraph,
  producerNode: OperationNode,
  targetSemantic: string | undefined,
  state: State,
  seen: Set<string>,
  queue: State[],
  endpointOpId: string,
): boolean {
  const isAuthoritative = !!targetSemantic && producerNode.providerMap?.[targetSemantic] === true;
  if (!isAuthoritative) return false;
  const directMissing = (producerNode.domainRequiresAll ?? []).filter(
    (ds) => !state.domainStates.has(ds),
  );
  if (directMissing.length === 0) return false;
  const missingAll = gatherDomainPrerequisites(graph, directMissing, state.domainStates);
  const candidates = new Set<string>();
  for (const ds of missingAll) {
    for (const opId of graph.producersByState?.[ds] ?? []) candidates.add(opId);
  }
  let enqueued = false;
  for (const candidateOpId of candidates) {
    if (candidateOpId === endpointOpId) continue;
    const candidateNode = graph.operations[candidateOpId];
    if (!candidateNode) continue;
    const indexInPath = state.ops.indexOf(candidateOpId);
    let nextCycle = state.cycle;
    if (indexInPath !== -1) {
      if (state.cycle) continue;
      nextCycle = true;
    }
    // Candidate must have its own domain prereqs satisfied (transitive
    // missing states are surfaced via `missingAll` so the *next* BFS
    // iteration will reach them).
    if (candidateNode.domainRequiresAll?.length) {
      const missing = candidateNode.domainRequiresAll.filter((d) => !state.domainStates.has(d));
      if (missing.length) continue;
    }
    if (!hasSatisfiedRequiredInputs(candidateNode, state.produced)) continue;
    // Apply the same artifact-rule selection as the semantic-producer
    // branch when the deferred domain producer is `createDeployment`,
    // otherwise we'd treat *all* deployment-advertised semantics
    // (Decision*/Form keys, etc.) as produced even when the selected
    // artifact bundle wouldn't yield them. Non-createDeployment
    // candidates take the unfiltered path (their `produces` is already
    // the authoritative set).
    const newProduced = new Set(state.produced);
    const newDomainStates = new Set(state.domainStates);
    // applyArtifactRuleSelection mutates state.artifactsApplied,
    // state.bindingsDraft, and state.modelsDraft (via
    // ensureArtifactBindings). Only the createDeployment branch
    // triggers those mutations and the seeding fallback below \u2014
    // clone the draft collections only on that path so non-deployment
    // candidates avoid the extra allocations on every BFS iteration.
    let workingState: State;
    if (isDeploymentGatewayOp(graph.domain, candidateOpId)) {
      const workingArtifactsApplied = state.artifactsApplied
        ? [...state.artifactsApplied]
        : undefined;
      const workingBindingsDraft = { ...(state.bindingsDraft || {}) };
      const workingModelsDraft = state.modelsDraft ? [...state.modelsDraft] : undefined;
      workingState = {
        ...state,
        artifactsApplied: workingArtifactsApplied,
        bindingsDraft: workingBindingsDraft,
        modelsDraft: workingModelsDraft,
      };
      applyArtifactRuleSelection(graph, candidateNode, workingState, newProduced, newDomainStates);
    } else {
      workingState = state;
      candidateNode.produces.forEach((s) => {
        newProduced.add(s);
      });
      candidateNode.domainProduces?.forEach((d) => {
        newDomainStates.add(d);
      });
      candidateNode.domainImplicitAdds?.forEach((d) => {
        newDomainStates.add(d);
      });
    }
    // Require this deferred step to make domain-state progress, else
    // BFS would loop on the same `seen` signature with no benefit.
    const domainAddedNow = [...newDomainStates].filter((d) => !state.domainStates.has(d));
    if (domainAddedNow.length === 0) continue;
    // Mirror the semantic-producer branch's transitive prereq check:
    // a newly-added domain state must have its `runtimeStates.requires`
    // and `capabilities.dependsOn` satisfied within `newDomainStates`,
    // otherwise we'd mark a state satisfied while its transitive
    // prerequisites are absent (e.g. `ProcessInstanceExists` requires
    // `ProcessDefinitionDeployed`).
    let prereqFailed = false;
    for (const d of domainAddedNow) {
      const rs = graph.domain?.runtimeStates?.[d];
      if (rs?.requires) {
        for (const req of rs.requires) {
          if (!newDomainStates.has(req)) {
            prereqFailed = true;
            break;
          }
        }
        if (prereqFailed) break;
      }
      const cap = graph.domain?.capabilities?.[d];
      if (cap?.dependsOn) {
        for (const dep of cap.dependsOn) {
          if (!newDomainStates.has(dep)) {
            prereqFailed = true;
            break;
          }
        }
        if (prereqFailed) break;
      }
    }
    if (prereqFailed) continue;
    const newNeeded = new Set(state.needed);
    candidateNode.requires.required.forEach((s) => {
      newNeeded.add(s);
    });
    const newOps = [...state.ops, candidateOpId];
    const newProductionMap = new Map(state.productionMap);
    // Only record productionMap entries for semantics that were actually
    // added to `newProduced`. For createDeployment, applyArtifactRuleSelection
    // intentionally limits the produced set based on the selected artifact
    // bundle; using `candidateNode.produces` unconditionally would make
    // productionMap claim semantics (Decision*/Form keys, etc.) the
    // candidate didn't actually produce in this scenario.
    candidateNode.produces.forEach((s) => {
      if (newProduced.has(s) && !newProductionMap.has(s)) {
        newProductionMap.set(s, candidateOpId);
      }
    });
    // Mirror the semantic-producer branch's createDeployment seeding so
    // a deferred deployment step still surfaces a process-definition
    // binding for downstream consumers.
    //
    // Read modelsDraft/bindingsDraft/artifactsApplied from `workingState`
    // (post-call), not from the pre-call locals. applyArtifactRuleSelection
    // and ensureArtifactBindings use `state.x ||= …` to allocate new
    // arrays/objects when their input was undefined; those allocations
    // land on `workingState.x`, while the pre-call locals stay undefined.
    // Reading from workingState preserves any artifact-selected
    // models/bindings/artifactsApplied for the enqueued child state.
    let modelsDraft = workingState.modelsDraft;
    const bindingsDraft = workingState.bindingsDraft ?? {};
    if (isDeploymentGatewayOp(graph.domain, candidateOpId) && !modelsDraft) {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder consumed by the test runtime
      bindingsDraft.processDefinitionIdVar1 = 'proc_${RANDOM}';
      modelsDraft = [buildBpmnModelSpec('processDefinitionIdVar1')];
    }
    const sig = signature(newOps, newProduced, newNeeded, nextCycle);
    if (seen.has(sig)) continue;
    seen.add(sig);
    queue.push({
      produced: newProduced,
      needed: newNeeded,
      domainStates: newDomainStates,
      ops: newOps,
      cycle: nextCycle,
      productionMap: newProductionMap,
      modelsDraft,
      bindingsDraft,
      // Propagate scenario-metadata bookkeeping from `state` and update
      // providerList for the candidate's produced semantics so later
      // scenario naming/description stays consistent with the semantic
      // expansion branch. Read artifactsApplied from `workingState` so
      // any array allocated by applyArtifactRuleSelection (`state.x ||= []`)
      // is preserved on the enqueued child without leaking into siblings.
      providerList: updateProviderList(
        state.providerList || {},
        candidateNode,
        newProductionMap,
        newProduced,
      ),
      artifactsApplied: workingState.artifactsApplied,
      discoveryIntents: state.discoveryIntents,
    });
    enqueued = true;
  }
  return enqueued;
}

/**
 * #305 Phase 3 — expand a `runtimeEmission` semantic type into a
 * discover-and-bind sub-chain.
 *
 * `runtimeEmission` semantic types declare a discovery operation
 * (ABox `discoveredVia.operationId`) that surfaces the key at runtime,
 * gated by `emittedBy.predecessor` (a runtime state) and optional
 * `emittedBy.guardedBy` capabilities. The discovery op is NOT in
 * `producersByType[target]` — the authoritative-producer index only
 * carries statically-annotated providers — so the producer loop would
 * otherwise dead-end on this semantic.
 *
 * Two branches:
 *
 *   - **Defer**: if any required domain state is missing, enqueue
 *     producers for the missing state(s) (mirrors the body of
 *     `deferForMissingDomainPrereqs`, sans the
 *     `providerMap[target]===true` precondition that doesn't apply to
 *     synthesised producers). The runtimeEmission semantic stays in
 *     `state.needed`; a later BFS iteration retries once the gates
 *     surface.
 *
 *   - **Apply**: gates satisfied — append the discovery op, add the
 *     runtimeEmission semantic to `produced`, and mint a `PENDING_BINDING`
 *     under its canonical var name (the server-extracted value is
 *     threaded through by the request builder / emitter).
 *
 * Returns true when a child state was enqueued (caller skips the
 * regular producer loop).
 */
function expandRuntimeEmission(
  graph: OperationGraph,
  targetSemantic: string,
  decl: NonNullable<NonNullable<OperationGraph['domain']>['semanticTypes']>[string],
  state: State,
  seen: Set<string>,
  queue: State[],
  endpointOpId: string,
): boolean {
  if (!decl.discoveredVia || !decl.emittedBy) return false;
  const discoveryOpId = decl.discoveredVia.operationId;
  if (discoveryOpId === endpointOpId) return false;
  const discoveryNode = graph.operations[discoveryOpId];
  if (!discoveryNode) return false;

  const requiredDomain = [decl.emittedBy.predecessor, ...(decl.emittedBy.guardedBy ?? [])];
  const directMissing = requiredDomain.filter((d) => !state.domainStates.has(d));

  // ── Defer branch ──────────────────────────────────────────────────────
  if (directMissing.length) {
    const missingAll = gatherDomainPrerequisites(graph, directMissing, state.domainStates);
    const candidates = new Set<string>();
    for (const ds of missingAll) {
      for (const opId of graph.producersByState?.[ds] ?? []) candidates.add(opId);
    }
    let enqueued = false;
    for (const candidateOpId of candidates) {
      if (candidateOpId === endpointOpId) continue;
      const candidateNode = graph.operations[candidateOpId];
      if (!candidateNode) continue;
      const indexInPath = state.ops.indexOf(candidateOpId);
      let nextCycle = state.cycle;
      if (indexInPath !== -1) {
        if (state.cycle) continue;
        nextCycle = true;
      }
      if (candidateNode.domainRequiresAll?.length) {
        const m = candidateNode.domainRequiresAll.filter((d) => !state.domainStates.has(d));
        if (m.length) continue;
      }
      if (!hasSatisfiedRequiredInputs(candidateNode, state.produced)) continue;

      const newProduced = new Set(state.produced);
      const newDomainStates = new Set(state.domainStates);
      let workingState: State;
      if (isDeploymentGatewayOp(graph.domain, candidateOpId)) {
        const workingArtifactsApplied = state.artifactsApplied
          ? [...state.artifactsApplied]
          : undefined;
        const workingBindingsDraft = { ...(state.bindingsDraft || {}) };
        const workingModelsDraft = state.modelsDraft ? [...state.modelsDraft] : undefined;
        workingState = {
          ...state,
          artifactsApplied: workingArtifactsApplied,
          bindingsDraft: workingBindingsDraft,
          modelsDraft: workingModelsDraft,
        };
        applyArtifactRuleSelection(
          graph,
          candidateNode,
          workingState,
          newProduced,
          newDomainStates,
        );
      } else {
        workingState = state;
        candidateNode.produces.forEach((s) => {
          newProduced.add(s);
        });
        candidateNode.domainProduces?.forEach((d) => {
          newDomainStates.add(d);
        });
        candidateNode.domainImplicitAdds?.forEach((d) => {
          newDomainStates.add(d);
        });
      }

      const domainAddedNow = [...newDomainStates].filter((d) => !state.domainStates.has(d));
      if (domainAddedNow.length === 0) continue;

      let prereqFailed = false;
      for (const d of domainAddedNow) {
        const rs = graph.domain?.runtimeStates?.[d];
        if (rs?.requires) {
          for (const req of rs.requires) {
            if (!newDomainStates.has(req)) {
              prereqFailed = true;
              break;
            }
          }
          if (prereqFailed) break;
        }
        const cap = graph.domain?.capabilities?.[d];
        if (cap?.dependsOn) {
          for (const dep of cap.dependsOn) {
            if (!newDomainStates.has(dep)) {
              prereqFailed = true;
              break;
            }
          }
          if (prereqFailed) break;
        }
      }
      if (prereqFailed) continue;

      const newNeeded = new Set(state.needed);
      candidateNode.requires.required.forEach((s) => {
        newNeeded.add(s);
      });
      const newOps = [...state.ops, candidateOpId];
      const newProductionMap = new Map(state.productionMap);
      candidateNode.produces.forEach((s) => {
        if (newProduced.has(s) && !newProductionMap.has(s)) {
          newProductionMap.set(s, candidateOpId);
        }
      });
      let modelsDraft = workingState.modelsDraft;
      const bindingsDraft = workingState.bindingsDraft ?? {};
      if (isDeploymentGatewayOp(graph.domain, candidateOpId) && !modelsDraft) {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder consumed by the test runtime
        bindingsDraft.processDefinitionIdVar1 = 'proc_${RANDOM}';
        modelsDraft = [buildBpmnModelSpec('processDefinitionIdVar1')];
      }
      const sig = signature(newOps, newProduced, newNeeded, nextCycle);
      if (seen.has(sig)) continue;
      seen.add(sig);
      queue.push({
        produced: newProduced,
        needed: newNeeded,
        domainStates: newDomainStates,
        ops: newOps,
        cycle: nextCycle,
        productionMap: newProductionMap,
        modelsDraft,
        bindingsDraft,
        providerList: updateProviderList(
          state.providerList || {},
          candidateNode,
          newProductionMap,
          newProduced,
        ),
        artifactsApplied: workingState.artifactsApplied,
        discoveryIntents: state.discoveryIntents,
      });
      enqueued = true;
    }
    return enqueued;
  }

  // ── Apply branch ──────────────────────────────────────────────────────
  const indexInPath = state.ops.indexOf(discoveryOpId);
  let nextCycle = state.cycle;
  if (indexInPath !== -1) {
    if (state.cycle) return false;
    nextCycle = true;
  }
  // The discovery op's own required semantic inputs (e.g. a search
  // filter that's actually `required` in the spec) must be available;
  // otherwise we'd build a chain whose discovery step has a missing
  // input. Optional filter-by inputs are not enforced here — the
  // request builder writes a placeholder if absent, and BFS would
  // otherwise spuriously plan a producer for an opportunistic filter.
  if (!hasSatisfiedRequiredInputs(discoveryNode, state.produced)) return false;

  const newProduced = new Set(state.produced);
  discoveryNode.produces.forEach((s) => {
    newProduced.add(s);
  });
  newProduced.add(targetSemantic);
  const newDomainStates = new Set(state.domainStates);
  discoveryNode.domainProduces?.forEach((d) => {
    newDomainStates.add(d);
  });
  discoveryNode.domainImplicitAdds?.forEach((d) => {
    newDomainStates.add(d);
  });
  const newNeeded = new Set(state.needed);
  discoveryNode.requires.required.forEach((s) => {
    newNeeded.add(s);
  });
  const newOps = [...state.ops, discoveryOpId];
  const newProductionMap = new Map(state.productionMap);
  if (!newProductionMap.has(targetSemantic)) {
    newProductionMap.set(targetSemantic, discoveryOpId);
  }
  discoveryNode.produces.forEach((s) => {
    if (newProduced.has(s) && !newProductionMap.has(s)) {
      newProductionMap.set(s, discoveryOpId);
    }
  });
  const bindingsDraft = { ...(state.bindingsDraft || {}) };
  const varName = semanticToVarName(targetSemantic, bindingsDraft);
  if (!bindingsDraft[varName]) bindingsDraft[varName] = PENDING_BINDING;

  // #309 Phase A — stamp DiscoveryIntent so the body builder emits
  // `{ filter: { [filterBy]: '${fromBinding}' } }` for this inserted
  // discovery step instead of the generic top-level scalar shape.
  // Stamping is *eager* here (without resolving `fromBinding`) because
  // the upstream producer may not have populated bindingsDraft yet at
  // this BFS frontier. `fromBinding` is resolved later, at scenario
  // finalisation, using `findLatestBindingForSemantic` against the
  // final chain's bindings — that mirrors `semanticToVarName`'s
  // suffixing convention (`Var`, `Var2`, …) so chains with multiple
  // producers of the same semantic bind to the latest producer rather
  // than the first.
  let newDiscoveryIntents = state.discoveryIntents;
  if (decl.discoveredVia.filterBy) {
    const filterBy = decl.discoveredVia.filterBy;
    const filterPaths = [`filter.${filterBy}`, filterBy];
    const filterEntry = (discoveryNode.requestBodySemantics ?? []).find((rb) =>
      filterPaths.includes(rb.fieldPath),
    );
    if (filterEntry) {
      const intent: DiscoveryIntent = {
        filterBy,
        fromSemantic: filterEntry.semantic,
        fromBinding: '', // resolved at finalisation (see attachDiscoveryIntents)
        extractKey: decl.discoveredVia.extractKey,
        extractInto: varName,
        consistency: decl.discoveredVia.consistency ?? 'strong',
      };
      newDiscoveryIntents = { ...(state.discoveryIntents ?? {}), [discoveryOpId]: intent };
    }
  }

  const sig = signature(newOps, newProduced, newNeeded, nextCycle);
  if (seen.has(sig)) return false;
  seen.add(sig);
  queue.push({
    produced: newProduced,
    needed: newNeeded,
    domainStates: newDomainStates,
    ops: newOps,
    cycle: nextCycle,
    productionMap: newProductionMap,
    modelsDraft: state.modelsDraft,
    bindingsDraft,
    providerList: updateProviderList(
      state.providerList || {},
      discoveryNode,
      newProductionMap,
      newProduced,
    ),
    artifactsApplied: state.artifactsApplied,
    discoveryIntents: newDiscoveryIntents,
  });
  return true;
}

// Select minimal artifact rules for the deployment-gateway producer based
// on unmet semantic needs. Callers gate on `isDeploymentGatewayOp` so the
// producerNode passed here is always the deployment-gateway op for the
// active config (Lift 9 / #225).
function applyArtifactRuleSelection(
  graph: OperationGraph,
  producerNode: OperationNode,
  state: State,
  newProduced: Set<string>,
  newDomainStates: Set<string>,
): void {
  const domain = graph.domain;
  if (!domain?.operationArtifactRules) {
    producerNode.produces.forEach((s: string) => {
      newProduced.add(s);
    });
    return;
  }
  const ruleSpec = domain.operationArtifactRules[producerNode.operationId];
  if (!ruleSpec) {
    producerNode.produces.forEach((s: string) => {
      newProduced.add(s);
    });
    return;
  }

  // If composable: treat artifacts as atomic and pick set cover of unmet semantics
  if (ruleSpec.composable) {
    const unmetNeeded = [...state.needed].filter((s) => !state.produced.has(s));
    const remaining = new Set(unmetNeeded);
    const applied: string[] = [];
    const rules = (ruleSpec.rules || []).slice();
    // Helper: pick the minimal preferred artifact (BPMN, else first).
    // Used both when no semantics drive coverage and as a fallback when
    // the greedy loop fails to apply any rule (e.g. when this is invoked
    // from `deferForMissingDomainPrereqs`, where the outer `state.needed`
    // contains semantics that no createDeployment rule produces, but we
    // still need *some* artifact selected so the deferred step makes
    // domain-state progress (#58 follow-up). Falling back to the
    // preferred minimal artifact keeps the Decision*/Form-flooding
    // protection intact while still letting BFS advance.
    const applyPreferred = () => {
      const preferred =
        (ruleSpec.rules || []).find((r) => r.artifactKind === 'bpmnProcess') ??
        (ruleSpec.rules || [])[0];
      if (!preferred) return;
      const semantics = enumerateRuleSemantics(preferred, graph);
      semantics.forEach((s) => {
        newProduced.add(s);
      });
      const states = enumerateRuleStates(preferred, graph);
      states.forEach((st) => {
        newDomainStates.add(st);
      });
      ensureArtifactBindings(preferred, graph, state, semantics, states);
      applied.push(preferred.id ?? preferred.artifactKind);
    };
    if (remaining.size === 0) {
      // No required semantics drive coverage: pick a single minimal artifact (prefer BPMN) to avoid flooding with unused Decision*/Form semantics.
      applyPreferred();
    } else {
      // Greedy until coverage or exhaustion
      while (remaining.size && rules.length) {
        rules.sort((a, b) => {
          const covA = coverageCount(a, remaining, graph);
          const covB = coverageCount(b, remaining, graph);
          if (covA !== covB) return covB - covA; // more coverage first
          const priA = a.priority ?? 100;
          const priB = b.priority ?? 100;
          if (priA !== priB) return priA - priB;
          const sizeA = enumerateRuleSemantics(a, graph).length;
          const sizeB = enumerateRuleSemantics(b, graph).length;
          return sizeA - sizeB;
        });
        const best = rules[0];
        const semantics = enumerateRuleSemantics(best, graph);
        const adds = semantics.filter((s) => remaining.has(s));
        if (!adds.length) {
          rules.shift();
          continue;
        }
        adds.forEach((s) => {
          newProduced.add(s);
          remaining.delete(s);
        });
        const states = enumerateRuleStates(best, graph);
        states.forEach((st) => {
          newDomainStates.add(st);
        });
        if (best.id) applied.push(best.id);
        else applied.push(best.artifactKind);
        ensureArtifactBindings(best, graph, state, adds, states);
      }
      // Greedy exhausted without applying any rule (no rule covers any
      // unmet `state.needed` semantic). Fall back to the preferred
      // minimal artifact so the caller still observes a valid
      // deployment artifact + ProcessDefinitionDeployed domain state.
      if (applied.length === 0) applyPreferred();
    }
    if (applied.length) {
      state.artifactsApplied ||= [];
      state.artifactsApplied.push(...applied);
    }
    return;
  }

  // Non-composable path (legacy multi-rule greedy minimal)
  const unmetNeeded = [...state.needed].filter((s) => !state.produced.has(s));
  const remaining = new Set(unmetNeeded);
  const appliedIds: string[] = [];
  const rules = [...(ruleSpec.rules || [])];
  rules.sort(
    (a, b) =>
      (a.priority ?? 100) - (b.priority ?? 100) ||
      countRuleCoverage(a, remaining, graph) - countRuleCoverage(b, remaining, graph),
  );
  for (const rule of rules) {
    const semantics = enumerateRuleSemantics(rule, graph);
    const adds = semantics.filter((s) => remaining.has(s));
    if (!adds.length) continue;
    adds.forEach((s) => {
      newProduced.add(s);
      remaining.delete(s);
    });
    const states = enumerateRuleStates(rule, graph);
    states.forEach((st) => {
      newDomainStates.add(st);
    });
    ensureArtifactBindings(rule, graph, state, adds, states);
    if (rule.id) appliedIds.push(rule.id);
    if (remaining.size === 0) break;
  }
  if (appliedIds.length === 0)
    producerNode.produces.forEach((s: string) => {
      newProduced.add(s);
    });
  if (appliedIds.length) {
    state.artifactsApplied ||= [];
    state.artifactsApplied.push(...appliedIds);
  }
}

function inferSemanticsFromArtifact(graph: OperationGraph, artifactKind: string): string[] {
  const domain = graph.domain;
  if (!domain?.artifactKinds) return [];
  const spec = domain.artifactKinds[artifactKind];
  if (!spec) return [];
  const semantics: string[] = [];
  if (spec.producesSemantics) semantics.push(...spec.producesSemantics);
  // Issue #35: an artifact also produces its identifier semantic (e.g.
  // bpmnProcess returns ProcessDefinitionId in the deployment response).
  // Without this, BFS chases a separate producer for the identifier and
  // inserts a spurious step.
  if (spec.identifierType) semantics.push(spec.identifierType);
  return [...new Set(semantics)];
}

function enumerateRuleSemantics(rule: ArtifactRule, graph: OperationGraph): string[] {
  const semantics = new Set<string>();
  if (rule.producesSemantics?.length) {
    for (const s of rule.producesSemantics) semantics.add(s);
    // Also include the artifact-kind's identifier for rules that
    // hand-roll producesSemantics, since inferSemanticsFromArtifact()
    // is not used in this branch and would otherwise silently drop it.
    const spec = graph.domain?.artifactKinds?.[rule.artifactKind];
    if (spec?.identifierType) semantics.add(spec.identifierType);
  } else {
    for (const s of inferSemanticsFromArtifact(graph, rule.artifactKind)) {
      semantics.add(s);
    }
  }
  return [...semantics];
}

function enumerateRuleStates(rule: ArtifactRule, graph: OperationGraph): string[] {
  // Chain-feasibility view: a `createDeployment` step is treated as capable
  // of producing any state listed at the kind level — including
  // `producibleStates` (which only SOME fixture of this kind actually
  // provides, #159). The selector picks the right fixture at emission
  // time; the planner just needs to know the chain is reachable.
  const states: string[] = [];
  if (rule.producesStates) states.push(...rule.producesStates);
  const spec = graph.domain?.artifactKinds?.[rule.artifactKind];
  if (spec?.producesStates) states.push(...spec.producesStates);
  if (spec?.producibleStates) states.push(...spec.producibleStates);
  return [...new Set(states)];
}

function countRuleCoverage(
  rule: ArtifactRule,
  remaining: Set<string>,
  graph: OperationGraph,
): number {
  const semantics = enumerateRuleSemantics(rule, graph);
  return semantics.filter((s) => remaining.has(s)).length || Number.MAX_SAFE_INTEGER; // non-covering rules last
}

function updateProviderList(
  existing: Record<string, string[]>,
  producerNode: OperationNode,
  _productionMap: Map<string, string>,
  newProduced: Set<string>,
): Record<string, string[]> {
  const copy: Record<string, string[]> = { ...existing };
  producerNode.produces?.forEach((s: string) => {
    // Only record providers for semantics that actually landed in
    // newProduced. For createDeployment, applyArtifactRuleSelection
    // intentionally limits the produced set based on the selected
    // artifact bundle; recording the full declared `produces` would
    // make providerList claim semantics (Decision*/Form keys, etc.)
    // that the candidate didn't actually produce in this scenario
    // (mirrors the productionMap gate).
    if (!newProduced.has(s)) return;
    const opId = producerNode.operationId;
    // Avoid in-place mutation of inherited arrays: `{ ...existing }` is
    // shallow, so `copy[s]` is the same array reference as the parent
    // BFS state's providerList[s]. push()ing into it would leak the
    // append into the parent (and any sibling state that inherited the
    // same reference). Allocate a fresh array on every write.
    if (!copy[s]) copy[s] = [opId];
    else if (!copy[s].includes(opId)) copy[s] = [...copy[s], opId];
  });
  return copy;
}

function coverageCount(rule: ArtifactRule, remaining: Set<string>, graph: OperationGraph): number {
  return enumerateRuleSemantics(rule, graph).filter((s) => remaining.has(s)).length;
}

function ensureArtifactBindings(
  _rule: ArtifactRule,
  graph: OperationGraph,
  state: State,
  semantics: string[],
  _states: string[],
) {
  state.bindingsDraft ||= {};
  state.modelsDraft ||= [];
  // Semantic-driven bindings naming
  for (const s of semantics) {
    const varName = semanticToVarName(s, state.bindingsDraft);
    if (!state.bindingsDraft[varName]) {
      // producerBound semantics (those with an authoritative producer) get
      // __PENDING__ — their value is server-established at runtime via the
      // producer's response. All other artifact semantics (model-derived,
      // client-minted) get a deterministic literal for pre-seeding.
      const isProducerBound = (graph.producersByType[s]?.length ?? 0) > 0;
      state.bindingsDraft[varName] = isProducerBound
        ? PENDING_BINDING
        : `${camelLower(s)}_${deterministicSuffix(`sg:sem:${s}:${varName}`)}`;
    }
    // Resolve the GeneratedModelSpec variant for this semantic via the ABox
    // (Lift 10 / #227): semantic → artifactKind → modelKind. Lift 13 / #253:
    // the per-kind arms collapsed into a single generic builder, so any
    // ABox-declared `modelKind` value (not just `bpmn` / `form`) produces a
    // model-spec entry. Per-kind primary-binding-role names live in
    // `modelSpecBuilders.ts`; new kinds register there without editing this
    // call site.
    const modelKind = getModelKindForSemantic(graph.domain, s);
    if (modelKind && !findModelSpec(state.modelsDraft, modelKind, varName)) {
      state.modelsDraft.push(buildModelSpec(modelKind, varName));
    }
  }
}

function semanticToVarName(semantic: string, existing: Record<string, string>): string {
  const base = `${camelLower(semantic)}Var`;
  if (!existing[base]) return base;
  let i = 2;
  while (existing[base + i]) i++;
  return base + i;
}

// Mirror of `semanticToVarName` for the *consumer* side: given a semantic
// for which a binding has already been allocated upstream in the chain,
// return the latest-allocated var name (`Var`, `Var2`, `Var3`, …) so the
// discovery step's filter binds to the most recent producer rather than
// the first. Returns undefined if no binding exists for the semantic.
function findLatestBindingForSemantic(
  semantic: string,
  bindings: Record<string, string>,
): string | undefined {
  const base = `${camelLower(semantic)}Var`;
  if (!(base in bindings)) return undefined;
  let latest = base;
  let i = 2;
  while (base + i in bindings) {
    latest = base + i;
    i++;
  }
  return latest;
}

function camelLower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function buildIntegrationScenarioName(
  endpointOpId: string,
  ordinal: number,
  state: State,
  _preOpCount: number,
  _totalRequired: number,
): string {
  const parts: string[] = [];
  if (state.cycle) parts.push('cycle');
  if (state.artifactsApplied?.length) parts.push(state.artifactsApplied.join('+'));
  const tag = parts.length ? parts.join('/') : 'path';
  return `${endpointOpId} - ${tag} #${ordinal}`;
}

function buildIntegrationScenarioDescription(
  endpoint: OperationNode,
  state: State,
  preOpCount: number,
  totalRequired: number,
): string {
  const segs: string[] = [];
  segs.push(
    `Scenario invoking ${endpoint.operationId} (${endpoint.method.toUpperCase()} ${endpoint.path}).`,
  );
  if (preOpCount === 0)
    segs.push('No prerequisite operations; endpoint self-satisfies requirements.');
  else
    segs.push(
      `${preOpCount} prerequisite operation(s) executed to satisfy ${totalRequired} required semantic type(s).`,
    );
  if (state.cycle) segs.push('Includes one allowed cycle repetition for semantic closure.');
  if (state.artifactsApplied?.length)
    segs.push(`Artifact bundle applied: ${state.artifactsApplied.join(', ')}.`);
  if (state.domainStates?.size)
    segs.push(`Domain states realized: ${[...state.domainStates].join(', ')}.`);
  return segs.join(' ');
}

// Recursively gather prerequisite domain states (runtimeState.requires and capability.dependsOn)
function gatherDomainPrerequisites(
  graph: OperationGraph,
  seeds: string[],
  already: Set<string>,
): string[] {
  const needed = new Set<string>();
  const stack = [...seeds];
  while (stack.length) {
    // biome-ignore lint/style/noNonNullAssertion: stack.length is checked in the loop predicate
    const cur = stack.pop()!;
    if (already.has(cur) || needed.has(cur)) continue;
    needed.add(cur);
    const rs = graph.domain?.runtimeStates?.[cur];
    if (rs?.requires)
      rs.requires.forEach((r) => {
        if (!already.has(r) && !needed.has(r)) stack.push(r);
      });
    const cap = graph.domain?.capabilities?.[cur];
    if (cap?.dependsOn)
      cap.dependsOn.forEach((d) => {
        if (!already.has(d) && !needed.has(d)) stack.push(d);
      });
  }
  return [...needed];
}

// =============================================================================
// Issue #37 — optional sub-shape variant scenarios
// =============================================================================
//
// Iteration 1 of issue #31 (PR #32) demoted optional-ancestor leaves like
// `startInstructions[].elementId` to `required: false`, so base scenarios
// no longer drag in spurious dependency producers when the optional
// sub-shape is omitted. That created a coverage gap: the populated case
// of those sub-shapes is no longer exercised by any scenario.
//
// `generateOptionalSubShapeVariants` fills that gap. For each
// `OperationNode.optionalSubShapes` entry on the endpoint, and for each
// semantic-typed leaf within that sub-shape, this function plans a
// sibling positive scenario where:
//
//   1. The leaf's semantic is added to the endpoint's required inputs.
//   2. If the chosen producer of the leaf needs an input that the endpoint
//      itself produces (e.g. `searchElementInstances` filters by
//      `ProcessInstanceKey`, which `createProcessInstance` produces), that
//      input is also promoted to required — forcing a WARM-UP endpoint
//      call before the producer can run.
//   3. The OUT-exclusion guard is lifted so BFS can use the endpoint as
//      the warm-up step. The existing one-cycle allowance caps usage at
//      one warm-up + one final.
//
// Variant scenarios are tagged `strategy: 'optionalSubShapeVariant'` and
// carry `populatesSubShape: { rootPath, leafPaths, leafSemantics }` so
// codegen can synthesize the populated request body.
export function generateOptionalSubShapeVariants(
  graph: OperationGraph,
  endpointOpId: string,
  opts: VariantGenerationOpts,
): EndpointScenarioCollection {
  const endpoint = graph.operations[endpointOpId];
  if (!endpoint) {
    return {
      endpoint: { operationId: endpointOpId, method: 'GET', path: '' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [],
      unsatisfied: false,
    };
  }
  const subShapes = endpoint.optionalSubShapes ?? [];
  const collectionScenarios: EndpointScenario[] = [];
  const seenVariantKeys = new Set<string>();
  // Cap total variants emitted per endpoint at `opts.maxVariantsPerEndpoint`.
  // The inner `generateScenariosForEndpoint` calls below intentionally pin
  // their own `maxChainAlternatives: 1` (one chain per variant), so this
  // outer cap is what bounds variant count for endpoints with many
  // semantic-typed optional leaves. Without this cap, a future spec
  // change could blow up `dist/variant-output/` with one file per
  // (subShape × leaf) pair.
  const maxVariants = Math.max(0, opts.maxVariantsPerEndpoint | 0);

  outer: for (const subShape of subShapes) {
    for (const leaf of subShape.leaves) {
      if (collectionScenarios.length >= maxVariants) break outer;

      // Skip duplicates BEFORE any planning work: `requestBodySemanticTypes`
      // can repeat the exact same (rootPath, fieldPath, semantic) triple
      // for true duplicates, and the producer-chain BFS below is the most
      // expensive step in this function — never run it for a key we've
      // already emitted. The dedup key includes `leaf.semantic`, so
      // polymorphic semantic-type annotations on the SAME field (e.g.
      // `evaluateExpression.scopeKey` annotated as `ScopeKey`,
      // `ProcessInstanceKey`, and `ElementInstanceKey`) are intentionally
      // kept as separate variants — one per semantic binding — rather than
      // collapsing into the first semantic seen (#324).
      const variantKey = `${subShape.rootPath}::${leaf.fieldPath}::${leaf.semantic}`;
      if (seenVariantKeys.has(variantKey)) continue;

      // Resolve producer candidates. When authoritative (provider:true)
      // producers exist, use them exclusively — `tryProducerChainVariant`'s
      // Pass 1 overlap heuristic would otherwise select an incidental
      // responder (e.g. searchAgentInstances, which exposes
      // ProcessDefinitionKey in its response but doesn't own it) over the
      // true authoritative producer (createDeployment). Restricting to
      // authoritative-only when available ensures the canonical source is
      // always tried. When authoritative is empty, fall back to the
      // inclusive index (provider:false response leaves, e.g.
      // searchElementInstances → ElementId).
      const authoritative = graph.producersByType[leaf.semantic] ?? [];
      const inclusive = graph.responseProducersByType?.[leaf.semantic] ?? [];
      const producerCandidates = unique(
        authoritative.length > 0 ? authoritative : inclusive,
      ).filter((id) => id !== endpointOpId);

      // #162 PR 4 (suite-partition cut): Try to build a producer-chain
      // variant first (the canonical "warm-up + search + final" pattern
      // for nested object leaves like `startInstructions[].elementId`).
      // If that fails — either because no producer exists at all
      // (clientMintedAttribute leaves like Tag/BusinessId) or because
      // BFS could not satisfy the augmented chain (some flat top-level
      // optionals on isolated message/signal endpoints) — fall back to
      // a bare endpoint scenario plus the populatesSubShape annotation
      // so the materializer still fills the body and the variant suite
      // covers the leaf.
      const producerChain = producerCandidates.length
        ? tryProducerChainVariant({
            graph,
            endpoint,
            endpointOpId,
            opts,
            leaf,
            producerCandidates,
          })
        : undefined;

      let scenario: EndpointScenario | undefined;
      if (producerChain) {
        scenario = producerChain;
      } else {
        // Bare-endpoint fallback: generate the basic chain and bind the
        // leaf semantic via the unified `bindSemanticInput` chokepoint.
        // For producerBound leaves where the chain failed, mint a
        // synthetic placeholder so the body still has a non-empty value
        // — matches the pre-PR-4 featureCoverageGenerator synthetic
        // (`<sem>_<suffix>`).
        const planned = generateScenariosForEndpoint(graph, endpointOpId, {
          ...opts,
          // #292: NOT a budget — this is a load-bearing strategy
          // constant. The variant emitter's contract is "one producer
          // chain per variant leaf"; raising it would emit multiple
          // chains for the same variant, which is the wrong shape.
          // Deliberately not surfaced via per-config planner caps.
          maxChainAlternatives: 1,
        });
        const baseScenario = planned.scenarios[0];
        if (!baseScenario || planned.unsatisfied) continue;
        const bound = bindSemanticInput({
          semantic: leaf.semantic,
          operationId: endpointOpId,
          graph,
        });
        const value = resolveFallbackValue(bound, leaf.semantic, endpointOpId);
        if (value === undefined) continue;
        // Prefer the canonical `bound.varName` (the same
        // `<camelCase(sem)>Var` convention every other binder uses) so
        // bindings stay consistent across planner paths. For
        // `unclassified` semantics (no entry in domain-semantics; no
        // varName on the bound result) derive the same name shape
        // locally so synthesised L2-fixture semantics like `ProductId`
        // still bind correctly.
        const varName =
          bound.classification === 'unclassified'
            ? `${camelLower(leaf.semantic)}Var`
            : bound.varName;
        baseScenario.bindings ||= {};
        // Only set the slot when empty so we never overwrite a binding
        // the basic-chain planner produced earlier in this pass.
        if (baseScenario.bindings[varName] === undefined) {
          baseScenario.bindings[varName] = value;
          // #172: a `modelDerived` leaf (e.g. `startInstructions[].elementId`)
          // has no producer-chain value reachable at this stage, so `value`
          // above is a SYNTHETIC placeholder. Record the binding so the
          // request-plan builder can replace it with a real value selected
          // from the chain's chosen deploy fixture (`providesElements`,
          // by type). Recorded ONLY when we actually installed the
          // placeholder (never in the producer-chain branch above), and
          // carries the exact placeholder so the fulfiller overwrites
          // nothing else. Other classifications carry an authoritative
          // value already and must not be touched at the deploy step.
          if (bound.classification === 'modelDerived' && varName) {
            baseScenario.modelDerivedBindings ||= [];
            baseScenario.modelDerivedBindings.push({
              varName,
              semantic: leaf.semantic,
              placeholder: value,
            });
          }
        }
        scenario = baseScenario;
      }

      seenVariantKeys.add(variantKey);
      scenario.id = `variant-${collectionScenarios.length + 1}`;
      scenario.strategy = 'optionalSubShapeVariant';
      scenario.variantKey = variantKey;
      scenario.populatesSubShape = {
        rootPath: subShape.rootPath,
        leafPaths: [leaf.fieldPath],
        leafSemantics: [leaf.semantic],
      };
      collectionScenarios.push(scenario);
    }
  }

  return {
    endpoint: toRef(endpoint),
    requiredSemanticTypes: [...endpoint.requires.required],
    optionalSemanticTypes: [...endpoint.requires.optional],
    scenarios: collectionScenarios,
    unsatisfied: false,
  };
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * #162 PR 4: producer-chain variant builder, extracted from
 * `generateOptionalSubShapeVariants` so the suite-partition-cut
 * fallback path can be invoked when no producer chain is viable.
 *
 * Returns the planned scenario on success, or `undefined` if no
 * producer candidate yields a satisfied chain (caller falls through
 * to the bare-endpoint variant).
 */
function tryProducerChainVariant(args: {
  graph: OperationGraph;
  endpoint: OperationNode;
  endpointOpId: string;
  opts: VariantGenerationOpts;
  leaf: { fieldPath: string; semantic: string };
  producerCandidates: string[];
}): EndpointScenario | undefined {
  const { graph, endpoint, endpointOpId, opts, leaf, producerCandidates } = args;
  const buildAdditional = (candidate: OperationNode): Set<string> => {
    const additional = new Set<string>();
    for (const opt of candidate.requires.optional) {
      if (endpoint.produces.includes(opt)) additional.add(opt);
    }
    for (const req of candidate.requires.required) additional.add(req);
    additional.add(leaf.semantic);
    return additional;
  };
  let chosenProducer: { node: OperationNode; additional: Set<string> } | undefined;
  // Pass 1: overlap-based (warm-up forced).
  for (const candidateOpId of producerCandidates) {
    const candidate = graph.operations[candidateOpId];
    if (!candidate) continue;
    const additional = buildAdditional(candidate);
    const overlapsEndpoint = [...additional].some((s) => endpoint.produces.includes(s));
    if (!overlapsEndpoint) continue;
    chosenProducer = { node: candidate, additional };
    break;
  }
  // Pass 2: non-overlap fallback (no warm-up).
  if (!chosenProducer) {
    for (const candidateOpId of producerCandidates) {
      const candidate = graph.operations[candidateOpId];
      if (!candidate) continue;
      chosenProducer = { node: candidate, additional: buildAdditional(candidate) };
      break;
    }
  }
  if (!chosenProducer) return undefined;
  const { additional } = chosenProducer;

  const chosenId = chosenProducer.node.operationId;
  const variantProducersByType: Record<string, string[]> = { ...graph.producersByType };
  variantProducersByType[leaf.semantic] = [chosenId];
  const variantOperations: Record<string, OperationNode> = { ...graph.operations };
  variantOperations[chosenId] = {
    ...chosenProducer.node,
    produces: chosenProducer.node.produces.includes(leaf.semantic)
      ? chosenProducer.node.produces
      : [...chosenProducer.node.produces, leaf.semantic],
    providerMap: {
      ...(chosenProducer.node.providerMap ?? {}),
      [leaf.semantic]: true,
    },
  };
  const variantGraph: OperationGraph = {
    ...graph,
    operations: variantOperations,
    producersByType: variantProducersByType,
  };

  const planned = generateScenariosForEndpoint(variantGraph, endpointOpId, {
    ...opts,
    allowEndpointAsProducer: true,
    additionalNeeded: [...additional],
    // #292: NOT a budget — see the matching note at the bare-endpoint
    // fallback above. One producer chain per variant leaf is the
    // strategy, not a tunable cap.
    maxChainAlternatives: 1,
  });
  const scenario = planned.scenarios[0];
  if (!scenario || planned.unsatisfied) return undefined;
  return scenario;
}

/**
 * #162 PR 4: pick a value for the bare-endpoint fallback path.
 *
 * - `clientMintedAttribute` and `serverEmergent` (PR 5): deterministic
 *   minted token from `bindSemanticInput`. Both classifications carry
 *   their own value because the planner is the authoritative source
 *   for what to put in the request body (no producer chain to extract
 *   from); reusing `bound.value` keeps the byte-stable mint formula
 *   centralised in `bindSemanticInput.ts`.
 * - `modelDerived` and `producerBound` (and other classifications):
 *   synthesise the same `<semantic>_<suffix>` placeholder shape
 *   `featureCoverageGenerator` used pre-PR-4 for `opt=<sem>` scenarios.
 *   For `modelDerived`, the proper deploy-fixture value is unreachable
 *   from this stage (no chain context); the placeholder is a stand-in
 *   so the variant exists and the body is well-formed. For
 *   `producerBound`, chain-extracted values would be preferable but
 *   are not reachable for endpoints whose producer-chain BFS could not
 *   satisfy.
 */
function resolveFallbackValue(
  bound: ReturnType<typeof bindSemanticInput>,
  semantic: string,
  endpointOpId: string,
): string | undefined {
  if (bound.classification === 'clientMintedAttribute') return bound.value;
  if (bound.classification === 'serverEmergent') return bound.value;
  return `${camelLower(semantic)}_${deterministicSuffix(`vc:opt:${endpointOpId}:${semantic}`)}`;
}
