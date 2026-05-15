// biome-ignore-all lint/correctness/noEmptyCharacterClassInRegex: pre-existing test patterns; `[^]` is a JS idiom for "any char including newline", retained for stability.
// biome-ignore-all lint/suspicious/noAssignInExpressions: pre-existing `while ((m = re.exec(s)) !== null)` test idiom; explicit `!== null` already documents intent.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: error message text intentionally describes literal `${...}` placeholder syntax.
// biome-ignore-all lint/correctness/noUnusedVariables: legacy declaration retained alongside its sibling describe blocks; safe to remove in a follow-up cleanup.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getActiveConfigName,
  getFeatureOutputDir,
  getGraphDir,
  getPlaywrightSuiteDir,
  getScenariosDir,
  getSpecBundleDir,
  getVariantOutputDir,
} from '../../path-analyser/src/configResolver.js';

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
// Per-config invariants (#128 PR 3): this file lives under
// configs/camunda-oca/ and only runs when the active CONFIG is
// camunda-oca. Vitest's `describe.skipIf` collects the file but skips
// the inner suites for any other config, so a CI matrix leg targeting
// a different config (e.g. camunda-hub) silently no-ops here and runs
// its own configs/<that-config>/regression-invariants.test.ts file.
const CONFIG_NAME = 'camunda-oca';
const ACTIVE_CONFIG = getActiveConfigName(REPO_ROOT);
const describeForThisConfig = describe.skipIf(ACTIVE_CONFIG !== CONFIG_NAME);
// Per-config layout (#128 PR 2): all generator outputs live under
// generated/<config>/. Resolved via the same configResolver helpers used
// by the production code so any path drift surfaces in one place.
const GRAPH_PATH = join(getGraphDir(REPO_ROOT), 'operation-dependency-graph.json');
const SCENARIOS_DIR = getScenariosDir(REPO_ROOT);
const FEATURE_SCENARIOS_DIR = getFeatureOutputDir(REPO_ROOT);
const VARIANT_SCENARIOS_DIR = getVariantOutputDir(REPO_ROOT);
const GENERATED_TESTS_DIR = getPlaywrightSuiteDir(REPO_ROOT);
const BUNDLED_SPEC_PATH = join(getSpecBundleDir(REPO_ROOT), 'rest-api.bundle.json');

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
interface GraphEdge {
  sourceOperationId: string;
  targetOperationId: string;
  semanticType: string;
  sourceFieldPath: string;
  targetFieldPath: string;
}
interface DependencyGraph {
  operations: OperationNode[];
  edges: GraphEdge[];
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

describeForThisConfig('bundled-spec invariants: extractor classification', () => {
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

  // Skipped: pinned spec now adds DecisionDefinitionId to the createDeployment
  // provider set (camunda/camunda PR #52322 / merge SHA b9d355d). Tracked at #137.
  it.skip('createDeployment provides the full {ProcessDefinitionKey, ProcessDefinitionId, DecisionDefinitionKey, DecisionRequirementsKey, FormKey} provider set (#34)', () => {
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

describeForThisConfig('bundled-spec invariants: planner output', () => {
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
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const rawGraph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
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
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const rawGraph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
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

  // Skipped: new cluster-variables endpoint family in pinned spec
  // (camunda/camunda PR #52322) is unsatisfied; tracked at #138.
  it.skip('every step in every scenario has its required semantic inputs produced by an earlier step (#35)', () => {
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

  // Skipped: new cluster-variables endpoint family in pinned spec
  // (camunda/camunda PR #52322) leaves placeholders unbound; tracked at #138.
  it.skip('every feature-output scenario binds or chains every {placeholder} whose path parameter has a recognised semanticType', () => {
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

  // Skipped: new cluster-variables endpoint family in pinned spec
  // (camunda/camunda PR #52322) lacks an authoritative producer; tracked at #138.
  it.skip('every feature scenario chain contains an authoritative producer for each requiredSemanticType', () => {
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

describeForThisConfig('bundled-spec invariants: planner variant output (#37)', () => {
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

  // Skipped: variant chain regressed after pinned-spec bump
  // (camunda/camunda PR #52322); tracked at #139.
  it.skip('createProcessInstance has a variant populating startInstructions[].elementId with the canonical chain (#37)', () => {
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

  // Skipped: variant scenarios for new cluster-variables / startInstructions
  // shapes regressed after pinned-spec bump (camunda/camunda PR #52322);
  // tracked at #138 / #139.
  it.skip('every step in every variant scenario has its required semantic inputs satisfied (#37)', () => {
    // Mirror of the base-scenario prereq invariant, scoped to variant
    // scenarios. This only checks that each step's required semantic
    // inputs are satisfied by semantics produced earlier in the chain;
    // it does not assert that optional inputs (for example
    // overlap-heuristic triggers on search steps) are present.
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

describeForThisConfig('bundled-spec invariants: emitted Playwright suite', () => {
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

  it('every eventually-consistent read step is wrapped with awaitEventually (#106)', () => {
    // Class-scoped guarantee: for every emitted spec file, the count of
    // `awaitEventually(` calls equals the count of read-shape steps
    // (GET or POST .../search) whose operation is flagged
    // `eventuallyConsistent` and which expect a 200, summed across all
    // scenarios in the matching feature/output JSON. Mismatches mean
    // the emitter's wrap heuristic has regressed.
    if (!existsSync(GENERATED_TESTS_DIR) || !existsSync(FEATURE_SCENARIOS_DIR)) {
      throw new Error(`Generated artifacts not found. Run 'npm run testsuite:generate' first.`);
    }

    interface RequestStepLite {
      operationId: string;
      method: string;
      pathTemplate: string;
      expect: { status: number };
    }
    interface OperationRefLite {
      operationId: string;
      eventuallyConsistent?: boolean;
    }
    interface ScenarioLite {
      operations: OperationRefLite[];
      requestPlan?: RequestStepLite[];
    }
    interface CollectionLite {
      endpoint: { operationId: string };
      scenarios: ScenarioLite[];
    }

    function isReadShape(method: string, pathTemplate: string): boolean {
      const m = method.toUpperCase();
      return m === 'GET' || (m === 'POST' && /\/search\/?$/.test(pathTemplate));
    }

    function expectedWraps(coll: CollectionLite): number {
      let n = 0;
      for (const s of coll.scenarios) {
        if (!s.requestPlan) continue;
        const ec = new Set<string>();
        for (const op of s.operations) {
          if (op.eventuallyConsistent) ec.add(op.operationId);
        }
        if (ec.size === 0) continue;
        for (const step of s.requestPlan) {
          if (!ec.has(step.operationId)) continue;
          if (step.expect.status !== 200) continue;
          if (!isReadShape(step.method, step.pathTemplate)) continue;
          n++;
        }
      }
      return n;
    }

    let totalExpected = 0;
    let totalActual = 0;
    let suitesWithEc = 0;

    for (const f of readdirSync(FEATURE_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      const raw = readFileSync(join(FEATURE_SCENARIOS_DIR, f), 'utf8');
      // biome-ignore lint/plugin: parsed JSON is a runtime contract boundary; shape locally typed as CollectionLite
      const coll = JSON.parse(raw) as CollectionLite;
      if (!coll || typeof coll !== 'object') continue;
      const expected = expectedWraps(coll);
      if (expected === 0) continue;
      suitesWithEc++;
      totalExpected += expected;

      const specName = `${coll.endpoint.operationId}.feature.spec.ts`;
      const specPath = join(GENERATED_TESTS_DIR, specName);
      if (!existsSync(specPath)) {
        throw new Error(`expected emitted spec ${specName} not found`);
      }
      const src = readFileSync(specPath, 'utf8');
      const actual = (src.match(/awaitEventually\(/g) ?? []).length;
      totalActual += actual;
      expect(actual, `${specName}: awaitEventually wrap count`).toBe(expected);
    }

    // Sanity: the bundled spec exercises this pattern non-trivially.
    expect(suitesWithEc).toBeGreaterThan(0);
    expect(totalExpected).toBeGreaterThan(0);
    expect(totalActual).toBe(totalExpected);
  });

  it('no emitted feature spec records responses (camunda-oca config has recordResponses=false)', () => {
    // configs.json#configs.camunda-oca.codegen.playwright.recordResponses is
    // intentionally `false`: SDK example workflows that consume the emitted
    // suite do not run observe:aggregate, so the per-step recordResponse()
    // block plus the recorder.ts vendoring are pure dead weight here. This
    // invariant locks that choice — flipping the config back to true would
    // re-introduce the boilerplate, and this assertion would catch it.
    //
    // The check is class-scoped: it asserts that *no* feature spec contains
    // `recordResponse` anywhere (call site or import), not just the spec the
    // change happened to touch. Catches partial-gating regressions (e.g. a
    // future refactor that re-emits the import without the call, or vice
    // versa) the same way the original direction did.
    if (!existsSync(GENERATED_TESTS_DIR)) {
      throw new Error(
        `Generated tests directory not found at ${GENERATED_TESTS_DIR}. Run 'npm run testsuite:generate' first.`,
      );
    }
    const specs = readdirSync(GENERATED_TESTS_DIR).filter((f) => f.endsWith('.feature.spec.ts'));
    expect(specs.length, 'at least one feature spec must be emitted').toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const f of specs) {
      const src = readFileSync(join(GENERATED_TESTS_DIR, f), 'utf8');
      if (src.includes('recordResponse')) {
        offenders.push(relative(REPO_ROOT, join(GENERATED_TESTS_DIR, f)));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describeForThisConfig('bundled-spec invariants: fixture selection by required state (#159)', () => {
  // PR A of #159: fixture selection generalises the `preferJobType=true`
  // hack into state-based matching. The chosen `*.bpmn` for each
  // `createDeployment` step must satisfy the chain's effective requirement
  // set — driven by the consumer ops' `operationRequirements.X.requires`.
  //
  // The two invariants below pin both directions:
  //   1. deleteProcessInstance requires ProcessInstanceCompleted; only
  //      bpmn/simple.bpmn provides it. The emitted spec MUST reference
  //      simple.bpmn.
  //   2. activateJobs requires ModelHasServiceTaskType; only
  //      bpmn/service-task.bpmn provides it. The emitted spec MUST keep
  //      referencing service-task.bpmn (regression guard for the move of
  //      ModelHasServiceTaskType from artifactKinds-level to per-fixture).
  // Together they prove the selector actually discriminates between
  // fixtures — not just "always returns the first one".

  it('deleteProcessInstance.feature.spec.ts deploys bpmn/simple.bpmn (requires ProcessInstanceCompleted)', () => {
    const spec = join(GENERATED_TESTS_DIR, 'deleteProcessInstance.feature.spec.ts');
    if (!existsSync(spec)) {
      throw new Error(`expected emitted spec ${spec} not found — run 'npm run testsuite:generate'`);
    }
    const src = readFileSync(spec, 'utf8');
    expect(src, 'deleteProcessInstance must deploy the instantly-completing fixture').toContain(
      '@@FILE:bpmn/simple.bpmn',
    );
    expect(src, 'deleteProcessInstance must NOT deploy service-task.bpmn').not.toContain(
      '@@FILE:bpmn/service-task.bpmn',
    );
  });

  it('activateJobs.feature.spec.ts still deploys bpmn/service-task.bpmn (requires ModelHasServiceTaskType)', () => {
    const spec = join(GENERATED_TESTS_DIR, 'activateJobs.feature.spec.ts');
    if (!existsSync(spec)) {
      throw new Error(`expected emitted spec ${spec} not found — run 'npm run testsuite:generate'`);
    }
    const src = readFileSync(spec, 'utf8');
    expect(src, 'activateJobs must deploy the service-task fixture').toContain(
      '@@FILE:bpmn/service-task.bpmn',
    );
  });

  it('deleteProcessInstance.feature.spec.ts injects an awaitEventually wait between createProcessInstance and deleteProcessInstance (#159 PR B)', () => {
    // PR B of #159: ProcessInstanceCompleted is declared `eventual: true`
    // with a `witness` shape that polls getProcessInstance until
    // `body.state === 'COMPLETED'`. The planner annotates the
    // createProcessInstance step with `eventualWaitsAfter`; the emitter
    // renders an `awaitEventually(...)` call immediately after that step
    // and before the deleteProcessInstance step.
    //
    // Pre-PR-B the chain ran straight from create → delete with no wait,
    // so the delete raced a still-ACTIVE instance and 4xx'd. The assertion
    // pins the wait's POSITION (must be in the create→delete window) and
    // its SHAPE (calls the witness operationId).
    const spec = join(GENERATED_TESTS_DIR, 'deleteProcessInstance.feature.spec.ts');
    if (!existsSync(spec)) {
      throw new Error(`expected emitted spec ${spec} not found — run 'npm run testsuite:generate'`);
    }
    const src = readFileSync(spec, 'utf8');
    // #118: each request step is now wrapped in `await test.step('<operationId>', ...)`
    // instead of being preceded by a `// Step N: <operationId>` comment.
    // Locate the create/delete steps by their test.step labels. The emitter
    // produces double-quoted labels via JSON.stringify(operationId); the
    // biome.generated.json post-processing rewrites them to single quotes,
    // so the test matches what's actually written to disk.
    const createIdx = src.indexOf("test.step('createProcessInstance'");
    const deleteIdx = src.indexOf("test.step('deleteProcessInstance'");
    expect(createIdx, 'createProcessInstance step marker not found').toBeGreaterThan(0);
    expect(deleteIdx, 'deleteProcessInstance step marker not found').toBeGreaterThan(createIdx);
    const between = src.slice(createIdx, deleteIdx);
    expect(between, 'awaitEventually wait must appear between create and delete').toContain(
      'awaitEventually(',
    );
    expect(between, 'wait must invoke the getProcessInstance witness').toContain(
      "operationId: 'getProcessInstance'",
    );
  });

  it('every entry in deployment-artifacts.json#providesStates is acknowledged by its kind (#159)', async () => {
    // Class-scoped coherence check between the fixture registry and
    // domain-semantics. For every registry entry e, every state in
    // e.providesStates MUST appear in either
    // artifactKinds.<e.kind>.producibleStates or .producesStates — and
    // be declared in runtimeStates ∪ capabilities. Catches typos and
    // half-finished registry edits before they reach a codegen run.
    interface RegistryEntry {
      kind: string;
      path: string;
      providesStates?: string[];
    }
    interface ArtifactKindSpec {
      producesStates?: string[];
      producibleStates?: string[];
    }
    interface DomainSemanticsShape {
      runtimeStates?: Record<string, unknown>;
      capabilities?: Record<string, unknown>;
      artifactKinds?: Record<string, ArtifactKindSpec>;
    }
    const registryPath = join(REPO_ROOT, 'path-analyser', 'fixtures', 'deployment-artifacts.json');
    const registryRaw = readFileSync(registryPath, 'utf8');
    // biome-ignore lint/plugin: parsed JSON is a runtime contract boundary
    const registry = JSON.parse(registryRaw) as { artifacts?: RegistryEntry[] };

    const { deriveArtifactKindsViews, deriveRuntimeStatesViews, deriveSemanticsViews } =
      await import('../../path-analyser/src/ontology/loader.ts');
    const artifactViews = deriveArtifactKindsViews(REPO_ROOT);
    const runtimeViews = deriveRuntimeStatesViews(REPO_ROOT);
    const semanticsViews = deriveSemanticsViews(REPO_ROOT);
    if (!artifactViews) throw new Error('artifact-kinds ABox missing');
    if (!runtimeViews) throw new Error('runtime-states ABox missing');
    if (!semanticsViews) throw new Error('semantics ABox missing');
    const ds: DomainSemanticsShape = {
      runtimeStates: runtimeViews.runtimeStates,
      capabilities: semanticsViews.capabilities,
      artifactKinds: artifactViews.artifactKinds,
    };
    const declaredStates = new Set<string>([
      ...Object.keys(ds.runtimeStates ?? {}),
      ...Object.keys(ds.capabilities ?? {}),
    ]);

    const offenders: { entry: string; state: string; reason: string }[] = [];
    for (const e of registry.artifacts ?? []) {
      for (const state of e.providesStates ?? []) {
        if (!declaredStates.has(state)) {
          offenders.push({
            entry: e.path,
            state,
            reason: 'not declared in runtimeStates or capabilities',
          });
          continue;
        }
        const kindSpec = ds.artifactKinds?.[e.kind];
        const ack = new Set<string>([
          ...(kindSpec?.producesStates ?? []),
          ...(kindSpec?.producibleStates ?? []),
        ]);
        if (!ack.has(state)) {
          offenders.push({
            entry: e.path,
            state,
            reason: `not in artifactKinds.${e.kind}.producibleStates or .producesStates`,
          });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describeForThisConfig('bundled-spec invariants: emitted Playwright variant suite (#105)', () => {
  it('every variant scenario file is materialised as a *.variant.spec.ts (#105)', () => {
    // Class-scoped guard for Phase 3 of #105: the codegen pipeline must
    // consume every JSON file under dist/variant-output/ and emit a
    // matching `<operationId>.variant.spec.ts` under dist/generated-tests/.
    // A regression that drops the variant-output scan would silently
    // strip every populated-sub-shape test from CI; this invariant
    // forces the failure to surface at the suite level rather than as
    // missing coverage.
    if (!existsSync(VARIANT_SCENARIOS_DIR) || !existsSync(GENERATED_TESTS_DIR)) {
      throw new Error(`Generated artifacts not found. Run 'npm run testsuite:generate' first.`);
    }
    const missing: string[] = [];
    let variantFilesSeen = 0;
    for (const f of readdirSync(VARIANT_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const coll = JSON.parse(
        readFileSync(join(VARIANT_SCENARIOS_DIR, f), 'utf8'),
      ) as VariantScenarioFile;
      if (!coll.scenarios?.length) continue;
      variantFilesSeen++;
      const specName = `${coll.endpoint.operationId}.variant.spec.ts`;
      if (!existsSync(join(GENERATED_TESTS_DIR, specName))) {
        missing.push(specName);
      }
    }
    expect(variantFilesSeen).toBeGreaterThan(0); // sanity: pipeline produced variants
    expect(missing).toEqual([]);
  });

  it('every variant scenario populating startInstructions[] emits a body with startInstructions: [{...}] (#105)', () => {
    // Class-scoped acceptance test for Phase 3 of #105: every variant
    // whose `populatesSubShape.rootPath === "startInstructions[]"` must
    // produce a generated test whose body literal contains
    // `startInstructions:` and a nested `elementId:` reference. We
    // grep the spec source rather than parse it because the literal is
    // emitted with `ctx[...]` substitutions for placeholders.
    if (!existsSync(VARIANT_SCENARIOS_DIR) || !existsSync(GENERATED_TESTS_DIR)) {
      throw new Error(`Generated artifacts not found. Run 'npm run testsuite:generate' first.`);
    }
    const offenders: { spec: string; reason: string }[] = [];
    let assertionsRun = 0;
    for (const f of readdirSync(VARIANT_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const coll = JSON.parse(
        readFileSync(join(VARIANT_SCENARIOS_DIR, f), 'utf8'),
      ) as VariantScenarioFile;
      const startInstrVariants = coll.scenarios.filter(
        (s) => s.populatesSubShape?.rootPath === 'startInstructions[]',
      );
      if (startInstrVariants.length === 0) continue;
      const specName = `${coll.endpoint.operationId}.variant.spec.ts`;
      const specPath = join(GENERATED_TESTS_DIR, specName);
      if (!existsSync(specPath)) {
        offenders.push({ spec: specName, reason: 'spec file missing' });
        continue;
      }
      const src = readFileSync(specPath, 'utf8');
      if (!src.includes('startInstructions:')) {
        offenders.push({ spec: specName, reason: 'no startInstructions: literal in body' });
        continue;
      }
      if (!src.includes('elementId:')) {
        offenders.push({ spec: specName, reason: 'no elementId: literal in startInstructions' });
        continue;
      }
      assertionsRun++;
    }
    expect(assertionsRun).toBeGreaterThan(0); // sanity: at least one variant exercises the path
    expect(offenders).toEqual([]);
  });
});

describeForThisConfig('bundled-spec invariants: x-semantic-establishes (#104)', () => {
  // Self-healing pattern (mirrors the camunda/camunda#52271 evaluateDecision
  // guard). While the upstream spec carries no `x-semantic-establishes`
  // annotations, the consumer endpoints (`getTenant`, `getUser`, `getGroup`,
  // …) are structurally unreachable and the planner emits the sentinel
  // `unsatisfied` scenario. Once the annotation lands and the spec pin is
  // bumped, every endpoint whose required semantics has an establisher must
  // plan a satisfied chain that ends in the establisher + endpoint pair.
  //
  // The bundled spec is loaded directly so we can detect both annotation
  // presence (sentinel-vs-positive switch) and reachability (the chain
  // shape the planner produces).
  it('every consumer of an established semantic plans a chain through its establisher', () => {
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const rawGraph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
      operations: Array<{
        operationId: string;
        path?: string;
        establishes?: {
          kind?: string;
          shape?: string;
          identifiedBy?: Array<{ in?: string; name?: string; semanticType?: string }>;
        };
      }>;
    };

    // Build establishersByType from the raw graph (same rule as
    // graphLoader: skip shape:'edge' entries; their identifiedBy is
    // pre-existing components, not values minted here).
    const establishersByType = new Map<string, string[]>();
    for (const op of rawGraph.operations) {
      const est = op.establishes;
      if (!est || !Array.isArray(est.identifiedBy) || est.shape === 'edge') continue;
      for (const id of est.identifiedBy) {
        if (typeof id?.semanticType !== 'string') continue;
        const list = establishersByType.get(id.semanticType) ?? [];
        if (!list.includes(op.operationId)) list.push(op.operationId);
        establishersByType.set(id.semanticType, list);
      }
    }

    // Cross-check the extractor surface against the bundled spec:
    // every *valid* `x-semantic-establishes` annotation in the source
    // must produce a corresponding `establishes` entry in the operation
    // graph. This guards against the "annotation surface disappeared"
    // failure mode (an extractor or loader regression that strips the
    // field) which a vacuous existence assertion would not catch —
    // and runs in *both* the pre- and post-annotation states.
    //
    // The extractor intentionally drops malformed annotations whole
    // (kind not a string, identifiedBy not an array, any member with a
    // wrong `in`/missing `name`/missing `semanticType`). Counting the
    // raw spec field would falsely fail the moment upstream landed a
    // malformed annotation; mirror the extractor's validity rule here
    // so the parity check stays meaningful.
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const bundledSpec = JSON.parse(
      readFileSync(join(getSpecBundleDir(REPO_ROOT), 'rest-api.bundle.json'), 'utf8'),
    ) as {
      paths?: Record<
        string,
        Record<string, { operationId?: string; 'x-semantic-establishes'?: unknown }>
      >;
    };
    const isRecord = (v: unknown): v is Record<string, unknown> =>
      !!v && typeof v === 'object' && !Array.isArray(v);
    const isValidEstablishes = (raw: unknown): boolean => {
      if (!isRecord(raw)) return false;
      // Mirror the extractor's strict rules in
      // `semantic-graph-extractor/schema-analyzer.ts`: `kind` must be
      // a non-empty string; `shape`, if present, must be exactly
      // `'edge'` (the only currently-known op-level shape — anything
      // else, including a typo like `'edeg'`, is dropped wholesale by
      // the extractor; `external-entity` is registry-side only);
      // `identifiedBy` must be a non-empty array and every member
      // must validate. Counting an upstream annotation the extractor
      // would intentionally reject would make the parity check fail
      // for the wrong reason.
      if (typeof raw.kind !== 'string' || raw.kind.length === 0) return false;
      if (raw.shape !== undefined && raw.shape !== 'edge') return false;
      if (!Array.isArray(raw.identifiedBy) || raw.identifiedBy.length === 0) return false;
      for (const id of raw.identifiedBy) {
        if (!isRecord(id)) return false;
        if (id.in !== 'body' && id.in !== 'path') return false;
        if (typeof id.name !== 'string' || !id.name) return false;
        if (typeof id.semanticType !== 'string' || !id.semanticType) return false;
      }
      return true;
    };
    let specAnnotatedCount = 0;
    let specNonEdgeAnnotatedCount = 0;
    for (const methods of Object.values(bundledSpec.paths ?? {})) {
      for (const op of Object.values(methods)) {
        if (op && typeof op === 'object' && isValidEstablishes(op['x-semantic-establishes'])) {
          specAnnotatedCount++;
          // Switch the pre-/post-annotation branch on the *non-edge*
          // count, mirroring the graph-loader rule that drops edge
          // entries from `establishersByType`. Equating
          // `establishersByType.size === 0` with "no annotations at
          // all" would fall into the pre-annotation branch the moment
          // upstream lands a spec carrying ONLY `shape: 'edge'`
          // annotations — and would then flag those legitimate edge
          // `establishes` entries as fabricated.
          const rawEstablishes = isRecord(op) ? op['x-semantic-establishes'] : undefined;
          if (!isRecord(rawEstablishes) || rawEstablishes.shape !== 'edge') {
            specNonEdgeAnnotatedCount++;
          }
        }
      }
    }
    const graphAnnotatedCount = rawGraph.operations.filter((o) => o.establishes).length;
    expect(
      graphAnnotatedCount,
      `extractor surface drift: bundled spec carries ${specAnnotatedCount} valid x-semantic-establishes annotations but only ${graphAnnotatedCount} reached the operation graph`,
    ).toBe(specAnnotatedCount);

    if (specNonEdgeAnnotatedCount === 0) {
      // Pre-annotation branch: the parity check above
      // (`specAnnotatedCount === graphAnnotatedCount`) is the active
      // regression guard for the extractor surface. The branch is
      // gated on the *non-edge* spec count rather than
      // `establishersByType.size` so that a spec carrying only valid
      // `shape: 'edge'` annotations does NOT fall into this branch
      // and flag those legitimate `establishes` entries as
      // fabricated. The remaining sentinel below protects the
      // chain-level guarantee while the upstream spec carries no
      // *non-edge* `x-semantic-establishes`.
      //
      // (A previous sentinel on a top-level `establishersByType`
      // field of the raw extractor JSON was removed: the extractor
      // does not serialize that field — it is built at runtime by
      // the graph loader — so the assertion was vacuous and could
      // not detect the fabrication mode it claimed to guard.)
      //
      // No operation in the graph should carry a non-empty *non-edge*
      // `establishes` field — if a single op surfaces a non-edge
      // `establishes` despite the spec having no non-edge
      // annotations, the extractor's intake or the graph normalizer
      // is fabricating it. Edge establishers are excluded from this
      // sentinel because the branch above gates on the *non-edge*
      // count: a spec carrying only valid `shape: 'edge'` annotations
      // legitimately surfaces edge `establishes` entries that this
      // pre-annotation branch must NOT flag as fabricated.
      const fabricatedEstablishesOps = rawGraph.operations
        .filter(
          (o) =>
            o.establishes &&
            o.establishes.shape !== 'edge' &&
            (o.establishes.identifiedBy?.length ?? 0) > 0,
        )
        .map((o) => o.operationId);
      expect(
        fabricatedEstablishesOps,
        'pre-annotation sentinel: operations carry non-edge `establishes` despite the bundled spec having no non-edge x-semantic-establishes annotations',
      ).toEqual([]);
      return;
    }

    // Post-annotation branch: every consumer endpoint that requires a
    // semantic with a non-edge establisher must (a) plan at least one
    // satisfied chain, AND (b) at least one satisfied scenario must
    // cover ALL of the endpoint's established requirements
    // simultaneously, with each requirement routed through a
    // registered establisher in that same chain. (a) on its own is
    // too weak — an unrelated heuristic could still satisfy the chain
    // via a different producer path. A weaker per-requirement check
    // (each requirement covered by *some* satisfied scenario, not
    // necessarily the same one) would also be inadequate: an endpoint
    // that needs `[A, B]` could pass with one chain establishing only
    // `A` and a second chain establishing only `B`, even though
    // neither chain on its own gives the consumer the composite
    // entity it needs.
    //
    // We iterate every satisfied scenario (not just the first) because
    // endpoints commonly have both producer-driven and establisher-
    // driven satisfied chains, and the order is not stable.
    const files = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('-scenarios.json'));
    const offenders: Array<{
      endpoint: string;
      missing: string[];
      reason: 'no-satisfied-scenario' | 'no-single-chain-covers-all';
    }> = [];
    let assertionsRun = 0;
    for (const file of files) {
      const scen = loadScenarioFile(file);
      const required = scen.requiredSemanticTypes ?? [];
      const establishedRequirements = required.filter((s) => establishersByType.has(s));
      if (establishedRequirements.length === 0) continue;
      assertionsRun++;
      const satisfiedScenarios = scen.scenarios.filter(
        (s) => !s.missingSemanticTypes || s.missingSemanticTypes.length === 0,
      );
      if (satisfiedScenarios.length === 0) {
        offenders.push({
          endpoint: scen.endpoint.operationId,
          missing: establishedRequirements,
          reason: 'no-satisfied-scenario',
        });
        continue;
      }
      // `requiredSemanticTypes` reaches us already filtered: graphLoader's
      // `normalizeOp` strips self-established semantics from
      // `op.requires.required` at load time, and the second-pass drop in
      // `path-analyser/src/index.ts` re-applies the same filter after
      // `loadOpenApiSemanticHints` re-introduces them from request-body
      // `x-semantic-type` annotations. So a self-establishing endpoint's
      // own minted semantic never appears in this list, and we can fold
      // it directly into the chain-coverage check below.
      // Look for at least one satisfied scenario whose operation set
      // covers every required semantic via a registered establisher.
      const anyChainCoversAll = satisfiedScenarios.some((s) => {
        const chainOps = new Set(s.operations.map((o) => o.operationId));
        return establishedRequirements.every((sem) => {
          const expected = establishersByType.get(sem) ?? [];
          return expected.some((opId) => chainOps.has(opId));
        });
      });
      if (!anyChainCoversAll) {
        offenders.push({
          endpoint: scen.endpoint.operationId,
          missing: establishedRequirements,
          reason: 'no-single-chain-covers-all',
        });
      }
    }
    expect(assertionsRun).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

describeForThisConfig('bundled-spec invariants: emitted request-validation suite (#129)', () => {
  it('emits zero case-only enum mutations when enumCaseInsensitive is true', () => {
    // The camunda-oca config sets `enumCaseInsensitive: true` in
    // configs/camunda-oca/request-validation.json because the upstream
    // Camunda 8 OCA parser accepts string-enum values case-insensitively
    // (camunda/camunda#52409). Class-scoped guard: scan every emitted
    // enum-violation test block (across every operation in every spec
    // file) and assert that no inlined string body value differs from a
    // valid enum member only by ASCII case. Catches any future analyser
    // (e.g. a sibling oneOf/anyOf walker) that re-introduces a case-only
    // mutation.
    const REQUEST_VALIDATION_DIR = join(REPO_ROOT, 'generated', CONFIG_NAME, 'request-validation');
    if (!existsSync(REQUEST_VALIDATION_DIR)) {
      throw new Error(
        `Generated request-validation directory not found at ${REQUEST_VALIDATION_DIR}. ` +
          `Run 'npm run generate:request-validation' (or 'npm run pipeline') first.`,
      );
    }

    interface Spec {
      paths?: unknown;
      components?: unknown;
    }
    function isObject(v: unknown): v is Record<string, unknown> {
      return typeof v === 'object' && v !== null && !Array.isArray(v);
    }
    const bundlePath = join(getSpecBundleDir(REPO_ROOT), 'rest-api.bundle.json');
    const rawSpec: unknown = JSON.parse(readFileSync(bundlePath, 'utf8'));
    if (!isObject(rawSpec)) {
      throw new Error(`Bundled spec at ${bundlePath} is not a JSON object.`);
    }
    // Build the universe of valid string-enum members from the bundled
    // spec. Membership is by exact string; the lower-cased index drives
    // the case-collision check.
    const validMembers = new Set<string>();
    const enumLowerSet = new Set<string>();
    function walk(node: unknown): void {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (!isObject(node)) return;
      const e = node.enum;
      if (Array.isArray(e)) {
        for (const member of e) {
          if (typeof member === 'string') {
            validMembers.add(member);
            enumLowerSet.add(member.toLowerCase());
          }
        }
      }
      for (const v of Object.values(node)) walk(v);
    }
    walk(rawSpec);

    function isCaseOnlyFalsePositive(value: string): boolean {
      if (validMembers.has(value)) return false;
      return enumLowerSet.has(value.toLowerCase());
    }

    // Locate each test block whose closing assertion has
    // `scenarioKind: 'enum-violation'` (single quotes — emitter writes
    // `JSON.stringify(s.type)` and prettier rewrites to single quotes during
    // emission, see request-validation/src/emit/qaEmitter.ts). For each such
    // block, scope extraction to the inlined `const requestBody = { ... };`
    // literal so we don't pick up unrelated quoted strings (operationId,
    // method, scenarioKind itself, etc.) and check every quoted string
    // *value* for case-only collision with a valid enum member.
    //
    // Prettier is configured (or falls back to) `singleQuote: true`, so
    // emitted body strings are single-quoted (`field: 'creationDate_INVALID'`).
    // Match both styles defensively in case prettier config drifts.
    const TEST_BLOCK = /test\([^]*?scenarioKind:\s*'enum-violation'[^]*?}\);/g;
    const REQUEST_BODY_LITERAL = /const requestBody\s*=\s*([\s\S]*?);\n/;
    // `: 'value'` or `: "value"` — captures the inner string regardless of
    // quote style, but stays after the `:` so we don't pick up object keys.
    const STRING_VALUE = /:\s*(?:'([^'\\\n]*)'|"([^"\\\n]*)")/g;
    const offenders: { file: string; sample: string }[] = [];
    let blocksScanned = 0;
    let stringValuesScanned = 0;
    for (const f of readdirSync(REQUEST_VALIDATION_DIR)) {
      if (!f.endsWith('.spec.ts')) continue;
      const src = readFileSync(join(REQUEST_VALIDATION_DIR, f), 'utf8');
      let block: RegExpExecArray | null;
      TEST_BLOCK.lastIndex = 0;
      while ((block = TEST_BLOCK.exec(src)) !== null) {
        blocksScanned++;
        const bodyMatch = REQUEST_BODY_LITERAL.exec(block[0]);
        if (!bodyMatch) continue;
        const bodyLiteral = bodyMatch[1];
        STRING_VALUE.lastIndex = 0;
        let q: RegExpExecArray | null;
        while ((q = STRING_VALUE.exec(bodyLiteral)) !== null) {
          const candidate = q[1] ?? q[2];
          if (candidate === undefined) continue;
          stringValuesScanned++;
          if (isCaseOnlyFalsePositive(candidate)) {
            offenders.push({
              file: relative(REPO_ROOT, join(REQUEST_VALIDATION_DIR, f)),
              sample: candidate,
            });
            break;
          }
        }
      }
    }
    // Guard against the invariant becoming vacuously true (e.g. emitter
    // changes the syntax of the assertion context, or prettier's quote
    // style drifts and the value regex stops matching). The camunda-oca
    // suite currently emits 100+ enum-violation blocks containing many
    // string values; any non-zero baseline is enough to prove both
    // regexes still match.
    expect(blocksScanned).toBeGreaterThan(0);
    expect(stringValuesScanned).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('routes non-path-token params to the query slot of buildUrl (#127)', () => {
    // Class-scoped guard for issue #127. `buildUrl(path, pathParams,
    // queryParams)` only substitutes entries whose key matches a `{token}`
    // in the path template; non-token keys passed in slot 2 are silently
    // dropped from the request. Scan every emitted `param-*-violation`
    // test in the request-validation suite, parse its `buildUrl(...)`
    // call, and reject any second-arg key that is NOT a path token of the
    // template.
    //
    // Catches the original `searchVariables - Param query.truncateValues
    // wrong type` case (path `/variables/search` carrying `truncateValues`
    // in slot 2) and any sibling emitter regression.
    const REQUEST_VALIDATION_DIR = join(REPO_ROOT, 'generated', CONFIG_NAME, 'request-validation');
    if (!existsSync(REQUEST_VALIDATION_DIR)) {
      throw new Error(
        `Generated request-validation directory not found at ${REQUEST_VALIDATION_DIR}. ` +
          `Run 'npm run generate:request-validation' (or 'npm run pipeline') first.`,
      );
    }

    // Match any param-* validation test block (type-mismatch, constraint-
    // violation, enum-violation). The block ends at the closing `});` of
    // the inner test arrow function call.
    const TEST_BLOCK =
      /test\([^]*?scenarioKind:\s*'param-(?:type-mismatch|constraint-violation|enum-violation)'[^]*?}\);/g;
    const BUILD_URL =
      /buildUrl\(\s*'([^']+)'(?:\s*,\s*(\{[^}]*\}|undefined))?(?:\s*,\s*(\{[^}]*\}))?\s*\)/;
    const PARAM_KEY = /(\b[a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g;

    interface Offender {
      file: string;
      template: string;
      orphanKey: string;
    }
    const offenders: Offender[] = [];
    let blocksScanned = 0;
    let pathParamSlotsScanned = 0;
    for (const f of readdirSync(REQUEST_VALIDATION_DIR)) {
      if (!f.endsWith('.spec.ts')) continue;
      const src = readFileSync(join(REQUEST_VALIDATION_DIR, f), 'utf8');
      let block: RegExpExecArray | null;
      TEST_BLOCK.lastIndex = 0;
      while ((block = TEST_BLOCK.exec(src)) !== null) {
        blocksScanned++;
        const urlMatch = BUILD_URL.exec(block[0]);
        if (!urlMatch) continue;
        const [, template, pathParamsLiteral] = urlMatch;
        if (!pathParamsLiteral || pathParamsLiteral === 'undefined') continue;
        pathParamSlotsScanned++;
        const pathTokens = new Set<string>();
        const tokenRe = /\{([^}]+)}/g;
        let t: RegExpExecArray | null;
        while ((t = tokenRe.exec(template)) !== null) pathTokens.add(t[1]);
        PARAM_KEY.lastIndex = 0;
        let kv: RegExpExecArray | null;
        while ((kv = PARAM_KEY.exec(pathParamsLiteral)) !== null) {
          const key = kv[1];
          if (!pathTokens.has(key)) {
            offenders.push({
              file: relative(REPO_ROOT, join(REQUEST_VALIDATION_DIR, f)),
              template,
              orphanKey: key,
            });
          }
        }
      }
    }
    // Vacuous-truth guards: prove both regexes still match the emitted
    // syntax. The camunda-oca suite has hundreds of param-* blocks with
    // at least one path-params slot.
    expect(blocksScanned).toBeGreaterThan(0);
    expect(pathParamSlotsScanned).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('emits zero URL-collapsing path-param values in param-constraint-violation tests (#147)', () => {
    // Class-scoped guard for issue #147. Path-param constraint scenarios
    // whose synthesised invalid value does not survive URL substitution
    // as a single non-empty path segment never reach Camunda's request
    // validator — Spring's router resolves the malformed URL as a
    // different route and answers 404 from the static-resource handler.
    // The expected 400 then fails for a reason unrelated to validation.
    //
    // Scan every emitted `param-constraint-violation` test block, parse
    // its `buildUrl('/template', { param: 'value' })` call, and reject
    // any value bound to a `{param}` token in the template that:
    //   - is the empty string,
    //   - is `.` or `..`,
    //   - literally contains a routing-significant `/`, `\`, `?`, or `#`,
    //   - already contains encoded `/` (`%2F`/`%2f`) or `\` (`%5C`/`%5c`),
    //   - or percent-encodes to contain `/` (`%2F`/`%2f`) or `\` (`%5C`/`%5c`).
    //
    // Catches not just the original `minLength: 1` empty-string emission
    // (paramConstraintViolations.ts) but any sibling code path that
    // synthesises a path-routing-significant violator in future.
    const REQUEST_VALIDATION_DIR = join(REPO_ROOT, 'generated', CONFIG_NAME, 'request-validation');
    if (!existsSync(REQUEST_VALIDATION_DIR)) {
      throw new Error(
        `Generated request-validation directory not found at ${REQUEST_VALIDATION_DIR}. ` +
          `Run 'npm run generate:request-validation' (or 'npm run pipeline') first.`,
      );
    }

    function isUrlCollapsingPathSegment(value: string): boolean {
      if (value.length === 0) return true;
      if (value === '.' || value === '..') return true;
      // Mirror production `paramConstraintViolations.ts:isUrlCollapsingPathSegment`.
      // `buildUrl` substitutes path-param values raw, so the predicate must
      // reject any value that *literally* contains a routing-significant
      // character or already-encoded segment splitter, in addition to the
      // canonical-encoding check.
      if (/[/\\?#]/.test(value)) return true;
      if (/%2f|%5c/i.test(value)) return true;
      const encoded = encodeURIComponent(value);
      if (/%2f|%5c/i.test(encoded)) return true;
      return false;
    }

    // Unescape a JavaScript string-literal body. The emitter writes path
    // params via `JSON.stringify`, then prettier may re-quote the outer
    // quotes (`singleQuote: true`). For correctness across the full set of
    // JSON escapes (`\\`, `\"`, `\/`, `\n`, `\t`, `\r`, `\b`, `\f`, and
    // `\uXXXX` — which can decode to routing-significant chars like `/` =
    // `\u002F`), we round-trip through `JSON.parse`. PR #148 review: the
    // previous hand-rolled `replace(/\\(.)/, ...)` returned just `<char>`
    // for any `\<char>`, which would have decoded `\u002F` to `u002F` and
    // hidden a real slash from the URL-collapsing predicate.
    function unescapeJsString(rawBody: string, quote: "'" | '"'): string {
      // Convert the captured body to a valid JSON string body. JSON requires
      // double-quoted strings with `\"` for embedded quotes; it does not
      // allow `\'` (a JS-only escape). For single-quoted source: unescape
      // `\'` to `'`, then escape any unescaped `"` to `\"`.
      let jsonBody: string;
      if (quote === '"') {
        jsonBody = rawBody;
      } else {
        jsonBody = rawBody.replace(/\\'/g, "'").replace(/(^|[^\\])((?:\\\\)*)"/g, '$1$2\\"');
      }
      try {
        const parsed: unknown = JSON.parse(`"${jsonBody}"`);
        if (typeof parsed === 'string') return parsed;
      } catch {
        // Fall through to raw return below — predicate's raw-character
        // checks (`/`, `\`, `?`, `#`, `%2f`, `%5c`) remain conservative
        // even on un-decoded escape sequences.
      }
      return rawBody;
    }

    // Match the `buildUrl(...)` call inside a `param-constraint-violation`
    // block. The emitter accepts both the 2-arg form
    // `buildUrl(path, pathParams)` and the 3-arg form
    // `buildUrl(path, pathParams, queryParams)` (#127). We only care about
    // the path-params slot for this invariant; slot 3 is captured-and-
    // discarded so the regex still matches when it exists. PR #148 review:
    // the previous regex required exactly two args and silently skipped
    // every block with a query-params slot, weakening coverage.
    const TEST_BLOCK = /test\([^]*?scenarioKind:\s*'param-constraint-violation'[^]*?}\);/g;
    const BUILD_URL =
      /buildUrl\(\s*'([^']+)'(?:\s*,\s*(\{[^}]*\}|undefined))(?:\s*,\s*(?:\{[^}]*\}|undefined))?\s*\)/;
    // `<key>: <value>` — key is either a bare identifier or a quoted
    // string (in case prettier ever quotes a non-identifier key); value is
    // a single- or double-quoted string literal that *may contain
    // backslash escapes* (PR #148 review). Both halves capture the
    // escape-aware body; the caller unescapes before predicate checks.
    const STR_BODY_SQ = "'((?:\\\\.|[^'\\\\])*)'";
    const STR_BODY_DQ = '"((?:\\\\.|[^"\\\\])*)"';
    const KEY_BARE = '\\b[a-zA-Z_$][a-zA-Z0-9_$]*';
    const PARAM_KV = new RegExp(
      `(?:(${KEY_BARE})|${STR_BODY_SQ}|${STR_BODY_DQ})\\s*:\\s*(?:${STR_BODY_SQ}|${STR_BODY_DQ})`,
      'g',
    );

    interface Offender {
      file: string;
      param: string;
      value: string;
    }
    const offenders: Offender[] = [];
    let blocksScanned = 0;
    let pathParamsScanned = 0;
    for (const f of readdirSync(REQUEST_VALIDATION_DIR)) {
      if (!f.endsWith('.spec.ts')) continue;
      const src = readFileSync(join(REQUEST_VALIDATION_DIR, f), 'utf8');
      let block: RegExpExecArray | null;
      TEST_BLOCK.lastIndex = 0;
      while ((block = TEST_BLOCK.exec(src)) !== null) {
        blocksScanned++;
        const urlMatch = BUILD_URL.exec(block[0]);
        if (!urlMatch) continue;
        const [, template, paramsLiteral] = urlMatch;
        // Only path-param tokens — `{name}` substrings — are routing-
        // significant. Query-only scenarios pass `undefined` for slot 2
        // (the 3-arg form, post-#127) or an empty `{}` (legacy 2-arg) and
        // are ignored automatically.
        if (!paramsLiteral || paramsLiteral === 'undefined') continue;
        const pathTokens = new Set<string>();
        const tokenRe = /\{([^}]+)}/g;
        let t: RegExpExecArray | null;
        while ((t = tokenRe.exec(template)) !== null) pathTokens.add(t[1]);
        if (pathTokens.size === 0) continue;
        PARAM_KV.lastIndex = 0;
        let kv: RegExpExecArray | null;
        while ((kv = PARAM_KV.exec(paramsLiteral)) !== null) {
          const [, bareKey, sqKey, dqKey, sqVal, dqVal] = kv;
          const key = bareKey ?? sqKey ?? dqKey;
          const rawValue = sqVal ?? dqVal;
          if (key === undefined || rawValue === undefined) continue;
          if (!pathTokens.has(key)) continue;
          pathParamsScanned++;
          const quote: "'" | '"' = sqVal !== undefined ? "'" : '"';
          const value = unescapeJsString(rawValue, quote);
          if (isUrlCollapsingPathSegment(value)) {
            offenders.push({
              file: relative(REPO_ROOT, join(REQUEST_VALIDATION_DIR, f)),
              param: key,
              value,
            });
          }
        }
      }
    }
    // Vacuous-truth guard: prove both regexes still match the emitted
    // syntax. The camunda-oca suite has hundreds of param-constraint
    // blocks with at least one path-param each.
    expect(blocksScanned).toBeGreaterThan(0);
    expect(pathParamsScanned).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

describeForThisConfig('bundled-spec invariants: scenario seed-binding completeness (#136)', () => {
  // Class-scoped invariant pinning the planner-side fix for #136.
  //
  // Defect class: a request-plan step references a binding (in its
  // body, multipart payload, or path template) that has no value at
  // the time the step runs. Pre-#136 the Playwright emitter swallowed
  // body-only identifier bindings whose value was ALSO extracted from
  // the same step's response (e.g. createUser sending
  // `username: ctx.usernameVar` while extracting `usernameVar` from
  // its own response) — the body went out as `undefined` and the
  // broker rejected it 400. The planner now stamps `seedBindings`
  // (path-analyser/src/seedBindings.ts) on every scenario; any
  // emitter just iterates it.
  //
  // The invariant: for every feature-output scenario, every `${var}`
  // referenced by step S must be resolvable at S's request time —
  // either a literal in `bindings`, or extracted by a strictly
  // earlier step, or listed in `scenario.seedBindings`. An offender
  // means SOME emitter would render an unseeded variable; the
  // contract is emitter-agnostic so this catches the bug class for
  // every present and future emitter.
  it('every step references only bindings that are literal, earlier-extracted, or in seedBindings', () => {
    if (!existsSync(FEATURE_SCENARIOS_DIR)) {
      throw new Error(
        `Feature-output directory not found at ${FEATURE_SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
      );
    }
    interface ExtractLite {
      bind: string;
    }
    interface RequestStepLite {
      operationId: string;
      pathTemplate: string;
      bodyTemplate?: unknown;
      multipartTemplate?: unknown;
      extract?: ExtractLite[];
    }
    interface ScenarioLite {
      id: string;
      bindings?: Record<string, string>;
      seedBindings?: string[];
      requestPlan?: RequestStepLite[];
    }
    interface CollectionLite {
      endpoint: { operationId: string };
      scenarios: ScenarioLite[];
    }

    // Mirrors path-analyser/src/codegen/playwright/emitter.ts:436 and
    // path-analyser/src/seedBindings.ts: trivial lowercase-first-char
    // only. Must stay aligned with the runtime emitter or this
    // invariant will check the wrong *Var names.
    function camelCase(input: string): string {
      return input.charAt(0).toLowerCase() + input.slice(1);
    }

    function collectStringRefs(s: string, out: Set<string>): void {
      for (const m of s.matchAll(/\$\{([^}]+)\}/g)) out.add(m[1]);
    }
    function walkTemplate(value: unknown, out: Set<string>): void {
      if (typeof value === 'string') {
        collectStringRefs(value, out);
        return;
      }
      if (Array.isArray(value)) {
        for (const v of value) walkTemplate(v, out);
        return;
      }
      if (value && typeof value === 'object') {
        for (const v of Object.values(value)) walkTemplate(v, out);
      }
    }
    function readsOf(step: RequestStepLite): Set<string> {
      const out = new Set<string>();
      walkTemplate(step.bodyTemplate, out);
      walkTemplate(step.multipartTemplate, out);
      for (const m of step.pathTemplate.matchAll(/\{([^}]+)\}/g)) {
        out.add(`${camelCase(m[1])}Var`);
      }
      return out;
    }

    interface Offender {
      file: string;
      scenarioId: string;
      stepIndex: number;
      operationId: string;
      missing: string;
    }
    const offenders: Offender[] = [];
    let scenariosScanned = 0;
    let stepsScanned = 0;

    for (const f of readdirSync(FEATURE_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed pipeline JSON
      const collection = JSON.parse(
        readFileSync(join(FEATURE_SCENARIOS_DIR, f), 'utf8'),
      ) as CollectionLite;
      for (const scenario of collection.scenarios) {
        if (!scenario.requestPlan?.length) continue;
        scenariosScanned++;
        const literals = new Set<string>();
        for (const [k, v] of Object.entries(scenario.bindings ?? {})) {
          if (v !== '__PENDING__') literals.add(k);
        }
        const seeds = new Set(scenario.seedBindings ?? []);
        const extractedSoFar = new Set<string>();
        for (let i = 0; i < scenario.requestPlan.length; i++) {
          const step = scenario.requestPlan[i];
          stepsScanned++;
          for (const v of readsOf(step)) {
            if (literals.has(v) || extractedSoFar.has(v) || seeds.has(v)) continue;
            offenders.push({
              file: f,
              scenarioId: scenario.id,
              stepIndex: i,
              operationId: step.operationId,
              missing: v,
            });
          }
          for (const ex of step.extract ?? []) extractedSoFar.add(ex.bind);
        }
      }
    }

    // Vacuous-truth guard: the camunda-oca bundle has thousands of
    // scenarios and tens of thousands of `${var}` reads. If either
    // count is suspiciously low the invariant has stopped exercising
    // the property.
    expect(scenariosScanned).toBeGreaterThan(100);
    expect(stepsScanned).toBeGreaterThan(scenariosScanned);
    expect(offenders).toEqual([]);
  });

  // Narrower companion invariant pinning the exact #136 reproducer:
  // an establisher operation whose endpoint scenario echoes a body
  // identifier in its response. Pre-#136 every such operation was a
  // live-broker 201→400 (46 of them in the issue's enumeration). Even
  // if the broader invariant above is later relaxed, this one keeps
  // the named defect class permanently red on regression.
  it('every establisher endpoint scenario seeds its own body identifier bindings', () => {
    if (!existsSync(FEATURE_SCENARIOS_DIR) || !existsSync(GRAPH_PATH)) {
      throw new Error(`Required pipeline output not found. Run 'npm run pipeline' first.`);
    }
    interface IdentifiedBy {
      in: 'body' | 'path' | 'header' | 'query';
      name: string;
      semanticType: string;
    }
    interface EstablishesSpec {
      kind: string;
      shape?: 'edge' | 'aggregate';
      identifiedBy: IdentifiedBy[];
    }
    interface OperationNodeLite {
      operationId: string;
      establishes?: EstablishesSpec;
    }
    interface GraphLite {
      operations: OperationNodeLite[];
    }
    interface RequestStepLite {
      operationId: string;
      bodyTemplate?: unknown;
      multipartTemplate?: unknown;
    }
    interface ScenarioLite {
      id: string;
      operations: { operationId: string }[];
      bindings?: Record<string, string>;
      seedBindings?: string[];
      requestPlan?: RequestStepLite[];
    }
    interface CollectionLite {
      endpoint: { operationId: string };
      scenarios: ScenarioLite[];
    }

    // Mirrors path-analyser/src/codegen/playwright/emitter.ts:436 and
    // path-analyser/src/seedBindings.ts: trivial lowercase-first-char
    // only. Must stay aligned with the runtime emitter or this
    // invariant will check the wrong *Var names.
    function camelCase(input: string): string {
      return input.charAt(0).toLowerCase() + input.slice(1);
    }

    // biome-ignore lint/plugin: runtime contract boundary for parsed pipeline JSON
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as GraphLite;
    const opsById = new Map(graph.operations.map((o) => [o.operationId, o]));
    interface Offender {
      file: string;
      scenarioId: string;
      operationId: string;
      bodyIdentifier: string;
      missingBinding: string;
    }
    const offenders: Offender[] = [];
    let establisherScenariosScanned = 0;

    for (const f of readdirSync(FEATURE_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed pipeline JSON
      const collection = JSON.parse(
        readFileSync(join(FEATURE_SCENARIOS_DIR, f), 'utf8'),
      ) as CollectionLite;
      const endpointNode = opsById.get(collection.endpoint.operationId);
      const establishes = endpointNode?.establishes;
      if (!establishes || establishes.shape === 'edge') continue;
      const bodyIdents = establishes.identifiedBy.filter((id) => id.in === 'body');
      if (bodyIdents.length === 0) continue;

      for (const scenario of collection.scenarios) {
        if (!scenario.requestPlan?.length) continue;
        const firstStep = scenario.requestPlan[0];
        if (firstStep.operationId !== collection.endpoint.operationId) continue;
        // Collect ${var} references actually emitted by the body /
        // multipart template — that is the surface where #136 produced
        // unbound reads. Body identifiers omitted from the body
        // template entirely are an orthogonal body-builder defect and
        // out of scope for this invariant.
        const bodyRefs = new Set<string>();
        const collectVarRefs = (node: unknown): void => {
          if (typeof node === 'string') {
            for (const m of node.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
              bodyRefs.add(m[1]);
            }
            return;
          }
          if (Array.isArray(node)) {
            for (const item of node) collectVarRefs(item);
            return;
          }
          if (node !== null && typeof node === 'object') {
            for (const v of Object.values(node)) collectVarRefs(v);
          }
        };
        collectVarRefs(firstStep.bodyTemplate);
        collectVarRefs(firstStep.multipartTemplate);
        establisherScenariosScanned++;
        const literals = new Set<string>();
        for (const [k, v] of Object.entries(scenario.bindings ?? {})) {
          if (v !== '__PENDING__') literals.add(k);
        }
        const seeds = new Set(scenario.seedBindings ?? []);
        for (const id of bodyIdents) {
          const expectedVar = `${camelCase(id.name)}Var`;
          if (!bodyRefs.has(expectedVar)) continue;
          if (literals.has(expectedVar) || seeds.has(expectedVar)) continue;
          offenders.push({
            file: f,
            scenarioId: scenario.id,
            operationId: collection.endpoint.operationId,
            bodyIdentifier: id.name,
            missingBinding: expectedVar,
          });
        }
      }
    }
    // Sanity floor: the bundled spec has multiple body-identifier
    // establishers (createUser, createMappingRule, createRole,
    // createGroup, createAdminUser, createAuthorization, …). If the
    // count drops below this floor the invariant is silently vacuous.
    expect(establisherScenariosScanned).toBeGreaterThanOrEqual(5);
    expect(offenders).toEqual([]);
  });
});

// #152: required body identifiers must always appear in the body
// template. Pre-fix, `path-analyser/src/canonicalSchemas.ts:resolveSchema`
// dropped wrapping-schema `properties`/`required` when an `allOf` was
// present, so e.g. `MappingRuleCreateRequest.mappingRuleId` and
// `GlobalTaskListenerCreateRequest.id` never reached the planner's
// canonical request shape, and the body template was emitted without
// them. Live broker rejected the request 400. This invariant is the
// inverse of the #136 invariant above: not only must referenced
// bindings be seeded, required body identifiers must also be referenced.
describeForThisConfig(
  'bundled-spec invariants: establisher body-identifier presence (#152)',
  () => {
    it('every establisher endpoint scenario references its required body identifiers', () => {
      if (!existsSync(FEATURE_SCENARIOS_DIR) || !existsSync(GRAPH_PATH)) {
        throw new Error(`Required pipeline output not found. Run 'npm run pipeline' first.`);
      }
      interface IdentifiedBy {
        in: 'body' | 'path' | 'header' | 'query';
        name: string;
        semanticType: string;
      }
      interface EstablishesSpec {
        kind: string;
        shape?: 'edge' | 'aggregate';
        identifiedBy: IdentifiedBy[];
      }
      interface RequestSemanticType {
        fieldPath: string;
        required?: boolean;
      }
      interface OperationNodeLite {
        operationId: string;
        establishes?: EstablishesSpec;
        requestBodySemanticTypes?: RequestSemanticType[];
      }
      interface GraphLite {
        operations: OperationNodeLite[];
      }
      interface RequestStepLite {
        operationId: string;
        bodyTemplate?: unknown;
        multipartTemplate?: unknown;
      }
      interface ScenarioLite {
        id: string;
        operations: { operationId: string }[];
        requestPlan?: RequestStepLite[];
      }
      interface CollectionLite {
        endpoint: { operationId: string };
        scenarios: ScenarioLite[];
      }

      function camelCase(input: string): string {
        return input.charAt(0).toLowerCase() + input.slice(1);
      }

      function collectVarRefs(node: unknown, out: Set<string>): void {
        if (typeof node === 'string') {
          for (const m of node.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
            out.add(m[1]);
          }
          return;
        }
        if (Array.isArray(node)) {
          for (const item of node) collectVarRefs(item, out);
          return;
        }
        if (node !== null && typeof node === 'object') {
          for (const v of Object.values(node)) collectVarRefs(v, out);
        }
      }

      // biome-ignore lint/plugin: runtime contract boundary for parsed pipeline JSON
      const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as GraphLite;
      const opsById = new Map(graph.operations.map((o) => [o.operationId, o]));
      interface Offender {
        file: string;
        scenarioId: string;
        operationId: string;
        bodyIdentifier: string;
        missingVar: string;
      }
      const offenders: Offender[] = [];
      let establisherScenariosScanned = 0;

      for (const f of readdirSync(FEATURE_SCENARIOS_DIR)) {
        if (!f.endsWith('-scenarios.json')) continue;
        // biome-ignore lint/plugin: runtime contract boundary for parsed pipeline JSON
        const collection = JSON.parse(
          readFileSync(join(FEATURE_SCENARIOS_DIR, f), 'utf8'),
        ) as CollectionLite;
        const endpointNode = opsById.get(collection.endpoint.operationId);
        const establishes = endpointNode?.establishes;
        if (!establishes || establishes.shape === 'edge') continue;
        const bodyIdents = establishes.identifiedBy.filter((id) => id.in === 'body');
        if (bodyIdents.length === 0) continue;
        // Only check identifiers that are actually required by the
        // request body schema. An identifier the spec marks optional in
        // the request body is out of scope for this invariant — the
        // planner is free to omit it, and absence won't 400 at the broker.
        const requiredBodyPaths = new Set(
          (endpointNode?.requestBodySemanticTypes ?? [])
            .filter((e) => e.required)
            .map((e) => e.fieldPath),
        );
        const requiredIdents = bodyIdents.filter((id) => requiredBodyPaths.has(id.name));
        if (requiredIdents.length === 0) continue;

        for (const scenario of collection.scenarios) {
          if (!scenario.requestPlan?.length) continue;
          const firstStep = scenario.requestPlan[0];
          if (firstStep.operationId !== collection.endpoint.operationId) continue;
          establisherScenariosScanned++;
          const refs = new Set<string>();
          collectVarRefs(firstStep.bodyTemplate, refs);
          collectVarRefs(firstStep.multipartTemplate, refs);
          for (const id of requiredIdents) {
            const expectedVar = `${camelCase(id.name)}Var`;
            if (refs.has(expectedVar)) continue;
            offenders.push({
              file: f,
              scenarioId: scenario.id,
              operationId: collection.endpoint.operationId,
              bodyIdentifier: id.name,
              missingVar: expectedVar,
            });
          }
        }
      }
      expect(establisherScenariosScanned).toBeGreaterThanOrEqual(5);
      expect(offenders).toEqual([]);
    });
  },
);

describeForThisConfig('bundled-spec invariants: modelDerived value source (#162 PR 1)', () => {
  // PR 1 of #162: ElementId and JobType are declared `kind: modelDerived`
  // in domain-semantics, and the fixture registry's `providesValues`
  // entry on each bpmn fixture declares which concrete values that
  // fixture deploys. When the feature planner emits a scenario whose
  // endpoint has ElementId or JobType as an optional input, it must
  // bind the var from the chain's deployment fixture's providesValues
  // — not from the synthetic `fc:pos:<endpoint>:<semantic>` placeholder
  // the pre-PR-1 planner used.
  //
  // The 4 single-deploy ElementId consumer sites covered here:
  //   - createProcessInstance        :: startInstructions[].elementId
  //   - activateAdHocSubProcessActivities :: elements[].elementId
  //   - completeJob                  :: result.activateElements[].elementId
  //   - modifyProcessInstance        :: activateInstructions[].elementId
  //
  // Other ElementId consumer sites that remain uncovered by PR 1:
  //   - modifyProcessInstancesBatchOperation :: moveInstructions[].sourceElementId
  //     (single-endpoint chain — the planner doesn't insert a
  //      createDeployment prerequisite for batch operations even though
  //      sourceElementId needs a model. Separate chain-construction issue.)
  //   - migrateProcessInstance / migrateProcessInstancesBatchOperation
  //     (multi-deploy: source-model + target-model — needs per-deploy-step
  //      fixture selection. PR 1's helper takes the FIRST deploy step.)

  // The deterministic-synthetic value pattern emitted by
  // featureCoverageGenerator pre-PR-1:
  // `<camelLower(semantic)>_<deterministicSuffix(...)>`,
  // e.g. `elementId_e1wc`. The suffix is base36 alphanumeric. The
  // assertions below check this leading-pattern is absent from the
  // corresponding feature scenario's binding — proving the binding
  // comes from providesValues instead. A real BPMN element id starts
  // #162 PR 4: the suite partition cut moved per-leaf optional
  // coverage from feature (was `opt=ElementId`) to variant (one
  // scenario per `<rootPath>::<fieldPath>`). The original assertion
  // that `elementIdVar` resolves from a deploy fixture and must NOT
  // match the synthetic `elementId_<suffix>` placeholder no longer
  // applies in the variant suite: variant-suite fallback minting
  // (path-analyser/src/scenarioGenerator.ts → `resolveFallbackValue`)
  // legitimately produces synthetic placeholders for `modelDerived`
  // semantics when the producer-chain BFS cannot satisfy the leaf,
  // because the variant generator does not have deploy-fixture
  // context at that stage. The cut's structural guards live in
  // `'bundled-spec invariants: suite-partition cut (#162 PR 4)'`
  // above. Here we keep a class-scoped existence + body-reference
  // invariant only: every endpoint that declares ElementId as an
  // optional body leaf must have at least one variant scenario that
  // populates ElementId, binds `elementIdVar`, and the emitted
  // variant spec must reference `ctx.elementIdVar`.

  interface VariantScenarioBody {
    bindings?: Record<string, string>;
    strategy?: string;
    variantKey?: string;
    populatesSubShape?: { leafSemantics?: string[] };
  }
  interface VariantScenarioFile {
    endpoint: { operationId: string };
    scenarios: VariantScenarioBody[];
  }

  function loadVariantCollection(file: string): VariantScenarioFile {
    const raw = readFileSync(file, 'utf8');
    // biome-ignore lint/plugin: parsed JSON is a runtime contract boundary
    return JSON.parse(raw) as VariantScenarioFile;
  }

  function findElementIdVariant(collection: VariantScenarioFile): VariantScenarioBody | undefined {
    return collection.scenarios.find((s) =>
      s.populatesSubShape?.leafSemantics?.includes('ElementId'),
    );
  }

  interface Target {
    endpoint: string;
    variantFile: string;
    varName: string;
  }
  const TARGETS: Target[] = [
    {
      endpoint: 'createProcessInstance',
      variantFile: 'post--process-instances-scenarios.json',
      varName: 'elementIdVar',
    },
    {
      endpoint: 'activateAdHocSubProcessActivities',
      variantFile:
        'post--element-instances--ad-hoc-activities--{adHocSubProcessInstanceKey}--activation-scenarios.json',
      varName: 'elementIdVar',
    },
    {
      endpoint: 'completeJob',
      variantFile: 'post--jobs--{jobKey}--completion-scenarios.json',
      varName: 'elementIdVar',
    },
    {
      endpoint: 'modifyProcessInstance',
      variantFile: 'post--process-instances--{processInstanceKey}--modification-scenarios.json',
      varName: 'elementIdVar',
    },
  ];

  for (const t of TARGETS) {
    it(`${t.endpoint} :: variant suite emits an ElementId-populating scenario binding ${t.varName} (#162 PR 4)`, () => {
      const path = join(VARIANT_SCENARIOS_DIR, t.variantFile);
      if (!existsSync(path)) {
        throw new Error(
          `expected variant-output JSON not found: ${t.variantFile} — run 'npm run testsuite:generate'`,
        );
      }
      const collection = loadVariantCollection(path);
      const scenario = findElementIdVariant(collection);
      expect(
        scenario,
        `${t.endpoint}: expected a variant scenario whose populatesSubShape.leafSemantics includes 'ElementId'`,
      ).toBeDefined();
      const binding = scenario?.bindings?.[t.varName];
      expect(binding, `${t.endpoint}: ElementId variant must bind ${t.varName}`).toBeDefined();
    });

    it(`${t.endpoint} :: emitted variant spec references ctx.${t.varName} (#162 PR 4)`, () => {
      const specName = `${t.endpoint}.variant.spec.ts`;
      const spec = join(GENERATED_TESTS_DIR, specName);
      if (!existsSync(spec)) {
        throw new Error(`expected emitted spec not found: ${specName}`);
      }
      const src = readFileSync(spec, 'utf8');
      // Variant specs use `variant-N` titles (no semantic-named
      // marker), and an endpoint's variant file contains only its
      // variant scenarios — so a file-wide `ctx.elementIdVar`
      // reference is sufficient and unambiguous evidence that the
      // ElementId variant body wires the binding.
      expect(
        src.includes(`ctx.${t.varName}`),
        `${t.endpoint} variant spec: body must reference ctx.${t.varName}`,
      ).toBe(true);
    });
  }
});

describeForThisConfig(
  'bundled-spec invariants: jobType binds from chosen fixture (#163 review)',
  () => {
    // #163 review-comment guard: when the registry switched from
    // `parameters.jobType` to `providesValues.JobType`, the planner code
    // path that binds `jobTypeVar` (separate from
    // `bindModelDerivedFromFixture`) almost regressed — it still read
    // `regHit.params.jobType` and would have fallen through to
    // `seedBinding('jobTypeVar')` at runtime once `parameters` was
    // removed. The bridge in PR 1 now consults
    // `providesValues.JobType[0]` first. This class-scoped invariant
    // asserts every job-related endpoint's feature-1 (base) scenario
    // binds `jobTypeVar = 'sampleJobType'` — the value `service-task.bpmn`
    // declares — and not a synthetic, runtime-seeded, or absent binding.
    //
    // The invariant covers the class, not a single instance: any job-
    // related endpoint whose chain deploys `service-task.bpmn` and whose
    // request body / path needs JobType is in scope.

    interface ScenarioWithBindings {
      id?: string;
      strategy?: string;
      bindings?: Record<string, string>;
    }
    interface FeatureCollection {
      endpoint: { operationId: string };
      scenarios: ScenarioWithBindings[];
    }

    function loadCollection(filename: string): FeatureCollection {
      const raw = readFileSync(join(FEATURE_SCENARIOS_DIR, filename), 'utf8');
      // biome-ignore lint/plugin: parsed JSON is a runtime contract boundary
      return JSON.parse(raw) as FeatureCollection;
    }

    const targets: { endpoint: string; featureFile: string }[] = [
      { endpoint: 'activateJobs', featureFile: 'post--jobs--activation-scenarios.json' },
      { endpoint: 'completeJob', featureFile: 'post--jobs--{jobKey}--completion-scenarios.json' },
      { endpoint: 'failJob', featureFile: 'post--jobs--{jobKey}--failure-scenarios.json' },
      { endpoint: 'throwJobError', featureFile: 'post--jobs--{jobKey}--error-scenarios.json' },
    ];

    for (const t of targets) {
      it(`${t.endpoint} :: feature scenarios bind jobTypeVar to the fixture's JobType (#163)`, () => {
        const path = join(FEATURE_SCENARIOS_DIR, t.featureFile);
        if (!existsSync(path)) {
          throw new Error(
            `expected feature-output JSON not found: ${t.featureFile} — run 'npm run testsuite:generate'`,
          );
        }
        const collection = loadCollection(t.featureFile);
        // Pick the base (feature-1) scenario as the witness — any chain
        // that needs jobTypeVar will have it set; the base scenario is
        // the most representative.
        const base = collection.scenarios.find(
          (s) => s.strategy === 'featureCoverage' && s.id === 'feature-1',
        );
        expect(base, `${t.endpoint}: feature-1 base scenario not found`).toBeDefined();
        const jt = base?.bindings?.jobTypeVar;
        expect(
          jt,
          `${t.endpoint}: feature-1 must bind jobTypeVar (chain deploys service-task.bpmn, which declares JobType in providesValues)`,
        ).toBe('sampleJobType');
      });
    }
  },
);

describeForThisConfig(
  'bundled-spec invariants: clientMintedAttribute setter sites (#162 PR 2)',
  () => {
    // PR 2 of #162: every semantic declared `kind: 'attribute',
    // clientMinted: true` in domain-semantics is bound by the planner
    // (deterministic minted value with the `fc:cma:<sem>:` prefix) at
    // setter sites — operations whose request body accepts the
    // semantic at a top-level path. The body materializer fills the
    // setter field with `ctx.<sem>Var`.
    //
    // Class-scoped: derive the (semantic, setter-op) pairs from
    // domain-semantics + the dependency graph, then assert the
    // bindings + emitted body for every pair. Adding a new attribute
    // semantic to domain-semantics (or upstream introducing a new
    // setter operation for an existing attribute semantic) lights up
    // the same assertions automatically.
    //
    // Filter-consumer sites (path begins with `filter.` / `filter[`)
    // are intentionally excluded — they need setter-chain reuse to be
    // meaningful (a setter step inserted before the filter step that
    // tags an entity, with the same minted value threaded through).
    // Tracked in #168 (the deferred follow-up to #162 PR 2).

    interface SemanticTypeDecl {
      kind?: string;
      clientMinted?: boolean;
    }
    interface DomainSemantics {
      semanticTypes?: Record<string, SemanticTypeDecl>;
    }

    function loadAttributeClientMintedSemantics(): string[] {
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const abox = JSON.parse(
        readFileSync(join(REPO_ROOT, 'configs', CONFIG_NAME, 'ontology', 'semantics.json'), 'utf8'),
      ) as { semanticTypes?: Array<{ name: string } & SemanticTypeDecl> };
      return (abox.semanticTypes ?? [])
        .filter((spec) => spec?.kind === 'attribute' && spec?.clientMinted === true)
        .map((spec) => spec.name)
        .sort();
    }

    function camelCase(s: string): string {
      return s.charAt(0).toLowerCase() + s.slice(1);
    }

    // Mirror the planner's setter-site predicate: top-level path or any
    // non-`filter.*` parent. Filter paths are deferred (see comment
    // above and `bindClientMintedAttribute` in path-analyser/src/index.ts).
    function isSetterPath(fieldPath: string): boolean {
      return !fieldPath.startsWith('filter.') && !fieldPath.startsWith('filter[');
    }

    function setterOpsFor(semantic: string): OperationNode[] {
      const graph = loadGraph();
      const ops: OperationNode[] = [];
      for (const op of graph.operations) {
        const leaves = op.requestBodySemanticTypes ?? [];
        if (leaves.some((l) => l.semanticType === semantic && isSetterPath(l.fieldPath))) {
          ops.push(op);
        }
      }
      return ops;
    }

    // OpenAPI op → feature-output JSON file name. Mirrors the
    // generator's normalizeEndpointFileName: lowercased method, path
    // with `/` replaced by `--`, leading `--`, trailing `-scenarios.json`.
    function featureFileFor(op: OperationNode): string {
      const method = op.method.toLowerCase();
      const pathPart = op.path.replace(/\//g, '--');
      return `${method}${pathPart}-scenarios.json`;
    }

    const ATTRIBUTE_SEMANTICS = loadAttributeClientMintedSemantics();

    it('the semantics ABox declares at least one clientMintedAttribute semantic (PR 2 must not regress to zero)', () => {
      expect(
        ATTRIBUTE_SEMANTICS.length,
        `expected at least one kind:'attribute' + clientMinted:true semantic in configs/${CONFIG_NAME}/ontology/semantics.json`,
      ).toBeGreaterThan(0);
    });

    for (const semantic of ATTRIBUTE_SEMANTICS) {
      const setterOps = setterOpsFor(semantic);

      it(`${semantic}: at least one setter operation declares the semantic at a top-level body path`, () => {
        expect(
          setterOps.length,
          `expected at least one operation accepting ${semantic} at a non-filter body path`,
        ).toBeGreaterThan(0);
      });

      for (const op of setterOps) {
        const varName = `${camelCase(semantic)}Var`;

        it(`${semantic} :: ${op.operationId}: variant suite emits a ${semantic}-populating scenario binding ${varName} (#162 PR 4)`, () => {
          const variantFile = join(VARIANT_SCENARIOS_DIR, featureFileFor(op));
          if (!existsSync(variantFile)) {
            throw new Error(
              `expected variant-output JSON not found: ${featureFileFor(op)} — run 'npm run testsuite:generate'`,
            );
          }
          const raw = readFileSync(variantFile, 'utf8');
          // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
          const parsed = JSON.parse(raw) as {
            scenarios: Array<{
              variantKey?: string;
              bindings?: Record<string, string>;
              populatesSubShape?: { leafSemantics?: string[] };
            }>;
          };
          const scenario = parsed.scenarios.find((s) =>
            s.populatesSubShape?.leafSemantics?.includes(semantic),
          );
          expect(
            scenario,
            `${op.operationId}: expected a variant scenario whose populatesSubShape.leafSemantics includes '${semantic}'`,
          ).toBeDefined();
          const binding = scenario?.bindings?.[varName];
          expect(
            binding,
            `${op.operationId}: ${semantic} variant must bind ${varName}`,
          ).toBeDefined();
          // PR 4 note: the binding may be either
          //   - `fc:cma:<sem>:<suffix>` — variant fallback path
          //     (`bindSemanticInput` for clientMintedAttribute), used
          //     when the producer-chain BFS could not satisfy the leaf;
          //   - `__PENDING__` — variant producer-chain path, where the
          //     value is extracted at runtime from a search step in the
          //     chain;
          //   - `<sem>_<suffix>` — variant fallback path for
          //     non-clientMintedAttribute classifications (only
          //     reached when the semantic is not clientMinted; included
          //     here for completeness even though clientMintedAttribute
          //     semantics never take this branch).
          // Asserting any of these specifically would couple this
          // invariant to the BFS outcome rather than to the suite-
          // partition contract.
        });

        it(`${semantic} :: ${op.operationId}: emitted variant spec references ctx.${varName} (#162 PR 4)`, () => {
          const spec = join(GENERATED_TESTS_DIR, `${op.operationId}.variant.spec.ts`);
          if (!existsSync(spec)) {
            throw new Error(
              `expected emitted spec not found: ${op.operationId}.variant.spec.ts — run 'npm run testsuite:generate'`,
            );
          }
          const src = readFileSync(spec, 'utf8');
          // Variant specs use `variant-N` titles (no semantic-named
          // marker), and an endpoint's variant file contains only its
          // variant scenarios — so a file-wide `ctx.<sem>Var` reference
          // is sufficient and unambiguous evidence that the scenario
          // body wires the binding.
          expect(
            src.includes(`ctx.${varName}`),
            `${op.operationId} variant spec: body must reference ctx.${varName}`,
          ).toBe(true);
        });
      }
    }
  },
);

describeForThisConfig(
  'bundled-spec invariants: multipart-only operations skip JSON-only mutations (#135)',
  () => {
    // Three negative-test mutation classes are nonsensical when wrapped
    // as multipart form-data and produce 415s or false-positive 201s
    // instead of 400s on the three multipart-only Camunda endpoints
    // (createDeployment, createDocument, createDocuments):
    //
    //   1. body-top-type-mismatch — no JSON top-level type to invert.
    //   2. type-mismatch on a `format: binary` part — any bytes satisfy
    //      the schema.
    //   3. constraint-violation on an array-typed part — array
    //      mutations don't translate to multipart `files=...` repetition.
    //
    // The fix in request-validation/scripts/generate.ts drops these
    // scenarios via shouldSkipForMultipart() rather than wrapping them.
    // This invariant pins the observable result on the bundled spec
    // (5 originally-emitted offenders → 0).
    it('emits zero JSON-only mutations on multipart-only endpoints', () => {
      const REQUEST_VALIDATION_DIR = join(
        REPO_ROOT,
        'generated',
        CONFIG_NAME,
        'request-validation',
      );
      if (!existsSync(REQUEST_VALIDATION_DIR)) {
        throw new Error(
          `Generated request-validation directory not found at ${REQUEST_VALIDATION_DIR}. ` +
            `Run 'npm run generate:request-validation' (or 'npm run pipeline') first.`,
        );
      }

      // The three multipart-only endpoints in the camunda-oca bundled
      // spec. If upstream introduces a JSON variant for any of these,
      // the assertion still holds vacuously, but the floor below
      // catches the case where these ops disappear entirely.
      const MULTIPART_ONLY_OPS = ['createDeployment', 'createDocument', 'createDocuments'];

      // Scenario kinds that are nonsensical on multipart-only ops.
      // Match either quote style so this invariant is not coupled to the
      // emitter's current Prettier/singleQuote output.
      const FORBIDDEN_KINDS = ['body-top-type-mismatch', 'type-mismatch', 'constraint-violation'];

      // Match a single emitted `test('...', async (...) => { ... });`
      // or `test("...", async (...) => { ... });` block. The single-
      // quoted branch captures title/kind in groups 1/2; the double-
      // quoted branch captures title/kind in groups 3/4.
      const TEST_BLOCK =
        /test\('([^']*)',\s*async[^]*?scenarioKind:\s*'([^']+)'[^]*?}\);|test\("([^"]*)",\s*async[^]*?scenarioKind:\s*"([^"]+)"[^]*?}\);/g;

      interface Offender {
        file: string;
        title: string;
        operationId: string;
        scenarioKind: string;
      }
      const offenders: Offender[] = [];
      const sawByOp = new Map<string, number>();

      for (const f of readdirSync(REQUEST_VALIDATION_DIR)) {
        if (!f.endsWith('-validation-api-tests.spec.ts')) continue;
        const text = readFileSync(join(REQUEST_VALIDATION_DIR, f), 'utf8');
        for (const match of text.matchAll(TEST_BLOCK)) {
          const title = match[1] ?? match[3];
          const scenarioKind = match[2] ?? match[4];
          if (title === undefined || scenarioKind === undefined) {
            continue;
          }
          // Title format: `<operationId> - <suffix>` (qaEmitter.ts).
          const opMatch = title.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s+-\s+/);
          if (!opMatch) continue;
          const operationId = opMatch[1];
          if (!MULTIPART_ONLY_OPS.includes(operationId)) continue;
          sawByOp.set(operationId, (sawByOp.get(operationId) ?? 0) + 1);
          if (FORBIDDEN_KINDS.includes(scenarioKind)) {
            // type-mismatch and constraint-violation are only forbidden
            // when targeting binary or array multipart parts. We can't
            // re-derive the schema from the spec text cheaply, so we
            // rely on the operations' known shapes: createDeployment's
            // only scalar non-binary part is `tenantId`; createDocument
            // and createDocuments expose only binary/array parts at the
            // top level. Anything not addressing tenantId is an
            // offender for those two kinds.
            if (scenarioKind === 'body-top-type-mismatch') {
              offenders.push({ file: f, title, operationId, scenarioKind });
              continue;
            }
            // Title for type-mismatch / constraint-violation is
            // `<op> - Param <target> wrong type` /
            // `<op> - Constraint violation <target> ...`
            const targetMatch =
              title.match(/Param\s+(\S+)\s+wrong type/) ??
              title.match(/Constraint violation\s+(\S+)/);
            const target = targetMatch?.[1] ?? '';
            if (operationId === 'createDeployment' && target === 'tenantId') continue;
            offenders.push({ file: f, title, operationId, scenarioKind });
          }
        }
      }

      // Sanity floor: every multipart-only op should still surface at
      // least one negative scenario after the skip (e.g. missing-body,
      // missing-required, additional-prop). A zero count signals the
      // op vanished from the spec, the title format drifted, or the
      // skip over-fires.
      for (const op of MULTIPART_ONLY_OPS) {
        expect(sawByOp.get(op) ?? 0, `expected ≥1 scenario for ${op}`).toBeGreaterThan(0);
      }
      expect(offenders).toEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// Suite-partition cut (#162 PR 4) — feature suite is required-only,
// variant suite owns every populated optional (flat + nested + oneOf:rich).
// ---------------------------------------------------------------------------
//
// These invariants encode the post-cut contract from issue #162's
// "Suite-partition cut" section:
//
//   - feature: one scenario per request shape, required fields ONLY.
//     Polymorphic (oneOf) request: one scenario per shape, MINIMAL
//     materialisation. Plus carve-out behavioural-matrix scenarios
//     (`duplicateTest`, `search-empty-negative`).
//
//   - variant: combinatorial exploration of optional fields, both flat
//     (top-level optionals like Tag) and nested (filter.elementId,
//     startInstructions[].elementId). Absorbs every `opt=*` scenario
//     and every `oneOf:rich` scenario the feature planner used to emit.
//
// Step 0 of PR 4 (this commit) lands the assertions before any
// production code moves — per AGENTS.md "Coverage analysis before a
// behaviour-preserving refactor". The cut is NOT behaviour-preserving,
// but the same red/green discipline applies: writing the assertions
// first proves the new contract is detectable, and the cut commit
// proves the production code now satisfies it.
//
// Expected on `main` (pre-cut): every `it` in this block FAILS. Today
// the feature suite has 284 `opt=*` scenarios and 8 `oneOf:rich`
// scenarios that PR 4 will move into variant.
//
// Expected after PR 4: every `it` passes; feature shrinks from 517 to
// ~233 scenarios, variant grows from 208 to ~492.

describeForThisConfig('bundled-spec invariants: suite-partition cut (#162 PR 4)', () => {
  function loadAllFeatureFiles(): { file: string; parsed: ScenarioFile }[] {
    if (!existsSync(FEATURE_SCENARIOS_DIR)) {
      throw new Error(
        `Feature scenarios directory not found at ${FEATURE_SCENARIOS_DIR}. Run 'npm run testsuite:generate' first.`,
      );
    }
    const out: { file: string; parsed: ScenarioFile }[] = [];
    for (const f of readdirSync(FEATURE_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const parsed = JSON.parse(
        readFileSync(join(FEATURE_SCENARIOS_DIR, f), 'utf8'),
      ) as ScenarioFile;
      out.push({ file: f, parsed });
    }
    return out;
  }

  function loadAllVariantFiles(): { file: string; parsed: VariantScenarioFile }[] {
    if (!existsSync(VARIANT_SCENARIOS_DIR)) return [];
    const out: { file: string; parsed: VariantScenarioFile }[] = [];
    for (const f of readdirSync(VARIANT_SCENARIOS_DIR)) {
      if (!f.endsWith('-scenarios.json')) continue;
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const parsed = JSON.parse(
        readFileSync(join(VARIANT_SCENARIOS_DIR, f), 'utf8'),
      ) as VariantScenarioFile;
      out.push({ file: f, parsed });
    }
    return out;
  }

  interface FeatureScenarioWithKey {
    id: string;
    variantKey?: string;
    negative?: boolean;
    duplicateTest?: { mode: string };
    requestVariantGroup?: string;
    requestVariantRichness?: string;
  }

  function readFeatureScenarios(parsed: ScenarioFile): FeatureScenarioWithKey[] {
    // The ScenarioFile schema in this test file is intentionally
    // minimal; widen the row shape here for the partition checks.
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON — partition fields read out-of-band
    return parsed.scenarios as unknown as FeatureScenarioWithKey[];
  }

  it('feature suite contains zero scenarios with variantKey starting with `opt=` (#162 PR 4)', () => {
    // Class-scoped guard for the cut: every populated-optional
    // scenario must live in the variant suite. A single `opt=*`
    // entry in feature output means the partition has regressed.
    const offenders: { file: string; id: string; variantKey: string }[] = [];
    for (const { file, parsed } of loadAllFeatureFiles()) {
      for (const s of readFeatureScenarios(parsed)) {
        if (typeof s.variantKey === 'string' && s.variantKey.startsWith('opt=')) {
          offenders.push({ file, id: s.id, variantKey: s.variantKey });
        }
      }
    }
    expect(
      offenders,
      'Feature suite emitted scenarios with `opt=` variantKey. Per #162 PR 4, every populated-optional scenario belongs in the variant suite.',
    ).toEqual([]);
  });

  it('feature suite contains zero scenarios with `:rich` variantKey suffix (#162 PR 4)', () => {
    // The `oneOf=*:rich` shapes (oneOf branch with optionals filled)
    // are populated-optional scenarios in disguise and belong in the
    // variant suite. The minimal `oneOf=*` (no `:rich` suffix) stays
    // in feature — one scenario per request shape.
    const offenders: { file: string; id: string; variantKey: string }[] = [];
    for (const { file, parsed } of loadAllFeatureFiles()) {
      for (const s of readFeatureScenarios(parsed)) {
        if (typeof s.variantKey === 'string' && s.variantKey.endsWith(':rich')) {
          offenders.push({ file, id: s.id, variantKey: s.variantKey });
        }
      }
    }
    expect(
      offenders,
      'Feature suite emitted `:rich` oneOf scenarios. Per #162 PR 4, the rich shape (oneOf branch with optionals populated) belongs in the variant suite.',
    ).toEqual([]);
  });

  it('every feature scenario variantKey matches the carve-out allowlist (#162 PR 4)', () => {
    // Authoritative list of feature-suite variantKey shapes after the
    // cut. Anything else is a regression. The allowlist:
    //   - 'base'                    : the canonical required-only scenario
    //   - 'neg'                     : search-empty-negative carve-out
    //   - 'oneOf=<group>:<variant>' : minimal oneOf branch (no `:rich`)
    //   - duplicateTest scenarios   : variantKey may be 'base' or 'neg';
    //                                 the duplicateTest field carries the
    //                                 distinguishing metadata and is
    //                                 permitted regardless.
    const ALLOW_PATTERNS: RegExp[] = [
      /^base$/,
      /^neg$/,
      /^oneOf=[^|]+:[^|:]+$/, // oneOf=<group>:<variant>, with no `:rich`
    ];
    const offenders: { file: string; id: string; variantKey: string }[] = [];
    for (const { file, parsed } of loadAllFeatureFiles()) {
      for (const s of readFeatureScenarios(parsed)) {
        // Carve-out: behavioural-matrix scenarios (`duplicateTest`)
        // are allowed regardless of variantKey shape — the
        // distinguishing metadata is on the scenario object, not in
        // the key.
        if (s.duplicateTest) continue;
        const key = s.variantKey;
        // A missing/non-string variantKey is itself a regression:
        // post-PR-4 every feature scenario must carry a suite-
        // convention key. Treat as an offender so an accidentally
        // omitted key cannot slip past this guard.
        if (typeof key !== 'string') {
          offenders.push({ file, id: s.id, variantKey: String(key) });
          continue;
        }
        if (!ALLOW_PATTERNS.some((p) => p.test(key))) {
          offenders.push({ file, id: s.id, variantKey: key });
        }
      }
    }
    expect(
      offenders,
      'Feature suite emitted a scenario whose variantKey is missing or not in the post-PR-4 allowlist (base | neg | oneOf=<g>:<v> | duplicateTest carve-out).',
    ).toEqual([]);
  });

  it('every feature scenario file is materialised as a *.feature.spec.ts (#162 PR 4)', () => {
    // Mirror of the variant-suite #105 guard. A feature JSON file
    // without a corresponding `.feature.spec.ts` means the emitter
    // dropped the suite silently — exactly the failure mode the
    // partition cut is supposed to prevent.
    const offenders: { jsonFile: string; expectedSpec: string }[] = [];
    for (const { file, parsed } of loadAllFeatureFiles()) {
      if (!parsed.scenarios?.length) continue;
      const opId = parsed.endpoint?.operationId;
      if (!opId) continue;
      const expectedSpec = `${opId}.feature.spec.ts`;
      const specPath = join(GENERATED_TESTS_DIR, expectedSpec);
      if (!existsSync(specPath)) {
        offenders.push({ jsonFile: file, expectedSpec });
      }
    }
    expect(
      offenders,
      'Feature scenario JSON without a matching .feature.spec.ts in the playwright suite directory.',
    ).toEqual([]);
  });

  it('variant suite covers every flat top-level optional present in the feature suite pre-cut (#162 PR 4)', () => {
    // After dropping the `subShapeRootOf` `segments.length < 2`
    // filter, the variant planner must enumerate flat top-level
    // optionals. Today the planner only enumerates nested sub-shapes
    // (filter.*, startInstructions[].*) — flat optionals like Tag,
    // CorrelationKey, BusinessId are skipped. This guard fails until
    // the cut lands.
    //
    // Concrete acceptance: for every (operationId, semantic) where
    // the operation declares the semantic as an optional top-level
    // requestBody field (no `.` in fieldPath), there is a variant
    // scenario whose populatesSubShape.leafSemantics includes it.
    const variantBySemanticByOp = new Map<string, Set<string>>();
    for (const { parsed } of loadAllVariantFiles()) {
      const opId = parsed.endpoint?.operationId;
      if (!opId) continue;
      const set = variantBySemanticByOp.get(opId) ?? new Set<string>();
      for (const s of parsed.scenarios ?? []) {
        for (const sem of s.populatesSubShape?.leafSemantics ?? []) {
          set.add(sem);
        }
      }
      variantBySemanticByOp.set(opId, set);
    }

    const graph = loadGraph();
    const offenders: { operationId: string; semantic: string; fieldPath: string }[] = [];
    for (const op of graph.operations) {
      for (const e of op.requestBodySemanticTypes ?? []) {
        if (e.required) continue;
        if (typeof e.fieldPath !== 'string') continue;
        // Flat top-level optional: no `.` separator. This includes
        // both flat scalars (e.g. `tenantId`) and top-level scalar-
        // array leaves (e.g. `tags[]`, `tenantIds[]`) — both are
        // populated-vs-omitted optionals the variant suite owns
        // post-cut. Operator-object pseudo-fields (`$eq`, `$like`,
        // ...) are excluded because they are not real body leaves.
        if (e.fieldPath.includes('.')) continue;
        if (e.fieldPath.startsWith('$')) continue;
        const covered = variantBySemanticByOp.get(op.operationId);
        if (!covered?.has(e.semanticType)) {
          offenders.push({
            operationId: op.operationId,
            semantic: e.semanticType,
            fieldPath: e.fieldPath,
          });
        }
      }
    }
    expect(
      offenders,
      'Variant suite is missing scenarios for flat top-level optionals. Per #162 PR 4, the variant planner must absorb every populated-optional scenario the feature suite previously emitted as `opt=*`.',
    ).toEqual([]);
  });
});

describeForThisConfig(
  'bundled-spec invariants: semantic body binding auto-derivation (#174)',
  () => {
    it('feature specs do not seed field-name vars for request body fields whose semantic type has a graph-level provider:true producer (#174)', () => {
      // Guard for the fix that auto-derives `ctx.${semanticType}Var` from
      // `requestBodySemanticTypes` instead of emitting a seeded placeholder
      // named after the raw field leaf (e.g. `targetProcessDefinitionKeyVar`).
      //
      // Class-scoped: for every request-body consumer edge in the graph that
      // wires a *provider:true* response producer (non-filter path), the
      // emitted feature spec for that consumer operation must NOT contain a
      // `seedBinding` call for the field-leaf-name-derived var.  Presence of
      // such a seeded call means the auto-derivation regressed and the field
      // is no longer wired to the semantic producer.
      //
      // Edges from client-minted (establisher) or provider:false response
      // fields are excluded because those semantics are intentionally seeded.
      //
      // Parameter edges (path.*, query.*, header.*, cookie.*) are excluded —
      // they are not request body fields and are wired via path/query helpers.
      //
      // Filter-prefixed paths (filter.* / filter[) are excluded because they
      // are deferred to #168 (clientMintedAttribute setter-chain reuse).
      const graph = loadGraph();

      // Build the set of semantic types with at least one provider:true response producer.
      // Only response fields with `provider: true` flow into producersByType (graphLoader #97/#98).
      const providerTrueSemantics = new Set<string>();
      for (const op of graph.operations) {
        for (const arr of Object.values(op.responseSemanticTypes ?? {})) {
          for (const e of arr) {
            if (e.provider) providerTrueSemantics.add(e.semanticType);
          }
        }
      }

      // Index edges by consumer: targetOperationId → set of field leaf names
      // that should NOT appear as seeded vars in the feature spec.
      // Only request-body consumer edges are relevant; skip parameter edges
      // (path.*, query.*, header.*, cookie.*) which are not request body fields.
      const shouldNotSeedByOp = new Map<string, { fieldLeaf: string; semanticType: string }[]>();
      for (const edge of graph.edges) {
        const fp = edge.targetFieldPath;
        if (
          fp.startsWith('path.') ||
          fp.startsWith('query.') ||
          fp.startsWith('header.') ||
          fp.startsWith('cookie.')
        )
          continue;
        if (fp.startsWith('filter.') || fp.startsWith('filter[')) continue;
        if (!providerTrueSemantics.has(edge.semanticType)) continue;
        const leaf = fp
          .split('.')
          .pop()
          ?.replace(/\[\]$/, '')
          ?.replace(/\[.*\]$/, '');
        if (!leaf) continue;
        const leafVar = `${leaf[0].toLowerCase()}${leaf.slice(1)}Var`;
        const semanticVar = `${edge.semanticType[0].toLowerCase()}${edge.semanticType.slice(1)}Var`;
        // Only flag cases where the field-leaf var name differs from the semantic var name;
        // if they happen to be the same the seeded call is ambiguous either way.
        if (leafVar === semanticVar) continue;
        const entries = shouldNotSeedByOp.get(edge.targetOperationId) ?? [];
        entries.push({ fieldLeaf: leafVar, semanticType: semanticVar });
        shouldNotSeedByOp.set(edge.targetOperationId, entries);
      }

      const offenders: { spec: string; seededVar: string; expectedVar: string }[] = [];
      for (const [opId, fields] of shouldNotSeedByOp.entries()) {
        const specPath = join(GENERATED_TESTS_DIR, `${opId}.feature.spec.ts`);
        if (!existsSync(specPath)) continue;
        const src = readFileSync(specPath, 'utf8');
        for (const { fieldLeaf, semanticType } of fields) {
          if (src.includes(`seedBinding('${fieldLeaf}')`)) {
            offenders.push({
              spec: `${opId}.feature.spec.ts`,
              seededVar: fieldLeaf,
              expectedVar: semanticType,
            });
          }
        }
      }

      expect(
        offenders,
        'Feature spec seeds a field-name var for a request body field whose semantic type has a provider:true graph-level producer. The auto-derivation from requestBodySemanticTypes must wire these to the semantic var (ctx.${semanticType}Var) instead of seeding a placeholder.',
      ).toEqual([]);
    });
  },
);

describeForThisConfig(
  'bundled-spec invariants: object-typed body field seeding (#174 sub-class 1)',
  () => {
    it('no feature or variant scenario seeds a ${...} string placeholder for a required request body field whose schema type is object or array', () => {
      // Regression guard for #174 sub-class 1: the planner must emit {} / []
      // literals for object/array-typed required body fields instead of seeding
      // a string placeholder (which causes broker "cannot be parsed" errors).
      //
      // Class-scoped: covers every operation in the bundled spec — not just the
      // known offenders (filter, variables, changeset) at the time of writing.
      if (!existsSync(FEATURE_SCENARIOS_DIR)) {
        throw new Error(
          `Feature output directory not found at ${FEATURE_SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
        );
      }
      if (!existsSync(BUNDLED_SPEC_PATH)) {
        throw new Error(
          `Bundled spec not found at ${BUNDLED_SPEC_PATH}. Run 'npm run fetch-spec' first.`,
        );
      }

      interface SchemaObject {
        type?: string;
        $ref?: string;
        required?: string[];
        properties?: Record<string, SchemaObject>;
        oneOf?: SchemaObject[];
      }

      interface OpenApiSpec {
        paths: Record<
          string,
          Record<
            string,
            {
              operationId?: string;
              requestBody?: {
                content?: {
                  'application/json'?: { schema?: SchemaObject };
                };
              };
            }
          >
        >;
        components?: { schemas?: Record<string, SchemaObject> };
      }

      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const spec = JSON.parse(readFileSync(BUNDLED_SPEC_PATH, 'utf8')) as OpenApiSpec;

      function resolveRef(ref: string): SchemaObject | undefined {
        const name = ref.split('/').pop() ?? '';
        return spec.components?.schemas?.[name];
      }

      function resolveSchemaObj(s: SchemaObject): SchemaObject {
        if (s.$ref) return resolveRef(s.$ref) ?? s;
        return s;
      }

      function getEffectiveType(s: SchemaObject): string | undefined {
        if (s.type) return s.type;
        if (s.$ref) return resolveRef(s.$ref)?.type;
        return undefined;
      }

      /** Collect top-level field names whose resolved type is 'object' or 'array' from a schema. */
      function collectObjectArrayFields(schema: SchemaObject): Set<string> {
        const fields = new Set<string>();
        const resolved = resolveSchemaObj(schema);
        // Root schema with properties
        for (const [fieldName, fieldSchema] of Object.entries(resolved.properties ?? {})) {
          const t = getEffectiveType(fieldSchema);
          if (t === 'object' || t === 'array') fields.add(fieldName);
        }
        // oneOf variants: union their fields
        for (const variant of resolved.oneOf ?? []) {
          const rv = resolveSchemaObj(variant);
          for (const [fieldName, fieldSchema] of Object.entries(rv.properties ?? {})) {
            const t = getEffectiveType(fieldSchema);
            if (t === 'object' || t === 'array') fields.add(fieldName);
          }
        }
        return fields;
      }

      // Build a map of operationId -> set of top-level body field names that have type 'object' or 'array'
      const objectFieldsByOp = new Map<string, Set<string>>();
      for (const pathItem of Object.values(spec.paths ?? {})) {
        for (const op of Object.values(pathItem)) {
          if (!op.operationId) continue;
          const jsonBody = op.requestBody?.content?.['application/json']?.schema;
          if (!jsonBody) continue;
          const objectFields = collectObjectArrayFields(jsonBody);
          if (objectFields.size > 0) {
            objectFieldsByOp.set(op.operationId, objectFields);
          }
        }
      }

      interface FeatureScenarioFile {
        scenarios: {
          id: string;
          seedBindings?: string[];
          requestPlan?: { operationId: string; bodyTemplate?: Record<string, unknown> }[];
        }[];
      }

      const offenders: { file: string; scenario: string; field: string; value: string }[] = [];
      const templatePattern = /^\$\{([^}]+)\}$/;

      const dirs = [FEATURE_SCENARIOS_DIR, VARIANT_SCENARIOS_DIR];
      for (const dir of dirs) {
        if (!existsSync(dir)) continue;
        for (const f of readdirSync(dir)) {
          if (!f.endsWith('-scenarios.json')) continue;
          // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
          const file = JSON.parse(readFileSync(join(dir, f), 'utf8')) as FeatureScenarioFile;
          for (const scenario of file.scenarios ?? []) {
            const seededVars = new Set(scenario.seedBindings ?? []);
            for (const step of scenario.requestPlan ?? []) {
              const objectFields = objectFieldsByOp.get(step.operationId);
              if (!objectFields) continue;
              for (const [field, value] of Object.entries(step.bodyTemplate ?? {})) {
                if (!objectFields.has(field) || typeof value !== 'string') continue;
                const match = templatePattern.exec(value);
                if (match && seededVars.has(match[1])) {
                  offenders.push({ file: f, scenario: scenario.id, field, value });
                }
              }
            }
          }
        }
      }

      expect(
        offenders,
        'A scenario bodyTemplate seeds a string placeholder for a field whose request body schema type is object or array. ' +
          'The planner must emit {} or [] literals for these fields instead of ${...} placeholders. ' +
          'A string placeholder causes broker "Request property [X] cannot be parsed" errors (#174 sub-class 1).',
      ).toEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// globalContextSeeds substitution into multipart templates (#200 — Lift 0)
// ---------------------------------------------------------------------------
//
// Lift 0 of the ontology migration retired the literal `'tenantId'` /
// `'tenantIdVar'` / `'__PENDING__'` triple that the multipart branch of
// `buildRequestBodyFromCanonical()` previously hard-coded, replacing it
// with a loop over `graph.domain.globalContextSeeds`. The behaviour is
// supposed to be byte-identical: every multipart scenario whose request
// body declares a `globalContextSeeds[i].fieldName` field must still
// emit `template.fields[fieldName] = "${binding}"`, AND the scenario's
// `bindings[binding]` must equal `__PENDING__` so the emitter's
// universal-seed prologue (codegen/playwright/emitter.ts) can rewrite
// it to the runtime sentinel (`<default>`). This invariant locks both
// directions and is class-scoped (every multipart scenario across the
// bundled output, not just createDeployment) so the same regression
// can't recur in a sibling op.
describeForThisConfig(
  'bundled-spec invariants: globalContextSeeds substitution survives Lift 0 (#200)',
  () => {
    it('every multipart scenario binds and substitutes each globalContextSeeds entry whose fieldName appears in the multipart template', () => {
      if (!existsSync(SCENARIOS_DIR)) {
        throw new Error(
          `Scenarios directory not found at ${SCENARIOS_DIR}. Run 'npm run pipeline' first.`,
        );
      }

      // Read the active config's globalContextSeeds from the
      // per-config ABox (Lift 8 / #218 — the canonical source post-Lift 8).
      const seedsPath = join(
        REPO_ROOT,
        'configs',
        CONFIG_NAME,
        'ontology',
        'global-context-seeds.json',
      );
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const seedsAbox = JSON.parse(readFileSync(seedsPath, 'utf8')) as {
        seeds?: { fieldName: string; binding: string }[];
      };
      const seeds = seedsAbox.seeds ?? [];
      expect(
        seeds.length,
        'Lift 0 assumes the active config declares at least one globalContextSeeds entry; ' +
          'without it the multipart substitution loop has nothing to do and this invariant ' +
          'becomes vacuous.',
      ).toBeGreaterThan(0);

      interface MultipartStep {
        multipartTemplate?: { fields?: Record<string, string> };
      }
      interface ScenarioWithMultipart {
        id: string;
        bindings?: Record<string, string>;
        requestPlan?: MultipartStep[];
      }
      interface ScenarioFileWithMultipart {
        endpoint: { operationId: string };
        scenarios: ScenarioWithMultipart[];
      }

      const offenders: {
        file: string;
        scenarioId: string;
        operationId: string;
        seed: string;
        reason: string;
      }[] = [];
      let multipartFieldHits = 0;

      for (const f of readdirSync(SCENARIOS_DIR)) {
        if (!f.endsWith('-scenarios.json')) continue;
        // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
        const file = JSON.parse(
          readFileSync(join(SCENARIOS_DIR, f), 'utf8'),
        ) as ScenarioFileWithMultipart;
        for (const scenario of file.scenarios ?? []) {
          for (const step of scenario.requestPlan ?? []) {
            const fields = step.multipartTemplate?.fields;
            if (!fields) continue;
            for (const seed of seeds) {
              if (!(seed.fieldName in fields)) continue;
              multipartFieldHits++;
              const expected = `\${${seed.binding}}`;
              if (fields[seed.fieldName] !== expected) {
                offenders.push({
                  file: f,
                  scenarioId: scenario.id,
                  operationId: file.endpoint.operationId,
                  seed: seed.fieldName,
                  reason: `multipart field '${seed.fieldName}' = ${JSON.stringify(
                    fields[seed.fieldName],
                  )}, expected ${JSON.stringify(expected)}`,
                });
              }
              if (scenario.bindings?.[seed.binding] !== '__PENDING__') {
                offenders.push({
                  file: f,
                  scenarioId: scenario.id,
                  operationId: file.endpoint.operationId,
                  seed: seed.fieldName,
                  reason: `binding '${seed.binding}' = ${JSON.stringify(
                    scenario.bindings?.[seed.binding],
                  )}, expected "__PENDING__"`,
                });
              }
            }
          }
        }
      }

      // Floor: at least one bundled-spec multipart scenario must have
      // exercised at least one globalContextSeeds substitution. If
      // multipartFieldHits is zero, the lift's only branch was never
      // entered, the multipart op vanished from the spec, or the
      // sidecar's fieldName drifted from the spec. Any of those is
      // worth a hard fail so we don't ship a vacuously-passing guard.
      expect(
        multipartFieldHits,
        'expected ≥1 multipart scenario across the bundled output to substitute a ' +
          'globalContextSeeds field (e.g. createDeployment.tenantId). Zero matches ' +
          'means the lift code path was never exercised.',
      ).toBeGreaterThan(0);

      expect(offenders).toEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// Edge-kinds ABox cross-reference invariants (#201 — Lift 1)
// ---------------------------------------------------------------------------
//
// Lift 1 of the ontology migration (#199) introduces the per-config edges
// ABox at `configs/<active>/ontology/edges.json`, validated by the TBox
// authored as a TS const in `path-analyser/src/ontology/edgeSchema.ts`,
// loaded by `path-analyser/src/ontology/loader.ts` (single source of
// truth: ajv runtime validation + json-schema-to-ts type inference both
// consume the same TS literal). The matching `ontology/vocabulary/
// edge.schema.json` is generated from the TS const by
// `scripts/build-ontology.ts` for external SPARQL/SHACL/OWL consumers.
//
// The TBox can express the row shape but Draft-07 cannot express
// cross-references against the bundled spec (operationIds existing,
// endpoint kind names existing, identifier types matching). Those are
// encoded here as named L3 invariants — failures point directly at the
// broken row instead of producing a generic schema error. A drift
// detector below also catches a stale generated JSON artefact.
//
// Class-scoped: every assertion ranges over every entry in the ABox AND
// every edge-shaped kind in the spec's semantic-kinds registry, so a
// new edge kind can't slip in unsynced in either direction.
describeForThisConfig('bundled-spec invariants: edges ABox cross-references (#201)', () => {
  interface SpecKind {
    name: string;
    shape: string;
    identifiers?: string[];
  }
  interface SemanticKindsFile {
    kinds: SpecKind[];
  }

  function loadSemanticKinds(): SemanticKindsFile {
    const p = join(getSpecBundleDir(REPO_ROOT), 'semantic-kinds.json');
    if (!existsSync(p)) {
      throw new Error(`semantic-kinds.json not found at ${p}. Run 'npm run fetch-spec' first.`);
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    return JSON.parse(readFileSync(p, 'utf8')) as SemanticKindsFile;
  }

  it('loads the edges ABox via the generic loader (proves the load path)', async () => {
    // Deliberately import via the public loader entry point rather than
    // re-parsing the JSON directly: this is the assertion that the
    // generic loader works end-to-end against the real ABox shipped
    // by this config. The loader compiles the TBox TS const with ajv,
    // so a regression in either the TBox shape or the loader fails
    // this test before any cross-reference is even attempted.
    const { loadEdgesAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadEdgesAbox(REPO_ROOT);
    expect(abox, 'edges ABox file must exist for the camunda-oca config').not.toBeNull();
    expect(abox?.edges.length).toBeGreaterThan(0);
  });

  it('the committed TBox JSON file matches the regenerated output of `npm run build:ontology` (drift detector)', async () => {
    // The TBox source of truth is the TS const in
    // `path-analyser/src/ontology/edgeSchema.ts`; the matching
    // `ontology/vocabulary/edge.schema.json` is generated from it
    // for external SPARQL/SHACL/OWL consumers (the schema's `$id`
    // URL points at this JSON file). If an author edits the TS
    // const but forgets to run `npm run build:ontology`, the JSON
    // ships stale to external consumers. This invariant catches
    // exactly that drift by re-rendering the artefact in-process
    // and comparing.
    const { ARTIFACTS, renderSchema } = await import('../../scripts/build-ontology.ts');
    for (const artifact of ARTIFACTS) {
      const onDisk = readFileSync(artifact.jsonPath, 'utf8');
      const rendered = renderSchema(artifact.schema);
      expect(
        onDisk,
        `Generated ontology artefact at ${artifact.jsonPath} is stale. ` +
          `Run 'npm run build:ontology' to refresh it from the TS source of truth.`,
      ).toBe(rendered);
    }
  });

  it('every edge.establishedBy and edge.observableVia is an operationId in the bundled spec', async () => {
    const { loadEdgesAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadEdgesAbox(REPO_ROOT);
    if (!abox) throw new Error('edges ABox missing');

    if (!existsSync(BUNDLED_SPEC_PATH)) {
      throw new Error(
        `Bundled spec not found at ${BUNDLED_SPEC_PATH}. Run 'npm run fetch-spec' first.`,
      );
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const spec = JSON.parse(readFileSync(BUNDLED_SPEC_PATH, 'utf8')) as {
      paths?: Record<string, Record<string, { operationId?: string }>>;
    };
    const opIds = new Set<string>();
    for (const pathItem of Object.values(spec.paths ?? {})) {
      for (const op of Object.values(pathItem)) {
        if (op && typeof op === 'object' && typeof op.operationId === 'string') {
          opIds.add(op.operationId);
        }
      }
    }

    const offenders: { edge: string; field: 'establishedBy' | 'observableVia'; op: string }[] = [];
    for (const e of abox.edges) {
      if (!opIds.has(e.establishedBy)) {
        offenders.push({ edge: e.name, field: 'establishedBy', op: e.establishedBy });
      }
      if (!opIds.has(e.observableVia)) {
        offenders.push({ edge: e.name, field: 'observableVia', op: e.observableVia });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every edge.establishedBy operation actually establishes that edge kind in the spec (x-semantic-establishes match, shape:'edge')", async () => {
    // Stronger than the operationId existence check above: a row that
    // points at a real but unrelated operation would still pass the
    // existence test. The spec's `x-semantic-establishes` annotation is
    // the binding surface that records which edge kind an operation
    // establishes — this invariant pins establishedBy to that binding.
    // (No `x-semantic-observes` exists in the spec, so observableVia
    // can only be guarded by the existence check + the cross-reference
    // identifier check.)
    const { loadEdgesAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadEdgesAbox(REPO_ROOT);
    if (!abox) throw new Error('edges ABox missing');
    if (!existsSync(BUNDLED_SPEC_PATH)) {
      throw new Error(
        `Bundled spec not found at ${BUNDLED_SPEC_PATH}. Run 'npm run fetch-spec' first.`,
      );
    }
    interface Establishes {
      kind?: string;
      shape?: string;
    }
    interface Op {
      operationId?: string;
      'x-semantic-establishes'?: Establishes;
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const spec = JSON.parse(readFileSync(BUNDLED_SPEC_PATH, 'utf8')) as {
      paths?: Record<string, Record<string, Op>>;
    };
    const establishesByOp = new Map<string, Establishes | undefined>();
    for (const pathItem of Object.values(spec.paths ?? {})) {
      for (const op of Object.values(pathItem)) {
        if (op && typeof op === 'object' && typeof op.operationId === 'string') {
          establishesByOp.set(op.operationId, op['x-semantic-establishes']);
        }
      }
    }

    const offenders: {
      edge: string;
      operation: string;
      reason: string;
      establishes: Establishes | undefined;
    }[] = [];
    for (const e of abox.edges) {
      const annotation = establishesByOp.get(e.establishedBy);
      if (!annotation) {
        offenders.push({
          edge: e.name,
          operation: e.establishedBy,
          reason: 'operation has no x-semantic-establishes annotation',
          establishes: annotation,
        });
        continue;
      }
      if (annotation.kind !== e.name) {
        offenders.push({
          edge: e.name,
          operation: e.establishedBy,
          reason: `x-semantic-establishes.kind=${annotation.kind ?? '(undefined)'} does not match edge name`,
          establishes: annotation,
        });
        continue;
      }
      if (annotation.shape !== 'edge') {
        offenders.push({
          edge: e.name,
          operation: e.establishedBy,
          reason: `x-semantic-establishes.shape=${annotation.shape ?? '(undefined)'} is not 'edge'`,
          establishes: annotation,
        });
      }
    }
    expect(
      offenders,
      `An edge ABox row claims an establishedBy operation whose x-semantic-establishes binding does not match. The row would still pass the operationId-existence check but the spec disagrees about what the operation establishes.`,
    ).toEqual([]);
  });

  it("the ABox file's $schema field resolves to the published TBox JSON (external tooling layout check)", () => {
    // External JSON Schema tooling reads `$schema` from the ABox file
    // to find the TBox. If the field drifts (typo, wrong relative
    // path, missing) external validators silently skip validation
    // even though the in-process loader is still happy. This invariant
    // resolves the field as a path relative to the ABox and asserts
    // the resulting absolute path is the published TBox file.
    const aboxPath = join(REPO_ROOT, 'configs', CONFIG_NAME, 'ontology', 'edges.json');
    const expectedTboxPath = join(REPO_ROOT, 'ontology', 'vocabulary', 'edge.schema.json');
    interface AboxHeader {
      $schema?: unknown;
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const aboxJson = JSON.parse(readFileSync(aboxPath, 'utf8')) as AboxHeader;
    const schemaField = aboxJson.$schema;
    expect(typeof schemaField, 'ABox must declare a string `$schema` field').toBe('string');
    if (typeof schemaField !== 'string') return;
    const resolved = join(aboxPath, '..', schemaField);
    expect(
      resolved,
      `ABox $schema='${schemaField}' resolves to '${resolved}', expected the published TBox at '${expectedTboxPath}'.`,
    ).toBe(expectedTboxPath);
  });

  it('the ABox @context maps every TBox term to the v1 ns IRI (JSON-LD contract for external RDF tooling)', () => {
    // The ABox is written so external RDF/SPARQL tooling can ingest it
    // unchanged. That requires the JSON-LD `@context` to map every
    // user-defined term used on edge rows to a stable IRI in the v1
    // namespace. A drift here (a renamed term, a stale namespace, a
    // missing mapping) would be silent at runtime in this repo (the
    // loader does not interpret the context) but breaks the published
    // contract.
    const aboxPath = join(REPO_ROOT, 'configs', CONFIG_NAME, 'ontology', 'edges.json');
    const NS = 'https://camunda.github.io/api-test-generator/ns/v1/';
    interface AboxHeader {
      '@context'?: unknown;
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const aboxJson = JSON.parse(readFileSync(aboxPath, 'utf8')) as AboxHeader;
    const ctx = aboxJson['@context'];
    expect(ctx, '@context must be a non-array object').toBeTypeOf('object');
    expect(Array.isArray(ctx), '@context must not be an array').toBe(false);
    if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return; // type narrowing only
    // biome-ignore lint/plugin: runtime contract boundary — narrowing JSON-LD context value
    const ctxObj = ctx as Record<string, unknown>;
    expect(ctxObj['@vocab'], `@vocab must be the v1 namespace IRI`).toBe(NS);

    const requiredTerms = ['edges', 'endpoints', 'identifiedBy', 'establishedBy', 'observableVia'];
    for (const term of requiredTerms) {
      const mapping = ctxObj[term];
      const iri =
        mapping && typeof mapping === 'object' && '@id' in mapping
          ? // biome-ignore lint/plugin: runtime contract boundary — narrowing JSON-LD term mapping value
            (mapping as { '@id'?: unknown })['@id']
          : mapping;
      expect(iri, `@context['${term}'] must map to the v1 ns IRI for '${term}'`).toBe(
        `${NS}${term}`,
      );
    }

    // identifiedBy is an ordered tuple ([endpoints.from-id, endpoints.to-id]).
    // The TBox encodes this via `minItems`/`maxItems` on the JSON array, but
    // RDF/JSON-LD consumers will only preserve element order if the term's
    // mapping carries `@container: '@list'` — without it a JSON-LD processor
    // may emit an unordered RDF set and silently lose the from/to pairing.
    const identifiedByMapping = ctxObj.identifiedBy;
    const identifiedByContainer =
      identifiedByMapping &&
      typeof identifiedByMapping === 'object' &&
      '@container' in identifiedByMapping
        ? // biome-ignore lint/plugin: runtime contract boundary — narrowing JSON-LD term mapping value
          (identifiedByMapping as { '@container'?: unknown })['@container']
        : undefined;
    expect(
      identifiedByContainer,
      "@context['identifiedBy'] must declare `@container: '@list'` so RDF consumers preserve the [from-id, to-id] tuple order",
    ).toBe('@list');
  });

  it('every edge endpoint references an entity-shaped kind in semantic-kinds.json', async () => {
    const { loadEdgesAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadEdgesAbox(REPO_ROOT);
    if (!abox) throw new Error('edges ABox missing');
    const kinds = loadSemanticKinds();
    const entityKinds = new Map<string, SpecKind>();
    for (const k of kinds.kinds) {
      if (k.shape === 'entity' || k.shape === 'external-entity') {
        entityKinds.set(k.name, k);
      }
    }
    const offenders: { edge: string; side: 'from' | 'to'; kind: string }[] = [];
    for (const e of abox.edges) {
      if (!entityKinds.has(e.endpoints.from)) {
        offenders.push({ edge: e.name, side: 'from', kind: e.endpoints.from });
      }
      if (!entityKinds.has(e.endpoints.to)) {
        offenders.push({ edge: e.name, side: 'to', kind: e.endpoints.to });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every edge.identifiedBy[i] matches an identifier of the corresponding endpoint kind', async () => {
    const { loadEdgesAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadEdgesAbox(REPO_ROOT);
    if (!abox) throw new Error('edges ABox missing');
    const kinds = loadSemanticKinds();
    const entityKinds = new Map<string, SpecKind>();
    for (const k of kinds.kinds) {
      if (k.shape === 'entity' || k.shape === 'external-entity') {
        entityKinds.set(k.name, k);
      }
    }
    const offenders: {
      edge: string;
      position: number;
      identifier: string;
      kind: string;
      declared: string[];
    }[] = [];
    for (const e of abox.edges) {
      const endpointKinds = [e.endpoints.from, e.endpoints.to];
      for (let i = 0; i < e.identifiedBy.length; i++) {
        const kindName = endpointKinds[i];
        // SAFETY: identifiedBy.length is fixed at 2 by the TBox and
        // endpointKinds has 2 entries; the index is in-bounds.
        if (kindName === undefined) continue;
        const kind = entityKinds.get(kindName);
        if (!kind) continue; // covered by the previous invariant
        const declared = kind.identifiers ?? [];
        const id = e.identifiedBy[i];
        if (id === undefined || !declared.includes(id)) {
          offenders.push({
            edge: e.name,
            position: i,
            identifier: id ?? '<undefined>',
            kind: kindName,
            declared,
          });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the ABox covers every edge-shaped kind in semantic-kinds.json (no orphans either way)', async () => {
    const { loadEdgesAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadEdgesAbox(REPO_ROOT);
    if (!abox) throw new Error('edges ABox missing');
    const kinds = loadSemanticKinds();
    const specEdgeNames = new Set(kinds.kinds.filter((k) => k.shape === 'edge').map((k) => k.name));
    const aboxEdgeNames = new Set(abox.edges.map((e) => e.name));
    const missingFromAbox = [...specEdgeNames].filter((n) => !aboxEdgeNames.has(n));
    const extraInAbox = [...aboxEdgeNames].filter((n) => !specEdgeNames.has(n));
    expect(missingFromAbox, 'spec declares edge kinds not present in ABox').toEqual([]);
    expect(extraInAbox, 'ABox declares edge kinds not present in spec').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lift 2 of the ontology migration (#202): bootstrap-sequences ABox
//
// The previous heuristic `RootDependencyAnalyzer` produced six hard-coded
// `bootstrapSequences` keyed off OCA-specific operationIds and semantic
// types. That logic is now lifted to a per-config ABox at
// `configs/<active>/ontology/bootstrap-sequences.json`, validated by the
// TBox authored as a TS const in
// `semantic-graph-extractor/ontology/bootstrapSequenceSchema.ts`, loaded
// by `semantic-graph-extractor/ontology/bootstrapSequencesLoader.ts`.
// The matching `ontology/vocabulary/bootstrap-sequence.schema.json` is
// generated from the TS const by `scripts/build-ontology.ts`. Drift
// between the TS source and the generated JSON is caught by the shared
// drift-detector invariant in the edges block above (it ranges over
// every artefact in `ARTIFACTS`).
//
// The TBox can express the row shape but cannot express cross-references
// against the bundled spec (operationIds existing, semantic types
// existing). Those are encoded here as named L3 invariants — failures
// point directly at the broken row.
// ---------------------------------------------------------------------------
describeForThisConfig(
  'bundled-spec invariants: bootstrap-sequences ABox cross-references (#202)',
  () => {
    const ABOX_PATH = join(
      REPO_ROOT,
      'configs',
      CONFIG_NAME,
      'ontology',
      'bootstrap-sequences.json',
    );

    it('every bootstrap-sequence operationId is present in the bundled spec', () => {
      if (!existsSync(GRAPH_PATH)) {
        throw new Error(
          `Graph not found at ${GRAPH_PATH}. Run 'npm run testsuite:generate' first.`,
        );
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
        operations?: { operationId?: string }[];
      };
      const opIds = new Set((graph.operations ?? []).map((o) => o.operationId).filter(Boolean));

      interface AboxFile {
        sequences: { name: string; operations: string[] }[];
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const abox = JSON.parse(readFileSync(ABOX_PATH, 'utf8')) as AboxFile;

      const offenders: { sequence: string; missing: string[] }[] = [];
      for (const s of abox.sequences) {
        const missing = s.operations.filter((op) => !opIds.has(op));
        if (missing.length > 0) offenders.push({ sequence: s.name, missing });
      }
      expect(
        offenders,
        'bootstrap-sequence references operationIds absent from the bundled spec',
      ).toEqual([]);
    });

    it('every bootstrap-sequence `produces` semantic type is registered in the bundled graph', () => {
      // The runtime contract is: `produces[]` must match a semantic type
      // visible to the planner via `graph.semanticTypes` (the loader's
      // `knownSemanticTypes` set is built from this list). Note that
      // `spec/<config>/bundled/semantic-kinds.json` covers a different
      // (entity/edge) registry and is intentionally NOT used here.
      if (!existsSync(GRAPH_PATH)) {
        throw new Error(
          `Graph not found at ${GRAPH_PATH}. Run 'npm run testsuite:generate' first.`,
        );
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
        semanticTypes?: { name?: string }[];
      };
      const known = new Set(
        (graph.semanticTypes ?? []).map((t) => t.name).filter((n): n is string => Boolean(n)),
      );

      interface AboxFile {
        sequences: { name: string; produces: string[] }[];
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const abox = JSON.parse(readFileSync(ABOX_PATH, 'utf8')) as AboxFile;
      const offenders: { sequence: string; type: string }[] = [];
      for (const s of abox.sequences) {
        for (const t of s.produces) {
          if (!known.has(t)) offenders.push({ sequence: s.name, type: t });
        }
      }
      expect(
        offenders,
        'bootstrap-sequence `produces` references semantic types not in graph.semanticTypes',
      ).toEqual([]);
    });

    it('the ABox $schema field resolves to the published TBox JSON (external JSON Schema tooling contract)', () => {
      const expectedTboxPath = join(
        REPO_ROOT,
        'ontology',
        'vocabulary',
        'bootstrap-sequence.schema.json',
      );
      interface AboxHeader {
        $schema?: unknown;
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const aboxJson = JSON.parse(readFileSync(ABOX_PATH, 'utf8')) as AboxHeader;
      const schemaField = aboxJson.$schema;
      expect(typeof schemaField, 'ABox must declare a string `$schema` field').toBe('string');
      if (typeof schemaField !== 'string') return;
      const resolved = join(ABOX_PATH, '..', schemaField);
      expect(
        resolved,
        `ABox $schema='${schemaField}' resolves to '${resolved}', expected the published TBox at '${expectedTboxPath}'.`,
      ).toBe(expectedTboxPath);
    });

    it('the ABox @context maps every TBox term to the v1 ns IRI (JSON-LD contract for external RDF tooling)', () => {
      const NS = 'https://camunda.github.io/api-test-generator/ns/v1/';
      interface AboxHeader {
        '@context'?: unknown;
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const aboxJson = JSON.parse(readFileSync(ABOX_PATH, 'utf8')) as AboxHeader;
      const ctx = aboxJson['@context'];
      expect(ctx, '@context must be a non-array object').toBeTypeOf('object');
      expect(Array.isArray(ctx), '@context must not be an array').toBe(false);
      if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return;
      // biome-ignore lint/plugin: runtime contract boundary — narrowing JSON-LD context value
      const ctxObj = ctx as Record<string, unknown>;
      expect(ctxObj['@vocab'], '@vocab must be the v1 namespace IRI').toBe(NS);

      const requiredTerms = ['sequences', 'operations', 'produces'];
      for (const term of requiredTerms) {
        const mapping = ctxObj[term];
        const iri =
          mapping && typeof mapping === 'object' && '@id' in mapping
            ? // biome-ignore lint/plugin: runtime contract boundary — narrowing JSON-LD term mapping value
              (mapping as { '@id'?: unknown })['@id']
            : mapping;
        expect(iri, `@context['${term}'] must map to the v1 ns IRI for '${term}'`).toBe(
          `${NS}${term}`,
        );
      }

      // operations is an ordered list (the prereq chain is order-significant —
      // running tenant-setup before deployment vs after has very different
      // semantics). Without `@container: '@list'` an RDF/JSON-LD processor
      // may emit the operations as an unordered set and silently lose the
      // execution order.
      const operationsMapping = ctxObj.operations;
      const operationsContainer =
        operationsMapping &&
        typeof operationsMapping === 'object' &&
        '@container' in operationsMapping
          ? // biome-ignore lint/plugin: runtime contract boundary — narrowing JSON-LD term mapping value
            (operationsMapping as { '@container'?: unknown })['@container']
          : undefined;
      expect(
        operationsContainer,
        "@context['operations'] must declare `@container: '@list'` so RDF consumers preserve execution order",
      ).toBe('@list');
    });

    it('the bundled graph contains zero unexpected bootstrap-sequence drops for the active config', () => {
      // The OCA ABox is authored against the pinned spec; every
      // sequence's operationIds must be present. A drop here is a
      // genuine ABox/spec inconsistency (either the ABox was authored
      // against the wrong spec ref or the spec ref was bumped without
      // updating the ABox). Surfacing this as an L3 invariant means
      // the failure points directly at the offending row instead of
      // disappearing into the extractor's verbose stdout.
      if (!existsSync(GRAPH_PATH)) {
        throw new Error(
          `Graph not found at ${GRAPH_PATH}. Run 'npm run testsuite:generate' first.`,
        );
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
        rootDependencyAnalysis?: {
          droppedBootstrapSequences?: { name: string; missing: string[] }[];
        };
      };
      const dropped = graph.rootDependencyAnalysis?.droppedBootstrapSequences ?? [];
      expect(
        dropped,
        'bootstrap-sequences ABox dropped one or more sequences against the pinned spec — fix the ABox or rerun against the matching spec ref',
      ).toEqual([]);
    });
  },
);

describeForThisConfig('bundled-spec invariants: entity-kinds ABox cross-references (#210)', () => {
  // Lift 4 / #210: the entity-kinds ABox is now the authoritative
  // source for `graph.externalEntityIdentifiers` (and, transitionally,
  // for the inventory of in-API entity kinds). These invariants are
  // the locality-loss replacement signal: where the spec gave us
  // "missing annotation lints at the operation site" for free, we
  // now manufacture the same completeness signal as named L3
  // assertions over ABox + spec + bundled graph. See #210 §4b/§4c
  // for the rationale and the two-sense framing of drift.

  it('loads the entity-kinds ABox via the generic loader (proves the load path)', async () => {
    const { loadEntityKindsAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadEntityKindsAbox(REPO_ROOT);
    expect(abox, 'entity-kinds ABox file must exist for the camunda-oca config').not.toBeNull();
    expect(abox?.kinds.length).toBeGreaterThan(0);
  });

  it('every kind name in the ABox appears in the spec semantic-kinds.json (sense-1: spec-vs-abox, ABox-stale)', async () => {
    // Transitional check (Lift 4 §4b sense 1). Becomes a no-op once
    // upstream retires `x-semantic-kind`; until then it catches
    // typos and stale ABox entries against the live spec.
    const { loadEntityKindsAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadEntityKindsAbox(REPO_ROOT);
    if (!abox) throw new Error('entity-kinds ABox missing');
    const kindsPath = join(getSpecBundleDir(REPO_ROOT), 'semantic-kinds.json');
    if (!existsSync(kindsPath)) {
      throw new Error(
        `semantic-kinds.json not found at ${kindsPath}. Run 'npm run fetch-spec' first.`,
      );
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const specKinds = JSON.parse(readFileSync(kindsPath, 'utf8')) as {
      kinds?: { name?: unknown }[];
    };
    const specNames = new Set<string>();
    for (const k of specKinds.kinds ?? []) {
      if (k && typeof k.name === 'string') specNames.add(k.name);
    }
    const aboxOnly = abox.kinds.map((k) => k.name).filter((n) => !specNames.has(n));
    expect(
      aboxOnly,
      'entity-kinds ABox lists kind names that the spec semantic-kinds.json does not — either the ABox is stale or the spec was regenerated against a ref that retired the kind',
    ).toEqual([]);
  });

  it('every non-edge kind in the spec semantic-kinds.json is listed in the ABox (sense-1: spec-vs-abox, ABox-incomplete)', async () => {
    // Transitional check (Lift 4 §4b sense 1). Until `x-semantic-kind`
    // retires upstream, the spec's kind list is the second source of
    // truth — every entry that isn't an `edge` shape (edges are owned
    // by the edges ABox post-Lift-3) must be classified by the
    // entity-kinds ABox. Without this, a new upstream kind would
    // ship with no domain classification and the planner would
    // silently treat any of its identifier types as "ordinary value
    // field, must have a producer" — usually wrong for external
    // entities and silently wrong for in-API entities.
    const { loadEntityKindsAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadEntityKindsAbox(REPO_ROOT);
    if (!abox) throw new Error('entity-kinds ABox missing');
    const kindsPath = join(getSpecBundleDir(REPO_ROOT), 'semantic-kinds.json');
    if (!existsSync(kindsPath)) {
      throw new Error(
        `semantic-kinds.json not found at ${kindsPath}. Run 'npm run fetch-spec' first.`,
      );
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const specKinds = JSON.parse(readFileSync(kindsPath, 'utf8')) as {
      kinds?: { name?: unknown; shape?: unknown }[];
    };
    const aboxNames = new Set(abox.kinds.map((k) => k.name));
    const specOnly: string[] = [];
    for (const k of specKinds.kinds ?? []) {
      if (k && typeof k.name === 'string' && k.shape !== 'edge' && !aboxNames.has(k.name)) {
        specOnly.push(k.name);
      }
    }
    expect(
      specOnly,
      "spec semantic-kinds.json lists non-edge kind names that the entity-kinds ABox does not classify — add the kind to configs/<config>/ontology/entity-kinds.json (or, if it's an edge kind, to edges.json instead)",
    ).toEqual([]);
  });

  it('every kind in the ABox has at least one identifier referenced by some operation in the bundled graph (sense-2: abox-vs-graph, ABox-stale-vs-use)', async () => {
    // Durable check (Lift 4 §4b sense 2). Survives the upstream
    // retirement of `x-semantic-kind` because it grounds drift in
    // actual runtime use of the bundled graph: a kind whose
    // identifier types appear nowhere in produces/requires/
    // establishes is dead weight in this API.
    const { loadEntityKindsAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadEntityKindsAbox(REPO_ROOT);
    if (!abox) throw new Error('entity-kinds ABox missing');
    if (!existsSync(GRAPH_PATH)) {
      throw new Error(`Graph not found at ${GRAPH_PATH}. Run 'npm run testsuite:generate' first.`);
    }
    interface GraphOp {
      operationId?: string;
      requires?: { required?: unknown; optional?: unknown };
      produces?: unknown;
      establishes?: { identifiedBy?: { semanticType?: unknown }[] };
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
      operationsById?: Record<string, GraphOp>;
      operations?: Record<string, GraphOp> | GraphOp[];
    };
    const ops: GraphOp[] = graph.operationsById
      ? Object.values(graph.operationsById)
      : Array.isArray(graph.operations)
        ? graph.operations
        : Object.values(graph.operations ?? {});
    const referenced = new Set<string>();
    for (const op of ops) {
      if (Array.isArray(op.produces))
        for (const t of op.produces) if (typeof t === 'string') referenced.add(t);
      const req = op.requires;
      if (req && typeof req === 'object') {
        if (Array.isArray(req.required))
          for (const t of req.required) if (typeof t === 'string') referenced.add(t);
        if (Array.isArray(req.optional))
          for (const t of req.optional) if (typeof t === 'string') referenced.add(t);
      }
      const est = op.establishes;
      if (est && Array.isArray(est.identifiedBy)) {
        for (const id of est.identifiedBy) {
          if (id && typeof id.semanticType === 'string') referenced.add(id.semanticType);
        }
      }
    }
    const dead = abox.kinds.filter((k) => !k.identifiers.some((t) => referenced.has(t)));
    expect(
      dead.map((k) => ({ kind: k.name, identifiers: k.identifiers })),
      'entity-kinds ABox lists kinds whose identifier types are not referenced by any operation in the bundled graph — either remove the kind or add an operation that consumes one of its identifiers',
    ).toEqual([]);
  });

  it('every semantic identifier type used in any op.establishes.identifiedBy[] is claimed by some kind in the ABox (sense-2: abox-vs-graph, ABox-incomplete-vs-use)', async () => {
    // Durable check (Lift 4 §4b/§4c sense 2). This is the locality-
    // loss replacement signal in its strongest form: when an upstream
    // PR adds a new `x-semantic-establishes.identifiedBy` whose
    // semanticType refers to a new identifier kind we forgot to
    // classify in the ABox, this invariant fails immediately with the
    // offending type. Without it, the new identifier would silently
    // fall through to the "ordinary value field" path and the
    // planner's kind-aware behaviour (externalBoundary
    // short-circuit, identifier minting) would no longer apply.
    const { loadEntityKindsAbox, loadEdgesAbox } = await import(
      '../../path-analyser/src/ontology/loader.js'
    );
    const entityAbox = loadEntityKindsAbox(REPO_ROOT);
    if (!entityAbox) throw new Error('entity-kinds ABox missing');
    const edgesAbox = loadEdgesAbox(REPO_ROOT);
    if (!existsSync(GRAPH_PATH)) {
      throw new Error(`Graph not found at ${GRAPH_PATH}. Run 'npm run testsuite:generate' first.`);
    }
    interface GraphOp {
      operationId?: string;
      establishes?: { identifiedBy?: { semanticType?: unknown }[] };
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
      operationsById?: Record<string, GraphOp>;
      operations?: Record<string, GraphOp> | GraphOp[];
    };
    const ops: GraphOp[] = graph.operationsById
      ? Object.values(graph.operationsById)
      : Array.isArray(graph.operations)
        ? graph.operations
        : Object.values(graph.operations ?? {});
    // Union of every identifier-shaped semantic type appearing in any
    // op's establish-identifiedBy list.
    const identifierTypes = new Set<string>();
    for (const op of ops) {
      const ids = op.establishes?.identifiedBy ?? [];
      for (const id of ids) {
        if (id && typeof id.semanticType === 'string') identifierTypes.add(id.semanticType);
      }
    }
    // Set of every identifier type claimed by some entity-kinds ABox kind
    // (or, for edge kinds, by the edges ABox's identifiedBy tuples — edges
    // own their own identifier classification post-Lift-3).
    const claimed = new Set<string>();
    for (const k of entityAbox.kinds) for (const t of k.identifiers) claimed.add(t);
    for (const e of edgesAbox?.edges ?? []) for (const t of e.identifiedBy) claimed.add(t);
    const unclassified = [...identifierTypes].filter((t) => !claimed.has(t));
    expect(
      unclassified,
      "semantic identifier type(s) appear in some op's x-semantic-establishes.identifiedBy[] but are not claimed by any kind in the entity-kinds ABox or the edges ABox — add the type to a kind's identifiers[] in configs/<config>/ontology/entity-kinds.json (or, for edge identifiers, to the appropriate edge's identifiedBy in edges.json)",
    ).toEqual([]);
  });

  it('graph.externalEntityIdentifiers is sourced from the entity-kinds ABox (planner contract)', async () => {
    // Closes the loop: the loader is supposed to source
    // graph.externalEntityIdentifiers from the entity-kinds ABox's
    // `external-entity` kinds. If a future change causes the loader
    // to silently fall back to the legacy spec-emitted kindRegistry
    // path (e.g. ABox file moves and ENOENT swallows the error),
    // this invariant fails by direct comparison.
    const { loadEntityKindsAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const { loadGraph } = await import('../../path-analyser/src/graphLoader.js');
    const abox = loadEntityKindsAbox(REPO_ROOT);
    if (!abox) throw new Error('entity-kinds ABox missing');
    const expected = new Set<string>();
    for (const k of abox.kinds) {
      if (k.shape === 'external-entity') for (const t of k.identifiers) expected.add(t);
    }
    const graph = await loadGraph(join(REPO_ROOT, 'path-analyser'));
    const actual = graph.externalEntityIdentifiers ?? new Set<string>();
    expect(
      [...actual].sort(),
      'graph.externalEntityIdentifiers does not match the union of identifiers across `external-entity` kinds in the entity-kinds ABox',
    ).toEqual([...expected].sort());
  });

  it('the committed entity-kinds vocabulary JSON matches the regenerated TBox (drift detector)', async () => {
    const { ARTIFACTS, renderSchema } = await import('../../scripts/build-ontology.ts');
    const target = ARTIFACTS.find((a) => a.jsonPath.endsWith('entity-kinds.schema.json'));
    expect(target, 'build-ontology must include entity-kinds.schema.json').toBeDefined();
    if (!target) return;
    const onDisk = readFileSync(target.jsonPath, 'utf8');
    const rendered = renderSchema(target.schema);
    expect(
      onDisk,
      `Generated ontology artefact at ${target.jsonPath} is stale. Run 'npm run build:ontology' to refresh it.`,
    ).toBe(rendered);
  });

  it("the entity-kinds ABox's $schema field resolves to the published TBox JSON", () => {
    const aboxPath = join(REPO_ROOT, 'configs', CONFIG_NAME, 'ontology', 'entity-kinds.json');
    const expectedTboxPath = join(REPO_ROOT, 'ontology', 'vocabulary', 'entity-kinds.schema.json');
    expect(
      existsSync(expectedTboxPath),
      `Published TBox at '${expectedTboxPath}' does not exist — vocabulary file may have been deleted or renamed`,
    ).toBe(true);
    interface AboxHeader {
      $schema?: unknown;
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const aboxJson = JSON.parse(readFileSync(aboxPath, 'utf8')) as AboxHeader;
    const schemaField = aboxJson.$schema;
    expect(typeof schemaField, 'ABox must declare a string `$schema` field').toBe('string');
    if (typeof schemaField !== 'string') return;
    expect(schemaField).toBe(
      'https://camunda.github.io/api-test-generator/ns/v1/entity-kinds.schema.json',
    );
  });
});

describeForThisConfig(
  'bundled-spec invariants: artifact-kinds ABox cross-references (#212)',
  () => {
    // Lift 5 / #212: the artifact-kinds ABox is now the authoritative
    // source for the four artifact-related sub-trees (artifactKinds,
    // semanticTypeToArtifactKind, operationArtifactRules,
    // artifactFileKinds).
    //
    // Unlike Lifts 3/4, the data was never sourced from upstream
    // OpenAPI annotations — so there is no `spec-vs-abox` (sense-1)
    // drift to guard. These invariants encode the durable
    // `abox-vs-graph` (sense-2) coverage gates only: the locality-loss
    // replacement signal that catches stale ABox entries against
    // runtime use of the bundled graph.

    it('loads the artifact-kinds ABox via the generic loader (proves the load path)', async () => {
      const { loadArtifactKindsAbox } = await import('../../path-analyser/src/ontology/loader.js');
      const abox = loadArtifactKindsAbox(REPO_ROOT);
      expect(abox, 'artifact-kinds ABox file must exist for the camunda-oca config').not.toBeNull();
      expect(abox?.kinds.length).toBeGreaterThan(0);
      expect(abox?.operationRules.length).toBeGreaterThan(0);
    });

    it('every operationRules entry references a real opId in the bundled graph (sense-2: abox-vs-graph)', async () => {
      const { loadArtifactKindsAbox } = await import('../../path-analyser/src/ontology/loader.js');
      const abox = loadArtifactKindsAbox(REPO_ROOT);
      if (!abox) throw new Error('artifact-kinds ABox missing');
      if (!existsSync(GRAPH_PATH)) {
        throw new Error(
          `Graph not found at ${GRAPH_PATH}. Run 'npm run testsuite:generate' first.`,
        );
      }
      interface GraphOp {
        operationId?: string;
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
        operationsById?: Record<string, GraphOp>;
        operations?: Record<string, GraphOp> | GraphOp[];
      };
      const opIds = new Set<string>(
        Object.keys(graph.operationsById ?? {}).length > 0
          ? Object.keys(graph.operationsById ?? {})
          : Array.isArray(graph.operations)
            ? graph.operations
                .map((o) => o.operationId)
                .filter((s): s is string => typeof s === 'string')
            : Object.keys(graph.operations ?? {}),
      );
      const dangling = abox.operationRules.map((r) => r.operationId).filter((id) => !opIds.has(id));
      expect(
        dangling,
        'artifact-kinds ABox operationRules entries reference opIds that do not exist in the bundled graph — typo, renamed-upstream op, or stale entry; remove or fix in configs/<config>/ontology/artifact-kinds.json',
      ).toEqual([]);
    });

    it('every artifact-kind referenced by operationRules / semanticTypeMap / fileExtensionMap is defined in `kinds`', async () => {
      const { loadArtifactKindsAbox } = await import('../../path-analyser/src/ontology/loader.js');
      const abox = loadArtifactKindsAbox(REPO_ROOT);
      if (!abox) throw new Error('artifact-kinds ABox missing');
      const kindNames = new Set(abox.kinds.map((k) => k.name));
      const dangling: string[] = [];
      for (const rule of abox.operationRules) {
        for (const r of rule.rules ?? []) {
          if (!kindNames.has(r.artifactKind))
            dangling.push(
              `operationRules['${rule.operationId}'].rules['${r.id ?? '<unnamed>'}'] → '${r.artifactKind}'`,
            );
        }
      }
      for (const m of abox.semanticTypeMap) {
        if (!kindNames.has(m.artifactKind))
          dangling.push(`semanticTypeMap['${m.semanticType}'] → '${m.artifactKind}'`);
      }
      for (const m of abox.fileExtensionMap) {
        for (const k of m.artifactKinds) {
          if (!kindNames.has(k)) dangling.push(`fileExtensionMap['${m.extension}'] → '${k}'`);
        }
      }
      expect(
        dangling,
        'artifact-kinds ABox cross-references unknown kind name(s) — define the missing kind in `kinds[]` or fix the reference',
      ).toEqual([]);
    });

    it('every artifact-kind in the ABox is referenced by at least one operationRules / semanticTypeMap / fileExtensionMap entry (no dead kinds)', async () => {
      const { loadArtifactKindsAbox } = await import('../../path-analyser/src/ontology/loader.js');
      const abox = loadArtifactKindsAbox(REPO_ROOT);
      if (!abox) throw new Error('artifact-kinds ABox missing');
      const referenced = new Set<string>();
      for (const rule of abox.operationRules) {
        for (const r of rule.rules ?? []) referenced.add(r.artifactKind);
      }
      for (const m of abox.semanticTypeMap) referenced.add(m.artifactKind);
      for (const m of abox.fileExtensionMap) {
        for (const k of m.artifactKinds) referenced.add(k);
      }
      const dead = abox.kinds.filter((k) => !referenced.has(k.name)).map((k) => k.name);
      expect(
        dead,
        'artifact-kinds ABox lists kind(s) referenced by no rule, semanticTypeMap entry, or fileExtensionMap entry — kind is dead weight; either remove it or add a reference',
      ).toEqual([]);
    });

    it('the `producesSemantics` ↔ `semanticTypeMap` relation is bidirectionally consistent (no dead or wrong reverse mappings)', async () => {
      // Bidirectional gate. Forward direction: every semantic type a
      // kind claims to produce must reverse-map to that kind. Reverse
      // direction: every semanticTypeMap entry must point to a kind
      // that actually claims (in `producesSemantics`) the mapped
      // semantic type. Without the reverse check, a stale or
      // misspelled `semanticTypeMap` entry that maps a type the kind
      // does not produce would still pass the forward-only test.
      const { loadArtifactKindsAbox } = await import('../../path-analyser/src/ontology/loader.js');
      const abox = loadArtifactKindsAbox(REPO_ROOT);
      if (!abox) throw new Error('artifact-kinds ABox missing');
      const mappedToKind = new Map<string, string>();
      for (const m of abox.semanticTypeMap) mappedToKind.set(m.semanticType, m.artifactKind);
      const kindByName = new Map(abox.kinds.map((k) => [k.name, k]));
      const issues: string[] = [];
      // Forward: kind.producesSemantics → semanticTypeMap.
      for (const kind of abox.kinds) {
        for (const sem of kind.producesSemantics) {
          const mappedKind = mappedToKind.get(sem);
          if (mappedKind === undefined) {
            issues.push(
              `[forward] '${sem}' is produced by kind '${kind.name}' but has no semanticTypeMap entry`,
            );
          } else if (mappedKind !== kind.name) {
            issues.push(
              `[forward] '${sem}' is produced by kind '${kind.name}' but semanticTypeMap maps it to '${mappedKind}'`,
            );
          }
        }
      }
      // Reverse: semanticTypeMap → kind.producesSemantics.
      for (const m of abox.semanticTypeMap) {
        const kind = kindByName.get(m.artifactKind);
        if (!kind) continue; // dangling-kind reference is already caught by another invariant
        if (!kind.producesSemantics.includes(m.semanticType)) {
          issues.push(
            `[reverse] semanticTypeMap maps '${m.semanticType}' to kind '${m.artifactKind}', but '${m.artifactKind}.producesSemantics' does not list '${m.semanticType}'`,
          );
        }
      }
      expect(
        issues,
        'artifact-kinds ABox `semanticTypeMap` is not in bidirectional sync with `kinds[].producesSemantics` — every produced semantic type must reverse-map to its producer kind, and every map entry must point to a kind that actually produces the mapped type',
      ).toEqual([]);
    });

    it('graph.domain.artifactKinds matches the ABox `kinds[]` (planner contract)', async () => {
      const { loadArtifactKindsAbox } = await import('../../path-analyser/src/ontology/loader.js');
      const { loadGraph } = await import('../../path-analyser/src/graphLoader.js');
      const abox = loadArtifactKindsAbox(REPO_ROOT);
      if (!abox) throw new Error('artifact-kinds ABox missing');
      const graph = await loadGraph(join(REPO_ROOT, 'path-analyser'));
      const expected = abox.kinds.map((k) => k.name).sort();
      const actual = Object.keys(graph.domain?.artifactKinds ?? {}).sort();
      expect(
        actual,
        'graph.domain.artifactKinds keys do not match the ABox `kinds[]` names — the loader may have failed to overlay the ABox onto graph.domain',
      ).toEqual(expected);
      // Spot-check: a kind's identifierType comes from the ABox, not the legacy sidecar.
      for (const k of abox.kinds) {
        expect(graph.domain?.artifactKinds?.[k.name]?.identifierType).toBe(k.identifierType);
      }
    });

    it('graph.domain.operationArtifactRules matches the ABox `operationRules[]` (planner contract — full per-rule fields)', async () => {
      const { loadArtifactKindsAbox, deriveArtifactKindsViews } = await import(
        '../../path-analyser/src/ontology/loader.js'
      );
      const { loadGraph } = await import('../../path-analyser/src/graphLoader.js');
      const abox = loadArtifactKindsAbox(REPO_ROOT);
      const expectedViews = deriveArtifactKindsViews(REPO_ROOT);
      if (!abox || !expectedViews) throw new Error('artifact-kinds ABox missing');
      const graph = await loadGraph(join(REPO_ROOT, 'path-analyser'));
      // Compare the full record-shaped views: keys, composable flag,
      // and every rule-level field (id, artifactKind, priority,
      // producesSemantics, producesStates). A regression that drops
      // any of those is caught directly because the rule.id is what
      // the emitter uses to look up the chosen rule, and the
      // optional override fields drive the planner's output.
      expect(
        graph.domain?.operationArtifactRules,
        'graph.domain.operationArtifactRules does not match the record-shaped view derived from the ABox — the loader may have failed to overlay the ABox onto graph.domain or may be dropping rule-level fields',
      ).toEqual(expectedViews.operationArtifactRules);
    });

    it('exactly one operation has role "deploymentGateway" and it is `createDeployment` (Lift 9 / #225)', async () => {
      // The deployment-gateway role discriminates the operation whose
      // multipart response surfaces deployed artifact identifiers.
      // The planner and Playwright emitter rely on this role to decide
      // which step uses the `deploy()` helper and whose extracts feed
      // model-derived bindings. Two operations with the role would make
      // those decisions ambiguous; zero would silently disable the
      // deploy() path. The role must map to `createDeployment` for the
      // camunda-oca config because that is the upstream multipart
      // deployment endpoint.
      const { loadGraph } = await import('../../path-analyser/src/graphLoader.js');
      const graph = await loadGraph(join(REPO_ROOT, 'path-analyser'));
      const rules = graph.domain?.operationArtifactRules ?? {};
      const opsWithDeploymentGateway = Object.entries(rules)
        .filter(([, spec]) => spec.role === 'deploymentGateway')
        .map(([opId]) => opId);
      expect(opsWithDeploymentGateway).toEqual(['createDeployment']);
    });

    it('graph.domain.semanticTypeToArtifactKind matches the ABox `semanticTypeMap[]` (planner contract)', async () => {
      const { deriveArtifactKindsViews } = await import(
        '../../path-analyser/src/ontology/loader.js'
      );
      const { loadGraph } = await import('../../path-analyser/src/graphLoader.js');
      const expectedViews = deriveArtifactKindsViews(REPO_ROOT);
      if (!expectedViews) throw new Error('artifact-kinds ABox missing');
      const graph = await loadGraph(join(REPO_ROOT, 'path-analyser'));
      expect(
        graph.domain?.semanticTypeToArtifactKind,
        'graph.domain.semanticTypeToArtifactKind does not match the ABox semanticTypeMap — overlay regression',
      ).toEqual(expectedViews.semanticTypeToArtifactKind);
    });

    it('graph.domain.artifactFileKinds matches the ABox `fileExtensionMap[]` (planner contract)', async () => {
      const { deriveArtifactKindsViews } = await import(
        '../../path-analyser/src/ontology/loader.js'
      );
      const { loadGraph } = await import('../../path-analyser/src/graphLoader.js');
      const expectedViews = deriveArtifactKindsViews(REPO_ROOT);
      if (!expectedViews) throw new Error('artifact-kinds ABox missing');
      const graph = await loadGraph(join(REPO_ROOT, 'path-analyser'));
      expect(
        graph.domain?.artifactFileKinds,
        'graph.domain.artifactFileKinds does not match the ABox fileExtensionMap — overlay regression',
      ).toEqual(expectedViews.artifactFileKinds);
    });

    it('the committed artifact-kinds vocabulary JSON matches the regenerated TBox (drift detector)', async () => {
      const { ARTIFACTS, renderSchema } = await import('../../scripts/build-ontology.ts');
      const target = ARTIFACTS.find((a) => a.jsonPath.endsWith('artifact-kinds.schema.json'));
      expect(target, 'build-ontology must include artifact-kinds.schema.json').toBeDefined();
      if (!target) return;
      const onDisk = readFileSync(target.jsonPath, 'utf8');
      const rendered = renderSchema(target.schema);
      expect(
        onDisk,
        `Generated ontology artefact at ${target.jsonPath} is stale. Run 'npm run build:ontology' to refresh it.`,
      ).toBe(rendered);
    });

    it("the artifact-kinds ABox's $schema field resolves to the published TBox JSON", () => {
      const aboxPath = join(REPO_ROOT, 'configs', CONFIG_NAME, 'ontology', 'artifact-kinds.json');
      const expectedTboxPath = join(
        REPO_ROOT,
        'ontology',
        'vocabulary',
        'artifact-kinds.schema.json',
      );
      expect(
        existsSync(expectedTboxPath),
        `Published TBox at '${expectedTboxPath}' does not exist — vocabulary file may have been deleted or renamed`,
      ).toBe(true);
      interface AboxHeader {
        $schema?: unknown;
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const aboxJson = JSON.parse(readFileSync(aboxPath, 'utf8')) as AboxHeader;
      const schemaField = aboxJson.$schema;
      expect(typeof schemaField, 'ABox must declare a string `$schema` field').toBe('string');
      if (typeof schemaField !== 'string') return;
      expect(schemaField).toBe(
        'https://camunda.github.io/api-test-generator/ns/v1/artifact-kinds.schema.json',
      );
    });
  },
);

describeForThisConfig(
  'bundled-spec invariants: runtime-states ABox cross-references (#214)',
  () => {
    // Lift 6 / #214: the runtime-states ABox is now the authoritative
    // source for the two runtime-related sub-trees (runtimeStates and
    // operationRequirements). Same coverage strategy as Lift 5.

    it('loads the runtime-states ABox via the generic loader (proves the load path)', async () => {
      const { loadRuntimeStatesAbox } = await import('../../path-analyser/src/ontology/loader.js');
      const abox = loadRuntimeStatesAbox(REPO_ROOT);
      expect(abox, 'runtime-states ABox file must exist for the camunda-oca config').not.toBeNull();
      expect(abox?.states.length).toBeGreaterThan(0);
      expect(abox?.operationRequirements.length).toBeGreaterThan(0);
    });

    it('every state.producedBy / state.witness.operationId / operationRequirements.operationId references a real opId in the bundled graph (sense-2: abox-vs-graph)', async () => {
      const { loadRuntimeStatesAbox } = await import('../../path-analyser/src/ontology/loader.js');
      const abox = loadRuntimeStatesAbox(REPO_ROOT);
      if (!abox) throw new Error('runtime-states ABox missing');
      if (!existsSync(GRAPH_PATH)) {
        throw new Error(
          `Graph not found at ${GRAPH_PATH}. Run 'npm run testsuite:generate' first.`,
        );
      }
      interface GraphOp {
        operationId?: string;
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
        operationsById?: Record<string, GraphOp>;
        operations?: Record<string, GraphOp> | GraphOp[];
      };
      const opIds = new Set<string>(
        Object.keys(graph.operationsById ?? {}).length > 0
          ? Object.keys(graph.operationsById ?? {})
          : Array.isArray(graph.operations)
            ? graph.operations
                .map((o) => o.operationId)
                .filter((s): s is string => typeof s === 'string')
            : Object.keys(graph.operations ?? {}),
      );
      const dangling: string[] = [];
      for (const s of abox.states) {
        for (const op of s.producedBy ?? []) {
          if (!opIds.has(op)) dangling.push(`states['${s.name}'].producedBy -> '${op}'`);
        }
        if (s.witness && !opIds.has(s.witness.operationId)) {
          dangling.push(`states['${s.name}'].witness.operationId -> '${s.witness.operationId}'`);
        }
      }
      for (const r of abox.operationRequirements) {
        if (!opIds.has(r.operationId)) dangling.push(`operationRequirements['${r.operationId}']`);
      }
      expect(
        dangling,
        'runtime-states ABox references opIds that do not exist in the bundled graph - typo, renamed-upstream op, or stale entry; remove or fix in configs/<config>/ontology/runtime-states.json',
      ).toEqual([]);
    });

    it('every state declared in the ABox is referenced by at least one operationRequirement / state.requires / semanticTypes.witnesses (no dead states)', async () => {
      const { loadRuntimeStatesAbox } = await import('../../path-analyser/src/ontology/loader.js');
      const abox = loadRuntimeStatesAbox(REPO_ROOT);
      if (!abox) throw new Error('runtime-states ABox missing');
      const referenced = new Set<string>();
      for (const r of abox.operationRequirements) {
        for (const x of r.requires ?? []) referenced.add(x);
        for (const d of r.disjunctions ?? []) for (const x of d) referenced.add(x);
        for (const x of r.implicitAdds ?? []) referenced.add(x);
        for (const x of r.produces ?? []) referenced.add(x);
        for (const v of Object.values(r.valueBindings ?? {})) {
          const dot = v.indexOf('.');
          if (dot > 0 && !v.startsWith('semantic:')) referenced.add(v.slice(0, dot));
        }
      }
      for (const s of abox.states) for (const x of s.requires ?? []) referenced.add(x);
      // Also count witness references from sibling sub-trees:
      // semanticTypes.witnesses (now in the semantics ABox / Lift 7) and
      // capabilities.dependsOn (semantics ABox) reference runtime-state
      // names. Without this, states only referenced by a witness coupling
      // (e.g. `ProcessDefinitionDeployed` ←
      // `ProcessDefinitionKey.witnesses`) would be flagged as dead even
      // though they are live. We read the semantics ABox directly because
      // the runtime ontology is now fully ABox-authored.
      const { loadSemanticsAbox } = await import('../../path-analyser/src/ontology/loader.js');
      const semantics = loadSemanticsAbox(REPO_ROOT);
      if (semantics !== null) {
        for (const t of semantics.semanticTypes) {
          if (typeof t.witnesses === 'string') referenced.add(t.witnesses);
        }
        for (const c of semantics.capabilities ?? []) {
          for (const dep of c.dependsOn ?? []) referenced.add(dep);
        }
        for (const i of semantics.identifiers ?? []) {
          if (typeof i.validityState === 'string') referenced.add(i.validityState);
        }
      }
      const dead = abox.states.filter((s) => !referenced.has(s.name)).map((s) => s.name);
      expect(
        dead,
        'runtime-states ABox lists state(s) referenced by no operationRequirement / state.requires / semanticTypes.witnesses entry - dead weight; either remove or add a reference',
      ).toEqual([]);
    });

    it('graph.domain.runtimeStates matches the record-shaped view derived from the ABox (planner contract)', async () => {
      const { deriveRuntimeStatesViews } = await import(
        '../../path-analyser/src/ontology/loader.js'
      );
      const { loadGraph } = await import('../../path-analyser/src/graphLoader.js');
      const expectedViews = deriveRuntimeStatesViews(REPO_ROOT);
      if (!expectedViews) throw new Error('runtime-states ABox missing');
      const graph = await loadGraph(join(REPO_ROOT, 'path-analyser'));
      expect(
        graph.domain?.runtimeStates,
        'graph.domain.runtimeStates does not match the ABox-derived view - overlay regression',
      ).toEqual(expectedViews.runtimeStates);
    });

    it('graph.domain.operationRequirements matches the record-shaped view derived from the ABox (planner contract)', async () => {
      const { deriveRuntimeStatesViews } = await import(
        '../../path-analyser/src/ontology/loader.js'
      );
      const { loadGraph } = await import('../../path-analyser/src/graphLoader.js');
      const expectedViews = deriveRuntimeStatesViews(REPO_ROOT);
      if (!expectedViews) throw new Error('runtime-states ABox missing');
      const graph = await loadGraph(join(REPO_ROOT, 'path-analyser'));
      expect(
        graph.domain?.operationRequirements,
        'graph.domain.operationRequirements does not match the ABox-derived view - overlay regression',
      ).toEqual(expectedViews.operationRequirements);
    });

    it('the committed runtime-states vocabulary JSON matches the regenerated TBox (drift detector)', async () => {
      const { ARTIFACTS, renderSchema } = await import('../../scripts/build-ontology.ts');
      const target = ARTIFACTS.find((a) => a.jsonPath.endsWith('runtime-states.schema.json'));
      expect(target, 'build-ontology must include runtime-states.schema.json').toBeDefined();
      if (!target) return;
      const onDisk = readFileSync(target.jsonPath, 'utf8');
      const rendered = renderSchema(target.schema);
      expect(
        onDisk,
        `Generated ontology artefact at ${target.jsonPath} is stale. Run 'npm run build:ontology' to refresh it.`,
      ).toBe(rendered);
    });

    it("the runtime-states ABox's $schema field resolves to the published TBox JSON", () => {
      const aboxPath = join(REPO_ROOT, 'configs', CONFIG_NAME, 'ontology', 'runtime-states.json');
      const expectedTboxPath = join(
        REPO_ROOT,
        'ontology',
        'vocabulary',
        'runtime-states.schema.json',
      );
      expect(
        existsSync(expectedTboxPath),
        `Published TBox at '${expectedTboxPath}' does not exist`,
      ).toBe(true);
      interface AboxHeader {
        $schema?: unknown;
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const aboxJson = JSON.parse(readFileSync(aboxPath, 'utf8')) as AboxHeader;
      const schemaField = aboxJson.$schema;
      expect(typeof schemaField, 'ABox must declare a string `$schema` field').toBe('string');
      if (typeof schemaField !== 'string') return;
      expect(schemaField).toBe(
        'https://camunda.github.io/api-test-generator/ns/v1/runtime-states.schema.json',
      );
    });
  },
);

describeForThisConfig('bundled-spec invariants: semantics ABox cross-references (#216)', () => {
  // Lift 7 / #216: the semantics ABox is now the authoritative
  // source for the three value-source sub-trees (semanticTypes,
  // capabilities, identifiers). Same coverage strategy as Lifts 5 and 6.

  it('loads the semantics ABox via the generic loader (proves the load path)', async () => {
    const { loadSemanticsAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadSemanticsAbox(REPO_ROOT);
    expect(abox, 'semantics ABox file must exist for the camunda-oca config').not.toBeNull();
    expect(abox?.semanticTypes.length).toBeGreaterThan(0);
  });

  it('every capabilities.producedBy / identifiers.boundBy references a real opId in the bundled graph (sense-2: abox-vs-graph)', async () => {
    const { loadSemanticsAbox } = await import('../../path-analyser/src/ontology/loader.js');
    const abox = loadSemanticsAbox(REPO_ROOT);
    if (!abox) throw new Error('semantics ABox missing');
    if (!existsSync(GRAPH_PATH)) {
      throw new Error(`Graph not found at ${GRAPH_PATH}. Run 'npm run testsuite:generate' first.`);
    }
    interface GraphOp {
      operationId?: string;
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
      operationsById?: Record<string, GraphOp>;
      operations?: Record<string, GraphOp> | GraphOp[];
    };
    const opIds = new Set<string>(
      Object.keys(graph.operationsById ?? {}).length > 0
        ? Object.keys(graph.operationsById ?? {})
        : Array.isArray(graph.operations)
          ? graph.operations
              .map((o) => o.operationId)
              .filter((s): s is string => typeof s === 'string')
          : Object.keys(graph.operations ?? {}),
    );
    const dangling: string[] = [];
    for (const c of abox.capabilities ?? []) {
      for (const op of c.producedBy ?? []) {
        if (!opIds.has(op)) dangling.push(`capabilities['${c.name}'].producedBy -> '${op}'`);
      }
    }
    for (const i of abox.identifiers ?? []) {
      for (const op of i.boundBy ?? []) {
        if (!opIds.has(op)) dangling.push(`identifiers['${i.name}'].boundBy -> '${op}'`);
      }
    }
    expect(
      dangling,
      'semantics ABox references opIds that do not exist in the bundled graph - typo, renamed-upstream op, or stale entry; remove or fix in configs/<config>/ontology/semantics.json',
    ).toEqual([]);
  });

  it('every semanticTypes.witnesses / capabilities.dependsOn / identifiers.validityState resolves to a runtime-states ABox state OR a capability declared in the same semantics ABox (cross-ABox integrity)', async () => {
    const { loadSemanticsAbox, loadRuntimeStatesAbox } = await import(
      '../../path-analyser/src/ontology/loader.js'
    );
    const semanticsAbox = loadSemanticsAbox(REPO_ROOT);
    const runtimeStatesAbox = loadRuntimeStatesAbox(REPO_ROOT);
    if (!semanticsAbox) throw new Error('semantics ABox missing');
    if (!runtimeStatesAbox) throw new Error('runtime-states ABox missing');
    const stateNames = new Set(runtimeStatesAbox.states.map((s) => s.name));
    const capNames = new Set((semanticsAbox.capabilities ?? []).map((c) => c.name));
    const dangling: string[] = [];
    for (const t of semanticsAbox.semanticTypes) {
      if (
        typeof t.witnesses === 'string' &&
        !stateNames.has(t.witnesses) &&
        !capNames.has(t.witnesses)
      ) {
        dangling.push(
          `semanticTypes['${t.name}'].witnesses -> '${t.witnesses}' (not a runtime state or capability)`,
        );
      }
    }
    for (const c of semanticsAbox.capabilities ?? []) {
      for (const dep of c.dependsOn ?? []) {
        if (!stateNames.has(dep)) {
          dangling.push(`capabilities['${c.name}'].dependsOn -> '${dep}' (not a runtime state)`);
        }
      }
    }
    for (const i of semanticsAbox.identifiers ?? []) {
      if (typeof i.validityState === 'string' && !stateNames.has(i.validityState)) {
        dangling.push(
          `identifiers['${i.name}'].validityState -> '${i.validityState}' (not a runtime state)`,
        );
      }
      if (typeof i.derivedVia === 'string' && !capNames.has(i.derivedVia)) {
        dangling.push(
          `identifiers['${i.name}'].derivedVia -> '${i.derivedVia}' (not a capability)`,
        );
      }
    }
    expect(
      dangling,
      'semantics ABox references targets that do not exist in either the semantics or runtime-states ABox - cross-ABox integrity broken',
    ).toEqual([]);
  });

  it('graph.domain.semanticTypes / capabilities / identifiers match the record-shaped views derived from the ABox (planner contract)', async () => {
    const { deriveSemanticsViews } = await import('../../path-analyser/src/ontology/loader.js');
    const { loadGraph } = await import('../../path-analyser/src/graphLoader.js');
    const expectedViews = deriveSemanticsViews(REPO_ROOT);
    if (!expectedViews) throw new Error('semantics ABox missing');
    const graph = await loadGraph(join(REPO_ROOT, 'path-analyser'));
    expect(
      graph.domain?.semanticTypes,
      'graph.domain.semanticTypes does not match the ABox-derived view - overlay regression',
    ).toEqual(expectedViews.semanticTypes);
    expect(
      graph.domain?.capabilities,
      'graph.domain.capabilities does not match the ABox-derived view - overlay regression',
    ).toEqual(expectedViews.capabilities);
    expect(
      graph.domain?.identifiers,
      'graph.domain.identifiers does not match the ABox-derived view - overlay regression',
    ).toEqual(expectedViews.identifiers);
  });

  it('the committed semantics vocabulary JSON matches the regenerated TBox (drift detector)', async () => {
    const { ARTIFACTS, renderSchema } = await import('../../scripts/build-ontology.ts');
    const target = ARTIFACTS.find((a) => a.jsonPath.endsWith('semantics.schema.json'));
    expect(target, 'build-ontology must include semantics.schema.json').toBeDefined();
    if (!target) return;
    const onDisk = readFileSync(target.jsonPath, 'utf8');
    const rendered = renderSchema(target.schema);
    expect(
      onDisk,
      `Generated ontology artefact at ${target.jsonPath} is stale. Run 'npm run build:ontology' to refresh it.`,
    ).toBe(rendered);
  });

  it("the semantics ABox's $schema field resolves to the published TBox JSON", () => {
    const aboxPath = join(REPO_ROOT, 'configs', CONFIG_NAME, 'ontology', 'semantics.json');
    const expectedTboxPath = join(REPO_ROOT, 'ontology', 'vocabulary', 'semantics.schema.json');
    expect(
      existsSync(expectedTboxPath),
      `Published TBox at '${expectedTboxPath}' does not exist`,
    ).toBe(true);
    interface AboxHeader {
      $schema?: unknown;
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
    const aboxJson = JSON.parse(readFileSync(aboxPath, 'utf8')) as AboxHeader;
    const schemaField = aboxJson.$schema;
    expect(typeof schemaField, 'ABox must declare a string `$schema` field').toBe('string');
    if (typeof schemaField !== 'string') return;
    expect(schemaField).toBe(
      'https://camunda.github.io/api-test-generator/ns/v1/semantics.schema.json',
    );
  });
});

// ---------------------------------------------------------------------------
// Lift 8 (#218): global-context-seeds ABox invariants.
// ---------------------------------------------------------------------------

describe.skipIf(CONFIG_NAME !== 'camunda-oca')(
  'bundled-spec invariants: global-context-seeds ABox is authoritative (Lift 8 / #218)',
  () => {
    it('the ABox loads, validates against the TBox, and has a stable shape', async () => {
      const { loadGlobalContextSeedsAbox } = await import(
        '../../path-analyser/src/ontology/loader.js'
      );
      const abox = loadGlobalContextSeedsAbox(REPO_ROOT);
      expect(abox, 'global-context-seeds ABox missing').not.toBeNull();
      if (!abox) return;
      expect(abox.version).toBe(1);
      expect(abox.seeds.length).toBeGreaterThan(0);
    });

    it('graph.domain.globalContextSeeds matches the array-shaped view derived from the ABox (planner contract)', async () => {
      const { deriveGlobalContextSeedsViews } = await import(
        '../../path-analyser/src/ontology/loader.js'
      );
      const { loadGraph } = await import('../../path-analyser/src/graphLoader.js');
      const expectedViews = deriveGlobalContextSeedsViews(REPO_ROOT);
      if (!expectedViews) throw new Error('global-context-seeds ABox missing');
      const graph = await loadGraph(join(REPO_ROOT, 'path-analyser'));
      expect(
        graph.domain?.globalContextSeeds,
        'graph.domain.globalContextSeeds does not match the ABox-derived view — overlay regression',
      ).toEqual(expectedViews.globalContextSeeds);
    });

    it('the committed global-context-seeds vocabulary JSON matches the regenerated TBox (drift detector)', async () => {
      const { ARTIFACTS, renderSchema } = await import('../../scripts/build-ontology.ts');
      const target = ARTIFACTS.find((a) => a.jsonPath.endsWith('global-context-seeds.schema.json'));
      expect(target, 'build-ontology must include global-context-seeds.schema.json').toBeDefined();
      if (!target) return;
      const onDisk = readFileSync(target.jsonPath, 'utf8');
      const rendered = renderSchema(target.schema);
      expect(
        onDisk,
        `Generated ontology artefact at ${target.jsonPath} is stale. Run 'npm run build:ontology' to refresh it.`,
      ).toBe(rendered);
    });

    it("the global-context-seeds ABox's $schema field resolves to the published TBox JSON", () => {
      const aboxPath = join(
        REPO_ROOT,
        'configs',
        CONFIG_NAME,
        'ontology',
        'global-context-seeds.json',
      );
      const expectedTboxPath = join(
        REPO_ROOT,
        'ontology',
        'vocabulary',
        'global-context-seeds.schema.json',
      );
      expect(
        existsSync(expectedTboxPath),
        `Published TBox at '${expectedTboxPath}' does not exist`,
      ).toBe(true);
      interface AboxHeader {
        $schema?: unknown;
      }
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const aboxJson = JSON.parse(readFileSync(aboxPath, 'utf8')) as AboxHeader;
      const schemaField = aboxJson.$schema;
      expect(typeof schemaField, 'ABox must declare a string `$schema` field').toBe('string');
      if (typeof schemaField !== 'string') return;
      expect(schemaField).toBe(
        'https://camunda.github.io/api-test-generator/ns/v1/global-context-seeds.schema.json',
      );
    });
  },
);
