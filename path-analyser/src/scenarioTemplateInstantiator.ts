import type {
  Edge,
  EdgesAbox,
  EntityKind,
  EntityKindsAbox,
  ScenarioTemplate,
  ScenarioTemplatesAbox,
} from './ontology/loader.js';
import { findMembershipArrayPath } from './ontology/observeArrayPath.js';
import type {
  EndpointScenario,
  OperationGraph,
  OperationRef,
  RequestStep,
  TemplateScenario,
  TemplateStep,
} from './types.js';

/**
 * #270 — Scenario template instantiator (Phase 2 of #268).
 *
 * For every (template × applicable subject) pair in the ABoxes,
 * compile the template into a {@link TemplateScenario}. The compiled
 * scenarios are written to
 * `generated/<config>/scenarios/templates/<TemplateName>/<SubjectName>.json`
 * by the path-analyser CLI entrypoint; the Playwright emitter
 * (materializer/src/playwright/templateEmitter.ts) consumes them to
 * produce the lifecycle .spec.ts files.
 *
 * Design choices the instantiator pins:
 *
 *   - **PrereqChain delegates to the existing BFS planner.** The
 *     instantiator does not reinvent dependency-chain construction; it
 *     pulls the already-planned canonical scenario for the establisher
 *     out of the per-operation canonical map that the CLI built
 *     earlier in the same run. That scenario carries the BFS-derived
 *     `operations`, `requestPlan`, `bindings`, and `seedBindings` —
 *     everything the prereq chain needs.
 *
 *   - **Invoke and Observe steps reuse the per-operation canonical
 *     scenario's final RequestStep.** The CLI invokes
 *     `buildRequestPlan` for every endpoint exactly once, regardless
 *     of how many templates reference it. The instantiator looks up
 *     the same scenario the CLI cached and copies the final step.
 *
 *   - **Observe membership locator is shared with the #269 feasibility
 *     invariant** via `findMembershipArrayPath`. A change in either
 *     consumer requires updating the helper, not duplicating
 *     parser logic in two places.
 *
 * Inputs/produces shape: the instantiator emits `inputs` and
 * `produces` maps keyed by **semantic type** (e.g. `RoleId`), with
 * **binding name** values (e.g. `roleIdVar`). The binding-name
 * convention matches `buildRequestPlan`'s `${camelCase(semantic)}Var`
 * rule so emitters can reach a value with `ctx[<bindingName>]`
 * without consulting the scenario binding table at every site.
 */

function camelCase(name: string): string {
  return name.length > 0 ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

function bindingNameFor(semantic: string): string {
  return `${camelCase(semantic)}Var`;
}

/**
 * Per-operation canonical-scenario map keyed by operationId. The CLI
 * populates one entry per endpoint with the planner's authoritative
 * scenario (the same `chainSource` that supplies feature variant
 * inheritance — see `index.ts` `canonicalByEndpoint`). By the time
 * the instantiator runs every entry has a fully-populated
 * `operations`, `bindings`, `requestPlan`, and `seedBindings`.
 *
 * Renamed from `ScenarioStash` in #288 Phase 3b when the per-operation
 * cache was unified into a single canonical source (also consumed by
 * `featureCoverageGenerator.buildScenarioFromVariant`).
 */
export type CanonicalScenarioMap = Map<string, EndpointScenario>;

/**
 * Produce the canonical 5-step {@link TemplateScenario} for one
 * (`EdgeLifecycle` template × edge) pair.
 *
 * Returns `null` if any of the three referenced operations
 * (establishedBy, revokedBy, observableVia) is missing from the
 * canonical, or if the observation op has no array-nested membership
 * field. The caller surfaces the error with the edge name so the
 * diagnostic points at the row instead of the helper.
 */
function compileEdgeLifecycle(
  template: ScenarioTemplate,
  edge: Edge,
  graph: OperationGraph,
  canonical: CanonicalScenarioMap,
): { scenario: TemplateScenario } | { error: string } {
  const establishScenario = canonical.get(edge.establishedBy);
  const revokeScenario = canonical.get(edge.revokedBy);
  const observeScenario = canonical.get(edge.observableVia);
  if (!establishScenario)
    return {
      error: `${template.name} × ${edge.name}: no canonical scenario for establishedBy='${edge.establishedBy}'`,
    };
  if (!revokeScenario)
    return {
      error: `${template.name} × ${edge.name}: no canonical scenario for revokedBy='${edge.revokedBy}'`,
    };
  if (!observeScenario)
    return {
      error: `${template.name} × ${edge.name}: no canonical scenario for observableVia='${edge.observableVia}'`,
    };

  const establishPlan = establishScenario.requestPlan;
  const revokePlan = revokeScenario.requestPlan;
  const observePlan = observeScenario.requestPlan;
  if (!establishPlan?.length || !revokePlan?.length || !observePlan?.length)
    return {
      error: `${template.name} × ${edge.name}: one of the referenced scenarios is missing a requestPlan`,
    };

  // The PrereqChain is everything in the establishedBy scenario
  // EXCEPT the establisher itself (which is invoked by the following
  // InvokeStep). The matching slice of `operations` and `requestPlan`
  // share an index because `buildRequestPlan` walks `operations` in
  // order, one RequestStep per operation. Both arrays may be longer
  // than each other when a final-step duplicate invocation is
  // appended (`duplicateTest`), but that only happens for endpoints
  // with `duplicateTest` set — none of the OCA edge establishers
  // have one. We assert one-to-one alignment to fail loud if a
  // future spec change introduces a mismatch.
  const establishOps = establishScenario.operations;
  if (establishOps.length !== establishPlan.length) {
    return {
      error: `${template.name} × ${edge.name}: establishedBy scenario operations.length (${establishOps.length}) ≠ requestPlan.length (${establishPlan.length}); duplicate invocation on an establisher is unsupported`,
    };
  }
  const prereqOps: OperationRef[] = establishOps.slice(0, -1).map((o) => ({ ...o }));
  const prereqPlan: RequestStep[] = establishPlan.slice(0, -1);

  // The aggregated binding table — union of every step's bindings,
  // keyed by semantic type (per the public TemplateScenario contract,
  // not by binding name as on EndpointScenario.bindings).
  //
  // The instantiator builds it from the union of the establishedBy
  // scenario's `bindings` (binding-name keyed, e.g. `roleIdVar`)
  // AND its `seedBindings` (binding names with no in-graph producer,
  // e.g. `clientIdVar` for external-entity kinds like Client). The
  // emitter resolves a semantic type back to a binding name via this
  // table, so both populated bindings and to-be-seeded ones need
  // to round-trip.
  //
  // Why include all of them (not just identifiedBy): the seeded
  // bindings (e.g. `nameVar`, `passwordVar` for createUser) need to
  // round-trip too so the emitter can prime them via seedBinding().
  // The membership-closure invariant (#270 L3) only asserts the
  // identifiedBy entries are present, not that the table is
  // minimal — keeping it inclusive matches the EndpointScenario
  // contract.
  const bindings: Record<string, string> = {};
  const aggregateBindingNames = new Set<string>([
    ...Object.keys(establishScenario.bindings ?? {}),
    ...(establishScenario.seedBindings ?? []),
  ]);
  for (const bindName of aggregateBindingNames) {
    // Recover the semantic type by stripping the trailing 'Var' and
    // upper-casing the first letter. This matches the inverse of
    // `bindingNameFor`. A binding name that doesn't end in 'Var'
    // (none exist today) would be passed through as-is so the
    // emitter still sees a stable round-trip key.
    const sem = bindName.endsWith('Var')
      ? bindName.slice(0, -3).charAt(0).toUpperCase() + bindName.slice(0, -3).slice(1)
      : bindName;
    bindings[sem] = bindName;
  }

  // Helper: map an op's required semantics to {semanticType: bindingName}.
  // Used by Invoke and Observe alike. We consult the graph for the
  // op's `requires.required`; the bindingName follows the camelCase
  // convention so callers don't need to inspect the canonical scenario
  // bindings (the union table built above is the source of truth at
  // emit time; this map is the per-step view onto it).
  const inputsFor = (opId: string): Record<string, string> => {
    const op = graph.operations[opId];
    const result: Record<string, string> = {};
    for (const sem of op?.requires.required ?? []) {
      result[sem] = bindingNameFor(sem);
    }
    return result;
  };
  // Producer view: every authoritative response semantic. Edge
  // establishers tend to be 204s with no producers, but the field is
  // present in the type for non-edge templates that may follow.
  const producesFor = (opId: string): Record<string, string> => {
    const op = graph.operations[opId];
    const result: Record<string, string> = {};
    for (const leaf of op?.responseSemanticLeaves ?? []) {
      if (!leaf.provider) continue;
      result[leaf.semantic] = bindingNameFor(leaf.semantic);
    }
    return result;
  };

  // Observe step: locate the membership array. The helper returns
  // null when no identifiedBy semantic appears array-nested in the
  // observation op's 200 response — the L3 feasibility invariant
  // from #269 has already pinned that this cannot happen for any
  // OCA edge, but we surface a structured error rather than throw
  // to keep the instantiator drop-in for future configs whose
  // edges might not yet satisfy the precondition.
  const observeOp = graph.operations[edge.observableVia];
  const locator = findMembershipArrayPath(observeOp, edge.identifiedBy);
  if (!locator) {
    return {
      error: `${template.name} × ${edge.name}: findMembershipArrayPath returned null for observableVia='${edge.observableVia}'; an edge with no array-nested identifiedBy semantic on its observation op cannot be observed via present/absent membership`,
    };
  }

  // Observe `inputs` are the SCOPING identifiers — identifiedBy
  // members the op consumes (path or filter params), minus the
  // membership identifier (which is asserted on the response, not
  // submitted). The scoping inputs come from the union
  // `identifiedBy ∩ op.requires.required`; the membership
  // identifier is whatever locator.membershipSemanticType says.
  const observeRequired = new Set(observeOp?.requires.required ?? []);
  const observeInputs: Record<string, string> = {};
  for (const sem of edge.identifiedBy) {
    if (sem === locator.membershipSemanticType) continue;
    if (!observeRequired.has(sem)) continue;
    observeInputs[sem] = bindingNameFor(sem);
  }

  const lastOf = (plan: RequestStep[]): RequestStep => plan[plan.length - 1];

  // Aggregate the set of operationIds across all five steps whose source
  // OperationSpec carries `eventuallyConsistent: true`. Threaded onto the
  // compiled TemplateScenario so the emitter can wrap read-shape steps in
  // `awaitEventually(...)` (the same predicate the per-endpoint emitter
  // uses). Without this, lifecycle suites whose observe step targets an
  // eventually-consistent search op would race the establish/revoke
  // mutation. (#270 review.)
  const allOpIds = new Set<string>([
    ...prereqOps.map((o) => o.operationId),
    edge.establishedBy,
    edge.observableVia,
    edge.revokedBy,
  ]);
  const eventuallyConsistentOps: string[] = [];
  for (const opId of allOpIds) {
    const op = graph.operations[opId];
    if (op?.eventuallyConsistent) eventuallyConsistentOps.push(opId);
  }
  eventuallyConsistentOps.sort();

  const steps: TemplateStep[] = [
    {
      kind: 'prereqChain',
      targetOperationId: edge.establishedBy,
      operations: prereqOps,
      bindings: { ...(establishScenario.bindings ?? {}) },
      seedBindings: [...(establishScenario.seedBindings ?? [])],
      requestPlan: prereqPlan,
    },
    {
      kind: 'invoke',
      operationId: edge.establishedBy,
      inputs: inputsFor(edge.establishedBy),
      produces: producesFor(edge.establishedBy),
      requestPlan: lastOf(establishPlan),
    },
    {
      kind: 'observe',
      operationId: edge.observableVia,
      inputs: observeInputs,
      requestPlan: lastOf(observePlan),
      assertion: {
        kind: 'membership',
        expect: 'present',
        arrayPath: locator.arrayPath,
        elementField: locator.elementField,
        membershipSemanticType: locator.membershipSemanticType,
      },
    },
    {
      kind: 'invoke',
      operationId: edge.revokedBy,
      inputs: inputsFor(edge.revokedBy),
      produces: producesFor(edge.revokedBy),
      requestPlan: lastOf(revokePlan),
    },
    {
      kind: 'observe',
      operationId: edge.observableVia,
      inputs: observeInputs,
      requestPlan: lastOf(observePlan),
      assertion: {
        kind: 'membership',
        expect: 'absent',
        arrayPath: locator.arrayPath,
        elementField: locator.elementField,
        membershipSemanticType: locator.membershipSemanticType,
      },
    },
  ];

  return {
    scenario: {
      templateName: template.name,
      subjectName: edge.name,
      subjectKind: 'Edge',
      steps,
      bindings,
      eventuallyConsistentOps,
    },
  };
}

export interface TemplateInstantiationResult {
  templateName: string;
  subjectName: string;
  subjectKind: 'Edge' | 'Entity' | 'RuntimeEntity';
  scenario: TemplateScenario;
}

/**
 * #280 — Produce the canonical 5-step {@link TemplateScenario} for one
 * (`EntityLifecycle` template × entity kind) pair. Parallel to
 * {@link compileEdgeLifecycle}; differs only in the observe assertion
 * shape (status-only by-id instead of array membership search).
 *
 * Returns `null`-flavoured `{ error }` if any of the three referenced
 * operations (establishedBy, observableVia, revokedBy) is missing from
 * the canonical map. The caller surfaces the error with the entity-kind name.
 */
function compileEntityLifecycle(
  template: ScenarioTemplate,
  kind: EntityKind,
  graph: OperationGraph,
  canonical: CanonicalScenarioMap,
): { scenario: TemplateScenario } | { error: string } {
  // EntityLifecycle only applies to shape: "entity" rows; the schema
  // forbids the triple on shape: "external-entity" so this is also a
  // type guard for the field reads below.
  if (kind.shape !== 'entity') {
    return {
      error: `${template.name} × ${kind.name}: appliesTo Entity templates only apply to shape: "entity" kinds, got shape: "${kind.shape}"`,
    };
  }
  const establishOpId = kind.establishedBy;
  const observeOpId = kind.observableVia;
  const revokeOpId = kind.revokedBy;
  if (
    typeof establishOpId !== 'string' ||
    typeof observeOpId !== 'string' ||
    typeof revokeOpId !== 'string'
  ) {
    // Schema enforces presence on shape: entity; defensive check
    // narrows the optional-by-FromSchema types for the rest of the
    // compiler.
    return {
      error: `${template.name} × ${kind.name}: missing one of establishedBy/observableVia/revokedBy on shape: "entity" kind (schema bug?)`,
    };
  }

  const establishScenario = canonical.get(establishOpId);
  const revokeScenario = canonical.get(revokeOpId);
  const observeScenario = canonical.get(observeOpId);
  if (!establishScenario)
    return {
      error: `${template.name} × ${kind.name}: no canonical scenario for establishedBy='${establishOpId}'`,
    };
  if (!revokeScenario)
    return {
      error: `${template.name} × ${kind.name}: no canonical scenario for revokedBy='${revokeOpId}'`,
    };
  if (!observeScenario)
    return {
      error: `${template.name} × ${kind.name}: no canonical scenario for observableVia='${observeOpId}'`,
    };

  const establishPlan = establishScenario.requestPlan;
  const revokePlan = revokeScenario.requestPlan;
  const observePlan = observeScenario.requestPlan;
  if (!establishPlan?.length || !revokePlan?.length || !observePlan?.length)
    return {
      error: `${template.name} × ${kind.name}: one of the referenced scenarios is missing a requestPlan`,
    };

  const establishOps = establishScenario.operations;
  if (establishOps.length !== establishPlan.length) {
    return {
      error: `${template.name} × ${kind.name}: establishedBy scenario operations.length (${establishOps.length}) ≠ requestPlan.length (${establishPlan.length}); duplicate invocation on an establisher is unsupported`,
    };
  }
  const prereqOps: OperationRef[] = establishOps.slice(0, -1).map((o) => ({ ...o }));
  const prereqPlan: RequestStep[] = establishPlan.slice(0, -1);

  const bindings: Record<string, string> = {};
  const aggregateBindingNames = new Set<string>([
    ...Object.keys(establishScenario.bindings ?? {}),
    ...(establishScenario.seedBindings ?? []),
  ]);
  for (const bindName of aggregateBindingNames) {
    const sem = bindName.endsWith('Var')
      ? bindName.slice(0, -3).charAt(0).toUpperCase() + bindName.slice(0, -3).slice(1)
      : bindName;
    bindings[sem] = bindName;
  }

  const inputsFor = (opId: string): Record<string, string> => {
    const op = graph.operations[opId];
    const result: Record<string, string> = {};
    for (const sem of op?.requires.required ?? []) {
      result[sem] = bindingNameFor(sem);
    }
    return result;
  };
  const producesFor = (opId: string): Record<string, string> => {
    const op = graph.operations[opId];
    const result: Record<string, string> = {};
    for (const leaf of op?.responseSemanticLeaves ?? []) {
      if (!leaf.provider) continue;
      result[leaf.semantic] = bindingNameFor(leaf.semantic);
    }
    return result;
  };

  // Observe inputs: every required semantic of the observation op.
  // For typical get-by-id endpoints (GET /users/{username}) that's a
  // single path-param identifier. No "membership identifier minus
  // scoping" split exists for by-id observation — the identifier IS
  // the input, and visibility is asserted on status alone.
  const observeInputs = inputsFor(observeOpId);

  const lastOf = (plan: RequestStep[]): RequestStep => plan[plan.length - 1];

  const allOpIds = new Set<string>([
    ...prereqOps.map((o) => o.operationId),
    establishOpId,
    observeOpId,
    revokeOpId,
  ]);
  const eventuallyConsistentOps: string[] = [];
  for (const opId of allOpIds) {
    const op = graph.operations[opId];
    if (op?.eventuallyConsistent) eventuallyConsistentOps.push(opId);
  }
  eventuallyConsistentOps.sort();

  const steps: TemplateStep[] = [
    {
      kind: 'prereqChain',
      targetOperationId: establishOpId,
      operations: prereqOps,
      bindings: { ...(establishScenario.bindings ?? {}) },
      seedBindings: [...(establishScenario.seedBindings ?? [])],
      requestPlan: prereqPlan,
    },
    {
      kind: 'invoke',
      operationId: establishOpId,
      inputs: inputsFor(establishOpId),
      produces: producesFor(establishOpId),
      requestPlan: lastOf(establishPlan),
    },
    {
      kind: 'observe',
      operationId: observeOpId,
      inputs: observeInputs,
      requestPlan: lastOf(observePlan),
      assertion: {
        kind: 'statusOnly',
        expect: 'present',
        expectedStatus: 200,
      },
    },
    {
      kind: 'invoke',
      operationId: revokeOpId,
      inputs: inputsFor(revokeOpId),
      produces: producesFor(revokeOpId),
      requestPlan: lastOf(revokePlan),
    },
    {
      kind: 'observe',
      operationId: observeOpId,
      inputs: observeInputs,
      requestPlan: lastOf(observePlan),
      assertion: {
        kind: 'statusOnly',
        expect: 'absent',
        expectedStatus: 404,
      },
    },
  ];

  return {
    scenario: {
      templateName: template.name,
      subjectName: kind.name,
      subjectKind: 'Entity',
      steps,
      bindings,
      eventuallyConsistentOps,
    },
  };
}

/**
 * #305 Phase 4 — Produce one {@link TemplateScenario} per
 * (runtime-entity × mutator) pair. Parallel to
 * {@link compileEntityLifecycle}, but tailored for runtime-emitted
 * entities (no establisher/revoker, just mutate → re-fetch → assert
 * the mutated field is visible on read-back).
 *
 * Returns one scenario per `kind.mutators[]` entry. Pairs that fail
 * (missing canonical, empty field intersection, missing fetcher
 * response leaves) are surfaced as `errors` so the caller can fail
 * the whole instantiation loudly with the full list of broken pairs.
 */
function compileUpdatedFieldVisibleOnReadBack(
  template: ScenarioTemplate,
  kind: EntityKind,
  graph: OperationGraph,
  canonical: CanonicalScenarioMap,
): {
  scenarios: Array<{ mutatorOpId: string; scenario: TemplateScenario }>;
  errors: string[];
} {
  const scenarios: Array<{ mutatorOpId: string; scenario: TemplateScenario }> = [];
  const errors: string[] = [];

  if (kind.shape !== 'runtime-entity') {
    errors.push(
      `${template.name} × ${kind.name}: appliesTo RuntimeEntity templates only apply to shape: "runtime-entity" kinds, got shape: "${kind.shape}"`,
    );
    return { scenarios, errors };
  }
  const fetcherOpId = kind.fetcher;
  const mutatorOpIds = kind.mutators;
  if (
    typeof fetcherOpId !== 'string' ||
    !Array.isArray(mutatorOpIds) ||
    mutatorOpIds.length === 0
  ) {
    errors.push(
      `${template.name} × ${kind.name}: missing fetcher and/or mutators[] on shape: "runtime-entity" kind (schema bug?)`,
    );
    return { scenarios, errors };
  }

  const fetcherScenario = canonical.get(fetcherOpId);
  if (!fetcherScenario) {
    errors.push(
      `${template.name} × ${kind.name}: no canonical scenario for fetcher='${fetcherOpId}'`,
    );
    return { scenarios, errors };
  }
  const fetcherPlan = fetcherScenario.requestPlan;
  if (!fetcherPlan?.length) {
    errors.push(`${template.name} × ${kind.name}: fetcher scenario has no requestPlan`);
    return { scenarios, errors };
  }

  // Collect every primitive leaf path of the fetcher's 200 response;
  // fall back to the first 2xx if no exact 200 (rare for getters).
  const fetcherOp = graph.operations[fetcherOpId];
  const fetcherLeaves =
    fetcherOp?.responseLeafPaths?.['200'] ??
    Object.entries(fetcherOp?.responseLeafPaths ?? {}).find(([s]) => /^2\d\d$/.test(s))?.[1] ??
    [];
  if (fetcherLeaves.length === 0) {
    errors.push(
      `${template.name} × ${kind.name}: fetcher='${fetcherOpId}' has no responseLeafPaths for 2xx (extractor regression?)`,
    );
    return { scenarios, errors };
  }
  // Build last-segment → full-path index. A response leaf like
  // `assignee` indexes under `'assignee'`; `items[].userTaskKey` under
  // `'userTaskKey'`. Multiple paths sharing a last segment are
  // preserved; matching prefers the shortest path (most likely the
  // top-level field a UI would observe).
  const responseByLeaf = new Map<string, string[][]>();
  for (const path of fetcherLeaves) {
    const segments = path.split('.');
    const last = segments[segments.length - 1].replace(/\[\]$/, '');
    const list = responseByLeaf.get(last) ?? [];
    list.push(segments);
    responseByLeaf.set(last, list);
  }

  for (const mutatorOpId of mutatorOpIds) {
    const mutatorScenario = canonical.get(mutatorOpId);
    if (!mutatorScenario) {
      errors.push(
        `${template.name} × ${kind.name} × ${mutatorOpId}: no canonical scenario for mutator`,
      );
      continue;
    }
    const mutatorPlan = mutatorScenario.requestPlan;
    if (!mutatorPlan?.length) {
      errors.push(
        `${template.name} × ${kind.name} × ${mutatorOpId}: mutator scenario has no requestPlan`,
      );
      continue;
    }
    const mutatorOps = mutatorScenario.operations;
    if (mutatorOps.length !== mutatorPlan.length) {
      errors.push(
        `${template.name} × ${kind.name} × ${mutatorOpId}: mutator scenario operations.length (${mutatorOps.length}) ≠ requestPlan.length (${mutatorPlan.length}); duplicate invocation on a mutator is unsupported`,
      );
      continue;
    }

    const lastOf = (plan: RequestStep[]): RequestStep => plan[plan.length - 1];
    const mutatorStep = lastOf(mutatorPlan);
    const bodyLeaves = collectBodyLeaves(mutatorStep.bodyTemplate);
    const fields: Array<{
      leafName: string;
      requestBodyPath: string[];
      responseBodyPath: string[];
    }> = [];
    for (const leaf of bodyLeaves) {
      const last = leaf.path[leaf.path.length - 1];
      const candidates = responseByLeaf.get(last);
      if (!candidates || candidates.length === 0) continue;
      // Prefer the shortest response path (top-level over nested).
      const responsePath = candidates.slice().sort((a, b) => a.length - b.length)[0];
      fields.push({
        leafName: last,
        requestBodyPath: leaf.path,
        responseBodyPath: responsePath,
      });
    }
    if (fields.length === 0) {
      errors.push(
        `${template.name} × ${kind.name} × ${mutatorOpId}: empty field intersection — mutator emitted body has no leaf whose name matches any leaf in fetcher='${fetcherOpId}' 2xx response. Add the relevant leaves to configs/<config>/request-defaults.json for the mutator, or annotate them upstream.`,
      );
      continue;
    }

    const prereqOps: OperationRef[] = mutatorOps.slice(0, -1).map((o) => ({ ...o }));
    const prereqPlan: RequestStep[] = mutatorPlan.slice(0, -1);

    const bindings: Record<string, string> = {};
    const aggregateBindingNames = new Set<string>([
      ...Object.keys(mutatorScenario.bindings ?? {}),
      ...(mutatorScenario.seedBindings ?? []),
    ]);
    for (const bindName of aggregateBindingNames) {
      const sem = bindName.endsWith('Var')
        ? bindName.slice(0, -3).charAt(0).toUpperCase() + bindName.slice(0, -3).slice(1)
        : bindName;
      bindings[sem] = bindName;
    }

    const inputsFor = (opId: string): Record<string, string> => {
      const op = graph.operations[opId];
      const result: Record<string, string> = {};
      for (const sem of op?.requires.required ?? []) {
        result[sem] = bindingNameFor(sem);
      }
      return result;
    };
    const producesFor = (opId: string): Record<string, string> => {
      const op = graph.operations[opId];
      const result: Record<string, string> = {};
      for (const leaf of op?.responseSemanticLeaves ?? []) {
        if (!leaf.provider) continue;
        result[leaf.semantic] = bindingNameFor(leaf.semantic);
      }
      return result;
    };

    const allOpIds = new Set<string>([
      ...prereqOps.map((o) => o.operationId),
      mutatorOpId,
      fetcherOpId,
    ]);
    const eventuallyConsistentOps: string[] = [];
    for (const opId of allOpIds) {
      const op = graph.operations[opId];
      if (op?.eventuallyConsistent) eventuallyConsistentOps.push(opId);
    }
    eventuallyConsistentOps.sort();

    const steps: TemplateStep[] = [
      {
        kind: 'prereqChain',
        targetOperationId: mutatorOpId,
        operations: prereqOps,
        bindings: { ...(mutatorScenario.bindings ?? {}) },
        seedBindings: [...(mutatorScenario.seedBindings ?? [])],
        requestPlan: prereqPlan,
      },
      {
        kind: 'invoke',
        operationId: mutatorOpId,
        inputs: inputsFor(mutatorOpId),
        produces: producesFor(mutatorOpId),
        requestPlan: lastOf(mutatorPlan),
      },
      {
        kind: 'observe',
        operationId: fetcherOpId,
        inputs: inputsFor(fetcherOpId),
        requestPlan: lastOf(fetcherPlan),
        assertion: {
          kind: 'fieldEquals',
          fields,
        },
      },
    ];

    scenarios.push({
      mutatorOpId,
      scenario: {
        templateName: template.name,
        subjectName: `${kind.name}.${mutatorOpId}`,
        subjectKind: 'RuntimeEntity',
        steps,
        bindings,
        eventuallyConsistentOps,
      },
    });
  }

  return { scenarios, errors };
}

/**
 * #305 Phase 5d / #189 — Produce one {@link TemplateScenario} per
 * (runtime-entity × transition) pair. Parallel to
 * {@link compileUpdatedFieldVisibleOnReadBack}, but tailored for
 * state-transition ops (e.g. `resolveIncident`) whose request body
 * carries no per-field update — the post-state is implicit in the op
 * semantics and asserted via a single equality on the fetcher's
 * `<stateField>` response leaf.
 *
 * Differences from the readback compiler:
 *   - The expected value is a string literal read from
 *     `transition.to` in the ABox, not plucked from the mutator body.
 *   - The state field is named explicitly by `kind.stateField` (not
 *     inferred from the body / response intersection).
 *   - The emitted assertion is `stateEquals`, not `fieldEquals`.
 *
 * Returns one scenario per `kind.transitions[]` entry. Pairs that fail
 * (missing canonical, fetcher missing `stateField`, etc.) are surfaced
 * as `errors` so the caller can fail the whole instantiation loudly
 * with the full list of broken pairs.
 */
function compileStateTransitionVisibleAfterAction(
  template: ScenarioTemplate,
  kind: EntityKind,
  graph: OperationGraph,
  canonical: CanonicalScenarioMap,
): {
  scenarios: Array<{ transitionOp: string; scenario: TemplateScenario }>;
  errors: string[];
} {
  const scenarios: Array<{ transitionOp: string; scenario: TemplateScenario }> = [];
  const errors: string[] = [];

  if (kind.shape !== 'runtime-entity') {
    errors.push(
      `${template.name} × ${kind.name}: appliesTo RuntimeEntity templates only apply to shape: "runtime-entity" kinds, got shape: "${kind.shape}"`,
    );
    return { scenarios, errors };
  }
  const fetcherOpId = kind.fetcher;
  const transitions = kind.transitions;
  const stateField = kind.stateField;
  if (
    typeof fetcherOpId !== 'string' ||
    !Array.isArray(transitions) ||
    transitions.length === 0 ||
    typeof stateField !== 'string' ||
    stateField.length === 0
  ) {
    errors.push(
      `${template.name} × ${kind.name}: missing fetcher, transitions[], or stateField on shape: "runtime-entity" kind (schema bug?)`,
    );
    return { scenarios, errors };
  }

  const fetcherScenario = canonical.get(fetcherOpId);
  if (!fetcherScenario) {
    errors.push(
      `${template.name} × ${kind.name}: no canonical scenario for fetcher='${fetcherOpId}'`,
    );
    return { scenarios, errors };
  }
  const fetcherPlan = fetcherScenario.requestPlan;
  if (!fetcherPlan?.length) {
    errors.push(`${template.name} × ${kind.name}: fetcher scenario has no requestPlan`);
    return { scenarios, errors };
  }

  // Verify the named stateField is actually a live leaf in the
  // fetcher's 2xx response. The L3 invariant repeats this guard
  // against the on-disk graph; doing it here means a misconfigured
  // ABox fails at planning time with a precise message rather than
  // emitting a spec that asserts against a non-existent field.
  const fetcherOp = graph.operations[fetcherOpId];
  const fetcherLeaves =
    fetcherOp?.responseLeafPaths?.['200'] ??
    Object.entries(fetcherOp?.responseLeafPaths ?? {}).find(([s]) => /^2\d\d$/.test(s))?.[1] ??
    [];
  if (!fetcherLeaves.includes(stateField)) {
    errors.push(
      `${template.name} × ${kind.name}: stateField='${stateField}' is not a 2xx response leaf of fetcher='${fetcherOpId}' (available leaves: ${fetcherLeaves.join(', ') || '<none>'})`,
    );
    return { scenarios, errors };
  }

  const lastOf = (plan: RequestStep[]): RequestStep => plan[plan.length - 1];

  for (const transition of transitions) {
    const transitionOpId = transition.op;
    const transitionScenario = canonical.get(transitionOpId);
    if (!transitionScenario) {
      errors.push(
        `${template.name} × ${kind.name} × ${transitionOpId}: no canonical scenario for transition op`,
      );
      continue;
    }
    const transitionPlan = transitionScenario.requestPlan;
    if (!transitionPlan?.length) {
      errors.push(
        `${template.name} × ${kind.name} × ${transitionOpId}: transition scenario has no requestPlan`,
      );
      continue;
    }
    const transitionOps = transitionScenario.operations;
    if (transitionOps.length !== transitionPlan.length) {
      errors.push(
        `${template.name} × ${kind.name} × ${transitionOpId}: transition scenario operations.length (${transitionOps.length}) ≠ requestPlan.length (${transitionPlan.length}); duplicate invocation on a transition is unsupported`,
      );
      continue;
    }

    const prereqOps: OperationRef[] = transitionOps.slice(0, -1).map((o) => ({ ...o }));
    const prereqPlan: RequestStep[] = transitionPlan.slice(0, -1);

    const bindings: Record<string, string> = {};
    const aggregateBindingNames = new Set<string>([
      ...Object.keys(transitionScenario.bindings ?? {}),
      ...(transitionScenario.seedBindings ?? []),
    ]);
    for (const bindName of aggregateBindingNames) {
      const sem = bindName.endsWith('Var')
        ? bindName.slice(0, -3).charAt(0).toUpperCase() + bindName.slice(0, -3).slice(1)
        : bindName;
      bindings[sem] = bindName;
    }

    const inputsFor = (opId: string): Record<string, string> => {
      const op = graph.operations[opId];
      const result: Record<string, string> = {};
      for (const sem of op?.requires.required ?? []) {
        result[sem] = bindingNameFor(sem);
      }
      return result;
    };
    const producesFor = (opId: string): Record<string, string> => {
      const op = graph.operations[opId];
      const result: Record<string, string> = {};
      for (const leaf of op?.responseSemanticLeaves ?? []) {
        if (!leaf.provider) continue;
        result[leaf.semantic] = bindingNameFor(leaf.semantic);
      }
      return result;
    };

    const allOpIds = new Set<string>([
      ...prereqOps.map((o) => o.operationId),
      transitionOpId,
      fetcherOpId,
    ]);
    const eventuallyConsistentOps: string[] = [];
    for (const opId of allOpIds) {
      const op = graph.operations[opId];
      if (op?.eventuallyConsistent) eventuallyConsistentOps.push(opId);
    }
    eventuallyConsistentOps.sort();

    const steps: TemplateStep[] = [
      {
        kind: 'prereqChain',
        targetOperationId: transitionOpId,
        operations: prereqOps,
        bindings: { ...(transitionScenario.bindings ?? {}) },
        seedBindings: [...(transitionScenario.seedBindings ?? [])],
        requestPlan: prereqPlan,
      },
      {
        kind: 'invoke',
        operationId: transitionOpId,
        inputs: inputsFor(transitionOpId),
        produces: producesFor(transitionOpId),
        requestPlan: lastOf(transitionPlan),
      },
      {
        kind: 'observe',
        operationId: fetcherOpId,
        inputs: inputsFor(fetcherOpId),
        requestPlan: lastOf(fetcherPlan),
        assertion: {
          kind: 'stateEquals',
          responseBodyPath: [stateField],
          expectedState: transition.to,
          fromState: transition.from,
          transitionOp: transitionOpId,
        },
      },
    ];

    scenarios.push({
      transitionOp: transitionOpId,
      scenario: {
        templateName: template.name,
        subjectName: `${kind.name}.${transitionOpId}`,
        subjectKind: 'RuntimeEntity',
        steps,
        bindings,
        eventuallyConsistentOps,
      },
    });
  }

  return { scenarios, errors };
}

/**
 * Walk an emitted request body template (object/array/primitive),
 * yielding every primitive (or array-of-primitive) leaf with its
 * dotted path. Array indices are skipped — we only care about the
 * structural property names that the planner emits.
 */
function collectBodyLeaves(body: unknown): Array<{ path: string[] }> {
  const out: Array<{ path: string[] }> = [];
  const walk = (node: unknown, path: string[]): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      // Treat the whole array as a leaf — its contents are the
      // mutation value (e.g. `candidateGroups: ['admins']`). Walking
      // inside arrays would only matter for arrays of objects, which
      // we don't currently support for read-back assertion.
      if (path.length > 0) out.push({ path });
      return;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        walk(value, [...path, key]);
      }
      return;
    }
    if (path.length > 0) out.push({ path });
  };
  walk(body, []);
  return out;
}

/**
 * Compile every (template × applicable subject) pair declared by the
 * given ABoxes. Throws if any pair fails to compile — failures here
 * indicate a misconfiguration that the L3 invariants should have
 * caught upstream (#269), so the loud failure mode is intentional.
 *
 * `entityKinds` is consulted only by `Entity`-applicable templates
 * (#280). Configs without an entity-kinds ABox may pass `null` and
 * any Entity templates will be skipped (and surface as a no-op rather
 * than a failure — same shape as the Edge path when edges is empty).
 */
export function instantiateAllTemplates(
  graph: OperationGraph,
  templates: ScenarioTemplatesAbox,
  edges: EdgesAbox,
  canonical: CanonicalScenarioMap,
  entityKinds: EntityKindsAbox | null,
): TemplateInstantiationResult[] {
  const out: TemplateInstantiationResult[] = [];
  const errors: string[] = [];
  for (const tpl of templates.templates) {
    if (tpl.appliesTo.kind === 'Edge') {
      // Phase-2 hard-codes the EdgeLifecycle compilation pipeline rather
      // than walking `tpl.steps`. New Edge-scoped templates therefore need
      // their own compiler (Phases 3-5 of #268). Refuse-by-default so an
      // unrecognised template name fails loudly instead of silently
      // re-emitting EdgeLifecycle's shape against the wrong vocabulary.
      if (tpl.name !== 'EdgeLifecycle') {
        throw new Error(
          `No compiler registered for scenario template '${tpl.name}'. ` +
            `Phase 2 (#270) only ships the EdgeLifecycle compiler; additional ` +
            `Edge-scoped templates need their own dispatch in instantiateAllTemplates.`,
        );
      }
      for (const edge of edges.edges) {
        const compiled = compileEdgeLifecycle(tpl, edge, graph, canonical);
        if ('error' in compiled) {
          errors.push(compiled.error);
          continue;
        }
        out.push({
          templateName: tpl.name,
          subjectName: edge.name,
          subjectKind: 'Edge',
          scenario: compiled.scenario,
        });
      }
      continue;
    }
    if (tpl.appliesTo.kind === 'Entity') {
      if (tpl.name !== 'EntityLifecycle') {
        throw new Error(
          `No compiler registered for scenario template '${tpl.name}'. ` +
            `#280 only ships the EntityLifecycle compiler; additional ` +
            `Entity-scoped templates need their own dispatch in instantiateAllTemplates.`,
        );
      }
      if (entityKinds === null) continue;
      for (const kind of entityKinds.kinds) {
        // Skip shape: "external-entity" kinds — the all-or-nothing
        // schema rule guarantees they have none of the triple, so
        // they can't satisfy EntityLifecycle. Silent skip is correct
        // here (not an error) because the template applies to the
        // whole ABox and the schema already classified them out.
        if (kind.shape !== 'entity') continue;
        const compiled = compileEntityLifecycle(tpl, kind, graph, canonical);
        if ('error' in compiled) {
          errors.push(compiled.error);
          continue;
        }
        out.push({
          templateName: tpl.name,
          subjectName: kind.name,
          subjectKind: 'Entity',
          scenario: compiled.scenario,
        });
      }
      continue;
    }
    if (tpl.appliesTo.kind === 'RuntimeEntity') {
      // #305 Phase 4 — UpdatedFieldVisibleOnReadBack template.
      // #305 Phase 5d / #189 — StateTransitionVisibleAfterAction template.
      // Refuse-by-default for any other template name so unrecognised
      // entries fail loudly rather than silently re-running an existing
      // compiler against the wrong vocabulary.
      if (
        tpl.name !== 'UpdatedFieldVisibleOnReadBack' &&
        tpl.name !== 'StateTransitionVisibleAfterAction'
      ) {
        throw new Error(
          `No compiler registered for scenario template '${tpl.name}'. ` +
            `RuntimeEntity-scoped templates currently shipped: ` +
            `UpdatedFieldVisibleOnReadBack (#305 Phase 4), ` +
            `StateTransitionVisibleAfterAction (#305 Phase 5d / #189). ` +
            `Additional templates need their own dispatch in instantiateAllTemplates.`,
        );
      }
      if (entityKinds === null) continue;
      for (const kind of entityKinds.kinds) {
        if (kind.shape !== 'runtime-entity') continue;
        if (tpl.name === 'UpdatedFieldVisibleOnReadBack') {
          // Skip rows that don't declare mutators — runtime-entity rows
          // are now allowed to carry transitions[] only (Phase 5d
          // schema relaxation). A row with no mutators is not an error
          // for *this* template, just out of scope.
          if (!Array.isArray(kind.mutators) || kind.mutators.length === 0) continue;
          const compiled = compileUpdatedFieldVisibleOnReadBack(tpl, kind, graph, canonical);
          for (const result of compiled.scenarios) {
            out.push({
              templateName: tpl.name,
              subjectName: `${kind.name}.${result.mutatorOpId}`,
              subjectKind: 'RuntimeEntity',
              scenario: result.scenario,
            });
          }
          for (const err of compiled.errors) errors.push(err);
        } else {
          // StateTransitionVisibleAfterAction. Skip rows with no
          // transitions[] — same reasoning as above.
          if (!Array.isArray(kind.transitions) || kind.transitions.length === 0) continue;
          const compiled = compileStateTransitionVisibleAfterAction(tpl, kind, graph, canonical);
          for (const result of compiled.scenarios) {
            out.push({
              templateName: tpl.name,
              subjectName: `${kind.name}.${result.transitionOp}`,
              subjectKind: 'RuntimeEntity',
              scenario: result.scenario,
            });
          }
          for (const err of compiled.errors) errors.push(err);
        }
      }
      continue;
    }
    // Exhaustiveness: a future appliesTo.kind value reaches here. The
    // current union is `'Edge' | 'Entity' | 'RuntimeEntity'`, so this
    // branch is unreachable today; the `never` annotation makes the
    // TS compiler keep us honest when the enum grows.
    const exhaustive: never = tpl.appliesTo.kind;
    throw new Error(
      `No dispatch registered for scenario template appliesTo.kind='${String(exhaustive)}' (template '${tpl.name}'). Extend instantiateAllTemplates.`,
    );
  }
  if (errors.length > 0) {
    throw new Error(
      `Scenario template instantiation failed for ${errors.length} (template × subject) pair(s):\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
  return out;
}
