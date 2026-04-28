import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Bundled-spec invariants — Layer 3 of the layered test strategy (#36).
 *
 * Each `it` block is a single, named regression statement of the form
 * "X must hold for the bundled spec output". Failures point at one
 * named property, not at 412 hashed files.
 *
 * The invariants here lock in behaviours we have already proven correct
 * against the real bundled spec (see #31, #32, #33, #34). Add a new
 * invariant whenever a bug fix is observable at the graph or chain
 * level; remove an invariant whenever the property it asserts is
 * deliberately revoked.
 *
 * Prerequisites: the pipeline must have been generated. CI runs
 * `npm run pipeline` before `npm test`; locally you can run
 * `npm run testsuite:generate` first.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const GRAPH_PATH = join(
  REPO_ROOT,
  'semantic-graph-extractor',
  'dist',
  'output',
  'operation-dependency-graph.json',
);
const SCENARIOS_DIR = join(REPO_ROOT, 'path-analyser', 'dist', 'output');
const FEATURE_SCENARIOS_DIR = join(REPO_ROOT, 'path-analyser', 'dist', 'feature-output');
const VARIANT_SCENARIOS_DIR = join(REPO_ROOT, 'path-analyser', 'dist', 'variant-output');
const GENERATED_TESTS_DIR = join(REPO_ROOT, 'path-analyser', 'dist', 'generated-tests');

interface SemanticTypeEntry {
  semanticType: string;
  fieldPath: string;
  required: boolean;
  provider: boolean;
}
interface ParameterEntry {
  name: string;
  location: string;
  semanticType?: string;
  required?: boolean;
}
interface OperationNode {
  operationId: string;
  method: string;
  path: string;
  parameters?: ParameterEntry[];
  requestBodySemanticTypes?: SemanticTypeEntry[];
  responseSemanticTypes?: Record<string, SemanticTypeEntry[]>;
}
interface DependencyGraph {
  operations: OperationNode[];
}
interface ScenarioFile {
  endpoint: { operationId: string };
  requiredSemanticTypes: string[];
  unsatisfied?: boolean;
  scenarios: {
    id: string;
    operations: { operationId: string }[];
    missingSemanticTypes?: string[];
  }[];
}

interface VariantScenario {
  id: string;
  variantKey?: string;
  hasEventuallyConsistent?: boolean;
  populatesSubShape?: { rootPath: string; leafPaths: string[]; leafSemantics?: string[] };
  operations: { operationId: string }[];
}
interface VariantScenarioFile {
  endpoint: { operationId: string };
  scenarios: VariantScenario[];
}

let cachedGraph: DependencyGraph | undefined;
let cachedOperationById: Map<string, OperationNode> | undefined;
function loadGraph(): DependencyGraph {
  if (cachedGraph) return cachedGraph;
  if (!existsSync(GRAPH_PATH)) {
    throw new Error(
      `Dependency graph not found at ${GRAPH_PATH}. Run 'npm run extract-graph' first.`,
    );
  }
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON; downstream property accesses tolerate malformed entries
  cachedGraph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as DependencyGraph;
  cachedOperationById = new Map(cachedGraph.operations.map((o) => [o.operationId, o]));
  return cachedGraph;
}

function findOperation(opId: string): OperationNode {
  loadGraph();
  const op = cachedOperationById?.get(opId);
  if (!op) throw new Error(`Operation ${opId} not found in dependency graph`);
  return op;
}

function requiredSemanticTypesOf(opId: string): string[] {
  const op = findOperation(opId);
  const set = new Set<string>();
  for (const e of op.requestBodySemanticTypes ?? []) {
    if (e.required) set.add(e.semanticType);
  }
  return [...set].sort();
}

function providersOf(opId: string): string[] {
  const op = findOperation(opId);
  const set = new Set<string>();
  for (const entries of Object.values(op.responseSemanticTypes ?? {})) {
    for (const e of entries) if (e.provider) set.add(e.semanticType);
  }
  return [...set].sort();
}

function loadScenarioFile(filename: string): ScenarioFile {
  const p = join(SCENARIOS_DIR, filename);
  if (!existsSync(p)) {
    throw new Error(
      `Scenario file not found at ${p}. Run 'npm run testsuite:generate' (or 'npm run pipeline') first.`,
    );
  }
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
  return JSON.parse(readFileSync(p, 'utf8')) as ScenarioFile;
}

describe('bundled-spec invariants: extractor classification', () => {
  it('createProcessInstance required semantic types are exactly {ProcessDefinitionId, ProcessDefinitionKey} (#31/#32)', () => {
    // Locks in ancestor-required tracking: ElementId nested under the
    // optional `startInstructions[]` parent must NOT be required.
    expect(requiredSemanticTypesOf('createProcessInstance')).toEqual([
      'ProcessDefinitionId',
      'ProcessDefinitionKey',
    ]);
  });

  it('createProcessInstance.startInstructions[].elementId is classified optional (#31)', () => {
    // Direct field-level lock-in: this is the leaf the original bug demoted.
    const op = findOperation('createProcessInstance');
    const node = op.requestBodySemanticTypes?.find(
      (e) => e.fieldPath === 'startInstructions[].elementId',
    );
    expect(
      node,
      'startInstructions[].elementId must be present in extracted semantics',
    ).toBeDefined();
    expect(node?.required).toBe(false);
  });

  it('createDeployment provides the full {ProcessDefinitionKey, ProcessDefinitionId, DecisionDefinitionKey, DecisionRequirementsKey, FormKey} provider set (#34)', () => {
    // Locks in `x-semantic-provider` array-form recognition: the response
    // payload uses array-form `x-semantic-provider` on `deployments[].*`,
    // and #34 made the inheritedProvider flag thread through the nested
    // object subtrees so every listed key is flagged provider:true.
    expect(providersOf('createDeployment')).toEqual([
      'DecisionDefinitionKey',
      'DecisionRequirementsKey',
      'FormKey',
      'ProcessDefinitionId',
      'ProcessDefinitionKey',
    ]);
  });
});

describe('bundled-spec invariants: planner output', () => {
  it('no scenario file references an operationId that is not in the dependency graph (stale-output guard)', () => {
    // Class-scoped guard against a stale `path-analyser/dist/output/`:
    // if a previous pipeline run left behind a `<verb>--<path>-scenarios.json`
    // for an operationId that the current spec no longer defines, downstream
    // invariants (notably the prereq guard above) silently break locally
    // while CI stays green (CI checks out a fresh tree). Asserting that
    // every emitted scenario file's `endpoint.operationId` exists in the
    // current graph forces `npm run testsuite:generate` to keep its output
    // directory in sync with the current spec.
    if (!existsSync(SCENARIOS_DIR)) {
      throw new Error(
        `Scenarios directory not found at ${SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
      );
    }
    loadGraph();
    const orphans: { file: string; operationId: string }[] = [];
    for (const f of readdirSync(SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const file = JSON.parse(readFileSync(join(SCENARIOS_DIR, f), 'utf8')) as ScenarioFile;
      const opId = file.endpoint?.operationId;
      if (opId && !cachedOperationById?.has(opId)) {
        orphans.push({ file: f, operationId: opId });
      }
    }
    expect(orphans).toEqual([]);
  });

  it('every createProcessInstance scenario starts with createDeployment as the first prerequisite (#32, #35)', () => {
    // Locks in #32 (PDK/PDI sourced from createDeployment) and #35
    // (no spurious intermediate steps): with prereq-checking and the
    // optional-leak fix, createDeployment must be the FIRST operation
    // in every non-trivial scenario.
    const scen = loadScenarioFile('post--process-instances-scenarios.json');
    expect(scen.scenarios.length).toBeGreaterThan(0);
    const offenders = scen.scenarios
      .map((s) => ({ id: s.id, ops: s.operations.map((o) => o.operationId) }))
      .filter((s) => s.ops[0] !== 'createDeployment');
    expect(offenders).toEqual([]);
  });

  it('no createProcessInstance BASE scenario calls searchElementInstances (#31)', () => {
    // The original symptom of #31: the planner inserted a search-step
    // chain because ElementId was wrongly required. Ancestor-required
    // tracking removed that branch from BASE scenarios. Variant
    // scenarios (#37) explicitly DO call searchElementInstances when
    // populating optional sub-shapes — they live in dist/variant-output/
    // and are exempt from this invariant.
    const scen = loadScenarioFile('post--process-instances-scenarios.json');
    const offenders = scen.scenarios
      .map((s) => ({ id: s.id, ops: s.operations.map((o) => o.operationId) }))
      .filter((s) => s.ops.includes('searchElementInstances'));
    expect(offenders).toEqual([]);
  });

  it('every endpoint whose only required semantic has a self-sufficient authoritative producer plans at least one chain (#95)', () => {
    // Class-scoped guard against the #95 defect family: the witness
    // implication in graphLoader must not turn an authoritative producer
    // candidate into a dead end by laundering an incidental response
    // semantic into a phantom domain-state production claim. The
    // observable symptom of #95 was `getDocument` (single required
    // semantic `DocumentId`, two authoritative producers `createDocument`
    // / `createDocuments` with no further required inputs) emitting
    // `scenarios: []` — every BFS candidate dropped at the prereq gate.
    //
    // Scope: endpoints with exactly one required semantic type T, where
    // at least one authoritative producer of T has no required inputs
    // of its own (i.e. is self-sufficient). Endpoints whose authoritative
    // producers have unmet upstream requirements are out of scope here
    // — those are separate planner gaps tracked elsewhere.
    if (!existsSync(SCENARIOS_DIR)) {
      throw new Error(
        `Scenarios directory not found at ${SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
      );
    }
    loadGraph();
    // Build authoritative producers and their required-input counts.
    const authoritativeProducers = new Map<string, OperationNode[]>();
    const requiredInputCount = new Map<string, number>();
    for (const op of cachedGraph?.operations ?? []) {
      let required = 0;
      for (const e of op.requestBodySemanticTypes ?? []) {
        if (e.required) required++;
      }
      for (const p of op.parameters ?? []) {
        if (p.required && p.semanticType) required++;
      }
      requiredInputCount.set(op.operationId, required);
      // Restrict to 2xx/3xx success responses: an authoritative provider
      // annotation on a 4xx/5xx error response does not represent a
      // producer the planner can rely on, and treating it as one would
      // make this invariant overstrict.
      for (const [statusCode, entries] of Object.entries(op.responseSemanticTypes ?? {})) {
        const code = Number.parseInt(statusCode, 10);
        if (!Number.isFinite(code) || code < 200 || code >= 400) continue;
        for (const e of entries) {
          if (!e.provider) continue;
          const list = authoritativeProducers.get(e.semanticType) ?? [];
          list.push(op);
          authoritativeProducers.set(e.semanticType, list);
        }
      }
    }
    const offenders: { file: string; endpoint: string; required: string[] }[] = [];
    for (const f of readdirSync(SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const file = JSON.parse(readFileSync(join(SCENARIOS_DIR, f), 'utf8')) as ScenarioFile;
      const required = file.requiredSemanticTypes ?? [];
      if (required.length !== 1) continue;
      const t = required[0];
      const producers = authoritativeProducers.get(t) ?? [];
      const endpointId = file.endpoint?.operationId;
      const externalSelfSufficient = producers.filter(
        (p) => p.operationId !== endpointId && (requiredInputCount.get(p.operationId) ?? 0) === 0,
      );
      if (externalSelfSufficient.length === 0) continue;
      // A planned chain means at least one scenario that is neither the
      // sentinel "unsatisfied" entry nor flagged with missingSemanticTypes.
      // `scenarios.length > 0` alone is insufficient: the planner emits a
      // single sentinel scenario when nothing satisfies the requirements,
      // which would otherwise mask the regression this invariant guards.
      const realScenarios = (file.scenarios ?? []).filter(
        (s) =>
          s.id !== 'unsatisfied' &&
          (!s.missingSemanticTypes || s.missingSemanticTypes.length === 0),
      );
      if (file.unsatisfied === true || realScenarios.length === 0) {
        offenders.push({ file: f, endpoint: endpointId, required });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('getDocument emits at least one non-trivial integration-path scenario (#95 reproducer)', () => {
    // Concrete instance the class-scoped invariant above subsumes. Kept
    // as a focused reproducer so a regression points at the exact symptom
    // (getDocument planning an empty scenario set because createDocument
    // was laundered into producersByState[ProcessInstanceExists]) rather
    // than at the abstract invariant.
    //
    // #97 update: dropping the permissive `produces` fallback in
    // graphLoader means `createDocument` no longer appears in
    // `producersByType[DocumentId]` until the upstream OpenAPI spec
    // annotates `createDocument`'s `documentId` response field with
    // `x-semantic-provider: true` (tracked in camunda/camunda#52169).
    // Until that lands and the spec pin is bumped, this assertion is
    // self-healing: it accepts either the original positive state
    // (chain is planned) OR the documented current state (createDocument
    // is not yet a canonical producer of DocumentId). When upstream
    // lands, the second branch becomes false, the first branch must
    // hold, and any future regression to "no chain planned" still
    // fails the test loudly.
    const REPO_ROOT = join(import.meta.dirname, '..', '..');
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const rawGraph = JSON.parse(
      readFileSync(
        join(
          REPO_ROOT,
          'semantic-graph-extractor',
          'dist',
          'output',
          'operation-dependency-graph.json',
        ),
        'utf8',
      ),
    ) as {
      operations: Array<{
        operationId: string;
        responseSemanticTypes?: Record<
          string,
          Array<{ semanticType?: unknown; provider?: unknown }>
        >;
      }>;
    };
    const createDocument = rawGraph.operations.find((o) => o.operationId === 'createDocument');
    expect(createDocument, 'createDocument operation must exist in raw graph').toBeDefined();
    const createDocumentProvidesDocumentId = Object.values(
      createDocument?.responseSemanticTypes ?? {},
    ).some(
      (arr) =>
        Array.isArray(arr) &&
        arr.some((e) => e?.semanticType === 'DocumentId' && e?.provider === true),
    );

    const scen = loadScenarioFile('get--documents--{documentId}-scenarios.json');

    if (!createDocumentProvidesDocumentId) {
      // Documented current-state branch: while upstream is missing the
      // annotation, getDocument's only producer chain is structurally
      // unreachable and the planner emits the sentinel `unsatisfied`
      // scenario. Assert that exact shape so a regression away from it
      // (e.g. silent re-introduction of the fallback) trips this guard.
      expect(scen.scenarios.length).toBeGreaterThan(0);
      const onlySentinel = scen.scenarios.every(
        (s) =>
          s.id === 'unsatisfied' || (s.missingSemanticTypes && s.missingSemanticTypes.length > 0),
      );
      expect(
        onlySentinel,
        'expected only an unsatisfied/missing-semantics scenario while createDocument lacks provider:true on documentId (camunda/camunda#52169)',
      ).toBe(true);
      return;
    }

    // Upstream-annotated branch: original positive assertion.
    expect(scen.scenarios.length).toBeGreaterThan(0);
    const matchingScenario = scen.scenarios.find((scenario) => {
      const chain = scenario.operations.map((o) => o.operationId);
      return chain.includes('createDocument') && chain[chain.length - 1] === 'getDocument';
    });
    expect(matchingScenario).toBeDefined();
  });

  it('evaluateDecision is reachable via [createDeployment, evaluateDecision] once DecisionDefinitionId is annotated (camunda/camunda#52271)', () => {
    // Self-healing guard for the array + allOf + nullable + provider-array
    // inheritance combination — the most structurally complex shape any
    // `x-semantic-provider` annotation in the upstream spec exercises.
    //
    // `createDeployment`'s 200 response is:
    //   DeploymentResponse
    //     .deployments[]                                  (array)
    //       .decisionDefinition                           (nullable: true)
    //         allOf:
    //           - $ref: DeploymentDecisionResult
    //             x-semantic-provider:
    //               - decisionDefinitionId  <-- promoted by camunda/camunda#52271
    //               - decisionRequirementsId
    //               - decisionDefinitionKey  (already present pre-#52271)
    //               - decisionRequirementsKey
    //               - name
    //               - version
    //
    // For the planner to discover `[createDeployment, evaluateDecision]`,
    // the extractor's response walker must descend through (a) array
    // `items`, (b) `allOf` wrappers, (c) propagate the parent object's
    // `x-semantic-provider: [...]` array down to each named child via
    // `inheritedProvider` — and emit `provider: true` on the resulting
    // leaf. None of those branches are exercised by the simpler
    // `getDocument` reproducer above (`DocumentReference` is a flat
    // object directly under the response).
    //
    // Self-healing pattern (mirrors the #95 reproducer): assert the
    // upstream-annotated branch only when the canonical signal is
    // present on `createDeployment`'s response. While upstream is
    // unannotated, assert the documented current state instead so a
    // regression away from it (e.g. the dropped fallback re-introduced)
    // still trips this guard. When camunda/camunda#52271 lands and the
    // spec pin is bumped, the second branch becomes false, the first
    // branch must hold, and any future regression to "no chain planned"
    // fails the test loudly.
    const REPO_ROOT = join(import.meta.dirname, '..', '..');
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const rawGraph = JSON.parse(
      readFileSync(
        join(
          REPO_ROOT,
          'semantic-graph-extractor',
          'dist',
          'output',
          'operation-dependency-graph.json',
        ),
        'utf8',
      ),
    ) as {
      operations: Array<{
        operationId: string;
        responseSemanticTypes?: Record<
          string,
          Array<{ semanticType?: unknown; provider?: unknown; fieldPath?: unknown }>
        >;
      }>;
    };
    const createDeployment = rawGraph.operations.find((o) => o.operationId === 'createDeployment');
    expect(createDeployment, 'createDeployment operation must exist in raw graph').toBeDefined();
    const createDeploymentProvidesDecisionDefinitionId = Object.values(
      createDeployment?.responseSemanticTypes ?? {},
    ).some(
      (arr) =>
        Array.isArray(arr) &&
        arr.some((e) => e?.semanticType === 'DecisionDefinitionId' && e?.provider === true),
    );

    const scen = loadScenarioFile('post--decision-definitions--evaluation-scenarios.json');

    if (!createDeploymentProvidesDecisionDefinitionId) {
      // Documented current-state branch: while upstream is missing the
      // annotation, evaluateDecision's only producer chain is structurally
      // unreachable and the planner emits the sentinel `unsatisfied`
      // scenario. Assert that exact shape so a regression away from it
      // (e.g. silent re-introduction of the fallback, or accidental
      // demotion of the response walker) trips this guard.
      expect(scen.scenarios.length).toBeGreaterThan(0);
      const onlySentinel = scen.scenarios.every(
        (s) =>
          s.id === 'unsatisfied' || (s.missingSemanticTypes && s.missingSemanticTypes.length > 0),
      );
      expect(
        onlySentinel,
        'expected only an unsatisfied/missing-semantics scenario while createDeployment lacks provider:true on decisionDefinitionId (camunda/camunda#52271)',
      ).toBe(true);
      return;
    }

    // Upstream-annotated branch: positive assertion. Once #52271 lands
    // and the spec pin is bumped, this is the durable regression guard
    // against the array + allOf + nullable + inheritance combination
    // breaking in the response walker.
    expect(scen.scenarios.length).toBeGreaterThan(0);
    const matchingScenario = scen.scenarios.find((scenario) => {
      const chain = scenario.operations.map((o) => o.operationId);
      return chain.includes('createDeployment') && chain[chain.length - 1] === 'evaluateDecision';
    });
    expect(
      matchingScenario,
      'expected a chain ending in evaluateDecision that includes createDeployment as a producer of DecisionDefinitionId',
    ).toBeDefined();
  });

  it('every step in every scenario has its required semantic inputs produced by an earlier step (#35)', () => {
    // Class-scoped guard against the #35 defect family: BFS must not
    // insert any operation whose `requires.required` is not satisfied
    // by either a seeded binding (none here) or an earlier step's
    // `produces`. A violation means a generated test would render with
    // a literal `${...}` placeholder URL at runtime.
    if (!existsSync(SCENARIOS_DIR)) {
      throw new Error(
        `Scenarios directory not found at ${SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
      );
    }
    const offenders: {
      file: string;
      scenario: string;
      step: string;
      missing: string[];
    }[] = [];
    for (const f of readdirSync(SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const file = JSON.parse(readFileSync(join(SCENARIOS_DIR, f), 'utf8')) as ScenarioFile;
      for (const sc of file.scenarios) {
        if (sc.id === 'unsatisfied') continue; // explicitly flagged unreachable
        const produced = new Set<string>();
        for (const ref of sc.operations) {
          // Let findOperation throw if the scenario references an
          // operationId not in the dependency graph: that would be a
          // pipeline/graph mismatch and a silent skip could hide a
          // real prereq violation.
          const opNode = findOperation(ref.operationId);
          const req = (opNode.requestBodySemanticTypes ?? [])
            .filter((e) => e.required)
            .map((e) => e.semanticType);
          for (const p of opNode.parameters ?? []) {
            if (p.required && p.semanticType) req.push(p.semanticType);
          }
          const missing = req.filter((s) => !produced.has(s));
          if (missing.length) {
            offenders.push({
              file: f,
              scenario: sc.id,
              step: ref.operationId,
              missing,
            });
          }
          for (const [statusCode, entries] of Object.entries(opNode.responseSemanticTypes ?? {})) {
            // Mirror semantic-graph-extractor/graph-builder.ts
            // getProducedSemanticTypes(): only count semantics from
            // success/redirect responses, otherwise an error-only
            // semantic could spuriously satisfy a downstream prereq.
            if (!statusCode.startsWith('2') && !statusCode.startsWith('3')) continue;
            for (const e of entries) produced.add(e.semanticType);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('authoritative semantic producers gated on satisfiable domain prerequisites emit ≥1 satisfied scenario (#58)', () => {
    // Class-scoped regression guard for #58 (BFS deadlock when an
    // authoritative semantic producer carries an unsatisfied
    // `domainRequiresAll` whose missing states have known domain
    // producers).
    //
    // Before the fix, the BFS semantic-target branch would silently
    // `continue` on such producers because the domain-progression
    // branch only fires when no required-semantic remains, and the
    // semantic branch had no deferral path. Result: every endpoint
    // that ultimately needs that producer (e.g. JobAvailableForActivation
    // → activateJobs → jobKey → completeJob/failJob) emitted 0
    // scenarios.
    //
    // The pinned reproducers below cover three distinct chain depths:
    //   - activateJobs       (1 hop:  createDeployment → createProcessInstance → activateJobs)
    //   - completeJob        (2 hops: …→ activateJobs → completeJob)
    //   - failJob            (2 hops: …→ activateJobs → failJob)
    //
    // The abstract class invariant ("BFS must defer rather than drop a
    // domain-prereq-blocked authoritative producer when a domain
    // producer for the missing state exists") is enforced at fixture
    // level by Fixture G in tests/fixtures/planner/planner-contracts.test.ts;
    // this L3 guard pins the real-world surfacings.
    const reproducers: { file: string; opId: string }[] = [
      { file: 'post--jobs--activation-scenarios.json', opId: 'activateJobs' },
      {
        file: 'post--jobs--{jobKey}--completion-scenarios.json',
        opId: 'completeJob',
      },
      {
        file: 'post--jobs--{jobKey}--failure-scenarios.json',
        opId: 'failJob',
      },
    ];
    const offenders: { opId: string; scenarios: number; unsatisfied: boolean }[] = [];
    for (const { file, opId } of reproducers) {
      const scen = loadScenarioFile(file);
      if (scen.endpoint.operationId !== opId) {
        throw new Error(
          `Pinned reproducer file ${file} no longer maps to operationId ${opId} (got ${scen.endpoint.operationId}). Update the pin.`,
        );
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const raw = JSON.parse(readFileSync(join(SCENARIOS_DIR, file), 'utf8')) as {
        unsatisfied?: boolean;
        scenarios: unknown[];
      };
      if (!scen.scenarios.length || raw.unsatisfied === true) {
        offenders.push({
          opId,
          scenarios: scen.scenarios.length,
          unsatisfied: raw.unsatisfied === true,
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every feature-output scenario binds or chains every {placeholder} whose path parameter has a recognised semanticType', () => {
    // Class-scoped guard for the "un-extracted ${var} in URL" defect family:
    // when an endpoint's response analyser produces no shape (typically for
    // 204 No-Content operations like cancelProcessInstance, completeJob,
    // resolveIncident, deleteRole, deleteUser, …), the feature-coverage
    // pipeline previously skipped the chain-graft + requestPlan step, leaving
    // a single-step scenario for an endpoint with required path parameters.
    // The emitter then rendered URLs like `/process-instances/${processInstanceKey}/cancellation`
    // — the literal placeholder, never substituted at runtime.
    //
    // Scope: only path placeholders whose parameter on the dependency graph
    // carries a `semanticType`. That excludes:
    //   - Bug B (admin-entity IDs lacking upstream `x-semantic-type` —
    //     roles/groups/mapping-rules/global cluster variables/resources):
    //     the parameter has no `semanticType`, so no producer is recognised.
    //   - The Bug A class itself is operations whose placeholders DO have
    //     recognised semantic types but whose chain was previously dropped.
    // Bug B will land its own invariant once we add the upstream x-semantic-type
    // tags (or the local domain-semantics fallback). Bug C (BFS empty-chain
    // for semanticised endpoints) is already separately surfaced by other
    // planner invariants and will get its own named guard with its fix.
    //
    // Invariant: for every feature-output scenario, every `{x}` in the
    // endpoint path whose parameter has a `semanticType` set must be either
    // (a) bound via `scenario.bindings.xVar`, or (b) covered by at least
    // one earlier step in `scenario.operations[]`.
    if (!existsSync(FEATURE_SCENARIOS_DIR)) {
      throw new Error(
        `Feature-output directory not found at ${FEATURE_SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
      );
    }
    if (!existsSync(SCENARIOS_DIR)) {
      throw new Error(
        `Planner scenarios directory not found at ${SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
      );
    }
    const graph = loadGraph();
    const opByKey = new Map<string, OperationNode>();
    for (const op of graph.operations) {
      opByKey.set(`${op.method.toUpperCase()} ${op.path}`, op);
    }
    interface FeatureScenarioFile {
      endpoint: { operationId: string; method: string; path: string };
      scenarios: {
        id: string;
        operations: { operationId: string }[];
        bindings?: Record<string, unknown>;
        requestPlan?: {
          operationId: string;
          extract?: { fieldPath: string; bind: string; semantic?: string }[];
        }[];
      }[];
    }
    interface PlannerScenarioFile {
      scenarios: { missingSemanticTypes?: string[] }[];
    }
    const offenders: {
      file: string;
      scenario: string;
      placeholders: string[];
    }[] = [];
    for (const f of readdirSync(FEATURE_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      const plannerPath = join(SCENARIOS_DIR, f);
      // The pipeline emits one planner-scenarios file per feature-scenarios
      // file (same normalised filename). A missing companion is a pipeline
      // bug — fail fast rather than silently skip and mask it.
      if (!existsSync(plannerPath)) {
        throw new Error(
          `Missing planner scenario file for feature scenario ${relative(
            REPO_ROOT,
            join(FEATURE_SCENARIOS_DIR, f),
          )}; expected ${relative(REPO_ROOT, plannerPath)}`,
        );
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const planner = JSON.parse(readFileSync(plannerPath, 'utf8')) as PlannerScenarioFile;
      // Out-of-scope: Bug C class — BFS could not produce a fully-satisfied
      // chain for this endpoint (every scenario has unmet semantic
      // prerequisites, e.g. ResourceKey has no producer). The BFS may still
      // emit a single "unsatisfied" scenario, so we filter on satisfaction
      // rather than non-emptiness. Tracked separately; will get its own
      // named guard with its fix.
      const hasSatisfiedChain = (planner.scenarios ?? []).some(
        (s) => !s.missingSemanticTypes || s.missingSemanticTypes.length === 0,
      );
      if (!hasSatisfiedChain) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const file = JSON.parse(
        readFileSync(join(FEATURE_SCENARIOS_DIR, f), 'utf8'),
      ) as FeatureScenarioFile;
      const placeholders = [...file.endpoint.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      if (placeholders.length === 0) continue;
      const endpointKey = `${file.endpoint.method.toUpperCase()} ${file.endpoint.path}`;
      const node = opByKey.get(endpointKey);
      // A missing dependency-graph node for an endpoint that has a
      // feature-output file is a graph/feature-output mismatch (or an
      // endpoint-keying bug) — fail fast rather than silently skip.
      if (!node) {
        throw new Error(
          `Missing dependency-graph node for endpoint ${endpointKey} referenced by feature scenario ${f}. This indicates a graph/feature-output mismatch or endpoint-keying bug.`,
        );
      }
      // Out-of-scope: Bug B (placeholder parameter lacks `semanticType`,
      // i.e. upstream `x-semantic-type` is missing). Tracked separately;
      // will get its own named guard with its fix.
      const parameters = node.parameters ?? [];
      const pathParameters = parameters.filter((p) => p.location === 'path');
      // If the path has placeholders but the graph node has no path
      // parameters at all, that is a graph/extractor bug — fail fast.
      if (pathParameters.length === 0) {
        throw new Error(
          `Dependency-graph node for endpoint ${endpointKey} referenced by feature scenario ${f} has path placeholders (${placeholders.join(', ')}) but no path parameters on the node. This indicates a graph extraction or endpoint-keying bug.`,
        );
      }
      const inScope = placeholders.filter((ph) => {
        const param = parameters.find((p) => p.name === ph && p.location === 'path');
        return Boolean(param?.semanticType);
      });
      if (inScope.length === 0) continue;
      for (const sc of file.scenarios) {
        const bindings = sc.bindings ?? {};
        // Mirror the Playwright emitter's URL templating, which references
        // `ctx.<camelCase(placeholder)>Var` (see
        // path-analyser/src/codegen/playwright/emitter.ts buildUrlExpression).
        // Lowering only the first char keeps existing lowerCamelCase
        // placeholders untouched while normalising any future PascalCase
        // ones, so the invariant cannot false-fail on casing alone.
        const placeholderVarName = (ph: string) => `${ph.charAt(0).toLowerCase()}${ph.slice(1)}Var`;
        // Collect every variable name that an earlier step in the request
        // plan actually `extract`s. Mere presence of a multi-step chain is
        // not sufficient — the chain must produce the binding the URL
        // template needs, otherwise `${...Var}` would still leak into the
        // emitted URL at runtime.
        const lastOpId = sc.operations[sc.operations.length - 1]?.operationId;
        const producedByEarlierStep = new Set<string>();
        for (const step of sc.requestPlan ?? []) {
          if (step.operationId === lastOpId) break;
          for (const e of step.extract ?? []) producedByEarlierStep.add(e.bind);
        }
        // Mirror the emitter's substitution semantics: `buildUrlExpression`
        // uses `ctx.<var>Var || '${placeholder}'`, so a binding that is
        // falsy (`null`, `''`, `0`, `false`) or the `__PENDING__` sentinel
        // (which the emitter only seeds for body/multipart template vars,
        // not URL placeholders) would still leak `${...Var}` into the URL
        // at runtime. Treat such bindings as unsatisfied.
        const isUsableBinding = (v: unknown) =>
          v !== undefined &&
          v !== null &&
          v !== '' &&
          v !== '__PENDING__' &&
          v !== 0 &&
          v !== false;
        const unsatisfied = inScope.filter((ph) => {
          const varName = placeholderVarName(ph);
          if (isUsableBinding(bindings[varName])) return false;
          if (producedByEarlierStep.has(varName)) return false;
          return true;
        });
        if (unsatisfied.length) {
          offenders.push({
            file: f,
            scenario: sc.id,
            placeholders: unsatisfied,
          });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every feature scenario whose placeholder has a known semanticType but no satisfied chain traces to a missing upstream x-semantic-provider annotation (#54)', () => {
    // Issue #54 — strict complement of the #52 invariant inside the
    // `semanticType`-known subset. An offender is a feature scenario whose
    // endpoint path has `{placeholders}` whose path parameter has a
    // recognised `semanticType` AND no planner scenario assembled a
    // fully-satisfied chain. The #52 invariant (above) silently filters
    // these out via `if (!hasSatisfiedChain) continue;`; this invariant
    // re-surfaces them and asserts they all share the same root cause.
    //
    // Diagnosis on the pinned bundled spec (2b2b962a…): all 21 offenders
    // bottom out in the upstream-spec gap tracked at camunda/camunda#52169
    // — the placeholder's `semanticType`, or a type transitively required
    // to satisfy any authoritative producer of it, has zero
    // `x-semantic-provider: true` producers in the bundled spec. List
    // endpoints (searchUserTasks, searchIncidents, searchAuditLogs,
    // searchVariables, searchDecisionInstances, searchGlobalTaskListeners)
    // emit the entity keys with `provider: false`; in this graph shape
    // that leaves the planner with no authoritative upstream producer to
    // graft for the affected chain. The same gap also blocks two
    // endpoints whose direct producer DOES exist
    // (DecisionEvaluationInstanceKey/Key via evaluateDecision) because
    // evaluateDecision itself transitively requires DecisionDefinitionId,
    // which has zero authoritative producers.
    //
    // Self-healing semantics: when upstream lands an
    // `x-semantic-provider: true` annotation that breaks the chain open
    // for one of these endpoints, that endpoint drops out of the offender
    // list; the assertion still passes because every remaining offender
    // continues to satisfy the structural-cause check. If the planner
    // regresses such that an endpoint with a satisfiable chain ends up
    // here, the structural-cause check fails and this test fails loudly.
    //
    // Out of scope:
    //  - #52 (planner dropped chains for endpoints that DID have
    //    authoritative producers — fixed and guarded by the invariant
    //    above).
    //  - #53 (placeholder parameter lacks an upstream `semanticType` tag
    //    altogether) — filtered out by the `param?.semanticType` gate.
    if (!existsSync(FEATURE_SCENARIOS_DIR)) {
      throw new Error(
        `Feature-output directory not found at ${FEATURE_SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
      );
    }
    if (!existsSync(SCENARIOS_DIR)) {
      throw new Error(
        `Planner scenarios directory not found at ${SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
      );
    }
    const graph = loadGraph();
    const opByEndpointKey = new Map<string, OperationNode>();
    const opByOperationId = new Map<string, OperationNode>();
    for (const op of graph.operations) {
      opByEndpointKey.set(`${op.method.toUpperCase()} ${op.path}`, op);
      opByOperationId.set(op.operationId, op);
    }
    // Authoritative producers per semantic type (provider:true only).
    // Intentionally stricter than `producersByType`: `graphLoader.normalizeOp`
    // currently falls back to treating every response semantic as a
    // producer when an op has no provider flags at all (graphLoader.ts
    // ~lines 372-381; tracked for removal in #97). The #54 diagnosis is
    // about authoritative producers, not the fallback set, so we re-derive
    // the strict authoritative-only relation here and avoid coupling the
    // invariant to internal planner state.
    const authoritativeProducersOf = new Map<string, string[]>();
    for (const op of graph.operations) {
      const surfaced = new Set<string>();
      for (const entries of Object.values(op.responseSemanticTypes ?? {})) {
        for (const e of entries) {
          if (e.provider === true && !surfaced.has(e.semanticType)) {
            surfaced.add(e.semanticType);
            const list = authoritativeProducersOf.get(e.semanticType) ?? [];
            list.push(op.operationId);
            authoritativeProducersOf.set(e.semanticType, list);
          }
        }
      }
    }
    // Required semantic-type inputs of an op (request body + every
    // required parameter that carries a `semanticType`, regardless of
    // location). Mirrors `extractRequires` in graphLoader.ts, which also
    // does not filter parameters by `path`/`query`/`header`/`cookie` — a
    // semanticType-tagged required header (rare in this spec, but
    // possible) would gate chain assembly the same way as a path
    // parameter, so the reachability model must include it.
    const requiredInputsOf = (opId: string): string[] => {
      const op = opByOperationId.get(opId);
      if (!op) return [];
      const set = new Set<string>();
      for (const e of op.requestBodySemanticTypes ?? []) {
        if (e.required) set.add(e.semanticType);
      }
      for (const p of op.parameters ?? []) {
        if (p.required && p.semanticType) set.add(p.semanticType);
      }
      return [...set];
    };
    // Transitively-unauthoritative: a semantic type T such that every
    // path to producing T bottoms out in a type with zero authoritative
    // producers. Computed as a least fixpoint: T is unauthoritative if it
    // has no authoritative producer, or every authoritative producer
    // requires (transitively) at least one unauthoritative type. The
    // dual — `authoritativeReachable` — is what the BFS would converge
    // on if we ran it; we compute its complement on the same edges.
    const authoritativelyReachable = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const [semType, producers] of authoritativeProducersOf) {
        if (authoritativelyReachable.has(semType)) continue;
        const reachable = producers.some((opId) =>
          requiredInputsOf(opId).every((req) => authoritativelyReachable.has(req)),
        );
        if (reachable) {
          authoritativelyReachable.add(semType);
          changed = true;
        }
      }
    }
    interface FeatureScenarioFile {
      endpoint: { method: string; path: string };
      scenarios: { id: string }[];
    }
    interface PlannerScenarioFile {
      scenarios: { missingSemanticTypes?: string[] }[];
    }
    interface OffenderRecord {
      file: string;
      endpoint: string;
      placeholderSemanticTypes: string[];
    }
    const offenders: OffenderRecord[] = [];
    const structuralOk: OffenderRecord[] = [];
    const structuralViolations: OffenderRecord[] = [];
    for (const f of readdirSync(FEATURE_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      const plannerPath = join(SCENARIOS_DIR, f);
      // The pipeline emits one planner-scenarios file per feature-scenarios
      // file (same normalised filename). A missing companion is a pipeline
      // bug — fail fast rather than silently skip and mask it.
      if (!existsSync(plannerPath)) {
        throw new Error(
          `Missing planner scenario file for feature scenario ${relative(
            REPO_ROOT,
            join(FEATURE_SCENARIOS_DIR, f),
          )}; expected ${relative(REPO_ROOT, plannerPath)}`,
        );
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const planner = JSON.parse(readFileSync(plannerPath, 'utf8')) as PlannerScenarioFile;
      const hasSatisfiedChain = (planner.scenarios ?? []).some(
        (s) => !s.missingSemanticTypes || s.missingSemanticTypes.length === 0,
      );
      if (hasSatisfiedChain) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const file = JSON.parse(
        readFileSync(join(FEATURE_SCENARIOS_DIR, f), 'utf8'),
      ) as FeatureScenarioFile;
      const placeholders = [...file.endpoint.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      if (!placeholders.length) continue;
      const endpointKey = `${file.endpoint.method.toUpperCase()} ${file.endpoint.path}`;
      const node = opByEndpointKey.get(endpointKey);
      // A missing dependency-graph node for an endpoint that has a
      // feature-output file is a graph/feature-output mismatch (or an
      // endpoint-keying bug) — fail fast rather than silently skip.
      if (!node) {
        throw new Error(
          `Missing dependency-graph node for endpoint ${endpointKey} referenced by feature scenario ${f}. This indicates a graph/feature-output mismatch or endpoint-keying bug.`,
        );
      }
      const pathParameters = (node.parameters ?? []).filter((p) => p.location === 'path');
      // If the path has placeholders but the graph node has no path
      // parameters at all, that is a graph/extractor bug — fail fast.
      if (pathParameters.length === 0) {
        throw new Error(
          `Dependency-graph node for endpoint ${endpointKey} referenced by feature scenario ${f} has path placeholders (${placeholders.join(', ')}) but no path parameters on the node. This indicates a graph extraction or endpoint-keying bug.`,
        );
      }
      // A placeholder must have a matching `path` parameter entry on the
      // graph node — otherwise the URL template references a name the
      // graph never declared, which is also a graph/extractor bug.
      const placeholdersMissingParam = placeholders.filter(
        (ph) => !pathParameters.some((p) => p.name === ph),
      );
      if (placeholdersMissingParam.length) {
        throw new Error(
          `Dependency-graph node for endpoint ${endpointKey} referenced by feature scenario ${f} is missing path parameter entries for placeholders: ${placeholdersMissingParam.join(', ')}. This indicates a graph extraction or endpoint-keying bug.`,
        );
      }
      const inScopeTypes = placeholders
        .map((ph) => {
          const param = pathParameters.find((p) => p.name === ph);
          return param?.semanticType;
        })
        .filter((st): st is string => Boolean(st));
      if (!inScopeTypes.length) continue;
      const record: OffenderRecord = {
        file: f,
        endpoint: endpointKey,
        placeholderSemanticTypes: [...new Set(inScopeTypes)],
      };
      offenders.push(record);
      // Structural-cause check: at least one placeholder type must be
      // unreachable via authoritative producers (i.e. NOT in
      // `authoritativelyReachable`). If every placeholder type IS
      // reachable, the planner has unjustified residual logic and the
      // test fails loudly — that is the regression we want to catch.
      const allReachable = record.placeholderSemanticTypes.every((st) =>
        authoritativelyReachable.has(st),
      );
      if (allReachable) structuralViolations.push(record);
      else structuralOk.push(record);
    }
    // Documented current-state sanity: the bucket is non-empty (the
    // upstream gap is unresolved) but every offender's structural cause
    // checks out. Both halves are necessary — an empty bucket would mean
    // the upstream gap closed and this guard should be retired in favour
    // of the strict empty-set assertion (see #54 acceptance criteria);
    // a non-empty `structuralViolations` means the planner is dropping
    // chains for endpoints that should have been planned.
    expect(
      structuralViolations,
      '#54 offenders that DO have authoritatively-reachable placeholder semantic types — the planner should have planned these chains. Investigate the BFS rather than upstream.',
    ).toEqual([]);
    // Self-healing upper bound: if every offender drops out (upstream
    // closed the gap), the bucket is empty and the test still passes
    // — at which point the structural-cause infrastructure becomes
    // redundant and the test should be replaced with `expect(offenders)
    // .toEqual([])` (the strict form from #54).
    if (offenders.length === 0) {
      // Nothing to assert; documented as a TODO via comment above.
      return;
    }
    // Otherwise, every offender must be in the structural-OK bucket.
    expect(offenders.length).toBe(structuralOk.length);
  });

  it('no planner result has zero scenarios while reporting unsatisfied=false', () => {
    // Planner-correctness guard. The BFS in `generateScenariosForEndpoint`
    // exits the search loop after exhausting its queue and unconditionally
    // returns `unsatisfied: false` regardless of whether any scenario was
    // actually completed. When an endpoint's required semantic type has
    // producers, but every producer either self-cycles (e.g. `getUserTask`
    // requires UserTaskKey to produce UserTaskKey) or its own prerequisites
    // are unreachable, the BFS exhausts the queue with zero completed
    // chains and the result is `{ scenarios: [], unsatisfied: false }`.
    //
    // Concrete example (current bundled spec):
    //   POST /user-tasks/{userTaskKey}/assignment  requires UserTaskKey
    //   producersByType[UserTaskKey] = [getUserTask, getAuditLog]
    //   - getUserTask requires UserTaskKey itself (self-cycle)
    //   - getAuditLog requires AuditLogKey, whose only producer also
    //     self-cycles
    //   Planner output: { scenarios: [], unsatisfied: false }
    //   Generated test: POST `${baseUrl}/user-tasks/${ctx.userTaskKeyVar
    //                          || '${userTaskKey}'}/assignment`
    //   → URL leaks `${userTaskKey}` literal at runtime.
    //
    // This is structurally the same broken-URL shape covered by the
    // unbindable-placeholder cases (45 endpoints blocked on upstream #53),
    // but the cause is internal to the planner: a producer exists, the BFS
    // just cannot use it. The result is silent — `unsatisfied: false` is
    // the strongest possible "this endpoint is fine" signal in the planner
    // output, and downstream code (orchestrator logs, the codegen, every
    // Layer-3 invariant) trusts it.
    //
    // Invariant: for every planner result, if `scenarios.length === 0` then
    // `unsatisfied` must be `true`. The planner is allowed to give up; it
    // is not allowed to give up silently.
    if (!existsSync(SCENARIOS_DIR)) {
      throw new Error(
        `Planner scenarios directory not found at ${SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
      );
    }
    interface PlannerResultFile {
      endpoint: { method: string; path: string; operationId: string };
      requiredSemanticTypes?: string[];
      scenarios: unknown[];
      unsatisfied?: boolean;
    }
    const offenders: { op: string; endpoint: string; required: string[] }[] = [];
    for (const f of readdirSync(SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const planner = JSON.parse(readFileSync(join(SCENARIOS_DIR, f), 'utf8')) as PlannerResultFile;
      if (!Array.isArray(planner.scenarios) || planner.scenarios.length > 0) continue;
      if (planner.unsatisfied === true) continue;
      offenders.push({
        op: planner.endpoint.operationId,
        endpoint: `${planner.endpoint.method.toUpperCase()} ${planner.endpoint.path}`,
        required: planner.requiredSemanticTypes ?? [],
      });
    }
    expect(
      offenders,
      'Planner returned an empty scenarios array while reporting unsatisfied=false. The BFS exhausted its queue without completing any chain (typically because every producer for the required semantic type self-cycles or has unreachable prereqs). The planner must mark these as unsatisfied — silent zero-scenario results break every downstream consumer that trusts unsatisfied=false.',
    ).toEqual([]);
  });

  it('every feature scenario chain contains an authoritative producer for each requiredSemanticType', () => {
    // Chain-selector correctness guard. The feature-output stage in
    // `path-analyser/src/index.ts` chooses one integration scenario from
    // the planner output to graft as the dependency chain in front of
    // every feature scenario. The current selector picks the
    // shortest non-`unsatisfied` chain with >1 operations and falls back
    // to `scenarios[0]` — with no check that the producers in that chain
    // are *authoritative* for the endpoint's required semantic types.
    //
    // Concrete example (current bundled spec):
    //   POST /process-instances/{processInstanceKey}/cancellation
    //     requiredSemanticTypes: [ProcessInstanceKey]
    //   planner offers:
    //     scenario-1: createDocument -> cancelProcessInstance      (length 2)
    //     scenario-4: createDeployment -> createProcessInstance
    //                 -> cancelProcessInstance                     (length 3)
    //   selector picks scenario-1 because it is shorter.
    //   But createDocument is NOT an authoritative producer for
    //   ProcessInstanceKey: its 201 response carries
    //   `metadata.processInstanceKey` with `provider: false` — it merely
    //   echoes whatever metadata the request supplied. The "extracted"
    //   key is empty at runtime and the URL renders with a literal
    //   `${processInstanceKey}` placeholder.
    //
    // The planner's `producersByType` index is intentionally permissive
    // (it includes echo fields so domain-progression and witness lenses
    // stay connected — see graphLoader.ts #95). The chain selector is
    // the right place to prefer authoritative providers, because it
    // chooses which single chain becomes the test prefix.
    //
    // Invariant: for every feature scenario whose endpoint has a
    // non-empty `requiredSemanticTypes`, every chain operation set must
    // contain at least one operation whose response declares that
    // semantic type with `provider: true`. If no authoritative producer
    // for a required type exists *anywhere* in the graph, the type is
    // exempt — that is an upstream-spec gap, not a selector bug.
    if (!existsSync(FEATURE_SCENARIOS_DIR)) {
      throw new Error(
        `Feature-output directory not found at ${FEATURE_SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
      );
    }
    const graph = loadGraph();
    const authoritativeProducers = new Map<string, Set<string>>();
    for (const op of graph.operations) {
      for (const [status, arr] of Object.entries(op.responseSemanticTypes ?? {})) {
        if (!/^2\d\d$/.test(status)) continue;
        for (const entry of arr) {
          if (entry.provider !== true) continue;
          let bucket = authoritativeProducers.get(entry.semanticType);
          if (!bucket) {
            bucket = new Set();
            authoritativeProducers.set(entry.semanticType, bucket);
          }
          bucket.add(op.operationId);
        }
      }
    }

    interface FeatureScenarioFile {
      endpoint: { method: string; path: string; operationId: string };
      requiredSemanticTypes?: string[];
      unsatisfied?: boolean;
      scenarios: { id: string; operations: { operationId: string }[] }[];
    }
    const offenders: {
      op: string;
      scenarioId: string;
      chain: string[];
      missingAuthoritative: { type: string; authoritativeProducers: string[] }[];
    }[] = [];
    for (const f of readdirSync(FEATURE_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const feat = JSON.parse(
        readFileSync(join(FEATURE_SCENARIOS_DIR, f), 'utf8'),
      ) as FeatureScenarioFile;
      if (feat.unsatisfied === true) continue;
      const required = feat.requiredSemanticTypes ?? [];
      if (!required.length) continue;
      for (const sc of feat.scenarios ?? []) {
        const chainOps = (sc.operations ?? []).map((o) => o.operationId);
        // Endpoint-self does not count: an op cannot bind its own URL
        // placeholder from its own response. Restrict the search to
        // prerequisite steps (everything except the final endpoint op).
        const prereqOps = chainOps.slice(0, -1);
        if (prereqOps.length === 0) continue;
        const missing: { type: string; authoritativeProducers: string[] }[] = [];
        for (const t of required) {
          const auth = authoritativeProducers.get(t);
          if (!auth || auth.size === 0) continue; // upstream-spec gap, exempt
          if (!prereqOps.some((opId) => auth.has(opId))) {
            missing.push({ type: t, authoritativeProducers: [...auth].sort() });
          }
        }
        if (missing.length) {
          offenders.push({
            op: feat.endpoint.operationId,
            scenarioId: sc.id,
            chain: chainOps,
            missingAuthoritative: missing,
          });
        }
      }
    }
    expect(
      offenders,
      'Feature-output chain selector grafted a prerequisite chain whose producers are not authoritative for the endpoint\'s required semantic type. The selected chain extracts the type from an "echo" response field (e.g. createDocument\'s `metadata.processInstanceKey` with provider:false) instead of from a real producer (createProcessInstance with provider:true). At runtime the extracted variable is empty and the URL placeholder leaks. Prefer chains containing at least one `provider:true` producer per required type before falling back to the shortest chain.',
    ).toEqual([]);
  });
});

describe('bundled-spec invariants: planner variant output (#37)', () => {
  function loadVariantFile(filename: string): VariantScenarioFile {
    const p = join(VARIANT_SCENARIOS_DIR, filename);
    if (!existsSync(p)) {
      throw new Error(
        `Variant scenario file not found at ${p}. Run 'npm run testsuite:generate' first.`,
      );
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    return JSON.parse(readFileSync(p, 'utf8')) as VariantScenarioFile;
  }

  it('createProcessInstance has a variant populating startInstructions[].elementId with the canonical chain (#37)', () => {
    // Acceptance criteria from #37:
    //  - At least one scenario populates startInstructions[].elementId
    //  - Chain has a warm-up createProcessInstance before the final one
    //  - Chain has searchElementInstances between warm-up and final
    //  - Scenario marked eventuallyConsistent: true
    const file = loadVariantFile('post--process-instances-scenarios.json');
    const startInstrVariants = file.scenarios.filter(
      (s) => s.populatesSubShape?.rootPath === 'startInstructions[]',
    );
    expect(startInstrVariants.length).toBeGreaterThan(0);

    const canonical = startInstrVariants.find((s) => {
      const ops = s.operations.map((o) => o.operationId);
      const cpiCount = ops.filter((o) => o === 'createProcessInstance').length;
      const seiIdx = ops.indexOf('searchElementInstances');
      const lastCpiIdx = ops.lastIndexOf('createProcessInstance');
      const firstCpiIdx = ops.indexOf('createProcessInstance');
      return (
        cpiCount >= 2 &&
        seiIdx > -1 &&
        seiIdx > firstCpiIdx &&
        seiIdx < lastCpiIdx &&
        s.hasEventuallyConsistent === true
      );
    });
    expect(canonical).toBeDefined();
  });

  it('every step in every variant scenario has its required semantic inputs satisfied (#37)', () => {
    // Mirror of the base-scenario prereq invariant, scoped to variant
    // scenarios. The variant family lifts the OUT-as-producer guard, so
    // we want explicit confirmation that the warm-up endpoint truly
    // produces the semantics the search-step then consumes.
    if (!existsSync(VARIANT_SCENARIOS_DIR)) return; // no variants generated yet
    const offenders: { file: string; scenario: string; step: string; missing: string[] }[] = [];
    for (const f of readdirSync(VARIANT_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const file = JSON.parse(
        readFileSync(join(VARIANT_SCENARIOS_DIR, f), 'utf8'),
      ) as VariantScenarioFile;
      for (const sc of file.scenarios) {
        const produced = new Set<string>();
        for (const ref of sc.operations) {
          const opNode = findOperation(ref.operationId);
          const req = (opNode.requestBodySemanticTypes ?? [])
            .filter((e) => e.required)
            .map((e) => e.semanticType);
          for (const p of opNode.parameters ?? []) {
            if (p.required && p.semanticType) req.push(p.semanticType);
          }
          const missing = req.filter((s) => !produced.has(s));
          if (missing.length) {
            offenders.push({ file: f, scenario: sc.id, step: ref.operationId, missing });
          }
          for (const [statusCode, entries] of Object.entries(opNode.responseSemanticTypes ?? {})) {
            if (!statusCode.startsWith('2') && !statusCode.startsWith('3')) continue;
            for (const e of entries) produced.add(e.semanticType);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('bundled-spec invariants: emitted Playwright suite', () => {
  it('no generated test contains a stray __invalidEnum sentinel object (#39)', () => {
    // Layer-3 mirror of the targeted enum-violation test in
    // tests/request-validation/. Catches any future analyser that
    // re-introduces the same sentinel-leak pattern.
    if (!existsSync(GENERATED_TESTS_DIR)) {
      throw new Error(
        `Generated tests directory not found at ${GENERATED_TESTS_DIR}. Run 'npm run testsuite:generate' (or 'npm run pipeline') first.`,
      );
    }
    const offenders: string[] = [];
    for (const f of readdirSync(GENERATED_TESTS_DIR)) {
      if (!f.endsWith('.spec.ts')) continue;
      const src = readFileSync(join(GENERATED_TESTS_DIR, f), 'utf8');
      if (src.includes('__invalidEnum')) {
        offenders.push(relative(REPO_ROOT, join(GENERATED_TESTS_DIR, f)));
      }
    }
    expect(offenders).toEqual([]);
  });
});
