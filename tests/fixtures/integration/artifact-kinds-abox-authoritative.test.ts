/**
 * Integration fixture for Lift 5 (#212): the artifact-kinds ABox is
 * the authoritative source for `graph.domain.artifactKinds`,
 * `semanticTypeToArtifactKind`, `operationArtifactRules`, and
 * `artifactFileKinds` at runtime. Mirrors
 * `entity-kinds-abox-authoritative.test.ts` (Lift 4 / #210).
 *
 * Unlike Lift 4, the migrated facts were never carried in upstream
 * OpenAPI annotations — only in the per-config ontology.
 * Consequence: the integration only exercises the durable
 * `abox-vs-graph` (sense-2) drift signal; there is no transitional
 * `spec-vs-abox` (sense-1) sense to test.
 *
 * Four observable behaviours guarded here:
 *
 *   1. **ABox-only graph population**: the ABox alone populates the
 *      four artifact-related sub-trees on `graph.domain`.
 *
 *   2. **Strict mode**: with `STRICT_ARTIFACT_KINDS_ABOX=1`, an
 *      abox-vs-graph drift is a hard error.
 *
 *   3. **Sense-2 drift warnings**: dead-kind / unknown-opId /
 *      unknown-artifactKind references are flagged.
 *
 *   4. **Cross-ABox validation**: artifact kinds referencing runtime
 *      states or semantic types must resolve through the authoritative
 *      runtime-states and semantics ABoxes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGraph } from '../../../path-analyser/src/graphLoader.ts';

const CONFIG_NAME = 'lift5-artifact-kinds-test';

let workdir: string;
let baseDir: string;
const ORIGINAL = {
  CONFIG: process.env.CONFIG,
  OPERATION_GRAPH_PATH: process.env.OPERATION_GRAPH_PATH,
  OPENAPI_SPEC_PATH: process.env.OPENAPI_SPEC_PATH,
  STRICT_ARTIFACT_KINDS_ABOX: process.env.STRICT_ARTIFACT_KINDS_ABOX,
};

function writeWorkspace(opts: {
  artifactKindsAbox: object | null;
  runtimeStatesAbox?: object;
  semanticsAbox?: object;
  graphOps: Record<string, unknown>;
}): void {
  const repoRoot = workdir;
  baseDir = join(repoRoot, 'path-analyser');
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(
    join(repoRoot, 'configs.json'),
    JSON.stringify({ default: CONFIG_NAME, configs: { [CONFIG_NAME]: {} } }),
  );
  const configDir = join(repoRoot, 'configs', CONFIG_NAME);
  mkdirSync(configDir, { recursive: true });
  const aboxDir = join(configDir, 'ontology');
  if (
    opts.artifactKindsAbox !== null ||
    opts.runtimeStatesAbox !== undefined ||
    opts.semanticsAbox !== undefined
  ) {
    mkdirSync(aboxDir, { recursive: true });
  }
  if (opts.artifactKindsAbox !== null) {
    writeFileSync(join(aboxDir, 'artifact-kinds.json'), JSON.stringify(opts.artifactKindsAbox));
  }
  if (opts.runtimeStatesAbox !== undefined) {
    writeFileSync(join(aboxDir, 'runtime-states.json'), JSON.stringify(opts.runtimeStatesAbox));
  }
  if (opts.semanticsAbox !== undefined) {
    writeFileSync(join(aboxDir, 'semantics.json'), JSON.stringify(opts.semanticsAbox));
  }
  const graphPath = join(baseDir, 'operation-dependency-graph.json');
  writeFileSync(graphPath, JSON.stringify({ operations: opts.graphOps }));
  process.env.OPERATION_GRAPH_PATH = graphPath;
  process.env.CONFIG = CONFIG_NAME;
  process.env.OPENAPI_SPEC_PATH = join(baseDir, 'no-such-spec.yaml');
}

function deployOp(): Record<string, unknown> {
  return {
    createDeployment: {
      operationId: 'createDeployment',
      method: 'POST',
      path: '/deployments',
      requires: { required: [], optional: [] },
      produces: [],
    },
  };
}

function minimalKind(name: string, identifierType: string): Record<string, unknown> {
  // Empty producesStates / producesSemantics by default — those would
  // reference runtimeStates / semanticTypes which most focused fixtures
  // don't declare. Tests that need cross-ABox validation supply them
  // inline along with companion declarations (PR #217 review).
  return {
    name,
    identifierType,
    producesStates: [],
    producesSemantics: [],
    deploymentSlices: [name],
    description: `${name} fixture`,
  };
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'lift5-artifact-kinds-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('Lift 5 (#212): artifact-kinds ABox is authoritative for graph.domain artifact sub-trees', () => {
  it('populates graph.domain artifact sub-trees from the ABox in a multi-kind fixture', async () => {
    writeWorkspace({
      artifactKindsAbox: {
        version: 1,
        kinds: [minimalKind('bpmnProcess', 'ProcessDefinitionId'), minimalKind('form', 'FormId')],
        semanticTypeMap: [
          { semanticType: 'bpmnProcessKey', artifactKind: 'bpmnProcess' },
          { semanticType: 'formKey', artifactKind: 'form' },
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
          { extension: '.form', artifactKinds: ['form'] },
        ],
      },
      graphOps: deployOp(),
    });
    const graph = await loadGraph(baseDir);
    expect(Object.keys(graph.domain?.artifactKinds ?? {})).toEqual(['bpmnProcess', 'form']);
    expect(graph.domain?.operationArtifactRules?.createDeployment?.composable).toBe(true);
    expect(graph.domain?.artifactFileKinds?.['.form']).toEqual(['form']);
  });

  it('populates graph.domain artifact sub-trees from the ABox in a minimal single-kind fixture', async () => {
    writeWorkspace({
      artifactKindsAbox: {
        version: 1,
        kinds: [minimalKind('bpmnProcess', 'ProcessDefinitionId')],
        semanticTypeMap: [{ semanticType: 'bpmnProcessKey', artifactKind: 'bpmnProcess' }],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: false,
            rules: [{ id: 'bpmn', artifactKind: 'bpmnProcess' }],
          },
        ],
        fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
      },
      graphOps: deployOp(),
    });
    const graph = await loadGraph(baseDir);
    expect(graph.domain?.artifactKinds?.bpmnProcess?.identifierType).toBe('ProcessDefinitionId');
    expect(graph.domain?.semanticTypeToArtifactKind).toEqual({
      bpmnProcessKey: 'bpmnProcess',
    });
  });

  it('hard-errors on abox-vs-graph drift when STRICT_ARTIFACT_KINDS_ABOX=1', async () => {
    process.env.STRICT_ARTIFACT_KINDS_ABOX = '1';
    writeWorkspace({
      artifactKindsAbox: {
        version: 1,
        kinds: [minimalKind('bpmnProcess', 'ProcessDefinitionId')],
        semanticTypeMap: [{ semanticType: 'bpmnProcessKey', artifactKind: 'bpmnProcess' }],
        operationRules: [
          {
            // Op doesn't exist in the graph.
            operationId: 'createNonexistentDeployment',
            composable: false,
            rules: [{ id: 'bpmn', artifactKind: 'bpmnProcess' }],
          },
        ],
        fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
      },
      graphOps: deployOp(),
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(/artifact-kinds ABox drift detected/);
  });

  it('warns on dead artifact kinds (sense-2 abox-vs-graph)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      artifactKindsAbox: {
        version: 1,
        kinds: [
          minimalKind('bpmnProcess', 'ProcessDefinitionId'),
          minimalKind('deadKind', 'DeadId'),
        ],
        semanticTypeMap: [{ semanticType: 'bpmnProcessKey', artifactKind: 'bpmnProcess' }],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: false,
            rules: [{ id: 'bpmn', artifactKind: 'bpmnProcess' }],
          },
        ],
        fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
      },
      graphOps: deployOp(),
    });
    await loadGraph(baseDir);
    const allWarnings = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allWarnings).toMatch(/artifact-kinds ABox drift detected/);
    expect(allWarnings).toMatch(/abox-vs-graph/);
    expect(allWarnings).toMatch(/deadKind/);
    expect(allWarnings).not.toMatch(/bpmnProcess.*dead weight/);
    warn.mockRestore();
  });

  it('warns on operationRules entries pointing at unknown opIds (sense-2 abox-vs-graph)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      artifactKindsAbox: {
        version: 1,
        kinds: [minimalKind('bpmnProcess', 'ProcessDefinitionId')],
        semanticTypeMap: [{ semanticType: 'bpmnProcessKey', artifactKind: 'bpmnProcess' }],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: false,
            rules: [{ id: 'bpmn', artifactKind: 'bpmnProcess' }],
          },
          {
            // Op missing from the graph — must surface as drift.
            operationId: 'createGhostDeployment',
            composable: false,
            rules: [{ id: 'bpmn', artifactKind: 'bpmnProcess' }],
          },
        ],
        fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
      },
      graphOps: deployOp(),
    });
    await loadGraph(baseDir);
    const allWarnings = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allWarnings).toMatch(/abox-vs-graph/);
    expect(allWarnings).toMatch(/createGhostDeployment/);
    warn.mockRestore();
  });

  it('warns on operationRules.rules entries pointing at unknown artifactKinds (sense-2 abox-vs-graph)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      artifactKindsAbox: {
        version: 1,
        kinds: [minimalKind('bpmnProcess', 'ProcessDefinitionId')],
        semanticTypeMap: [{ semanticType: 'bpmnProcessKey', artifactKind: 'bpmnProcess' }],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: false,
            rules: [
              { id: 'bpmn', artifactKind: 'bpmnProcess' },
              { id: 'ghost', artifactKind: 'ghostKind' },
            ],
          },
        ],
        fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
      },
      graphOps: deployOp(),
    });
    await loadGraph(baseDir);
    const allWarnings = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allWarnings).toMatch(
      /operationRules\['createDeployment'\]\.rules\['ghost'\] references unknown artifactKind 'ghostKind'/,
    );
    warn.mockRestore();
  });

  it('warns on semanticTypeMap entries pointing at unknown artifactKinds (sense-2 abox-vs-graph)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      artifactKindsAbox: {
        version: 1,
        kinds: [minimalKind('bpmnProcess', 'ProcessDefinitionId')],
        semanticTypeMap: [
          { semanticType: 'bpmnProcessKey', artifactKind: 'bpmnProcess' },
          { semanticType: 'GhostKey', artifactKind: 'ghostKind' },
        ],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: false,
            rules: [{ id: 'bpmn', artifactKind: 'bpmnProcess' }],
          },
        ],
        fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
      },
      graphOps: deployOp(),
    });
    await loadGraph(baseDir);
    const allWarnings = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allWarnings).toMatch(
      /semanticTypeMap entry 'GhostKey' → 'ghostKind' references unknown artifactKind/,
    );
    warn.mockRestore();
  });

  it('warns on fileExtensionMap entries pointing at unknown artifactKinds (sense-2 abox-vs-graph)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      artifactKindsAbox: {
        version: 1,
        kinds: [minimalKind('bpmnProcess', 'ProcessDefinitionId')],
        semanticTypeMap: [{ semanticType: 'bpmnProcessKey', artifactKind: 'bpmnProcess' }],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: false,
            rules: [{ id: 'bpmn', artifactKind: 'bpmnProcess' }],
          },
        ],
        fileExtensionMap: [
          { extension: '.bpmn', artifactKinds: ['bpmnProcess'] },
          { extension: '.ghost', artifactKinds: ['ghostKind'] },
        ],
      },
      graphOps: deployOp(),
    });
    await loadGraph(baseDir);
    const allWarnings = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allWarnings).toMatch(
      /fileExtensionMap entry '\.ghost' references unknown artifactKind 'ghostKind'/,
    );
    warn.mockRestore();
  });

  it('hard-errors when the ABox introduces a `producesStates` value not declared in the runtime-state domain', async () => {
    writeWorkspace({
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'ProcessDefinitionDeployed', producedBy: ['createDeployment'] }],
        operationRequirements: [],
      },
      semanticsAbox: {
        version: 1,
        semanticTypes: [{ name: 'ProcessDefinitionKey', witnesses: 'ProcessDefinitionDeployed' }],
      },
      artifactKindsAbox: {
        version: 1,
        kinds: [
          {
            name: 'bpmnProcess',
            identifierType: 'ProcessDefinitionId',
            // 'UndeclaredState' is NOT in runtimeStates above.
            producesStates: ['ProcessDefinitionDeployed', 'UndeclaredState'],
            producesSemantics: ['ProcessDefinitionKey'],
            deploymentSlices: ['processDefinition'],
            description: 'fixture',
          },
        ],
        semanticTypeMap: [{ semanticType: 'ProcessDefinitionKey', artifactKind: 'bpmnProcess' }],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: false,
            rules: [{ id: 'bpmn', artifactKind: 'bpmnProcess' }],
          },
        ],
        fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
      },
      graphOps: deployOp(),
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(/artifactKindStateDeclared.*UndeclaredState/);
  });

  it('hard-errors when an ABox rule-level `producesStates` override references a state not declared in runtimeStates / capabilities (post-overlay re-validation, rule-level)', async () => {
    // Rule-level overrides on operationArtifactRules feed the planner
    // via getEffectiveProducesStates(); kind-level-only validation
    // would let an undeclared rule-level state slip through.
    writeWorkspace({
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'ProcessDefinitionDeployed', producedBy: ['createDeployment'] }],
        operationRequirements: [],
      },
      semanticsAbox: {
        version: 1,
        semanticTypes: [{ name: 'ProcessDefinitionKey', witnesses: 'ProcessDefinitionDeployed' }],
      },
      artifactKindsAbox: {
        version: 1,
        kinds: [
          {
            name: 'bpmnProcess',
            identifierType: 'ProcessDefinitionId',
            producesStates: ['ProcessDefinitionDeployed'],
            producesSemantics: ['ProcessDefinitionKey'],
            deploymentSlices: ['processDefinition'],
            description: 'fixture',
          },
        ],
        semanticTypeMap: [{ semanticType: 'ProcessDefinitionKey', artifactKind: 'bpmnProcess' }],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: false,
            rules: [
              {
                id: 'bpmn',
                artifactKind: 'bpmnProcess',
                // Rule-level override pointing at an undeclared state.
                producesStates: ['UndeclaredRuleLevelState'],
              },
            ],
          },
        ],
        fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
      },
      graphOps: deployOp(),
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(
      /operationArtifactRules\.createDeployment\.rules\['bpmn'\]\.producesStates references "UndeclaredRuleLevelState"/,
    );
  });

  it('hard-errors when an ABox rule-level `producesSemantics` override references a semantic type with no semanticTypes.witnesses declaration', async () => {
    writeWorkspace({
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'ProcessDefinitionDeployed', producedBy: ['createDeployment'] }],
        operationRequirements: [],
      },
      semanticsAbox: {
        version: 1,
        semanticTypes: [{ name: 'ProcessDefinitionKey', witnesses: 'ProcessDefinitionDeployed' }],
      },
      artifactKindsAbox: {
        version: 1,
        kinds: [
          {
            name: 'bpmnProcess',
            identifierType: 'ProcessDefinitionId',
            producesStates: ['ProcessDefinitionDeployed'],
            producesSemantics: ['ProcessDefinitionKey'],
            deploymentSlices: ['processDefinition'],
            description: 'fixture',
          },
        ],
        semanticTypeMap: [{ semanticType: 'ProcessDefinitionKey', artifactKind: 'bpmnProcess' }],
        operationRules: [
          {
            operationId: 'createDeployment',
            composable: false,
            rules: [
              {
                id: 'bpmn',
                artifactKind: 'bpmnProcess',
                producesSemantics: ['UndeclaredKey'],
              },
            ],
          },
        ],
        fileExtensionMap: [{ extension: '.bpmn', artifactKinds: ['bpmnProcess'] }],
      },
      graphOps: deployOp(),
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(
      /operationArtifactRules\.createDeployment\.rules\['bpmn'\]\.producesSemantics references "UndeclaredKey"/,
    );
  });
});
