/**
 * Unit tests for the runtime-states ABox loader (Lift 6 / #214).
 *
 * Mirrors the structure of `artifact-kinds-abox-loader.test.ts` (Lift 5 /
 * #212). Documented loader contract has the same observable branches:
 *   1. Missing ABox file → returns `null`.
 *   2. configs.json missing → returns `null` (test-isolation fallback).
 *   3. Invalid JSON → throws with a "Failed to parse" diagnostic.
 *   4. Schema-invalid content → throws with a "failed TBox validation" diagnostic.
 *   5. Duplicate state name / operationRequirement opId → throws.
 *   6. `eventual: true` without a witness → throws (cross-property invariant).
 *   7. Happy path → returns the parsed ABox.
 *
 * Plus the `deriveRuntimeStatesViews` accessor returns record-shaped
 * views that match what `graph.domain.{runtimeStates,operationRequirements}`
 * consumers expect — including rehydrating the `kind: 'state'` tag that
 * the ABox drops.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveRuntimeStatesViews,
  loadRuntimeStatesAbox,
} from '../../../path-analyser/src/ontology/loader.ts';

let workdir: string;
const CONFIG_NAME = 'unit-test-config';
const ORIGINAL_CONFIG = process.env.CONFIG;

function configsJson(): string {
  return JSON.stringify({ default: CONFIG_NAME, configs: { [CONFIG_NAME]: {} } });
}

function writeAbox(contents: string): void {
  const dir = join(workdir, 'configs', CONFIG_NAME, 'ontology');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'runtime-states.json'), contents);
}

function minimalState(name = 'ProcessDefinitionDeployed') {
  return {
    name,
    producedBy: ['createDeployment'],
    parameter: 'processDefinitionId',
  };
}

function minimalAbox(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    states: [minimalState()],
    operationRequirements: [
      {
        operationId: 'createProcessInstance',
        requires: ['ProcessDefinitionDeployed'],
      },
    ],
    ...overrides,
  });
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'runtime-states-abox-loader-'));
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, 'configs.json'), configsJson());
  process.env.CONFIG = CONFIG_NAME;
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  if (ORIGINAL_CONFIG === undefined) {
    delete process.env.CONFIG;
  } else {
    process.env.CONFIG = ORIGINAL_CONFIG;
  }
});

describe('loadRuntimeStatesAbox: documented branches', () => {
  it('returns null when the ABox file does not exist (configs are not required to ship one)', () => {
    expect(loadRuntimeStatesAbox(workdir)).toBeNull();
  });

  it('returns null when configs.json itself is missing (test-isolation fallback)', () => {
    rmSync(join(workdir, 'configs.json'));
    expect(loadRuntimeStatesAbox(workdir)).toBeNull();
  });

  it('throws with a "Failed to parse" diagnostic on invalid JSON', () => {
    writeAbox('{ not json');
    expect(() => loadRuntimeStatesAbox(workdir)).toThrow(/Failed to parse runtime-states ABox/);
  });

  it('throws with a "failed TBox validation" diagnostic on schema-invalid content', () => {
    // missing required `operationRequirements`
    writeAbox(JSON.stringify({ version: 1, states: [minimalState()] }));
    expect(() => loadRuntimeStatesAbox(workdir)).toThrow(/failed TBox validation/);
  });

  it('throws on duplicate state names', () => {
    writeAbox(
      minimalAbox({
        states: [minimalState('Foo'), minimalState('Foo')],
      }),
    );
    expect(() => loadRuntimeStatesAbox(workdir)).toThrow(/duplicate state name\(s\): Foo/);
  });

  it('throws on duplicate operationRequirements entries', () => {
    writeAbox(
      minimalAbox({
        operationRequirements: [
          { operationId: 'op1', requires: ['Foo'] },
          { operationId: 'op1', requires: ['Bar'] },
        ],
      }),
    );
    expect(() => loadRuntimeStatesAbox(workdir)).toThrow(
      /duplicate operationRequirements entries for: op1/,
    );
  });

  it('throws when `eventual: true` is set without a witness (planner contract)', () => {
    writeAbox(
      minimalAbox({
        states: [{ name: 'JobAvailableForActivation', eventual: true }],
      }),
    );
    expect(() => loadRuntimeStatesAbox(workdir)).toThrow(
      /JobAvailableForActivation.*eventual: true but no witness/,
    );
  });

  it('returns the parsed ABox on the happy path', () => {
    writeAbox(minimalAbox());
    const abox = loadRuntimeStatesAbox(workdir);
    expect(abox).not.toBeNull();
    expect(abox?.states).toHaveLength(1);
    expect(abox?.states[0]?.name).toBe('ProcessDefinitionDeployed');
    expect(abox?.operationRequirements[0]?.operationId).toBe('createProcessInstance');
  });
});

describe('deriveRuntimeStatesViews: record-shaped views', () => {
  it('returns null when no ABox is shipped (caller falls back to domain-semantics.json)', () => {
    expect(deriveRuntimeStatesViews(workdir)).toBeNull();
  });

  it("rehydrates the `kind: 'state'` tag the ABox drops", () => {
    writeAbox(minimalAbox());
    const views = deriveRuntimeStatesViews(workdir);
    expect(views?.runtimeStates.ProcessDefinitionDeployed?.kind).toBe('state');
  });

  it('reshapes states[] and operationRequirements[] into Record<name, …> form', () => {
    writeAbox(
      minimalAbox({
        states: [
          minimalState('ProcessDefinitionDeployed'),
          {
            name: 'JobAvailableForActivation',
            eventual: true,
            requires: ['ProcessInstanceExists'],
            witness: {
              operationId: 'searchJobs',
              predicate: { path: 'state', equals: 'CREATED' },
              waitUpToMs: 5000,
              pollIntervalMs: 100,
            },
          },
        ],
        operationRequirements: [
          {
            operationId: 'createProcessInstance',
            requires: ['ProcessDefinitionDeployed'],
            valueBindings: { processDefinitionKey: 'semantic:ProcessDefinitionKey' },
          },
          {
            operationId: 'activateJobs',
            disjunctions: [['JobAvailableForActivation', 'ProcessInstanceExists']],
            implicitAdds: ['JobsActivated'],
          },
        ],
      }),
    );
    const views = deriveRuntimeStatesViews(workdir);
    if (!views) throw new Error('expected derived views');
    expect(Object.keys(views.runtimeStates).sort()).toEqual([
      'JobAvailableForActivation',
      'ProcessDefinitionDeployed',
    ]);
    expect(views.runtimeStates.JobAvailableForActivation?.eventual).toBe(true);
    expect(views.runtimeStates.JobAvailableForActivation?.witness?.operationId).toBe('searchJobs');
    expect(views.runtimeStates.JobAvailableForActivation?.witness?.waitUpToMs).toBe(5000);
    expect(views.operationRequirements.createProcessInstance?.valueBindings).toEqual({
      processDefinitionKey: 'semantic:ProcessDefinitionKey',
    });
    expect(views.operationRequirements.activateJobs?.disjunctions).toEqual([
      ['JobAvailableForActivation', 'ProcessInstanceExists'],
    ]);
    expect(views.operationRequirements.activateJobs?.implicitAdds).toEqual(['JobsActivated']);
  });

  it('deep-clones array/object fields so callers cannot mutate the cached parse', () => {
    writeAbox(
      minimalAbox({
        states: [{ ...minimalState('S'), producedBy: ['op1'], requires: ['cap1'] }],
        operationRequirements: [
          {
            operationId: 'op1',
            requires: ['S'],
            valueBindings: { x: 'S.y' },
            disjunctions: [['a', 'b']],
          },
        ],
      }),
    );
    const v1 = deriveRuntimeStatesViews(workdir);
    if (!v1) throw new Error('expected views');
    v1.runtimeStates.S?.producedBy?.push('mutated');
    if (v1.operationRequirements.op1?.valueBindings) {
      v1.operationRequirements.op1.valueBindings.x = 'mutated';
    }
    v1.operationRequirements.op1?.disjunctions?.[0]?.push('mutated');
    const v2 = deriveRuntimeStatesViews(workdir);
    expect(v2?.runtimeStates.S?.producedBy).toEqual(['op1']);
    expect(v2?.operationRequirements.op1?.valueBindings).toEqual({ x: 'S.y' });
    expect(v2?.operationRequirements.op1?.disjunctions).toEqual([['a', 'b']]);
  });

  it("propagates the loader's validation failure (does not silently swallow malformed ABox)", () => {
    writeAbox('{ not json');
    expect(() => deriveRuntimeStatesViews(workdir)).toThrow(/Failed to parse runtime-states ABox/);
  });
});
