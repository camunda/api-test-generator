/**
 * Integration fixture for Lift 7 (#216): the semantics ABox is the
 * authoritative source for `graph.domain.{semanticTypes,capabilities,
 * identifiers}` at runtime, AND the values it declares are seen by the
 * producersByState-building loop (capabilities.producedBy →
 * producersByState[capName]; identifiers.boundBy →
 * producersByState[validityState]) inside loadGraph (because the
 * overlay happens inside the try block as well as in the post-try
 * ABox-only path).
 *
 * Mirrors `runtime-states-abox-authoritative.test.ts` (Lift 6 / #214).
 *
 * Seven observable behaviours guarded here:
 *
 *   1. **ABox-only — populates everything**: with no
 *      `domain-semantics.json` sidecar, `graph.domain.semanticTypes` /
 *      `capabilities` / `identifiers` are populated from the ABox AND
 *      `producersByState` reflects capabilities.producedBy and
 *      identifiers.boundBy.
 *
 *   2. **ABox authoritative — promotes**: legacy declares one set;
 *      ABox declares a different set. After loadGraph, `graph.domain`
 *      reflects the ABox AND `producersByState` is built from it.
 *
 *   3. **Strict mode**: with `STRICT_SEMANTICS_ABOX=1`, an
 *      abox-vs-graph drift (capabilities.producedBy referencing a
 *      nonexistent opId) is a hard error.
 *
 *   4. **Legacy fallback**: with no ABox shipped, the legacy
 *      `domain-semantics.json` keys remain authoritative.
 *
 *   5. **Sense-2 drift warnings**: dangling capabilities.producedBy
 *      / identifiers.boundBy opIds are flagged.
 *
 *   6. **Post-overlay re-validation**: an ABox that introduces a
 *      `semanticTypes.witnesses` referencing an undeclared state is
 *      rejected when overlaid on a legacy sidecar.
 *
 *   7. **ABox supersedes stale legacy**: a legacy sidecar that
 *      contains a `semanticTypes.X.witnesses` referencing a state that
 *      _itself_ no longer exists in the ABox does NOT fail load —
 *      because pre-overlay validation overlays the ABox values first.
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
  it('populates graph.domain semantic sub-trees AND producersByState from the ABox even when no domain-semantics.json is shipped (Lift 8-style ABox-authoritative)', async () => {
    writeWorkspace({
      // No domain-semantics.json sidecar at all.
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
    // graph.domain populated from the ABox.
    expect(Object.keys(graph.domain?.semanticTypes ?? {}).sort()).toEqual([
      'ProcessDefinitionKey',
      'Tag',
    ]);
    expect(graph.domain?.capabilities?.ModelHasServiceTaskType?.parameter).toBe('jobType');
    expect(graph.domain?.identifiers?.ProcessDefinitionId?.validityState).toBe(
      'ProcessDefinitionDeployed',
    );
    // capabilities.producedBy and identifiers.boundBy both surface as producers (the consumer-loop fix).
    expect(graph.producersByState?.ModelHasServiceTaskType).toEqual(['createDeployment']);
    expect(graph.producersByState?.ProcessDefinitionDeployed).toEqual(['createDeployment']);
    // node.domainProduces reflects the produced state set.
    expect(graph.operations.createDeployment?.domainProduces).toContain('ModelHasServiceTaskType');
    expect(graph.operations.createDeployment?.domainProduces).toContain(
      'ProcessDefinitionDeployed',
    );
  });

  it('overrides domain-semantics.json semanticTypes/capabilities/identifiers with ABox values (promote) AND propagates to producersByState', async () => {
    writeWorkspace({
      domainSemantics: {
        version: 1,
        // Legacy declares one capability with createProcessInstance as producer.
        capabilities: {
          LegacyCap: { kind: 'capability', parameter: 'p', producedBy: ['createProcessInstance'] },
        },
        identifiers: {
          LegacyId: {
            kind: 'identifier',
            validityState: 'LegacyState',
            boundBy: ['createProcessInstance'],
          },
        },
        semanticTypes: { LegacyType: { witnesses: 'LegacyState' } },
        runtimeStates: {
          LegacyState: { kind: 'state', producedBy: ['createProcessInstance'] },
        },
      },
      semanticsAbox: {
        version: 1,
        semanticTypes: [{ name: 'AboxType', witnesses: 'LegacyState' }],
        capabilities: [{ name: 'AboxCap', parameter: 'p', producedBy: ['createDeployment'] }],
        identifiers: [
          {
            name: 'AboxId',
            validityState: 'LegacyState',
            boundBy: ['createDeployment'],
          },
        ],
      },
      graphOps: ops(),
    });
    const graph = await loadGraph(baseDir);
    // graph.domain reflects the ABox.
    expect(Object.keys(graph.domain?.semanticTypes ?? {})).toEqual(['AboxType']);
    expect(Object.keys(graph.domain?.capabilities ?? {})).toEqual(['AboxCap']);
    expect(Object.keys(graph.domain?.identifiers ?? {})).toEqual(['AboxId']);
    // producersByState built INSIDE the try block from the overlaid value.
    expect(graph.producersByState?.AboxCap).toEqual(['createDeployment']);
    // LegacyCap is gone — ABox supersedes.
    expect(graph.producersByState?.LegacyCap).toBeUndefined();
    // identifiers.boundBy → validityState route is also exercised.
    expect(graph.producersByState?.LegacyState).toContain('createDeployment');
  });

  it('hard-errors on abox-vs-graph drift when STRICT_SEMANTICS_ABOX=1', async () => {
    process.env.STRICT_SEMANTICS_ABOX = '1';
    writeWorkspace({
      domainSemantics: { version: 1 },
      semanticsAbox: {
        version: 1,
        semanticTypes: [{ name: 'T' }],
        capabilities: [
          // producedBy references an opId that doesn't exist in the graph.
          { name: 'Cap', parameter: 'p', producedBy: ['nonexistentOp'] },
        ],
      },
      graphOps: ops(),
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(/semantics ABox drift detected/);
  });

  it('preserves legacy domain-semantics.json semantic sub-trees when no ABox is shipped', async () => {
    writeWorkspace({
      semanticsAbox: null,
      domainSemantics: {
        version: 1,
        capabilities: {
          LegacyCap: { kind: 'capability', parameter: 'p', producedBy: ['createDeployment'] },
        },
        semanticTypes: { LegacyType: {} },
      },
      graphOps: ops(),
    });
    const graph = await loadGraph(baseDir);
    expect(graph.domain?.capabilities?.LegacyCap).toBeDefined();
    expect(graph.producersByState?.LegacyCap).toEqual(['createDeployment']);
  });

  it('warns on dangling capabilities.producedBy / identifiers.boundBy opIds (sense-2 abox-vs-graph)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      domainSemantics: { version: 1 },
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

  it('post-overlay validation rejects an ABox semanticTypes.witnesses referencing an undeclared state (the validator sees the merged authoritative view)', async () => {
    writeWorkspace({
      domainSemantics: {
        version: 1,
        // Legacy has nothing relevant; the ABox brings in `Witnesses: 'GoneState'`.
        runtimeStates: {
          DeclaredState: { kind: 'state', producedBy: ['createDeployment'] },
        },
      },
      semanticsAbox: {
        version: 1,
        // 'GoneState' is not in runtimeStates and not in capabilities.
        semanticTypes: [{ name: 'BadType', witnesses: 'GoneState' }],
      },
      graphOps: ops(),
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(
      /semanticTypeWitnessTargetResolves.*GoneState/,
    );
  });

  it('ABox supersedes a legacy sidecar that itself references a now-removed state (no spurious load failure)', async () => {
    writeWorkspace({
      domainSemantics: {
        version: 1,
        // Legacy semanticTypes.witnesses points at a state the legacy
        // sidecar's runtimeStates no longer declares — this entry would
        // fail validation pre-overlay if the ABox didn't supersede it.
        semanticTypes: { StaleType: { witnesses: 'GoneStateInLegacy' } },
        runtimeStates: {
          OnlyAboxStateExists: { kind: 'state', producedBy: ['createDeployment'] },
        },
      },
      semanticsAbox: {
        version: 1,
        semanticTypes: [{ name: 'GoodType', witnesses: 'OnlyAboxStateExists' }],
      },
      graphOps: ops(),
    });
    const graph = await loadGraph(baseDir);
    expect(Object.keys(graph.domain?.semanticTypes ?? {})).toEqual(['GoodType']);
  });

  it('PR #217 review: post-overlay cross-reference validation runs in the ABox-only path too (no legacy sidecar present)', async () => {
    writeWorkspace({
      // No domain-semantics.json sidecar at all — exercises the
      // ABox-authoritative branch the reviewer flagged.
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'DeclaredState', producedBy: ['createDeployment'] }],
        operationRequirements: [],
      },
      semanticsAbox: {
        version: 1,
        // 'GoneState' is not in runtimeStates and not in capabilities,
        // so witnesses targets nothing in the synthesized ABox-only domain.
        semanticTypes: [{ name: 'BadType', witnesses: 'GoneState' }],
      },
      graphOps: ops(),
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(
      /semanticTypeWitnessTargetResolves.*GoneState/,
    );
  });
});
