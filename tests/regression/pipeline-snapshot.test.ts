import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildManifest, snapshotPath } from '../../scripts/build-snapshot.ts';

/**
 * Behaviour-preservation regression guard for the generator pipeline.
 *
 * Compares every file under the four generator output trees against a
 * SHA-256 manifest captured in pipeline-snapshot.json. ANY drift in any
 * analyser, planner or emitter — across all 396 emitted files — fails
 * this test.
 *
 * Workflow:
 *   1. Run the generation pipeline:
 *        npm run testsuite:generate && npm run generate:request-validation
 *   2. Run this test:
 *        npm test
 *   3. If you intentionally changed generator behaviour and the test
 *      fails, regenerate the snapshot:
 *        npm run snapshot:update
 *      and commit the updated pipeline-snapshot.json alongside your
 *      production change.
 *
 * This is a CLASS-scoped regression guard — it catches any kind of
 * pipeline drift, not just a single instance of a defect.
 */

interface Manifest {
  generatedAt: string;
  fileCount: number;
  trees: string[];
  files: Record<string, string>;
}

function loadSnapshot(): Manifest {
  const path = snapshotPath();
  if (!existsSync(path)) {
    throw new Error(
      `No snapshot at ${path}. Run 'npm run snapshot:update' to capture one ` +
        `from the current pipeline outputs.`,
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('files' in parsed) ||
    typeof parsed.files !== 'object' ||
    parsed.files === null ||
    !('fileCount' in parsed) ||
    typeof parsed.fileCount !== 'number'
  ) {
    throw new Error(`Snapshot at ${path} is malformed`);
  }
  // After the structural narrowing above, `parsed` matches Manifest.
  // biome-ignore lint/plugin: validated by the guard chain immediately above
  return parsed as Manifest;
}

describe('pipeline output snapshot (regression guard)', () => {
  it('current generator outputs are byte-identical to the captured baseline', () => {
    const expected = loadSnapshot();
    const actual = buildManifest();

    if (actual.fileCount === 0) {
      throw new Error(
        'No output files found on disk. Run the generation pipeline before this test:\n' +
          '  npm run testsuite:generate && npm run generate:request-validation',
      );
    }

    const exp = expected.files;
    const act = actual.files;
    const missing = Object.keys(exp).filter((k) => !(k in act));
    const added = Object.keys(act).filter((k) => !(k in exp));
    const changed = Object.keys(exp).filter((k) => k in act && exp[k] !== act[k]);
    const drift = missing.length + added.length + changed.length;

    if (drift > 0) {
      const sample = (xs: string[]) => xs.slice(0, 10).join('\n  - ');
      throw new Error(
        `Pipeline output drifted from snapshot.\n\n` +
          `  Missing (${missing.length}):\n  - ${sample(missing) || '(none)'}\n\n` +
          `  Added (${added.length}):\n  - ${sample(added) || '(none)'}\n\n` +
          `  Changed (${changed.length}):\n  - ${sample(changed) || '(none)'}\n\n` +
          `If the change is intentional, regenerate the snapshot:\n` +
          `  npm run snapshot:update\n`,
      );
    }

    expect(actual.fileCount).toBe(expected.fileCount);
  });
});
