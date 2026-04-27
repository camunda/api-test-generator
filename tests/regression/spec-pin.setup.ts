import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vitest globalSetup — runs once before any test file is collected.
 *
 * Acts as a precondition gate for the regression suite: the
 * bundled-spec invariants are only meaningful against a fixed upstream
 * OpenAPI spec content. If the bundled spec drifts from the pin
 * recorded in `tests/regression/spec-pin.json`, throw here so Vitest
 * aborts the entire run with a single actionable error before loading
 * the (now-misleading) invariant assertions.
 *
 * Running this in `globalSetup` (rather than as a sibling test file)
 * removes the test-ordering hazard the reviewer flagged: with
 * `pool: 'forks'` Vitest does not guarantee that a precondition test
 * file executes before sibling test files.
 */

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..', '..');
const PIN_PATH = join(REPO_ROOT, 'tests', 'regression', 'spec-pin.json');
const METADATA_PATH = join(REPO_ROOT, 'spec', 'bundled', 'spec-metadata.json');

interface SpecPin {
  specRef: string;
  expectedSpecHash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
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

function loadActualSpecHash(): string {
  if (!existsSync(METADATA_PATH)) {
    throw new Error(
      `No spec metadata at ${METADATA_PATH}. Fetch the spec first:\n  npm run fetch-spec`,
    );
  }
  const raw = loadJson(METADATA_PATH);
  if (!isRecord(raw) || typeof raw.specHash !== 'string') {
    throw new Error(`spec-metadata.json at ${METADATA_PATH} is malformed`);
  }
  return raw.specHash;
}

export default function setup(): void {
  const pin = loadPin();
  const actual = loadActualSpecHash();
  if (actual !== pin.expectedSpecHash) {
    throw new Error(
      `Bundled spec content drifted from the pinned baseline.\n\n` +
        `  Pinned ref:           ${pin.specRef}\n` +
        `  Pinned expected hash: ${pin.expectedSpecHash}\n` +
        `  Actual current hash:  ${actual}\n\n` +
        `If the upstream spec changed intentionally, re-pin and re-run:\n` +
        `  1. Update tests/regression/spec-pin.json (specRef + expectedSpecHash)\n` +
        `  2. npm run testsuite:generate && npm run generate:request-validation\n` +
        `  3. Update any invariants in tests/regression/bundled-spec-invariants.test.ts\n` +
        `     whose values legitimately changed.\n` +
        `  4. Commit spec-pin.json alongside the invariant updates.\n`,
    );
  }
}
