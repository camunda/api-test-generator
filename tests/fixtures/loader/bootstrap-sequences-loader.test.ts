/**
 * Unit tests for the bootstrap-sequences ABox loader (#202, Lift 2).
 *
 * Documented loader contract:
 *   1. Missing ABox file → returns an empty result (configs aren't required to ship one).
 *   2. Invalid JSON → throws with a "Failed to parse" diagnostic.
 *   3. Schema-invalid content → throws with a "failed TBox validation" diagnostic.
 *   4. Duplicate sequence `name` values → throws.
 *   5. Unknown semantic type in `produces[]` → throws (hard error — typos must
 *      not silently disable downstream credit).
 *   6. Sequences whose operationIds are not all in the spec → soft-drop
 *      (preserves original `if (operationExists(...))` semantics).
 *   7. Happy path returns the parsed sequence (and verifies the loader
 *      operates generically with no OCA-specific knowledge — AC #6).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBootstrapSequences } from '../../../semantic-graph-extractor/ontology/bootstrapSequencesLoader.ts';

let workdir: string;
const CONFIG_NAME = 'unit-test-config';
const ORIGINAL_CONFIG = process.env.CONFIG;

function configsJson(): string {
  return JSON.stringify({ default: CONFIG_NAME, configs: { [CONFIG_NAME]: {} } });
}

function writeAbox(contents: string): void {
  const dir = join(workdir, 'configs', CONFIG_NAME, 'ontology');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bootstrap-sequences.json'), contents);
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'bootstrap-sequences-loader-'));
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, 'configs.json'), configsJson());
  process.env.CONFIG = CONFIG_NAME;
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  if (ORIGINAL_CONFIG === undefined) {
    delete process.env.CONFIG;
  } else {
    process.env.CONFIG = ORIGINAL_CONFIG;
  }
});

describe('loadBootstrapSequences: documented branches (#202)', () => {
  it('returns an empty result when the ABox file does not exist', () => {
    const result = loadBootstrapSequences(workdir, {
      knownOperationIds: new Set(),
      knownSemanticTypes: new Set(),
    });
    expect(result.sequences).toEqual([]);
    expect(result.droppedForMissingOperations).toEqual([]);
  });

  it('throws a parse-error when the ABox file is not valid JSON', () => {
    writeAbox('{ this is not json');
    expect(() =>
      loadBootstrapSequences(workdir, {
        knownOperationIds: new Set(),
        knownSemanticTypes: new Set(),
      }),
    ).toThrow(/Failed to parse bootstrap-sequences ABox/);
  });

  it('throws a TBox-validation error when the ABox is structurally wrong', () => {
    writeAbox(JSON.stringify({ '@context': {} }));
    expect(() =>
      loadBootstrapSequences(workdir, {
        knownOperationIds: new Set(),
        knownSemanticTypes: new Set(),
      }),
    ).toThrow(/failed TBox validation/);
  });

  it('lists the failing instance path in the validation diagnostic', () => {
    writeAbox(JSON.stringify({ version: 1 }));
    expect(() =>
      loadBootstrapSequences(workdir, {
        knownOperationIds: new Set(),
        knownSemanticTypes: new Set(),
      }),
    ).toThrow(/must have required property 'sequences'/);
  });

  it('throws a duplicate-name error when two sequences share the same `name`', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        sequences: [
          {
            name: 'duped_sequence',
            description: 'first',
            operations: ['opOne'],
            produces: [],
          },
          {
            name: 'duped_sequence',
            description: 'second',
            operations: ['opTwo'],
            produces: [],
          },
        ],
      }),
    );
    expect(() =>
      loadBootstrapSequences(workdir, {
        knownOperationIds: new Set(['opOne', 'opTwo']),
        knownSemanticTypes: new Set(),
      }),
    ).toThrow(/duplicate sequence name\(s\): duped_sequence/);
  });

  it('throws when a `produces` semantic type is not in the spec', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        sequences: [
          {
            name: 'bad_produces',
            description: 'references unknown type',
            operations: ['opOne'],
            produces: ['NotARealType'],
          },
        ],
      }),
    );
    expect(() =>
      loadBootstrapSequences(workdir, {
        knownOperationIds: new Set(['opOne']),
        knownSemanticTypes: new Set(['SomeOtherType']),
      }),
    ).toThrow(/references semantic type\(s\) not in the spec[\s\S]*NotARealType/);
  });

  it('soft-drops sequences whose operationIds are not all in the spec', () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        sequences: [
          {
            name: 'partial_sequence',
            description: 'one op missing from spec',
            operations: ['opOne', 'opMissing'],
            produces: [],
          },
          {
            name: 'present_sequence',
            description: 'all ops present',
            operations: ['opOne'],
            produces: [],
          },
        ],
      }),
    );
    const result = loadBootstrapSequences(workdir, {
      knownOperationIds: new Set(['opOne']),
      knownSemanticTypes: new Set(),
    });
    expect(result.sequences).toHaveLength(1);
    expect(result.sequences[0]?.name).toBe('present_sequence');
    expect(result.droppedForMissingOperations).toEqual([
      { name: 'partial_sequence', missing: ['opMissing'] },
    ]);
  });

  it('does not validate `produces` for sequences that are soft-dropped (cross-variant ABox contract)', () => {
    // Regression guard for the PR #205 review comment: validating
    // `produces[]` on every row before computing soft-drops would break
    // the documented "same ABox across API variants" behaviour — a
    // sequence whose operationId is absent from the variant could
    // still hard-fail extraction if its `produces[]` referenced a
    // semantic type also absent from the variant.
    writeAbox(
      JSON.stringify({
        version: 1,
        sequences: [
          {
            name: 'variant_only_sequence',
            description: 'op + produces type both absent from this variant',
            operations: ['opMissing'],
            produces: ['TypeMissing'],
          },
          {
            name: 'present_sequence',
            description: 'all ops + types present',
            operations: ['opOne'],
            produces: ['SomeType'],
          },
        ],
      }),
    );
    const result = loadBootstrapSequences(workdir, {
      knownOperationIds: new Set(['opOne']),
      knownSemanticTypes: new Set(['SomeType']),
    });
    expect(result.sequences).toHaveLength(1);
    expect(result.sequences[0]?.name).toBe('present_sequence');
    expect(result.droppedForMissingOperations).toEqual([
      { name: 'variant_only_sequence', missing: ['opMissing'] },
    ]);
  });

  it('returns the parsed sequence for a minimal valid file with no API-specific knowledge (AC #6)', () => {
    // The loader must work for any operationId/semantic-type vocabulary —
    // there are no OCA literals (createDeployment, ProcessDefinitionKey, etc.)
    // baked into the implementation.
    writeAbox(
      JSON.stringify({
        version: 1,
        sequences: [
          {
            name: 'arbitrary_setup',
            description: 'arbitrary opIds; no OCA assumptions',
            operations: ['fooOp', 'barOp'],
            produces: ['FooKind'],
          },
        ],
      }),
    );
    const result = loadBootstrapSequences(workdir, {
      knownOperationIds: new Set(['fooOp', 'barOp']),
      knownSemanticTypes: new Set(['FooKind']),
    });
    expect(result.sequences).toEqual([
      {
        name: 'arbitrary_setup',
        description: 'arbitrary opIds; no OCA assumptions',
        operations: ['fooOp', 'barOp'],
        produces: ['FooKind'],
      },
    ]);
    expect(result.droppedForMissingOperations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Analyzer-level strict-mode tests (#202 review feedback).
//
// The loader always soft-drops sequences whose operationIds aren't all
// in the spec — that's the cross-API-variant contract. The analyzer
// layer adds an opt-in strict mode (driven by env var
// STRICT_BOOTSTRAP_ABOX=1 in production; via opts in unit tests) that
// escalates such drops to a hard error so a CI leg targeting one
// active config can assert ABox/spec consistency.
// ---------------------------------------------------------------------------
describe('RootDependencyAnalyzer: strict bootstrap-abox mode (#202)', () => {
  // Late-import so the loader's beforeEach has set CONFIG to the temp tree.
  async function loadAnalyzer() {
    return await import('../../../semantic-graph-extractor/root-dependency-analyzer.ts');
  }

  function emptyGraph(opIds: string[]) {
    const operations = new Map<string, unknown>();
    for (const id of opIds) operations.set(id, { operationId: id });
    // The analyzer only reads `operations` (for known opIds) and `edges`
    // (for entry-point computation); other fields are unused.
    // biome-ignore lint/plugin: minimal stub for analyzer test — not a real OperationDependencyGraph
    return { operations, edges: [] } as unknown as Parameters<
      Awaited<
        ReturnType<typeof loadAnalyzer>
      >['RootDependencyAnalyzer']['prototype']['analyzeRootDependencies']
    >[0];
  }

  it('strict mode throws when a sequence is dropped for missing operationIds', async () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        sequences: [
          {
            name: 'partial_sequence',
            description: 'one op missing from spec',
            operations: ['present', 'missing'],
            produces: [],
          },
        ],
      }),
    );
    const { RootDependencyAnalyzer } = await loadAnalyzer();
    const analyzer = new RootDependencyAnalyzer();
    expect(() =>
      analyzer.analyzeRootDependencies(emptyGraph(['present']), {
        knownSemanticTypes: new Set(),
        repoRoot: workdir,
        strictBootstrapAbox: true,
      }),
    ).toThrow(/Strict bootstrap-sequences ABox: refusing to silently drop 1 sequence\(s\)/);
  });

  it('non-strict mode (default) surfaces drops on the result and does not throw', async () => {
    writeAbox(
      JSON.stringify({
        version: 1,
        sequences: [
          {
            name: 'partial_sequence',
            description: 'one op missing from spec',
            operations: ['present', 'missing'],
            produces: [],
          },
        ],
      }),
    );
    const { RootDependencyAnalyzer } = await loadAnalyzer();
    const analyzer = new RootDependencyAnalyzer();
    const result = analyzer.analyzeRootDependencies(emptyGraph(['present']), {
      knownSemanticTypes: new Set(),
      repoRoot: workdir,
    });
    expect(result.bootstrapSequences).toEqual([]);
    expect(result.droppedBootstrapSequences).toEqual([
      { name: 'partial_sequence', missing: ['missing'] },
    ]);
  });
});
