import { deterministicSuffix } from './codegen/support/seeding.js';
import type {
  ArtifactRule,
  EndpointScenario,
  EndpointScenarioCollection,
  ExtendedGenerationOpts,
  GeneratedModelSpec,
  OperationGraph,
  OperationNode,
  OperationRef,
} from './types.js';

// Back-compat generation options
interface GenerationOpts {
  maxScenarios: number;
  longChains?: { enabled: boolean; maxPreOps: number };
}

// BFS state used by generateScenariosForEndpoint and its helpers.
interface State {
  produced: Set<string>; // semantic types produced
  needed: Set<string>; // semantic types still potentially needed (includes optional initially)
  domainStates: Set<string>; // accumulated domain states/capabilities
  ops: string[]; // operations before endpoint
  cycle: boolean;
  productionMap: Map<string, string>; // semanticType -> opId
  bootstrapSequencesUsed: string[]; // contributing bootstrap sequences
  bootstrapFull?: boolean; // this state derives from a single bootstrap that covers all required
  modelsDraft?: GeneratedModelSpec[]; // synthesized models (mutable during BFS)
  bindingsDraft?: Record<string, string>; // variable bindings
  providerList?: Record<string, string[]>; // semantic -> all providers
  artifactsApplied?: string[]; // artifact rule ids used so far
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
Stop when maxScenarios collected or queue empty.
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
  const initialNeeded = new Set([...required]);

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

  // Determine impossible semantic types (no producer anywhere, excluding endpoint self-production)
  const missing: string[] = [];
  for (const st of initialNeeded) {
    if (!graph.producersByType[st] || graph.producersByType[st].length === 0) {
      if (!endpoint.produces.includes(st)) missing.push(st);
    }
  }

  const scenarios: EndpointScenario[] = [];
  const max = opts.maxScenarios;

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
    produced: new Set(),
    needed: new Set(initialNeeded),
    domainStates: new Set(),
    ops: [],
    cycle: false,
    productionMap: new Map(),
    bootstrapSequencesUsed: [],
    providerList: {},
    artifactsApplied: [],
  };

  const queue: State[] = [initial];
  const bootstrapScenarios: EndpointScenario[] = [];

  // Seed states from bootstrap sequences (if any) whose produced set contributes to endpoint requirements.
  if (graph.bootstrapSequences?.length) {
    for (const seq of graph.bootstrapSequences) {
      const seqOpsValid = seq.operations.every((opId) => graph.operations[opId]);
      if (!seqOpsValid) continue;
      const produced = new Set<string>();
      for (const opId of seq.operations) {
        graph.operations[opId].produces.forEach((s) => {
          produced.add(s);
        });
      }
      // Include declared produces on sequence definition (acts as union / override)
      seq.produces.forEach((s) => {
        produced.add(s);
      });
      // Only enqueue if it helps satisfy at least one needed semantic type (or endpoint has none -> still useful as canonical setup)
      const helps = [...initialNeeded].some((s) => produced.has(s));
      if (helps || initialNeeded.size === 0) {
        const productionMap = new Map<string, string>();
        for (const opId of seq.operations) {
          graph.operations[opId].produces.forEach((s) => {
            if (!productionMap.has(s)) productionMap.set(s, opId);
          });
        }
        // Sequence state before endpoint
        const bootstrapFull = [...required].every((r) => produced.has(r));
        queue.push({
          produced,
          needed: new Set(initialNeeded),
          domainStates: new Set(),
          ops: [...seq.operations],
          cycle: false,
          productionMap,
          bootstrapSequencesUsed: [seq.name],
          bootstrapFull,
        });
        // Emit explicit bootstrap scenario if it alone satisfies all required semantic types
        if (bootstrapFull) {
          const producedSemanticTypes = new Set<string>(produced);
          endpoint.produces.forEach((s) => {
            producedSemanticTypes.add(s);
          });
          const opRefs = [
            ...seq.operations.map((id) => toRef(graph.operations[id])),
            toRef(endpoint),
          ];
          const evCount = opRefs.filter((o) => o.eventuallyConsistent).length;
          bootstrapScenarios.push({
            id: `bootstrap:${seq.name}`,
            operations: opRefs,
            producedSemanticTypes: [...producedSemanticTypes],
            satisfiedSemanticTypes: [...initialNeeded],
            productionMap: Object.fromEntries(productionMap.entries()),
            bootstrapSequencesUsed: [seq.name],
            bootstrapFull: true,
            hasEventuallyConsistent: evCount > 0 || undefined,
            eventuallyConsistentCount: evCount || undefined,
          });
        } else if (initialNeeded.size === 0) {
          // For endpoints with no requirements we still include a bootstrap variant for reference
          const producedSemanticTypes = new Set<string>(produced);
          endpoint.produces.forEach((s) => {
            producedSemanticTypes.add(s);
          });
          const opRefs = [
            ...seq.operations.map((id) => toRef(graph.operations[id])),
            toRef(endpoint),
          ];
          const evCount = opRefs.filter((o) => o.eventuallyConsistent).length;
          bootstrapScenarios.push({
            id: `bootstrap:${seq.name}`,
            operations: opRefs,
            producedSemanticTypes: [...producedSemanticTypes],
            satisfiedSemanticTypes: [],
            productionMap: Object.fromEntries(productionMap.entries()),
            bootstrapSequencesUsed: [seq.name],
            hasEventuallyConsistent: evCount > 0 || undefined,
            eventuallyConsistentCount: evCount || undefined,
          });
        }
      }
    }
  }
  const seen = new Set<string>(); // simple dedupe by produced+ops signature
  const completed: Map<string, EndpointScenario> = new Map();

  const longChainsEnabled = !!opts.longChains?.enabled;
  const maxPreOps = opts.longChains?.maxPreOps ?? 25;
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
        if (!models && state.ops.includes('createDeployment')) {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder consumed by the test runtime
          bindings = { processDefinitionIdVar1: 'proc_${RANDOM}' };
          if (state.ops.includes('activateJobs'))
            // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder consumed by the test runtime
            bindings.jobTypeVar1 = 'jobType_${RANDOM}';
          models = [
            {
              kind: 'bpmn',
              processDefinitionIdVar: 'processDefinitionIdVar1',
              serviceTasks: state.ops.includes('activateJobs')
                ? [{ id: 'task1', typeVar: 'jobTypeVar1' }]
                : undefined,
            },
          ];
        }
        const scenario: EndpointScenario = {
          id: `scenario-${completed.size + 1}`,
          name: buildIntegrationScenarioName(
            endpoint.operationId,
            completed.size + 1,
            state,
            opRefs.length - 1,
            initialNeeded.size,
          ),
          description: buildIntegrationScenarioDescription(
            endpoint,
            state,
            opRefs.length - 1,
            initialNeeded.size,
          ),
          operations: opRefs,
          producedSemanticTypes: [...producedSemanticTypes],
          satisfiedSemanticTypes: [...initialNeeded],
          cycleInvolved: state.cycle || undefined,
          productionMap: Object.fromEntries(state.productionMap.entries()),
          providerList: Object.keys(state.providerList || {}).length
            ? state.providerList
            : undefined,
          bootstrapSequencesUsed: state.bootstrapSequencesUsed.length
            ? [...state.bootstrapSequencesUsed]
            : undefined,
          bootstrapFull: state.bootstrapFull || undefined,
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
          bootstrapSequencesUsed: state.bootstrapSequencesUsed,
          bootstrapFull: state.bootstrapFull,
          modelsDraft: state.modelsDraft,
          bindingsDraft: state.bindingsDraft,
        });
      }
      continue;
    }

    // Choose a semantic type to target next
    const targetSemantic = remaining[0];
    let producers: string[] = targetSemantic ? graph.producersByType[targetSemantic] || [] : [];

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
      if (producerOpId === endpointOpId) continue; // don't pre-run endpoint

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
      if (producerOpId === 'createDeployment') {
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
      if (producerOpId === 'createDeployment' && !modelsDraft) {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder consumed by the test runtime
        bindingsDraft.processDefinitionIdVar1 = 'proc_${RANDOM}';
        modelsDraft = [{ kind: 'bpmn', processDefinitionIdVar: 'processDefinitionIdVar1' }];
      }
      // Identifier heuristic: assign vars for newly added semantics ending with 'Key'
      const newlyAddedSemantics = [...newProduced].filter((s) => !state.produced.has(s));
      for (const s of newlyAddedSemantics) {
        if (/Key$/.test(s)) {
          const varName = semanticToVarName(s, bindingsDraft);
          if (!bindingsDraft[varName])
            bindingsDraft[varName] =
              `${camelLower(s)}_${deterministicSuffix(`sg:key:${s}:${varName}`)}`;
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
        bootstrapSequencesUsed: state.bootstrapSequencesUsed,
        bootstrapFull: state.bootstrapFull,
        modelsDraft,
        bindingsDraft,
        providerList: updateProviderList(
          state.providerList || {},
          producerNode,
          newProductionMap,
          newProduced,
        ),
        artifactsApplied: workingState.artifactsApplied,
      });
    }
  }

  scenarios.push(...bootstrapScenarios.filter((bs) => !scenarios.find((s) => s.id === bs.id)));
  // Sort: full bootstrap first, then any bootstrap-used, then by length.
  scenarios.sort((a, b) => {
    const aFull = a.bootstrapFull ? 1 : 0;
    const bFull = b.bootstrapFull ? 1 : 0;
    if (aFull !== bFull) return bFull - aFull; // full first
    const aBoot = a.bootstrapSequencesUsed ? 1 : 0;
    const bBoot = b.bootstrapSequencesUsed ? 1 : 0;
    if (aBoot !== bBoot) return bBoot - aBoot; // any bootstrap before none
    return a.operations.length - b.operations.length;
  });

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
    if (candidateOpId === 'createDeployment') {
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
    if (candidateOpId === 'createDeployment' && !modelsDraft) {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder consumed by the test runtime
      bindingsDraft.processDefinitionIdVar1 = 'proc_${RANDOM}';
      modelsDraft = [{ kind: 'bpmn', processDefinitionIdVar: 'processDefinitionIdVar1' }];
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
      bootstrapSequencesUsed: state.bootstrapSequencesUsed,
      bootstrapFull: state.bootstrapFull,
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
    });
    enqueued = true;
  }
  return enqueued;
}

// Select minimal artifact rules for createDeployment based on unmet semantic needs.
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
  const ruleSpec = domain.operationArtifactRules.createDeployment;
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
  const states: string[] = [];
  if (rule.producesStates) states.push(...rule.producesStates);
  const domainProduces = graph.domain?.artifactKinds?.[rule.artifactKind]?.producesStates;
  if (domainProduces) states.push(...domainProduces);
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
  _graph: OperationGraph,
  state: State,
  semantics: string[],
  _states: string[],
) {
  state.bindingsDraft ||= {};
  state.modelsDraft ||= [];
  // Semantic-driven bindings naming
  for (const s of semantics) {
    const varName = semanticToVarName(s, state.bindingsDraft);
    if (!state.bindingsDraft[varName])
      state.bindingsDraft[varName] =
        `${camelLower(s)}_${deterministicSuffix(`sg:sem:${s}:${varName}`)}`;
    // If BPMN process definition -> ensure BPMN model spec exists
    if (s === 'ProcessDefinitionKey' && !state.modelsDraft.find((m) => m.kind === 'bpmn')) {
      state.modelsDraft.push({ kind: 'bpmn', processDefinitionIdVar: varName });
    }
    if (
      s === 'FormKey' &&
      !state.modelsDraft.find((m) => m.kind === 'form' && m.formKeyVar === varName)
    ) {
      state.modelsDraft.push({ kind: 'form', formKeyVar: varName });
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
  if (state.bootstrapFull) parts.push('bootstrap');
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
  if (state.bootstrapFull)
    segs.push('Uses bootstrap sequence providing full coverage of required semantics.');
  else if (state.bootstrapSequencesUsed?.length)
    segs.push(`Bootstrap assistance: ${state.bootstrapSequencesUsed.join(', ')}.`);
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
