/**
 * Loader fixtures for `deriveOptionalSubShapes` in graphLoader (#37).
 *
 * `subShapeRootOf` strips the trailing leaf segment from a request-body
 * `fieldPath` to obtain the sub-shape root, returning `null` for paths
 * that do not represent a populated-vs-omitted object or array-of-object
 * ancestor (top-level scalars, operator-object keys, scalar arrays).
 *
 * The class-scoped guarantee guarded here: an optional request-body
 * leaf whose path is a *scalar-array item* (ends with `[]`) must NOT be
 * grouped into an `optionalSubShapes` entry, regardless of how many
 * dotted ancestors it has. Without the fix, `filter.tags[]` was grouped
 * under root `filter`, causing the variant planner to emit a sub-shape
 * variant whose only leaf is a scalar collection.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadGraph } from '../../../path-analyser/src/graphLoader.ts';

let workdir: string;
let baseDir: string;
let graphDir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'graphloader-subshape-fixture-'));
  baseDir = join(workdir, 'path-analyser');
  graphDir = join(workdir, 'semantic-graph-extractor', 'dist', 'output');
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(graphDir, { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

interface Layout {
  graph: Record<string, unknown>;
  domain?: Record<string, unknown>;
}

function writeLayout(layout: Layout): void {
  writeFileSync(join(graphDir, 'operation-dependency-graph.json'), JSON.stringify(layout.graph));
  writeFileSync(
    join(baseDir, 'domain-semantics.json'),
    JSON.stringify(layout.domain ?? { operationRequirements: {} }),
  );
}

// ---------------------------------------------------------------------------
// Fixture K — `subShapeRootOf` rejects scalar-array item leaves at any depth
// (PR #51 review).
// ---------------------------------------------------------------------------
//
// Class-scoped: any optional fieldPath whose terminal segment ends with
// `[]` (i.e. the leaf IS the scalar-array item) is excluded from
// `optionalSubShapes` regardless of nesting depth.
describe('graphLoader: deriveOptionalSubShapes rejects scalar-array leaves at any depth (#51 review)', () => {
  it('does not group `filter.tags[]` (nested scalar array) under a sub-shape root', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'searchWithTags',
            method: 'POST',
            path: '/search',
            requestBodySemanticTypes: [
              // Nested scalar array — leaf segment is `tags[]`. Must NOT
              // be grouped under root `filter`.
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
    expect(op, 'operation must load').toBeDefined();
    const subShapes = op?.optionalSubShapes ?? [];
    // No sub-shape may have `filter` (or any other root) carrying a
    // scalar-array leaf.
    for (const s of subShapes) {
      for (const leaf of s.leaves) {
        expect(
          leaf.fieldPath.endsWith('[]'),
          `optionalSubShapes leaf ${leaf.fieldPath} (root ${s.rootPath}) must not be a scalar-array item`,
        ).toBe(false);
      }
    }
    // And specifically: no sub-shape root for this op (the only optional
    // leaf was a scalar array).
    expect(subShapes).toEqual([]);
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

  it('mixed leaves: scalar-array siblings are excluded; object-shape siblings retained', async () => {
    writeLayout({
      graph: {
        operations: [
          {
            operationId: 'mixedSearch',
            method: 'POST',
            path: '/mixed',
            requestBodySemanticTypes: [
              // Scalar-array sibling — must be excluded.
              {
                fieldPath: 'filter.tags[]',
                semanticType: 'TagName',
                required: false,
              },
              // Object-shape sibling under same root — must be retained.
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
        leaves: [{ fieldPath: 'filter.processInstanceKey', semantic: 'ProcessInstanceKey' }],
      },
    ]);
  });
});
