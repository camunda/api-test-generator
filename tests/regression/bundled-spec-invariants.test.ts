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
  scenarios: { id: string; operations: { operationId: string }[] }[];
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

  it('no createProcessInstance scenario calls searchElementInstances (#31)', () => {
    // The original symptom of #31: the planner inserted a search-step
    // chain because ElementId was wrongly required. Ancestor-required
    // tracking removed that branch.
    const scen = loadScenarioFile('post--process-instances-scenarios.json');
    const offenders = scen.scenarios
      .map((s) => ({ id: s.id, ops: s.operations.map((o) => o.operationId) }))
      .filter((s) => s.ops.includes('searchElementInstances'));
    expect(offenders).toEqual([]);
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
      const raw = JSON.parse(
        readFileSync(join(SCENARIOS_DIR, file), 'utf8'),
      ) as { unsatisfied?: boolean; scenarios: unknown[] };
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
          // Out-of-scope: placeholder-name vs. semantic-type alias mismatch
          // (issue #61). When a producer extracts under
          // `<camelCase(semantic)>Var` but the URL template substitutes
          // `<placeholderName>Var`, the names never meet. Tracked separately
          // as a follow-up to #58 (BFS deferral); the class-scoped fix will
          // remove this carve-out and add a generic alias check.
          const param = parameters.find(
            (p) => p.name === ph && p.location === 'path',
          );
          if (param?.semanticType) {
            const aliasVar = `${param.semanticType.charAt(0).toLowerCase()}${param.semanticType.slice(1)}Var`;
            if (isUsableBinding(bindings[aliasVar])) return false;
            if (producedByEarlierStep.has(aliasVar)) return false;
          }
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
