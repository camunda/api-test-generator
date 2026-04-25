import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * Spec-pin precondition guard.
 *
 * The pipeline output snapshot in `pipeline-snapshot.json` was captured
 * against a specific upstream OpenAPI spec content. If the upstream spec
 * drifts — even by an unrelated field rename — the snapshot test would
 * fail with an opaque "396 files changed" diff that wastes reviewer time.
 *
 * This test runs first, reads the bundled spec's `specHash`, and compares
 * it to the value recorded next to the snapshot. A mismatch means the
 * spec changed upstream since the baseline was captured. The fix is:
 *
 *   1. Re-pin: update `tests/regression/spec-pin.json` with the new ref.
 *   2. Re-snapshot: `npm run testsuite:generate &&
 *      npm run generate:request-validation && npm run snapshot:update`.
 *   3. Commit the pin update and the regenerated snapshot together.
 *
 * The guard is **class-scoped**: it catches every kind of upstream spec
 * change, not just one specific field.
 */

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..', '..');
const PIN_PATH = join(REPO_ROOT, 'tests', 'regression', 'spec-pin.json');
const METADATA_PATH = join(REPO_ROOT, 'spec', 'bundled', 'spec-metadata.json');

interface SpecPin {
  specRef: string;
  expectedSpecHash: string;
}

interface SpecMetadata {
  specHash: string;
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadPin(): SpecPin {
  const raw = loadJson(PIN_PATH);
  if (
    !isRecord(raw) ||
    typeof raw.specRef !== 'string' ||
    typeof raw.expectedSpecHash !== 'string'
  ) {
    throw new Error(`spec-pin.json at ${PIN_PATH} is malformed`);
  }
  return { specRef: raw.specRef, expectedSpecHash: raw.expectedSpecHash };
}

function loadMetadata(): SpecMetadata {
  if (!existsSync(METADATA_PATH)) {
    throw new Error(
      `No spec metadata at ${METADATA_PATH}. Fetch the spec first:\n` + `  npm run fetch-spec`,
    );
  }
  const raw = loadJson(METADATA_PATH);
  if (!isRecord(raw) || typeof raw.specHash !== 'string') {
    throw new Error(`spec-metadata.json at ${METADATA_PATH} is malformed`);
  }
  return { specHash: raw.specHash };
}

describe('spec pin (regression precondition)', () => {
  test('bundled spec content matches the hash recorded in spec-pin.json', () => {
    const pin = loadPin();
    const meta = loadMetadata();
    if (meta.specHash !== pin.expectedSpecHash) {
      throw new Error(
        `Bundled spec content drifted from the pinned baseline.\n\n` +
          `  Pinned ref:           ${pin.specRef}\n` +
          `  Pinned expected hash: ${pin.expectedSpecHash}\n` +
          `  Actual current hash:  ${meta.specHash}\n\n` +
          `If the upstream spec changed intentionally, re-pin and re-snapshot:\n` +
          `  1. Update tests/regression/spec-pin.json (specRef + expectedSpecHash)\n` +
          `  2. npm run testsuite:generate && npm run generate:request-validation\n` +
          `  3. npm run snapshot:update\n` +
          `  4. Commit both files together.\n`,
      );
    }
    expect(meta.specHash).toBe(pin.expectedSpecHash);
  });
});
