/**
 * Integration fixture for Lift 5 (#212): the artifact-kinds ABox is
 * the authoritative source for `graph.domain.artifactKinds`,
 * `semanticTypeToArtifactKind`, `operationArtifactRules`, and
 * `artifactFileKinds` at runtime. Mirrors
 * `entity-kinds-abox-authoritative.test.ts` (Lift 4 / #210).
 *
 * Unlike Lift 4, the migrated facts were never carried in upstream
 * OpenAPI annotations — only in `configs/<config>/domain-semantics.json`.
 * Consequence: the integration only exercises the durable
 * `abox-vs-graph` (sense-2) drift signal; there is no transitional
 * `spec-vs-abox` (sense-1) sense to test.
 *
 * Five observable behaviours guarded here:
 *
 *   1. **ABox authoritative — promotes**: `domain-semantics.json`
 *      declares one set of artifactKinds; the ABox declares a
 *      different set. After loadGraph, `graph.domain.artifactKinds`
 *      reflects the ABox.
 *
 *   2. **ABox authoritative — works without domain-semantics.json**:
 *      no legacy sidecar shipped at all; the ABox alone populates the
 *      four sub-trees on `graph.domain`.
 *
 *   3. **Strict mode**: with `STRICT_ARTIFACT_KINDS_ABOX=1`, an
 *      abox-vs-graph drift is a hard error.
 *
 *   4. **Legacy fallback**: with no ABox shipped, the legacy
 *      `domain-semantics.json` keys remain authoritative.
 *
 *   5. **Sense-2 drift warnings**: dead-kind / unknown-opId /
 *      unknown-artifactKind references are flagged.
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
  domainSemantics?: object;
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
  if (opts.domainSemantics !== undefined) {
    writeFileSync(join(configDir, 'domain-semantics.json'), JSON.stringify(opts.domainSemantics));
  }
  if (opts.artifactKindsAbox !== null) {
    const aboxDir = join(configDir, 'ontology');
    mkdirSync(aboxDir, { recursive: true });
    writeFileSync(join(aboxDir, 'artifact-kinds.json'), JSON.stringify(opts.artifactKindsAbox));
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
  return {
    name,
    identifierType,
    producesStates: [`${identifierType}Deployed`],
    producesSemantics: [`${name}Key`],
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
  it('overrides domain-semantics.json artifactKinds with the ABox values when both are present (promote)', async () => {
    writeWorkspace({
      domainSemantics: {
        version: 1,
        runtimeStates: {
          ProcessDefinitionDeployed: { producedBy: [] },
          ProcessDefinitionIdDeployed: { producedBy: [] },
          FormIdDeployed: { producedBy: [] },
        },
        semanticTypes: {
          ProcessDefinitionKey: { witnesses: 'ProcessDefinitionDeployed' },
          bpmnProcessKey: { witnesses: 'ProcessDefinitionIdDeployed' },
          formKey: { witnesses: 'FormIdDeployed' },
        },
        // Legacy says only bpmnProcess. ABox will add `form`.
        artifactKinds: {
          bpmnProcess: {
            producesStates: ['ProcessDefinitionDeployed'],
            producesSemantics: ['ProcessDefinitionKey'],
            identifierType: 'ProcessDefinitionId',
            deploymentSlices: ['processDefinition'],
          },
        },
        semanticTypeToArtifactKind: { ProcessDefinitionKey: 'bpmnProcess' },
        operationArtifactRules: {
          createDeployment: {
            composable: false,
            rules: [{ id: 'bpmn', artifactKind: 'bpmnProcess' }],
          },
        },
        artifactFileKinds: { '.bpmn': ['bpmnProcess'] },
      },
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
    // ABox supersedes — `form` is now part of artifactKinds, composable is true.
    expect(Object.keys(graph.domain?.artifactKinds ?? {})).toEqual(['bpmnProcess', 'form']);
    expect(graph.domain?.operationArtifactRules?.createDeployment?.composable).toBe(true);
    expect(graph.domain?.artifactFileKinds?.['.form']).toEqual(['form']);
  });

  it('populates graph.domain artifact sub-trees from the ABox even when no domain-semantics.json is shipped', async () => {
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

  it('preserves legacy domain-semantics.json artifact sub-trees when no ABox is shipped', async () => {
    writeWorkspace({
      artifactKindsAbox: null,
      domainSemantics: {
        version: 1,
        runtimeStates: { LegacyDeployed: { producedBy: [] } },
        semanticTypes: { LegacyKey: { witnesses: 'LegacyDeployed' } },
        artifactKinds: {
          legacyKind: {
            producesStates: ['LegacyDeployed'],
            producesSemantics: ['LegacyKey'],
            identifierType: 'LegacyId',
            deploymentSlices: ['legacy'],
          },
        },
        semanticTypeToArtifactKind: { LegacyKey: 'legacyKind' },
        operationArtifactRules: {},
        artifactFileKinds: { '.legacy': ['legacyKind'] },
      },
      graphOps: deployOp(),
    });
    const graph = await loadGraph(baseDir);
    expect(graph.domain?.artifactKinds?.legacyKind?.identifierType).toBe('LegacyId');
    expect(graph.domain?.semanticTypeToArtifactKind?.LegacyKey).toBe('legacyKind');
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

  it('hard-errors when the ABox introduces a `producesStates` value not declared in domain-semantics.json runtimeStates / capabilities (post-overlay re-validation)', async () => {
    // Pre-overlay validation only sees the legacy sidecar's
    // artifactKinds. Without re-validating after the ABox overlay, an
    // ABox that introduces an undeclared state would slip through and
    // the planner would silently break at the BFS stage.
    writeWorkspace({
      domainSemantics: {
        version: 1,
        runtimeStates: { ProcessDefinitionDeployed: { producedBy: [] } },
        semanticTypes: { ProcessDefinitionKey: { witnesses: 'ProcessDefinitionDeployed' } },
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
    await expect(loadGraph(baseDir)).rejects.toThrow(
      /artifact-kinds ABox introduced cross-reference violation/,
    );
  });
});
