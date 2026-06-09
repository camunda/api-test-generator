// Tests for the coverage-report renderer (#335 follow-up).
//
// Two surfaces are guarded:
//   1. `buildCoverageSummary` — pure aggregation: reconciliation math
//      (total = emitted + suppressed + unmapped), per-template tallies,
//      and unmapped-operation derivation.
//   2. `renderMarkdown` — deterministic Markdown layout for a known
//      summary block. Locked against a hand-crafted artefact so future
//      reshapes surface as a single diff rather than silent drift.
//
// The materializer is the only writer of `coverage.json`, and the
// renderer is a pure transform over the embedded `summary` block, so
// these unit tests + the existing L3 invariant (every suppressed opId
// has an emitted lifecycle spec) are sufficient — no fixture under
// `generated/<config>/` is required for renderer correctness.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  buildCoverageSummary,
  loadSpecOperationIds,
} from '../../materializer/src/coverageSummary.ts';
import { renderMarkdown } from '../../scripts/render-coverage-report.ts';

describe('buildCoverageSummary (#335)', () => {
  test('reconciles emitted + suppressed + unmapped against total', () => {
    const summary = buildCoverageSummary({
      allSpecOpIds: ['createGroup', 'deleteGroup', 'getGroup', 'orphanOp'],
      emittedFeatureOpIds: new Set(['getGroup']),
      suppressedOpIds: new Set(['createGroup', 'deleteGroup']),
      entries: [
        {
          operationId: 'createGroup',
          template: 'EntityLifecycle',
          appliesToKind: 'Entity',
          aboxRow: 'Group',
          stepKind: 'invoke',
          emittedSpec: 'templates/EntityLifecycle/Group.lifecycle.spec.ts',
        },
        {
          operationId: 'deleteGroup',
          template: 'EntityLifecycle',
          appliesToKind: 'Entity',
          aboxRow: 'Group',
          stepKind: 'invoke',
          emittedSpec: 'templates/EntityLifecycle/Group.lifecycle.spec.ts',
        },
        {
          operationId: 'createGroup',
          template: 'EntityLifecycle',
          appliesToKind: 'Entity',
          aboxRow: 'Group',
          stepKind: 'observe',
          emittedSpec: 'templates/EntityLifecycle/Group.lifecycle.spec.ts',
        },
      ],
      variantSpecs: 5,
      lifecycleSpecs: 1,
    });

    expect(summary.totalSpecOperations).toBe(4);
    expect(summary.emittedFeatureSpecs).toBe(1);
    expect(summary.suppressedByTemplate).toBe(2);
    expect(summary.variantSpecs).toBe(5);
    expect(summary.lifecycleSpecs).toBe(1);
    expect(summary.unmappedOperations).toEqual(['orphanOp']);
    expect(summary.perTemplate).toEqual([
      {
        name: 'EntityLifecycle',
        specs: 1,
        uniqueOperations: 2,
        entries: 3,
        invokeSteps: 2,
        observeSteps: 1,
      },
    ]);
  });

  test('per-template aggregates are sorted by name', () => {
    const summary = buildCoverageSummary({
      allSpecOpIds: [],
      emittedFeatureOpIds: new Set(),
      suppressedOpIds: new Set(['a', 'b']),
      entries: [
        {
          operationId: 'a',
          template: 'ZTemplate',
          appliesToKind: 'X',
          aboxRow: 'r1',
          stepKind: 'invoke',
          emittedSpec: 'templates/ZTemplate/r1.lifecycle.spec.ts',
        },
        {
          operationId: 'b',
          template: 'ATemplate',
          appliesToKind: 'X',
          aboxRow: 'r2',
          stepKind: 'invoke',
          emittedSpec: 'templates/ATemplate/r2.lifecycle.spec.ts',
        },
      ],
      variantSpecs: 0,
      lifecycleSpecs: 2,
    });
    expect(summary.perTemplate.map((t) => t.name)).toEqual(['ATemplate', 'ZTemplate']);
  });

  test('unmapped operations are sorted', () => {
    const summary = buildCoverageSummary({
      allSpecOpIds: ['zebra', 'alpha', 'mango'],
      emittedFeatureOpIds: new Set(),
      suppressedOpIds: new Set(),
      entries: [],
      variantSpecs: 0,
      lifecycleSpecs: 0,
    });
    expect(summary.unmappedOperations).toEqual(['alpha', 'mango', 'zebra']);
  });
});

describe('loadSpecOperationIds (#337)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coverage-summary-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns sorted unique operationIds (dedupes duplicates across paths/methods)', async () => {
    // OpenAPI does not technically forbid duplicate operationIds. Treat them as a set
    // so totalSpecOperations + unmapped reconciliation don't inflate (PR #337 review).
    const spec = {
      paths: {
        '/groups': {
          get: { operationId: 'listGroups' },
          post: { operationId: 'createGroup' },
        },
        '/groups/{id}': {
          // Same operationId appearing again under a different path — must
          // contribute one entry, not two.
          get: { operationId: 'listGroups' },
          delete: { operationId: 'deleteGroup' },
        },
      },
    };
    writeFileSync(join(tmpDir, 'rest-api.bundle.json'), JSON.stringify(spec), 'utf8');

    const ids = await loadSpecOperationIds(tmpDir);

    expect(ids).toEqual(['createGroup', 'deleteGroup', 'listGroups']);
    // Defect-class guard: total length === unique-set size, for any spec.
    expect(ids.length).toBe(new Set(ids).size);
  });

  test('returns [] when the bundled spec file is missing', async () => {
    const ids = await loadSpecOperationIds(tmpDir);
    expect(ids).toEqual([]);
  });
});

describe('renderMarkdown (#335)', () => {
  test('renders a deterministic Markdown report for a known summary', () => {
    const md = renderMarkdown({
      version: 2,
      config: 'camunda-oca',
      emitter: 'playwright',
      summary: {
        totalSpecOperations: 190,
        emittedFeatureSpecs: 117,
        suppressedByTemplate: 73,
        variantSpecs: 70,
        lifecycleSpecs: 26,
        unmappedOperations: [],
        perTemplate: [
          {
            name: 'EdgeLifecycle',
            specs: 14,
            uniqueOperations: 28,
            entries: 56,
            invokeSteps: 28,
            observeSteps: 28,
          },
          {
            name: 'EntityLifecycle',
            specs: 8,
            uniqueOperations: 32,
            entries: 40,
            invokeSteps: 24,
            observeSteps: 16,
          },
        ],
      },
    });
    expect(md).toContain('# Coverage report — camunda-oca');
    expect(md).toContain('- Emitter: `playwright`');
    expect(md).toContain('- Spec operations: **190**');
    expect(md).toContain('- Emitted feature specs: **117**');
    expect(md).toContain('- Suppressed by scenario-template coverage: **73**');
    expect(md).toContain('- Operation coverage: **190 / 190 (100.0%)**');
    expect(md).toContain('| `EdgeLifecycle` | 14 | 28 | 56 | 28 | 28 |');
    expect(md).toContain('| `EntityLifecycle` | 8 | 32 | 40 | 24 | 16 |');
    expect(md).toContain(
      '_None — every spec operation is covered by a feature or lifecycle suite._',
    );
  });

  test('renders the unmapped-operations list when non-empty', () => {
    const md = renderMarkdown({
      version: 2,
      config: 'demo',
      emitter: 'playwright',
      summary: {
        totalSpecOperations: 3,
        emittedFeatureSpecs: 1,
        suppressedByTemplate: 0,
        variantSpecs: 0,
        lifecycleSpecs: 0,
        unmappedOperations: ['missingOpA', 'missingOpB'],
        perTemplate: [],
      },
    });
    expect(md).toContain('- Unmapped operations: **2**');
    expect(md).toContain('- `missingOpA`');
    expect(md).toContain('- `missingOpB`');
    expect(md).toContain('_No template-derived coverage in this run._');
  });

  test('throws when the artefact is missing the summary block (v1 artefact)', () => {
    expect(() => renderMarkdown({ version: 1, suppressedOpIds: [], entries: [] })).toThrow(
      /no 'summary' block/,
    );
  });
});
