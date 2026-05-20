/**
 * Unit tests for the semantics ABox loader (Lift 7 / #216).
 *
 * Mirrors the structure of `runtime-states-abox-loader.test.ts` (Lift 6 /
 * #214). Documented loader contract has the same observable branches:
 *   1. Missing ABox file → returns `null`.
 *   2. configs.json missing → returns `null` (test-isolation fallback).
 *   3. Invalid JSON → throws with a "Failed to parse" diagnostic.
 *   4. Schema-invalid content → throws with a "failed TBox validation" diagnostic.
 *   5. Duplicate name in any sub-tree → throws.
 *   6. `kind: 'attribute'` without `clientMinted: true` → throws (cross-property invariant, #162 PR 2).
 *   7. `kind: 'runtimeEmission'` without `emittedBy` or without `discoveredVia` → throws (cross-property invariant, #305 Phase 1).
 *   8. Happy path → returns the parsed ABox.
 *
 * Plus the `deriveSemanticsViews` accessor returns record-shaped views
 * that match what `graph.domain.{semanticTypes,capabilities,identifiers}`
 * consumers expect — including rehydrating the `kind: 'capability'` /
 * `kind: 'identifier'` tags the ABox drops.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveSemanticsViews,
  loadSemanticsAbox,
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
  writeFileSync(join(dir, 'semantics.json'), contents);
}

function minimalAbox(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    semanticTypes: [{ name: 'ProcessDefinitionKey', witnesses: 'ProcessDefinitionDeployed' }],
    ...overrides,
  });
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'semantics-abox-loader-'));
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

describe('loadSemanticsAbox: documented branches', () => {
  it('returns null when the ABox file does not exist (configs are not required to ship one)', () => {
    expect(loadSemanticsAbox(workdir)).toBeNull();
  });

  it('returns null when configs.json itself is missing (test-isolation fallback)', () => {
    rmSync(join(workdir, 'configs.json'));
    expect(loadSemanticsAbox(workdir)).toBeNull();
  });

  it('throws with a "Failed to parse" diagnostic on invalid JSON', () => {
    writeAbox('{ not json');
    expect(() => loadSemanticsAbox(workdir)).toThrow(/Failed to parse semantics ABox/);
  });

  it('throws with a "failed TBox validation" diagnostic on schema-invalid content', () => {
    // missing required `semanticTypes`
    writeAbox(JSON.stringify({ version: 1 }));
    expect(() => loadSemanticsAbox(workdir)).toThrow(/failed TBox validation/);
  });

  it('throws on duplicate semanticTypes names', () => {
    writeAbox(
      minimalAbox({
        semanticTypes: [{ name: 'Foo', witnesses: 'Bar' }, { name: 'Foo' }],
      }),
    );
    expect(() => loadSemanticsAbox(workdir)).toThrow(/duplicate semanticTypes name\(s\): Foo/);
  });

  it('throws on duplicate capabilities names', () => {
    writeAbox(
      minimalAbox({
        capabilities: [
          { name: 'Cap', parameter: 'p' },
          { name: 'Cap', parameter: 'p2' },
        ],
      }),
    );
    expect(() => loadSemanticsAbox(workdir)).toThrow(/duplicate capabilities name\(s\): Cap/);
  });

  it('throws on duplicate identifiers names', () => {
    writeAbox(
      minimalAbox({
        identifiers: [{ name: 'Id' }, { name: 'Id' }],
      }),
    );
    expect(() => loadSemanticsAbox(workdir)).toThrow(/duplicate identifiers name\(s\): Id/);
  });

  it("throws when `kind: 'attribute'` is set without `clientMinted: true` (#162 PR 2 coupling)", () => {
    writeAbox(
      minimalAbox({
        semanticTypes: [{ name: 'Tag', kind: 'attribute' }],
      }),
    );
    expect(() => loadSemanticsAbox(workdir)).toThrow(
      /Tag.*kind: 'attribute' but clientMinted is not true/,
    );
  });

  it("accepts `kind: 'attribute'` when `clientMinted: true` is set", () => {
    writeAbox(
      minimalAbox({
        semanticTypes: [{ name: 'Tag', kind: 'attribute', clientMinted: true }],
      }),
    );
    const abox = loadSemanticsAbox(workdir);
    expect(abox?.semanticTypes[0]?.kind).toBe('attribute');
    expect(abox?.semanticTypes[0]?.clientMinted).toBe(true);
  });

  it("throws when `kind: 'runtimeEmission'` is set without `emittedBy` (#305 Phase 1 coupling)", () => {
    writeAbox(
      minimalAbox({
        semanticTypes: [
          {
            name: 'UserTaskKey',
            kind: 'runtimeEmission',
            discoveredVia: {
              operationId: 'searchUserTasks',
              filterBy: 'processInstanceKey',
              extractKey: 'userTaskKey',
              consistency: 'eventual',
            },
          },
        ],
      }),
    );
    expect(() => loadSemanticsAbox(workdir)).toThrow(
      /UserTaskKey.*kind: 'runtimeEmission' but no emittedBy/,
    );
  });

  it("throws when `kind: 'runtimeEmission'` is set without `discoveredVia` (#305 Phase 1 coupling)", () => {
    writeAbox(
      minimalAbox({
        semanticTypes: [
          {
            name: 'UserTaskKey',
            kind: 'runtimeEmission',
            emittedBy: { predecessor: 'ProcessInstanceExists', guardedBy: ['ModelHasUserTask'] },
          },
        ],
      }),
    );
    expect(() => loadSemanticsAbox(workdir)).toThrow(
      /UserTaskKey.*kind: 'runtimeEmission' but no discoveredVia/,
    );
  });

  it("accepts `kind: 'runtimeEmission'` with both `emittedBy` and `discoveredVia` (#305 Phase 1)", () => {
    writeAbox(
      minimalAbox({
        semanticTypes: [
          {
            name: 'UserTaskKey',
            kind: 'runtimeEmission',
            emittedBy: { predecessor: 'ProcessInstanceExists', guardedBy: ['ModelHasUserTask'] },
            discoveredVia: {
              operationId: 'searchUserTasks',
              filterBy: 'processInstanceKey',
              extractKey: 'userTaskKey',
              consistency: 'eventual',
            },
          },
        ],
      }),
    );
    const abox = loadSemanticsAbox(workdir);
    expect(abox?.semanticTypes[0]?.kind).toBe('runtimeEmission');
  });

  it('returns the parsed ABox on the happy path', () => {
    writeAbox(
      minimalAbox({
        capabilities: [
          {
            name: 'ModelHasServiceTaskType',
            parameter: 'jobType',
            producedBy: ['createDeployment'],
            dependsOn: ['ProcessDefinitionDeployed'],
          },
        ],
        identifiers: [
          {
            name: 'ProcessDefinitionId',
            validityState: 'ProcessDefinitionDeployed',
            boundBy: ['createDeployment'],
            fieldPaths: ['deployments[].processDefinition.processDefinitionId'],
          },
        ],
      }),
    );
    const abox = loadSemanticsAbox(workdir);
    expect(abox).not.toBeNull();
    expect(abox?.semanticTypes).toHaveLength(1);
    expect(abox?.capabilities).toHaveLength(1);
    expect(abox?.identifiers).toHaveLength(1);
  });
});

describe('deriveSemanticsViews: record-shaped views', () => {
  it('returns null when no ABox is shipped', () => {
    expect(deriveSemanticsViews(workdir)).toBeNull();
  });

  it("rehydrates the `kind: 'capability'` / `kind: 'identifier'` tags the ABox drops", () => {
    writeAbox(
      minimalAbox({
        capabilities: [{ name: 'Cap', parameter: 'p' }],
        identifiers: [{ name: 'Id', validityState: 'S' }],
      }),
    );
    const views = deriveSemanticsViews(workdir);
    expect(views?.capabilities.Cap?.kind).toBe('capability');
    expect(views?.identifiers.Id?.kind).toBe('identifier');
  });

  it('reshapes the three sub-trees into Record<name, …> form', () => {
    writeAbox(
      minimalAbox({
        semanticTypes: [
          { name: 'ProcessDefinitionKey', witnesses: 'ProcessDefinitionDeployed' },
          { name: 'Tag', kind: 'attribute', clientMinted: true },
          { name: 'IncidentKey', kind: 'serverEmergent' },
          {
            name: 'UserTaskKey',
            kind: 'runtimeEmission',
            emittedBy: { predecessor: 'ProcessInstanceExists', guardedBy: ['ModelHasUserTask'] },
            discoveredVia: {
              operationId: 'searchUserTasks',
              filterBy: 'processInstanceKey',
              extractKey: 'userTaskKey',
              consistency: 'eventual',
            },
          },
        ],
        capabilities: [
          {
            name: 'ModelHasServiceTaskType',
            parameter: 'jobType',
            producedBy: ['createDeployment'],
            dependsOn: ['ProcessDefinitionDeployed'],
          },
        ],
        identifiers: [
          {
            name: 'JobTypeValue',
            derivedVia: 'ModelHasServiceTaskType',
            boundBy: ['createDeployment'],
          },
        ],
      }),
    );
    const views = deriveSemanticsViews(workdir);
    if (!views) throw new Error('expected derived views');
    expect(Object.keys(views.semanticTypes).sort()).toEqual([
      'IncidentKey',
      'ProcessDefinitionKey',
      'Tag',
      'UserTaskKey',
    ]);
    expect(views.semanticTypes.Tag).toEqual({ kind: 'attribute', clientMinted: true });
    expect(views.semanticTypes.IncidentKey).toEqual({ kind: 'serverEmergent' });
    expect(views.semanticTypes.UserTaskKey).toEqual({
      kind: 'runtimeEmission',
      emittedBy: { predecessor: 'ProcessInstanceExists', guardedBy: ['ModelHasUserTask'] },
      discoveredVia: {
        operationId: 'searchUserTasks',
        filterBy: 'processInstanceKey',
        extractKey: 'userTaskKey',
        consistency: 'eventual',
      },
    });
    expect(views.capabilities.ModelHasServiceTaskType).toEqual({
      kind: 'capability',
      parameter: 'jobType',
      producedBy: ['createDeployment'],
      dependsOn: ['ProcessDefinitionDeployed'],
    });
    expect(views.identifiers.JobTypeValue).toEqual({
      kind: 'identifier',
      derivedVia: 'ModelHasServiceTaskType',
      boundBy: ['createDeployment'],
    });
  });

  it('deep-clones array fields so callers cannot mutate the cached parse', () => {
    writeAbox(
      minimalAbox({
        semanticTypes: [
          { name: 'T', witnesses: 'S' },
          {
            name: 'EmittedKey',
            kind: 'runtimeEmission',
            emittedBy: { predecessor: 'PS', guardedBy: ['Cap'] },
            discoveredVia: { operationId: 'searchOp', extractKey: 'emittedKey' },
          },
        ],
        capabilities: [
          {
            name: 'Cap',
            parameter: 'p',
            producedBy: ['op1'],
            dependsOn: ['S'],
          },
        ],
        identifiers: [
          {
            name: 'Id',
            validityState: 'S',
            boundBy: ['op1'],
            fieldPaths: ['a.b'],
          },
        ],
      }),
    );
    const v1 = deriveSemanticsViews(workdir);
    if (!v1) throw new Error('expected views');
    v1.capabilities.Cap?.producedBy?.push('mutated');
    v1.capabilities.Cap?.dependsOn?.push('mutated');
    v1.identifiers.Id?.boundBy?.push('mutated');
    v1.identifiers.Id?.fieldPaths?.push('mutated');
    v1.semanticTypes.EmittedKey?.emittedBy?.guardedBy?.push('mutated');
    const v2 = deriveSemanticsViews(workdir);
    expect(v2?.capabilities.Cap?.producedBy).toEqual(['op1']);
    expect(v2?.capabilities.Cap?.dependsOn).toEqual(['S']);
    expect(v2?.identifiers.Id?.boundBy).toEqual(['op1']);
    expect(v2?.identifiers.Id?.fieldPaths).toEqual(['a.b']);
    expect(v2?.semanticTypes.EmittedKey?.emittedBy?.guardedBy).toEqual(['Cap']);
  });

  it("propagates the loader's validation failure (does not silently swallow malformed ABox)", () => {
    writeAbox('{ not json');
    expect(() => deriveSemanticsViews(workdir)).toThrow(/Failed to parse semantics ABox/);
  });
});
