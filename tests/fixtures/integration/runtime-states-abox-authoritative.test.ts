/**
 * Integration fixture for Lift 6 (#214): the runtime-states ABox is
 * the authoritative source for `graph.domain.runtimeStates` and
 * `graph.domain.operationRequirements` at runtime, AND the values it
 * declares are seen by the producersByState-building loop and the
 * `node.domainRequiresAll` / `domainImplicitAdds` / `domainProduces`
 * setters inside loadGraph (because the overlay happens inside the
 * try block, not in the post-try block where artifact-kinds lives).
 *
 * Mirrors `artifact-kinds-abox-authoritative.test.ts` (Lift 5 / #212).
 *
 * Six observable behaviours guarded here:
 *
 *   1. **ABox authoritative — promotes**: `domain-semantics.json`
 *      declares one set of runtimeStates; the ABox declares a
 *      different set. After loadGraph, `graph.domain.runtimeStates`
 *      reflects the ABox AND `producersByState` is built from the
 *      ABox values.
 *
 *   2. **Strict mode**: with `STRICT_RUNTIME_STATES_ABOX=1`, an
 *      abox-vs-graph drift (producedBy referencing a nonexistent
 *      opId) is a hard error.
 *
 *   3. **Legacy fallback**: with no ABox shipped, the legacy
 *      `domain-semantics.json` keys remain authoritative.
 *
 *   4. **Sense-2 drift warnings**: dead-state / dangling-opId
 *      references are flagged.
 *
 *   5. **Post-overlay re-validation**: an ABox that introduces an
 *      `operationRequirements.disjunctions` member referencing an
 *      undeclared state is rejected, even when the legacy sidecar
 *      didn't have that member at all.
 *
 *   6. **ABox supersedes stale legacy**: a legacy sidecar that
 *      contains a `runtimeStates` entry referencing a state that
 *      _itself_ no longer exists in the ABox does NOT fail load —
 *      because pre-overlay validation overlays the ABox values.
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
  it('populates graph.domain runtime sub-trees AND producersByState from the ABox even when no domain-semantics.json is shipped (Lift 8-style ABox-authoritative)', async () => {
    writeWorkspace({
      // No domain-semantics.json sidecar at all.
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
    // graph.domain populated from the ABox.
    expect(Object.keys(graph.domain?.runtimeStates ?? {})).toEqual(['AboxOnlyState']);
    expect(graph.domain?.operationRequirements?.createProcessInstance?.requires).toEqual([
      'AboxOnlyState',
    ]);
    // producersByState built from the ABox (the consumer-loop fix).
    expect(graph.producersByState?.AboxOnlyState).toEqual(['createDeployment']);
    expect(graph.producersByState?.DerivedState).toEqual(['createProcessInstance']);
    // node.domain* setters fired from the ABox.
    expect(graph.operations.createProcessInstance?.domainRequiresAll).toEqual(['AboxOnlyState']);
    expect(graph.operations.createProcessInstance?.domainProduces).toContain('DerivedState');
  });

  it('overrides domain-semantics.json runtimeStates+operationRequirements with ABox values (promote) AND propagates to producersByState', async () => {
    writeWorkspace({
      domainSemantics: {
        version: 1,
        // Legacy declares one state. ABox declares a different one.
        runtimeStates: {
          LegacyOnlyState: { kind: 'state', producedBy: ['createDeployment'] },
        },
        operationRequirements: {
          createProcessInstance: { requires: ['LegacyOnlyState'] },
        },
      },
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'AboxState', producedBy: ['createDeployment'] }],
        operationRequirements: [{ operationId: 'createProcessInstance', requires: ['AboxState'] }],
      },
      graphOps: ops(),
    });
    const graph = await loadGraph(baseDir);
    // graph.domain reflects the ABox.
    expect(Object.keys(graph.domain?.runtimeStates ?? {})).toEqual(['AboxState']);
    expect(graph.domain?.operationRequirements?.createProcessInstance?.requires).toEqual([
      'AboxState',
    ]);
    // producersByState is built INSIDE the try block from the overlaid value.
    expect(graph.producersByState?.AboxState).toEqual(['createDeployment']);
    expect(graph.producersByState?.LegacyOnlyState).toBeUndefined();
    // node.domainRequiresAll picks up the ABox-overlaid operationRequirements.
    expect(graph.operations.createProcessInstance?.domainRequiresAll).toEqual(['AboxState']);
  });

  it('hard-errors on abox-vs-graph drift when STRICT_RUNTIME_STATES_ABOX=1', async () => {
    process.env.STRICT_RUNTIME_STATES_ABOX = '1';
    writeWorkspace({
      domainSemantics: { version: 1 },
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

  it('preserves legacy domain-semantics.json runtime sub-trees when no ABox is shipped', async () => {
    writeWorkspace({
      runtimeStatesAbox: null,
      domainSemantics: {
        version: 1,
        runtimeStates: { LegacyState: { kind: 'state', producedBy: ['createDeployment'] } },
        operationRequirements: {
          createProcessInstance: { requires: ['LegacyState'] },
        },
      },
      graphOps: ops(),
    });
    const graph = await loadGraph(baseDir);
    expect(graph.domain?.runtimeStates?.LegacyState).toBeDefined();
    expect(graph.producersByState?.LegacyState).toEqual(['createDeployment']);
  });

  it('warns on dangling opIds (sense-2 abox-vs-graph)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      domainSemantics: { version: 1 },
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'UsedState', producedBy: ['createDeployment'] }],
        operationRequirements: [
          { operationId: 'createProcessInstance', requires: ['UsedState'] },
          // Dangling opId
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

  it('post-overlay validation rejects an ABox that introduces a disjunctions member referencing an undeclared state (the validator sees the merged authoritative view)', async () => {
    writeWorkspace({
      domainSemantics: {
        version: 1,
      },
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

  it('ABox supersedes a legacy sidecar that itself references a now-removed state (no spurious load failure)', async () => {
    writeWorkspace({
      domainSemantics: {
        version: 1,
        // Legacy declares an operationRequirements entry that references
        // a state the legacy sidecar's runtimeStates no longer declares.
        // Without the pre-overlay overlay, validateDomainSemantics would
        // fail on this stale entry. With the overlay, the ABox values
        // are validated instead.
        runtimeStates: {
          StaleStateName: { kind: 'state', producedBy: ['createDeployment'] },
        },
        operationRequirements: {
          createProcessInstance: { disjunctions: [['StaleStateName', 'GoneState']] },
        },
      },
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'AboxState', producedBy: ['createDeployment'] }],
        operationRequirements: [{ operationId: 'createProcessInstance', requires: ['AboxState'] }],
      },
      graphOps: ops(),
    });
    const graph = await loadGraph(baseDir);
    expect(Object.keys(graph.domain?.runtimeStates ?? {})).toEqual(['AboxState']);
    expect(graph.operations.createProcessInstance?.domainRequiresAll).toEqual(['AboxState']);
  });
});
