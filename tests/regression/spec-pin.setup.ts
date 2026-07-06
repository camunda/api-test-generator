import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getActiveConfigName, getSpecBundleDir } from '../../path-analyser/src/configResolver.js';

/**
 * Vitest globalSetup — runs once before any test file is collected.
 *
 * Acts as a precondition gate for the regression suite: the
 * bundled-spec invariants are only meaningful against a fixed upstream
 * OpenAPI spec content. If the bundled spec drifts from the pin
 * recorded in `configs/<active>/spec-pin.json` (active config selected
 * via the CONFIG env var; default `camunda-oca`), throw here so Vitest
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
// Active config name comes from the CONFIG env var (default: from
// configs.json). Resolution + validation (allowlist, safe pattern) is
// shared with the runtime loaders via getActiveConfigName so an invalid
// CONFIG fails fast here with the same actionable error rather than
// silently reading an unexpected path. See #128.
const ACTIVE_CONFIG = getActiveConfigName(REPO_ROOT);
const PIN_PATH = join(REPO_ROOT, 'configs', ACTIVE_CONFIG, 'spec-pin.json');
const METADATA_PATH = join(getSpecBundleDir(REPO_ROOT), 'spec-metadata.json');

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
    // Escape hatch for the scheduled spec-bump dry-run
    // (.github/workflows/spec-bump-dryrun.yml), which deliberately fetches the
    // latest upstream spec (hash ≠ pin by design) to check whether it still
    // flows through the generator + invariants. There, a drift is the signal
    // we WANT to observe, not a precondition failure — so warn and let the
    // invariants run instead of aborting. Never set in PR/branch CI, which
    // must keep failing loud on unexpected drift.
    if (process.env.ALLOW_SPEC_DRIFT === '1') {
      console.warn(
        `::warning::[spec-pin] Bundled spec drifted from the pin ` +
          `(pinned ref ${pin.specRef}, expected content hash ${pin.expectedSpecHash}; ` +
          `actual content hash ${actual}). Continuing because ALLOW_SPEC_DRIFT=1 ` +
          `(spec-bump dry-run). Invariants below run against the drifted spec.`,
      );
      return;
    }
    throw new Error(
      `Bundled spec content drifted from the pinned baseline.\n\n` +
        `  Pinned ref:           ${pin.specRef}\n` +
        `  Pinned expected hash: ${pin.expectedSpecHash}\n` +
        `  Actual current hash:  ${actual}\n\n` +
        `If the upstream spec changed intentionally, re-pin and re-run:\n` +
        `  1. SPEC_REF=<newSha> npm run fetch-spec:ref   (re-fetch the bundled spec)\n` +
        `  2. npm run testsuite:generate && npm run generate:request-validation\n` +
        `  3. Update configs/${ACTIVE_CONFIG}/spec-pin.json: set specRef to the\n` +
        `     resolved 40-char commit SHA and expectedSpecHash to the\n` +
        `     value printed in spec/${ACTIVE_CONFIG}/bundled/spec-metadata.json\n` +
        `  4. Update any invariants in configs/${ACTIVE_CONFIG}/regression-invariants.test.ts\n` +
        `     whose values legitimately changed.\n` +
        `  5. Commit configs/${ACTIVE_CONFIG}/spec-pin.json alongside the invariant updates.\n`,
    );
  }
}
