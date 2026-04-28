/**
 * Scenario-chain invariants — Layer 3 extension of the layered test strategy.
 *
 * These tests lock in properties of the BFS-generated scenario chains so that:
 *   1. Known-correct chains cannot be silently broken by sidecar or graph changes.
 *   2. The chain-grafting fix (no-response-body endpoints) is regression-guarded.
 *   3. The sidecar population completeness (zero-gap audit) is enforced as a test.
 *
 * Prerequisites: the pipeline must have been generated.
 *   npm run testsuite:generate   (or npm run pipeline)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const FEATURE_OUTPUT_DIR = join(REPO_ROOT, 'path-analyser', 'dist', 'feature-output');
const RAW_OUTPUT_DIR = join(REPO_ROOT, 'path-analyser', 'dist', 'output');

interface OperationRef {
  operationId: string;
}
interface ScenarioEntry {
  id: string;
  operations: OperationRef[];
  domainStatesRequired?: string[];
  expectedResult?: { kind: string };
}
interface ScenarioCollection {
  endpoint: { operationId: string };
  scenarios: ScenarioEntry[];
  unsatisfied?: boolean;
}

function loadFeatureScenarios(filename: string): ScenarioCollection {
  const p = join(FEATURE_OUTPUT_DIR, filename);
  if (!existsSync(p)) {
    throw new Error(
      `Feature scenario file not found at ${p}. Run 'npm run testsuite:generate' first.`,
    );
  }
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
  return JSON.parse(readFileSync(p, 'utf8')) as ScenarioCollection;
}

function loadRawScenarios(filename: string): ScenarioCollection {
  const p = join(RAW_OUTPUT_DIR, filename);
  if (!existsSync(p)) {
    throw new Error(`Raw scenario file not found at ${p}. Run 'npm run testsuite:generate' first.`);
  }
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
  return JSON.parse(readFileSync(p, 'utf8')) as ScenarioCollection;
}

// ---------------------------------------------------------------------------
// BFS domain-state gating: key chains that require domain state prerequisites
// ---------------------------------------------------------------------------
describe('scenario-chain invariants: BFS domain-state chains', () => {
  it('cancelProcessInstance raw scenario chain includes createDeployment and createProcessInstance', () => {
    const col = loadRawScenarios(
      'post--process-instances--{processInstanceKey}--cancellation-scenarios.json',
    );
    const mainScenario = col.scenarios.find(
      (s) => s.id !== 'unsatisfied' && s.operations.length > 1,
    );
    expect(mainScenario, 'expected at least one multi-op scenario').toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: mainScenario asserted by preceding expect().toBeDefined()
    const opIds = mainScenario!.operations.map((o) => o.operationId);
    expect(opIds).toContain('createDeployment');
    expect(opIds).toContain('createProcessInstance');
    // createDeployment must precede createProcessInstance
    expect(opIds.indexOf('createDeployment')).toBeLessThan(opIds.indexOf('createProcessInstance'));
    // createProcessInstance must precede cancelProcessInstance
    expect(opIds.indexOf('createProcessInstance')).toBeLessThan(
      opIds.indexOf('cancelProcessInstance'),
    );
  });

  it('cancelProcessInstance domain state is declared as ProcessInstanceExists', () => {
    const col = loadRawScenarios(
      'post--process-instances--{processInstanceKey}--cancellation-scenarios.json',
    );
    const mainScenario = col.scenarios.find(
      (s) => s.id !== 'unsatisfied' && s.operations.length > 1,
    );
    expect(mainScenario?.domainStatesRequired).toContain('ProcessInstanceExists');
  });

  it('completeJob raw scenario chain includes activateJobs as a prerequisite', () => {
    const col = loadRawScenarios('post--jobs--{jobKey}--completion-scenarios.json');
    expect(col.scenarios.length).toBeGreaterThan(0);
    const satisfiedScenario = col.scenarios.find(
      (s) => s.id !== 'unsatisfied' && s.operations.length > 1,
    );
    if (!satisfiedScenario) {
      // If all scenarios are unsatisfied, that itself is a regression signal
      expect(col.unsatisfied, 'completeJob must not be permanently unsatisfied').toBe(false);
      return;
    }
    const opIds = satisfiedScenario.operations.map((o) => o.operationId);
    expect(opIds).toContain('activateJobs');
    expect(opIds.indexOf('activateJobs')).toBeLessThan(opIds.indexOf('completeJob'));
  });

  it('evaluateDecision raw scenario chain includes createDeployment as a prerequisite', () => {
    // evaluateDecision requires DecisionDefinitionDeployed (new sidecar state)
    const files = existsSync(RAW_OUTPUT_DIR)
      ? readdirSync(RAW_OUTPUT_DIR).filter(
          (f) => f.includes('evaluation') && f.includes('decision'),
        )
      : [];
    if (files.length === 0) {
      throw new Error(
        'No evaluateDecision scenario file found. Run npm run testsuite:generate first.',
      );
    }
    const col = loadRawScenarios(files[0]);
    const satisfiedScenario = col.scenarios.find(
      (s) => s.id !== 'unsatisfied' && s.operations.length > 1,
    );
    if (!satisfiedScenario) return; // unsatisfied is informational only for this operation
    const opIds = satisfiedScenario.operations.map((o) => o.operationId);
    expect(opIds).toContain('createDeployment');
  });
});

// ---------------------------------------------------------------------------
// Chain-grafting fix: no-response-body endpoints must get the chain in feature output
// ---------------------------------------------------------------------------
describe('scenario-chain invariants: chain graft for no-body endpoints', () => {
  it('cancelProcessInstance feature scenario includes createDeployment (chain grafted despite no response body)', () => {
    const col = loadFeatureScenarios(
      'post--process-instances--{processInstanceKey}--cancellation-scenarios.json',
    );
    const mainScenario = col.scenarios[0];
    expect(mainScenario, 'expected at least one feature scenario').toBeDefined();
    const opIds = mainScenario.operations.map((o) => o.operationId);
    expect(
      opIds,
      'cancelProcessInstance feature scenario must include createDeployment (chain graft should have fired)',
    ).toContain('createDeployment');
  });

  it('deleteProcessInstance feature scenario includes createDeployment', () => {
    const col = loadFeatureScenarios(
      'post--process-instances--{processInstanceKey}--deletion-scenarios.json',
    );
    const mainScenario = col.scenarios[0];
    expect(mainScenario).toBeDefined();
    const opIds = mainScenario.operations.map((o) => o.operationId);
    expect(opIds).toContain('createDeployment');
  });

  it('search-like empty-negative scenarios are NOT grafted with a prerequisite chain', () => {
    // The search-like empty-negative is intentionally standalone (expects empty result set)
    const col = loadFeatureScenarios('post--process-instances--search-scenarios.json');
    const emptyNeg = col.scenarios.find(
      (s) => s.id.startsWith('feature-') && s.expectedResult?.kind === 'empty',
    );
    if (!emptyNeg) return; // no empty-negative variant for this endpoint, skip
    // Empty-negative should be a standalone call (1 operation only)
    expect(
      emptyNeg.operations,
      'empty-negative scenario must not include setup operations',
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// createDeployment chain: existing invariant from bundled-spec-invariants (mirrored here for chain focus)
// ---------------------------------------------------------------------------
describe('scenario-chain invariants: createProcessInstance chain integrity', () => {
  it('every createProcessInstance feature scenario includes createDeployment', () => {
    const col = loadFeatureScenarios('post--process-instances-scenarios.json');
    expect(col.scenarios.length).toBeGreaterThan(0);
    const offenders = col.scenarios
      .map((s) => ({ id: s.id, ops: s.operations.map((o) => o.operationId) }))
      .filter((s) => s.ops.length > 1 && !s.ops.includes('createDeployment'));
    expect(
      offenders,
      'all multi-op createProcessInstance scenarios must include createDeployment',
    ).toEqual([]);
  });
});
