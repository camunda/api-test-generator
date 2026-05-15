/**
 * Integration fixture for Lift 7 (#216): the semantics ABox is the
 * authoritative source for `graph.domain.{semanticTypes,capabilities,
 * identifiers}` at runtime, and the values it declares are seen by the
 * producersByState-building loop (capabilities.producedBy →
 * producersByState[capName]; identifiers.boundBy →
 * producersByState[validityState]).
 *
 * Mirrors `runtime-states-abox-authoritative.test.ts` (Lift 6 / #214).
 *
 * Four observable behaviours guarded here:
 *
 *   1. **ABox-only graph population**: `graph.domain.semanticTypes` /
 *      `capabilities` / `identifiers` are populated from the ABox and
 *      `producersByState` reflects capabilities.producedBy and
 *      identifiers.boundBy.
 *
 *   2. **Strict mode**: with `STRICT_SEMANTICS_ABOX=1`, an
 *      abox-vs-graph drift (capabilities.producedBy referencing a
 *      nonexistent opId) is a hard error.
 *
 *   3. **Sense-2 drift warnings**: dangling capabilities.producedBy
 *      / identifiers.boundBy opIds are flagged.
 *
 *   4. **Cross-ABox validation**: an ABox semanticTypes.witnesses
 *      referencing an undeclared state is rejected.
 *
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGraph } from '../../../path-analyser/src/graphLoader.ts';

const CONFIG_NAME = 'lift7-semantics-test';

let workdir: string;
let baseDir: string;
const ORIGINAL = {
  CONFIG: process.env.CONFIG,
  OPERATION_GRAPH_PATH: process.env.OPERATION_GRAPH_PATH,
  OPENAPI_SPEC_PATH: process.env.OPENAPI_SPEC_PATH,
  STRICT_SEMANTICS_ABOX: process.env.STRICT_SEMANTICS_ABOX,
};

function writeWorkspace(opts: {
  semanticsAbox: object | null;
  runtimeStatesAbox?: object;
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
  if (opts.semanticsAbox !== null || opts.runtimeStatesAbox !== undefined) {
    mkdirSync(aboxDir, { recursive: true });
  }
  if (opts.semanticsAbox !== null) {
    writeFileSync(join(aboxDir, 'semantics.json'), JSON.stringify(opts.semanticsAbox));
  }
  if (opts.runtimeStatesAbox !== undefined) {
    writeFileSync(join(aboxDir, 'runtime-states.json'), JSON.stringify(opts.runtimeStatesAbox));
  }
  const graphPath = join(baseDir, 'operation-dependency-graph.json');
  writeFileSync(graphPath, JSON.stringify({ operations: opts.graphOps }));
  process.env.OPERATION_GRAPH_PATH = graphPath;
  process.env.CONFIG = CONFIG_NAME;
  process.env.OPENAPI_SPEC_PATH = join(baseDir, 'no-such-spec.yaml');
}

function ops(): Record<string, unknown> {
  return {
    createDeployment: {
      operationId: 'createDeployment',
      method: 'POST',
      path: '/deployments',
      requires: { required: [], optional: [] },
      produces: [],
    },
    createProcessInstance: {
      operationId: 'createProcessInstance',
      method: 'POST',
      path: '/process-instances',
      requires: { required: [], optional: [] },
      produces: [],
    },
  };
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'lift7-semantics-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('Lift 7 (#216): semantics ABox is authoritative for graph.domain semantic sub-trees', () => {
  it('populates graph.domain semantic sub-trees AND producersByState from the ABox', async () => {
    writeWorkspace({
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'ProcessDefinitionDeployed', producedBy: ['createDeployment'] }],
        operationRequirements: [],
      },
      semanticsAbox: {
        version: 1,
        semanticTypes: [
          { name: 'ProcessDefinitionKey', witnesses: 'ProcessDefinitionDeployed' },
          { name: 'Tag', kind: 'attribute', clientMinted: true },
        ],
        capabilities: [
          {
            name: 'ModelHasServiceTaskType',
            parameter: 'jobType',
            producedBy: ['createDeployment'],
          },
        ],
        identifiers: [
          {
            name: 'ProcessDefinitionId',
            validityState: 'ProcessDefinitionDeployed',
            boundBy: ['createDeployment'],
          },
        ],
      },
      graphOps: ops(),
    });
    const graph = await loadGraph(baseDir);
    expect(Object.keys(graph.domain?.semanticTypes ?? {}).sort()).toEqual([
      'ProcessDefinitionKey',
      'Tag',
    ]);
    expect(graph.domain?.capabilities?.ModelHasServiceTaskType?.parameter).toBe('jobType');
    expect(graph.domain?.identifiers?.ProcessDefinitionId?.validityState).toBe(
      'ProcessDefinitionDeployed',
    );
    expect(graph.producersByState?.ModelHasServiceTaskType).toEqual(['createDeployment']);
    expect(graph.producersByState?.ProcessDefinitionDeployed).toEqual(['createDeployment']);
    expect(graph.operations.createDeployment?.domainProduces).toContain('ModelHasServiceTaskType');
    expect(graph.operations.createDeployment?.domainProduces).toContain(
      'ProcessDefinitionDeployed',
    );
  });

  it('hard-errors on abox-vs-graph drift when STRICT_SEMANTICS_ABOX=1', async () => {
    process.env.STRICT_SEMANTICS_ABOX = '1';
    writeWorkspace({
      semanticsAbox: {
        version: 1,
        semanticTypes: [{ name: 'T' }],
        capabilities: [{ name: 'Cap', parameter: 'p', producedBy: ['nonexistentOp'] }],
      },
      graphOps: ops(),
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(/semantics ABox drift detected/);
  });

  it('warns on dangling capabilities.producedBy / identifiers.boundBy opIds (sense-2 abox-vs-graph)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      semanticsAbox: {
        version: 1,
        semanticTypes: [{ name: 'T' }],
        capabilities: [
          { name: 'Cap', parameter: 'p', producedBy: ['createDeployment', 'nonexistentOp1'] },
        ],
        identifiers: [{ name: 'Id', boundBy: ['nonexistentOp2'] }],
      },
      graphOps: ops(),
    });
    await loadGraph(baseDir);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    const joined = messages.join('\n');
    expect(joined).toMatch(/semantics ABox drift detected/);
    expect(joined).toMatch(/capability 'Cap'.*nonexistentOp1/);
    expect(joined).toMatch(/identifier 'Id'.*nonexistentOp2/);
    warn.mockRestore();
  });

  it('rejects a semanticTypes.witnesses reference to an undeclared state', async () => {
    writeWorkspace({
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'DeclaredState', producedBy: ['createDeployment'] }],
        operationRequirements: [],
      },
      semanticsAbox: {
        version: 1,
        semanticTypes: [{ name: 'BadType', witnesses: 'GoneState' }],
      },
      graphOps: ops(),
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(
      /semanticTypeWitnessTargetResolves.*GoneState/,
    );
  });
});
