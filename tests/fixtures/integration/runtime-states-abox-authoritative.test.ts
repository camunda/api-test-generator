/**
 * Integration fixture for Lift 6 (#214): the runtime-states ABox is
 * the authoritative source for `graph.domain.runtimeStates` and
 * `graph.domain.operationRequirements` at runtime, and the values it
 * declares are reflected in the producer/setter indexes loadGraph
 * builds.
 *
 * Mirrors `artifact-kinds-abox-authoritative.test.ts` (Lift 5 / #212).
 *
 * Four observable behaviours guarded here:
 *
 *   1. **ABox-only graph population**: the runtime-states ABox
 *      populates `graph.domain.runtimeStates`,
 *      `graph.domain.operationRequirements`, and the dependent
 *      producer/setter indexes.
 *
 *   2. **Strict mode**: with `STRICT_RUNTIME_STATES_ABOX=1`, an
 *      abox-vs-graph drift (producedBy referencing a nonexistent
 *      opId) is a hard error.
 *
 *   3. **Sense-2 drift warnings**: dead-state / dangling-opId
 *      references are flagged.
 *
 *   4. **Cross-ABox validation**: an ABox that introduces an
 *      `operationRequirements.disjunctions` member referencing an
 *      undeclared state is rejected.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGraph } from '../../../path-analyser/src/graphLoader.ts';

const CONFIG_NAME = 'lift6-runtime-states-test';

let workdir: string;
let baseDir: string;
const ORIGINAL = {
  CONFIG: process.env.CONFIG,
  OPERATION_GRAPH_PATH: process.env.OPERATION_GRAPH_PATH,
  OPENAPI_SPEC_PATH: process.env.OPENAPI_SPEC_PATH,
  STRICT_RUNTIME_STATES_ABOX: process.env.STRICT_RUNTIME_STATES_ABOX,
};

function writeWorkspace(opts: {
  runtimeStatesAbox: object | null;
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
  if (opts.runtimeStatesAbox !== null) {
    const aboxDir = join(configDir, 'ontology');
    mkdirSync(aboxDir, { recursive: true });
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
  workdir = mkdtempSync(join(tmpdir(), 'lift6-runtime-states-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('Lift 6 (#214): runtime-states ABox is authoritative for graph.domain runtime sub-trees', () => {
  it('populates graph.domain runtime sub-trees AND producersByState from the ABox', async () => {
    writeWorkspace({
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'AboxOnlyState', producedBy: ['createDeployment'] }],
        operationRequirements: [
          {
            operationId: 'createProcessInstance',
            requires: ['AboxOnlyState'],
            produces: ['DerivedState'],
          },
        ],
      },
      graphOps: ops(),
    });
    const graph = await loadGraph(baseDir);
    expect(Object.keys(graph.domain?.runtimeStates ?? {})).toEqual(['AboxOnlyState']);
    expect(graph.domain?.operationRequirements?.createProcessInstance?.requires).toEqual([
      'AboxOnlyState',
    ]);
    expect(graph.producersByState?.AboxOnlyState).toEqual(['createDeployment']);
    expect(graph.producersByState?.DerivedState).toEqual(['createProcessInstance']);
    expect(graph.operations.createProcessInstance?.domainRequiresAll).toEqual(['AboxOnlyState']);
    expect(graph.operations.createProcessInstance?.domainProduces).toContain('DerivedState');
  });

  it('propagates runtime-state producers and operationRequirements from the ABox into graph indexes', async () => {
    writeWorkspace({
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'AboxState', producedBy: ['createDeployment'] }],
        operationRequirements: [{ operationId: 'createProcessInstance', requires: ['AboxState'] }],
      },
      graphOps: ops(),
    });
    const graph = await loadGraph(baseDir);
    expect(Object.keys(graph.domain?.runtimeStates ?? {})).toEqual(['AboxState']);
    expect(graph.domain?.operationRequirements?.createProcessInstance?.requires).toEqual([
      'AboxState',
    ]);
    expect(graph.producersByState?.AboxState).toEqual(['createDeployment']);
    expect(graph.operations.createProcessInstance?.domainRequiresAll).toEqual(['AboxState']);
  });

  it('hard-errors on abox-vs-graph drift when STRICT_RUNTIME_STATES_ABOX=1', async () => {
    process.env.STRICT_RUNTIME_STATES_ABOX = '1';
    writeWorkspace({
      runtimeStatesAbox: {
        version: 1,
        states: [
          // producedBy references an opId that doesn't exist in the graph.
          { name: 'AboxState', producedBy: ['nonexistentOp'] },
        ],
        operationRequirements: [{ operationId: 'createProcessInstance', requires: ['AboxState'] }],
      },
      graphOps: ops(),
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(/runtime-states ABox drift detected/);
  });

  it('warns on dangling opIds (sense-2 abox-vs-graph)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'UsedState', producedBy: ['createDeployment'] }],
        operationRequirements: [
          { operationId: 'createProcessInstance', requires: ['UsedState'] },
          { operationId: 'nonexistentOp', requires: ['UsedState'] },
        ],
      },
      graphOps: ops(),
    });
    await loadGraph(baseDir);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    const joined = messages.join('\n');
    expect(joined).toMatch(/runtime-states ABox drift detected/);
    expect(joined).toMatch(/operationRequirements entry 'nonexistentOp'/);
    warn.mockRestore();
  });

  it('rejects a disjunction that references an undeclared state', async () => {
    writeWorkspace({
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'DeclaredState', producedBy: ['createDeployment'] }],
        operationRequirements: [
          {
            operationId: 'createProcessInstance',
            // 'UndeclaredState' is not in states[] and not in capabilities.
            disjunctions: [['DeclaredState', 'UndeclaredState']],
          },
        ],
      },
      graphOps: ops(),
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(/disjunctionMemberResolves.*UndeclaredState/);
  });
});
