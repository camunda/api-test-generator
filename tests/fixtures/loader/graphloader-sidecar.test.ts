/**
 * Loader fixtures for runtime-states ABox handling — issue #56.
 *
 * Each fixture builds a tiny on-disk layout mimicking the path-analyser
 * baseDir contract (a `generated/<config>/graph/` directory at the repo
 * root holding the dependency graph, plus ontology ABoxes inside the
 * active config directory at the repo root — see #128), then calls
 * `loadGraph()` and asserts on the returned `OperationGraph`.
 *
 * The fixtures pin the regression for #56: an ABox-declared
 * `operationRequirements[opId].produces` must surface in
 * `producersByType` and `operations[opId].produces`, otherwise
 * semantic BFS cannot use it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadGraph } from '../../../path-analyser/src/graphLoader.ts';

interface Layout {
  graph: Record<string, unknown>;
  runtimeStatesAbox?: Record<string, unknown>;
}

let workdir: string;
let baseDir: string;
let graphDir: string;
let configDir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'graphloader-fixture-'));
  baseDir = join(workdir, 'path-analyser');
  graphDir = join(workdir, 'generated', 'camunda-oca', 'graph');
  configDir = join(workdir, 'configs', 'camunda-oca');
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(graphDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(workdir, 'configs.json'),
    JSON.stringify({ default: 'camunda-oca', configs: { 'camunda-oca': {} } }),
  );
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function writeLayout(layout: Layout): void {
  writeFileSync(join(graphDir, 'operation-dependency-graph.json'), JSON.stringify(layout.graph));
  if (layout.runtimeStatesAbox !== undefined) {
    const aboxDir = join(configDir, 'ontology');
    mkdirSync(aboxDir, { recursive: true });
    writeFileSync(join(aboxDir, 'runtime-states.json'), JSON.stringify(layout.runtimeStatesAbox));
  }
}

describe('graphLoader: runtime-states ABox declared produces (#56)', () => {
  it('registers ABox produces in producersByType so semantic BFS can find them', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'producerOp',
            method: 'POST',
            path: '/producer',
          },
          {
            operationId: 'consumerOp',
            method: 'POST',
            path: '/consumer',
          },
        ],
      },
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'Foo' }],
        operationRequirements: [
          {
            operationId: 'producerOp',
            produces: ['Foo'],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.producersByType.Foo, 'ABox producer must be registered for semantic BFS').toEqual([
      'producerOp',
    ]);
  });

  it("registers ABox produces on the operation's own produces list", async () => {
    writeLayout({
      graph: {
        operations: [{ operationId: 'producerOp', method: 'POST', path: '/producer' }],
      },
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'Foo' }],
        operationRequirements: [
          {
            operationId: 'producerOp',
            produces: ['Foo'],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.operations.producerOp?.produces).toContain('Foo');
  });

  it('preserves an existing extractor-derived producer when the ABox declares the same semantic', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'extractorProducer',
            method: 'POST',
            path: '/extractor',
            responseSemanticTypes: {
              '200': [{ semanticType: 'Foo', fieldPath: 'foo', provider: true }],
            },
          },
          { operationId: 'aboxProducer', method: 'POST', path: '/abox' },
        ],
      },
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'Foo' }],
        operationRequirements: [
          {
            operationId: 'aboxProducer',
            produces: ['Foo'],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.producersByType.Foo).toEqual(
      expect.arrayContaining(['extractorProducer', 'aboxProducer']),
    );
  });

  it('does not duplicate a producer if the ABox redundantly declares an extractor-derived semantic', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'opOne',
            method: 'POST',
            path: '/one',
            responseSemanticTypes: {
              '200': [{ semanticType: 'Foo', fieldPath: 'foo', provider: true }],
            },
          },
        ],
      },
      runtimeStatesAbox: {
        version: 1,
        states: [{ name: 'Foo' }],
        operationRequirements: [
          {
            operationId: 'opOne',
            produces: ['Foo'],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.producersByType.Foo).toEqual(['opOne']);
    expect(g.operations.opOne?.produces.filter((s) => s === 'Foo').length).toBe(1);
  });

  it('leaves domain analysis disabled when no ontology ABox is shipped', async () => {
    writeLayout({
      graph: {
        operations: [{ operationId: 'op', method: 'GET', path: '/x' }],
      },
    });
    const graph = await loadGraph(baseDir);
    expect(graph.domain).toBeUndefined();
    expect(graph.producersByState).toBeUndefined();
  });
});
