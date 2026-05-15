/**
 * Loader fixtures for `requestSettersByType` and the per-op
 * `requestBodySemantics` index added in #162 PR 2.
 *
 * Class-scoped guarantee: every semantic-typed request-body leaf surfaces
 * on `OperationNode.requestBodySemantics` regardless of nesting,
 * required flag, or scalar/array shape; and the per-graph
 * `requestSettersByType` index lists every operation that accepts each
 * semantic in its body, dedup'd, with no entries when no operation
 * declares a body semantic.
 *
 * These properties are what the planner's `bindClientMintedAttribute`
 * helper and the future setter-chain reuse pass consume; if either
 * regresses, attribute-classification scenarios silently revert to the
 * pre-PR-2 synthetic placeholder. The fixture is the smallest spec
 * that exercises each shape independently.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadGraph } from '../../../path-analyser/src/graphLoader.ts';

let workdir: string;
let baseDir: string;
let graphDir: string;
let configDir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'graphloader-request-setters-'));
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

interface Layout {
  graph: Record<string, unknown>;
  semanticsAbox?: Record<string, unknown>;
}

// Default classifications for the synthetic semantics these fixtures
// reference in their `requestBodySemanticTypes` blocks. Without this,
// #162 PR 5's load-time fail-fast diagnostic rejects every fixture
// that names a semantic with no corresponding producer/establisher in
// the synthetic graph (which is most of them — these fixtures are
// scoped to the request-setter index, not to the classification chain).
//
// Any test exercising the unclassified-detection path itself must
// override `semanticsAbox` explicitly.
const DEFAULT_SEMANTICS_ABOX = {
  version: 1,
  semanticTypes: [
    { name: 'Tag', kind: 'attribute', clientMinted: true },
    { name: 'BusinessId', kind: 'attribute', clientMinted: true },
    { name: 'NoPath', kind: 'attribute', clientMinted: true },
    { name: 'ProcessInstanceKey', kind: 'serverEmergent' },
    { name: 'ProcessDefinitionId', kind: 'serverEmergent' },
  ],
};

function writeLayout(layout: Layout): void {
  writeFileSync(join(graphDir, 'operation-dependency-graph.json'), JSON.stringify(layout.graph));
  const aboxDir = join(configDir, 'ontology');
  mkdirSync(aboxDir, { recursive: true });
  writeFileSync(
    join(aboxDir, 'semantics.json'),
    JSON.stringify(layout.semanticsAbox ?? DEFAULT_SEMANTICS_ABOX),
  );
}

describe('graphLoader: requestBodySemantics surfaces every body leaf shape (#162 PR 2)', () => {
  it('top-level scalar, top-level scalar array, and nested-object leaves all surface', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'createInstance',
            method: 'POST',
            path: '/instance',
            requestBodySemanticTypes: [
              { fieldPath: 'businessId', semanticType: 'BusinessId', required: false },
              { fieldPath: 'tags[]', semanticType: 'Tag', required: false },
              {
                fieldPath: 'filter.processInstanceKey',
                semanticType: 'ProcessInstanceKey',
                required: false,
              },
            ],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    const op = g.operations.createInstance;
    expect(op?.requestBodySemantics).toEqual([
      { semantic: 'BusinessId', fieldPath: 'businessId', required: false },
      { semantic: 'Tag', fieldPath: 'tags[]', required: false },
      {
        semantic: 'ProcessInstanceKey',
        fieldPath: 'filter.processInstanceKey',
        required: false,
      },
    ]);
  });

  it('preserves the `required: true` flag on body leaves', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'createDeployment',
            method: 'POST',
            path: '/deployments',
            requestBodySemanticTypes: [
              {
                fieldPath: 'processDefinitionId',
                semanticType: 'ProcessDefinitionId',
                required: true,
              },
            ],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.operations.createDeployment?.requestBodySemantics).toEqual([
      { semantic: 'ProcessDefinitionId', fieldPath: 'processDefinitionId', required: true },
    ]);
  });

  it('omits `requestBodySemantics` when the operation has no body semantics', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'getStatus',
            method: 'GET',
            path: '/status',
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.operations.getStatus?.requestBodySemantics).toBeUndefined();
  });

  it('skips malformed entries (missing semanticType or fieldPath) without throwing', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'looseOp',
            method: 'POST',
            path: '/loose',
            requestBodySemanticTypes: [
              { fieldPath: 'businessId', semanticType: 'BusinessId', required: false },
              // Missing semanticType — the loader must drop this entry,
              // not surface a partial { fieldPath, undefined } in the
              // index (which would produce a bogus `undefined` key in
              // requestSettersByType).
              { fieldPath: 'noType' },
              // Missing fieldPath.
              { semanticType: 'NoPath' },
            ],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.operations.looseOp?.requestBodySemantics).toEqual([
      { semantic: 'BusinessId', fieldPath: 'businessId', required: false },
    ]);
  });
});

describe('graphLoader: requestSettersByType lists every body-acceptor per semantic (#162 PR 2)', () => {
  it('builds a per-semantic list of operations that accept the semantic in their body', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'createInstance',
            method: 'POST',
            path: '/instance',
            requestBodySemanticTypes: [
              { fieldPath: 'tags[]', semanticType: 'Tag', required: false },
              { fieldPath: 'businessId', semanticType: 'BusinessId', required: false },
            ],
          },
          {
            operationId: 'searchInstances',
            method: 'POST',
            path: '/instance/search',
            requestBodySemanticTypes: [
              { fieldPath: 'filter.tags[]', semanticType: 'Tag', required: false },
            ],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.requestSettersByType).toBeDefined();
    expect(g.requestSettersByType?.Tag).toEqual(['createInstance', 'searchInstances']);
    expect(g.requestSettersByType?.BusinessId).toEqual(['createInstance']);
  });

  it('dedups when one operation declares the same semantic on multiple body leaves', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'searchInstances',
            method: 'POST',
            path: '/instance/search',
            requestBodySemanticTypes: [
              { fieldPath: 'filter.tags[]', semanticType: 'Tag', required: false },
              { fieldPath: 'filter.$or[].tags[]', semanticType: 'Tag', required: false },
            ],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.requestSettersByType?.Tag).toEqual(['searchInstances']);
  });

  it('omits `requestSettersByType` entirely when no operation has body semantics', async () => {
    writeLayout({
      graph: {
        operations: [{ operationId: 'getStatus', method: 'GET', path: '/status' }],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.requestSettersByType).toBeUndefined();
  });
});
