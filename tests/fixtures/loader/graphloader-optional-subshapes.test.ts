/**
 * Loader fixtures for `deriveOptionalSubShapes` in graphLoader (#37,
 * widened by #162 PR 4).
 *
 * `subShapeRootOf` strips the trailing leaf segment from a request-body
 * `fieldPath` to obtain the sub-shape root, returning `null` ONLY for
 * operator-object pseudo-fields (`filter.x.$eq`, `.$in[]`, …). Every
 * other optional leaf — nested object leaves, scalar-array leaves
 * (`tags[]`, `filter.tags[]`), and flat top-level scalars (`tenantId`)
 * — enters `optionalSubShapes` so the variant suite owns the entire
 * populated-optional partition (#162 PR 4).
 *
 * Class-scoped guarantees pinned here:
 *
 *   - Operator-object leaves (`$`-prefixed terminal segment) are
 *     excluded.
 *   - Every other optional leaf is included, with `rootPath` derived
 *     from the dotted ancestors (empty string for flat top-level
 *     leaves).
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
  workdir = mkdtempSync(join(tmpdir(), 'graphloader-subshape-fixture-'));
  baseDir = join(workdir, 'path-analyser');
  graphDir = join(workdir, 'generated', 'camunda-oca', 'graph');
  configDir = join(workdir, 'configs', 'camunda-oca');
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(graphDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  // configResolver requires a configs.json at the repo root with the
  // active config declared in its allowlist (see #128).
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
// use in their `requestBodySemanticTypes` blocks. Without this, #162
// PR 5's fail-fast load-time diagnostic rejects every fixture that
// references a semantic with no producer/establisher in the synthetic
// graph (which is most of them — these fixtures are scoped to the
// sub-shape grouping behaviour, not to the classification chain).
//
// Any test exercising the unclassified-detection path itself must
// override `semanticsAbox` explicitly.
const DEFAULT_SEMANTICS_ABOX = {
  version: 1,
  semanticTypes: [
    { name: 'Tag', kind: 'attribute', clientMinted: true },
    { name: 'TagName', kind: 'attribute', clientMinted: true },
    { name: 'BusinessId', kind: 'attribute', clientMinted: true },
    { name: 'TenantId', kind: 'attribute', clientMinted: true },
    { name: 'ElementId', kind: 'modelDerived' },
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

// ---------------------------------------------------------------------------
// Fixture K — `subShapeRootOf` includes scalar-array and flat top-level
// leaves at any depth; only operator-object pseudo-fields are excluded
// (#37 + #162 PR 4).
// ---------------------------------------------------------------------------
//
// Class-scoped: every optional fieldPath whose terminal segment is NOT
// `$`-prefixed enters `optionalSubShapes`, regardless of nesting depth
// or whether the leaf is a scalar-array item. Operator subtrees
// (`filter.x.$eq`, etc.) remain excluded because they are pseudo-fields
// the extractor surfaces for filter expressiveness, not a settable
// shape.
describe('graphLoader: deriveOptionalSubShapes includes scalar-array and flat leaves; rejects operator objects (#37 + #162 PR 4)', () => {
  it('groups `filter.tags[]` (nested scalar array) under root `filter` (PR 4 widening)', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'searchWithTags',
            method: 'POST',
            path: '/search',
            requestBodySemanticTypes: [
              {
                fieldPath: 'filter.tags[]',
                semanticType: 'TagName',
                required: false,
              },
            ],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    const op = g.operations.searchWithTags;
    expect(op?.optionalSubShapes).toEqual([
      {
        rootPath: 'filter',
        leaves: [{ fieldPath: 'filter.tags[]', semantic: 'TagName' }],
      },
    ]);
  });

  it('groups genuine array-of-object leaves (e.g. `startInstructions[].elementId`) normally', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'createInstance',
            method: 'POST',
            path: '/instance',
            requestBodySemanticTypes: [
              {
                fieldPath: 'startInstructions[].elementId',
                semanticType: 'ElementId',
                required: false,
              },
            ],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    const op = g.operations.createInstance;
    expect(op?.optionalSubShapes).toEqual([
      {
        rootPath: 'startInstructions[]',
        leaves: [{ fieldPath: 'startInstructions[].elementId', semantic: 'ElementId' }],
      },
    ]);
  });

  it('mixed leaves: scalar-array siblings and object-shape siblings co-exist under one root (PR 4 widening)', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'mixedSearch',
            method: 'POST',
            path: '/mixed',
            requestBodySemanticTypes: [
              {
                fieldPath: 'filter.tags[]',
                semanticType: 'TagName',
                required: false,
              },
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
    const subShapes = g.operations.mixedSearch?.optionalSubShapes ?? [];
    expect(subShapes).toEqual([
      {
        rootPath: 'filter',
        leaves: [
          { fieldPath: 'filter.tags[]', semantic: 'TagName' },
          { fieldPath: 'filter.processInstanceKey', semantic: 'ProcessInstanceKey' },
        ],
      },
    ]);
  });

  it('flat top-level scalar leaves group under empty root (PR 4 widening)', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'createMessage',
            method: 'POST',
            path: '/messages',
            requestBodySemanticTypes: [
              { fieldPath: 'tenantId', semanticType: 'TenantId', required: false },
            ],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.operations.createMessage?.optionalSubShapes).toEqual([
      {
        rootPath: '',
        leaves: [{ fieldPath: 'tenantId', semantic: 'TenantId' }],
      },
    ]);
  });

  it('operator-object leaves (`filter.x.$eq`) remain excluded', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'searchByOperator',
            method: 'POST',
            path: '/search',
            requestBodySemanticTypes: [
              {
                fieldPath: 'filter.processInstanceKey.$eq',
                semanticType: 'ProcessInstanceKey',
                required: false,
              },
            ],
          },
        ],
      },
    });
    const g = await loadGraph(baseDir);
    expect(g.operations.searchByOperator?.optionalSubShapes ?? []).toEqual([]);
  });
});
