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

const REPO_ROOT = join(__dirname, '..', '..');
const GRAPH_PATH = join(
  REPO_ROOT,
  'semantic-graph-extractor',
  'dist',
  'output',
  'operation-dependency-graph.json',
);
const SCENARIOS_DIR = join(REPO_ROOT, 'path-analyser', 'dist', 'output');
const GENERATED_TESTS_DIR = join(REPO_ROOT, 'path-analyser', 'dist', 'generated-tests');

interface SemanticTypeEntry {
  semanticType: string;
  fieldPath: string;
  required: boolean;
  provider: boolean;
}
interface OperationNode {
  operationId: string;
  method: string;
  path: string;
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
function loadGraph(): DependencyGraph {
  if (cachedGraph) return cachedGraph;
  if (!existsSync(GRAPH_PATH)) {
    throw new Error(
      `Dependency graph not found at ${GRAPH_PATH}. Run 'npm run extract-graph' first.`,
    );
  }
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON; downstream property accesses tolerate malformed entries
  cachedGraph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as DependencyGraph;
  return cachedGraph;
}

function findOperation(opId: string): OperationNode {
  const op = loadGraph().operations.find((o) => o.operationId === opId);
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
  it('every createProcessInstance scenario includes createDeployment as a prerequisite (#32)', () => {
    // Locks in #32: ProcessDefinitionKey/Id must always be sourced from
    // createDeployment, the canonical authoritative provider. Tightening
    // this further (e.g. "is the FIRST step") is blocked by #35
    // (spurious intermediate steps), which can prepend an unrelated GET
    // for an eventually-consistent variant. Tighten when #35 lands.
    const scen = loadScenarioFile('post--process-instances-scenarios.json');
    expect(scen.scenarios.length).toBeGreaterThan(0);
    const offenders = scen.scenarios
      .map((s) => ({ id: s.id, ops: s.operations.map((o) => o.operationId) }))
      .filter((s) => !s.ops.includes('createDeployment'));
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
});

describe('bundled-spec invariants: emitted Playwright suite', () => {
  it('no generated test contains a stray __invalidEnum sentinel object (#39)', () => {
    // Layer-3 mirror of the targeted enum-violation test in
    // tests/request-validation/. Catches any future analyser that
    // re-introduces the same sentinel-leak pattern.
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
