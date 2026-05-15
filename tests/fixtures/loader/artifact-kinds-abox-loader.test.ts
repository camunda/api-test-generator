/**
 * Unit tests for the artifact-kinds ABox loader (Lift 5 / #212).
 *
 * Mirrors the structure of `entity-kinds-abox-loader.test.ts` (Lift 4 /
 * #210). Documented loader contract has the same observable branches:
 *   1. Missing ABox file → returns `null`.
 *   2. configs.json missing → returns `null` (test-isolation fallback).
 *   3. Invalid JSON → throws with a "Failed to parse" diagnostic.
 *   4. Schema-invalid content → throws with a "failed TBox validation" diagnostic.
 *   5. Duplicate kind / semanticType / operationId / extension keys → throws.
 *   6. Happy path → returns the parsed ABox.
 *
 * Plus the `deriveArtifactKindsViews` accessor returns record-shaped
 * views that match what `graph.domain.*` consumers expect.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveArtifactKindsViews,
  loadArtifactKindsAbox,
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
  writeFileSync(join(dir, 'artifact-kinds.json'), contents);
}

function minimalKind(name = 'bpmnProcess', identifierType = 'ProcessDefinitionId') {
  return {
    name,
    identifierType,
    producesStates: ['ProcessDefinitionDeployed'],
    producesSemantics: ['ProcessDefinitionKey'],
    deploymentSlices: ['processDefinition'],
    description: `${name} description`,
  };
}

function minimalAbox(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    kinds: [minimalKind()],
    semanticTypeMap: [{ semanticType: 'ProcessDefinitionKey', artifactKind: 'bpmnProcess' }],
    operationRules: [
      {
        operationId: 'createDeployment',
        composable: true,
        rules: [{ id: 'bpmn', artifactKind: 'bpmnProcess' }],
      },
    ],
    fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
    ...overrides,
  });
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'artifact-kinds-abox-loader-'));
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

describe('loadArtifactKindsAbox: documented branches', () => {
  it('returns null when the ABox file does not exist (configs are not required to ship one)', () => {
    expect(loadArtifactKindsAbox(workdir)).toBeNull();
  });

  it('returns null when configs.json itself is missing (test-isolation fallback)', () => {
    rmSync(join(workdir, 'configs.json'));
    expect(loadArtifactKindsAbox(workdir)).toBeNull();
  });

  it('throws with a "Failed to parse" diagnostic on invalid JSON', () => {
    writeAbox('{ not json');
    expect(() => loadArtifactKindsAbox(workdir)).toThrow(/Failed to parse artifact-kinds ABox/);
  });

  it('throws with a "failed TBox validation" diagnostic on schema-invalid content', () => {
    // kind name violates camelCase pattern
    writeAbox(
      JSON.stringify({
        version: 1,
        kinds: [{ ...minimalKind(), name: 'BPMN-PROCESS' }],
        semanticTypeMap: [],
        operationRules: [],
        fileExtensionMap: [],
      }),
    );
    expect(() => loadArtifactKindsAbox(workdir)).toThrow(/failed TBox validation/);
  });

  it('throws on duplicate kind names', () => {
    writeAbox(
      minimalAbox({
        kinds: [minimalKind('bpmnProcess'), minimalKind('bpmnProcess', 'OtherId')],
      }),
    );
    expect(() => loadArtifactKindsAbox(workdir)).toThrow(/duplicate kind name\(s\): bpmnProcess/);
  });

  it('throws on duplicate semanticTypeMap entries', () => {
    writeAbox(
      minimalAbox({
        semanticTypeMap: [
          { semanticType: 'ProcessDefinitionKey', artifactKind: 'bpmnProcess' },
          { semanticType: 'ProcessDefinitionKey', artifactKind: 'bpmnProcess' },
        ],
      }),
    );
    expect(() => loadArtifactKindsAbox(workdir)).toThrow(
      /duplicate semanticTypeMap entries for: ProcessDefinitionKey/,
    );
  });

  it('throws on duplicate operationRules entries', () => {
    writeAbox(
      minimalAbox({
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: true,
            rules: [{ id: 'bpmn', artifactKind: 'bpmnProcess' }],
          },
          {
            operationId: 'createDeployment',
            composable: false,
            rules: [{ id: 'bpmn2', artifactKind: 'bpmnProcess' }],
          },
        ],
      }),
    );
    expect(() => loadArtifactKindsAbox(workdir)).toThrow(
      /duplicate operationRules entries for: createDeployment/,
    );
  });

  it('throws on duplicate fileExtensionMap entries', () => {
    writeAbox(
      minimalAbox({
        fileExtensionMap: [
          { extension: '.bpmn', artifactKinds: ['bpmnProcess'] },
          { extension: '.bpmn', artifactKinds: ['bpmnProcess'] },
        ],
      }),
    );
    expect(() => loadArtifactKindsAbox(workdir)).toThrow(
      /duplicate fileExtensionMap entries for: \.bpmn/,
    );
  });

  it('returns the parsed ABox on the happy path', () => {
    writeAbox(minimalAbox());
    const abox = loadArtifactKindsAbox(workdir);
    expect(abox).not.toBeNull();
    expect(abox?.kinds).toHaveLength(1);
    expect(abox?.kinds[0]?.name).toBe('bpmnProcess');
    expect(abox?.operationRules[0]?.rules).toHaveLength(1);
  });
});

describe('deriveArtifactKindsViews: record-shaped views', () => {
  it('returns null when no ABox is shipped', () => {
    expect(deriveArtifactKindsViews(workdir)).toBeNull();
  });

  it('reshapes the ABox into the four record forms graph.domain.* expects', () => {
    writeAbox(
      minimalAbox({
        kinds: [
          {
            ...minimalKind('bpmnProcess'),
            producibleStates: ['ProcessInstanceCompleted'],
          },
          minimalKind('form', 'FormId'),
        ],
        semanticTypeMap: [
          { semanticType: 'ProcessDefinitionKey', artifactKind: 'bpmnProcess' },
          { semanticType: 'FormKey', artifactKind: 'form' },
        ],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: true,
            rules: [
              { id: 'bpmn', artifactKind: 'bpmnProcess' },
              { id: 'form', artifactKind: 'form' },
            ],
          },
        ],
        fileExtensionMap: [
          { extension: '.bpmn', artifactKinds: ['bpmnProcess'] },
          { extension: '.dmn', artifactKinds: ['dmnDecision', 'dmnDrd'] },
        ],
      }),
    );
    const views = deriveArtifactKindsViews(workdir);
    expect(views).not.toBeNull();
    expect(views?.artifactKinds.bpmnProcess?.producibleStates).toEqual([
      'ProcessInstanceCompleted',
    ]);
    expect(views?.artifactKinds.form?.identifierType).toBe('FormId');
    expect(views?.semanticTypeToArtifactKind).toEqual({
      ProcessDefinitionKey: 'bpmnProcess',
      FormKey: 'form',
    });
    expect(views?.operationArtifactRules.createDeployment?.composable).toBe(true);
    expect(views?.operationArtifactRules.createDeployment?.rules).toHaveLength(2);
    expect(views?.artifactFileKinds['.dmn']).toEqual(['dmnDecision', 'dmnDrd']);
  });

  it("propagates the loader's validation failure (does not silently swallow malformed ABox)", () => {
    writeAbox('{ not json');
    expect(() => deriveArtifactKindsViews(workdir)).toThrow(/Failed to parse artifact-kinds ABox/);
  });

  it('throws when an operation defines duplicate `rules[].id` values', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        kinds: [minimalKind()],
        semanticTypeMap: [{ semanticType: 'ProcessDefinitionKey', artifactKind: 'bpmnProcess' }],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: true,
            rules: [
              { id: 'bpmn', artifactKind: 'bpmnProcess' },
              { id: 'bpmn', artifactKind: 'bpmnProcess', priority: 5 },
            ],
          },
        ],
        fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
      }),
    );
    expect(() => loadArtifactKindsAbox(workdir)).toThrow(
      /operationRules\['createDeployment'\] has duplicate rule id\(s\): bpmn/,
    );
  });

  it('preserves optional rule fields (`id`, `priority`, `producesSemantics`, `producesStates`) through deriveArtifactKindsViews', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        kinds: [minimalKind()],
        semanticTypeMap: [{ semanticType: 'ProcessDefinitionKey', artifactKind: 'bpmnProcess' }],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: true,
            rules: [
              {
                id: 'bpmn',
                artifactKind: 'bpmnProcess',
                priority: 7,
                producesSemantics: ['ExtraKey'],
                producesStates: ['ExtraState'],
              },
            ],
          },
        ],
        fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
      }),
    );
    const views = deriveArtifactKindsViews(workdir);
    if (!views) throw new Error('expected derived views');
    const rules = views.operationArtifactRules.createDeployment?.rules;
    expect(rules).toEqual([
      {
        id: 'bpmn',
        artifactKind: 'bpmnProcess',
        priority: 7,
        producesSemantics: ['ExtraKey'],
        producesStates: ['ExtraState'],
      },
    ]);
  });
});
