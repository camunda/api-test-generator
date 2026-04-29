/**
 * Loader fixtures for graphLoader sidecar handling — issue #56.
 *
 * Each fixture builds a tiny on-disk layout mimicking the path-analyser
 * baseDir contract (a sibling `semantic-graph-extractor/dist/output/`
 * directory holding the dependency graph, plus a `domain-semantics.json`
 * inside the baseDir), then calls `loadGraph()` and asserts on the
 * returned `OperationGraph`.
 *
 * The first fixture pins the regression for #56: a sidecar-declared
 * `domain.operationRequirements[opId].produces` must surface in
 * `bySemanticProducer` and `operations[opId].produces`, otherwise
 * semantic BFS cannot use it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadGraph } from '../../../path-analyser/src/graphLoader.ts';

interface SidecarLayout {
  graph: Record<string, unknown>;
  domain: Record<string, unknown>;
}

let workdir: string;
let baseDir: string;
let graphDir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'graphloader-fixture-'));
  baseDir = join(workdir, 'path-analyser');
  graphDir = join(workdir, 'semantic-graph-extractor', 'dist', 'output');
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(graphDir, { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function writeLayout(layout: SidecarLayout): void {
  writeFileSync(join(graphDir, 'operation-dependency-graph.json'), JSON.stringify(layout.graph));
  writeFileSync(join(baseDir, 'domain-semantics.json'), JSON.stringify(layout.domain));
}

// ---------------------------------------------------------------------------
// Fixture #56 — sidecar `produces` must surface in BFS-visible maps.
// ---------------------------------------------------------------------------
describe('graphLoader: sidecar-declared produces (#56)', () => {
  it('registers sidecar produces in bySemanticProducer so semantic BFS can find them', async () => {
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
      domain: {
        operationRequirements: {
          producerOp: {
            produces: ['Foo'],
          },
        },
      },
    });
    const g = await loadGraph(baseDir);
    expect(
      g.bySemanticProducer.Foo,
      'sidecar producer must be registered for semantic BFS',
    ).toEqual(['producerOp']);
  });

  it("registers sidecar produces on the operation's own produces list", async () => {
    writeLayout({
      graph: {
        operations: [{ operationId: 'producerOp', method: 'POST', path: '/producer' }],
      },
      domain: {
        operationRequirements: {
          producerOp: {
            produces: ['Foo'],
          },
        },
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.operations.producerOp?.produces).toContain('Foo');
  });

  it('preserves an existing extractor-derived producer when the sidecar declares the same semantic', async () => {
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
          { operationId: 'sidecarProducer', method: 'POST', path: '/sidecar' },
        ],
      },
      domain: {
        operationRequirements: {
          sidecarProducer: {
            produces: ['Foo'],
          },
        },
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.bySemanticProducer.Foo).toEqual(
      expect.arrayContaining(['extractorProducer', 'sidecarProducer']),
    );
  });

  it('does not duplicate a producer if the sidecar redundantly declares an extractor-derived semantic', async () => {
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
      domain: {
        operationRequirements: {
          opOne: {
            produces: ['Foo'],
          },
        },
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.bySemanticProducer.Foo).toEqual(['opOne']);
    expect(g.operations.opOne?.produces.filter((s) => s === 'Foo').length).toBe(1);
  });
});
