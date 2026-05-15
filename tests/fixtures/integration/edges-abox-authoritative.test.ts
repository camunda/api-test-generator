/**
 * Integration fixture for Lift 3 (#208): the edges ABox is the
 * authoritative source for `op.establishes.shape === 'edge'` at runtime.
 *
 * The principle (#198): an annotation belongs in the spec iff a
 * non-Camunda implementer of the API would need it to implement a
 * conformant server. The `shape: 'edge'` classifier on
 * `x-semantic-establishes` is a domain claim with no wire signature,
 * so it belongs in the ABox.
 *
 * Three observable behaviours guarded by this fixture:
 *
 *   1. **ABox authoritative — promotes**: the spec annotation has no
 *      `shape` value (or `undefined`); the ABox lists the op in
 *      `establishedBy`. After loadGraph, `op.establishes.shape ===
 *      'edge'` (sourced from the ABox, not the spec annotation).
 *
 *   2. **ABox authoritative — demotes**: the spec annotation says
 *      `shape: 'edge'`; the ABox does NOT list the op. After loadGraph,
 *      `op.establishes.shape === undefined` (the spec annotation is
 *      ignored), and a drift warning is emitted to stderr.
 *
 *   3. **Strict mode**: with `STRICT_EDGES_ABOX=1`, drift becomes a
 *      hard error.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGraph } from '../../../path-analyser/src/graphLoader.ts';

const CONFIG_NAME = 'lift3-edges-test';

let workdir: string;
let baseDir: string;
const ORIGINAL = {
  CONFIG: process.env.CONFIG,
  OPERATION_GRAPH_PATH: process.env.OPERATION_GRAPH_PATH,
  OPENAPI_SPEC_PATH: process.env.OPENAPI_SPEC_PATH,
  STRICT_EDGES_ABOX: process.env.STRICT_EDGES_ABOX,
};

function writeWorkspace(opts: {
  edgesAbox: object | null;
  graphOps: Record<string, unknown>;
}): void {
  // loadGraph computes `repoRoot = path.resolve(baseDir, '..')`; place
  // configs.json + the ABox under repoRoot, and the graph file under
  // baseDir. Mirrors the real layout (path-analyser as workspace).
  const repoRoot = workdir;
  baseDir = join(repoRoot, 'path-analyser');
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(
    join(repoRoot, 'configs.json'),
    JSON.stringify({ default: CONFIG_NAME, configs: { [CONFIG_NAME]: {} } }),
  );
  if (opts.edgesAbox !== null) {
    const aboxDir = join(repoRoot, 'configs', CONFIG_NAME, 'ontology');
    mkdirSync(aboxDir, { recursive: true });
    writeFileSync(join(aboxDir, 'edges.json'), JSON.stringify(opts.edgesAbox));
  }
  const graphPath = join(baseDir, 'operation-dependency-graph.json');
  writeFileSync(graphPath, JSON.stringify({ operations: opts.graphOps }));
  process.env.OPERATION_GRAPH_PATH = graphPath;
  process.env.CONFIG = CONFIG_NAME;
  // Ensure the (optional) hint-merge loader doesn't try to read a real spec.
  process.env.OPENAPI_SPEC_PATH = join(baseDir, 'no-such-spec.yaml');
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'lift3-edges-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('Lift 3 (#208): edges ABox is authoritative for op.establishes.shape', () => {
  it('promotes a non-edge spec annotation to shape: edge when the ABox lists the op', async () => {
    writeWorkspace({
      edgesAbox: {
        version: 1,
        edges: [
          {
            name: 'GroupUserMembership',
            endpoints: { from: 'Group', to: 'User' },
            identifiedBy: ['GroupId', 'Username'],
            establishedBy: 'assignUserToGroup',
            observableVia: 'searchUsersForGroup',
            description: 'fixture',
          },
        ],
      },
      graphOps: {
        assignUserToGroup: {
          operationId: 'assignUserToGroup',
          method: 'POST',
          path: '/groups/{groupId}/users/{username}',
          requires: { required: [], optional: [] },
          produces: [],
          // Spec annotation has NO `shape` value — pre-Lift-3 the
          // planner would have classified this as a non-edge.
          establishes: {
            kind: 'GroupUserMembership',
            identifiedBy: [
              { in: 'path', name: 'groupId', semanticType: 'GroupId' },
              { in: 'path', name: 'username', semanticType: 'Username' },
            ],
          },
        },
      },
    });
    const graph = await loadGraph(baseDir);
    expect(graph.operations.assignUserToGroup?.establishes?.shape).toBe('edge');
  });

  it('demotes a spec shape: edge to undefined when the ABox does not list the op', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeWorkspace({
      // ABox ships an unrelated edge — the schema requires at least
      // one entry. The op under test is intentionally NOT listed in
      // `establishedBy`, which is what triggers the demote.
      edgesAbox: {
        version: 1,
        edges: [
          {
            name: 'UnrelatedEdge',
            endpoints: { from: 'P', to: 'Q' },
            identifiedBy: ['PId', 'QId'],
            establishedBy: 'unrelatedEstablisher',
            observableVia: 'unrelatedObserver',
            description: 'unrelated to the op under test',
          },
        ],
      },
      graphOps: {
        notReallyAnEdge: {
          operationId: 'notReallyAnEdge',
          method: 'POST',
          path: '/x/{xId}/y/{yId}',
          requires: { required: [], optional: [] },
          produces: [],
          establishes: {
            kind: 'WhateverKind',
            shape: 'edge',
            identifiedBy: [
              { in: 'path', name: 'xId', semanticType: 'XId' },
              { in: 'path', name: 'yId', semanticType: 'YId' },
            ],
          },
        },
      },
    });
    const graph = await loadGraph(baseDir);
    expect(graph.operations.notReallyAnEdge?.establishes?.shape).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    const allWarnings = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allWarnings).toMatch(/edges ABox \/ spec-annotation drift/);
    expect(allWarnings).toMatch(/notReallyAnEdge/);
    warn.mockRestore();
  });

  it('hard-errors on drift when STRICT_EDGES_ABOX=1', async () => {
    process.env.STRICT_EDGES_ABOX = '1';
    writeWorkspace({
      edgesAbox: {
        version: 1,
        edges: [
          {
            name: 'UnrelatedEdge',
            endpoints: { from: 'P', to: 'Q' },
            identifiedBy: ['PId', 'QId'],
            establishedBy: 'unrelatedEstablisher',
            observableVia: 'unrelatedObserver',
            description: 'unrelated',
          },
        ],
      },
      graphOps: {
        spuriousEdge: {
          operationId: 'spuriousEdge',
          method: 'POST',
          path: '/a/{aId}/b/{bId}',
          requires: { required: [], optional: [] },
          produces: [],
          establishes: {
            kind: 'SpuriousKind',
            shape: 'edge',
            identifiedBy: [
              { in: 'path', name: 'aId', semanticType: 'AId' },
              { in: 'path', name: 'bId', semanticType: 'BId' },
            ],
          },
        },
      },
    });
    await expect(loadGraph(baseDir)).rejects.toThrow(/edges ABox \/ spec-annotation drift/);
  });

  it('falls back to legacy spec-driven behaviour when no ABox file is present', async () => {
    writeWorkspace({
      edgesAbox: null,
      graphOps: {
        legacyEdge: {
          operationId: 'legacyEdge',
          method: 'POST',
          path: '/a/{aId}/b/{bId}',
          requires: { required: [], optional: [] },
          produces: [],
          establishes: {
            kind: 'LegacyEdge',
            shape: 'edge',
            identifiedBy: [
              { in: 'path', name: 'aId', semanticType: 'AId' },
              { in: 'path', name: 'bId', semanticType: 'BId' },
            ],
          },
        },
      },
    });
    const graph = await loadGraph(baseDir);
    expect(graph.operations.legacyEdge?.establishes?.shape).toBe('edge');
  });
});
