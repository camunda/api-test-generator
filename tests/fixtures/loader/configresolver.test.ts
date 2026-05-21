/**
 * Class-scoped guards for configResolver — review feedback on PR #141.
 *
 * The active config name is interpolated into a filesystem path, so it
 * must never contain `..` or path separators (defense-in-depth: even
 * though the allowlist makes escape impossible in practice, the safe-
 * pattern check fails fast with a clear error). It must also be
 * declared in configs.json's allowlist; an unknown CONFIG must throw
 * rather than silently read an unexpected directory.
 *
 * Tests cover the *defect class* (any unsafe character / any unknown
 * name), not just the specific instance, so the guard survives future
 * refactors.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveConfigDir,
  getActiveConfigName,
  getActivePlannerConfig,
} from '../../../path-analyser/src/configResolver.ts';

let workdir: string;
const ORIGINAL_CONFIG = process.env.CONFIG;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'configresolver-fixture-'));
  mkdirSync(workdir, { recursive: true });
  writeFileSync(
    join(workdir, 'configs.json'),
    JSON.stringify({
      default: 'camunda-oca',
      configs: { 'camunda-oca': {}, 'other-config': {} },
    }),
  );
  delete process.env.CONFIG;
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  if (ORIGINAL_CONFIG === undefined) {
    delete process.env.CONFIG;
  } else {
    process.env.CONFIG = ORIGINAL_CONFIG;
  }
});

describe('configResolver: default + allowlist (#128, #141 review)', () => {
  it('returns the default from configs.json when CONFIG is unset', () => {
    expect(getActiveConfigName(workdir)).toBe('camunda-oca');
  });

  it('returns CONFIG when it is in the allowlist', () => {
    process.env.CONFIG = 'other-config';
    expect(getActiveConfigName(workdir)).toBe('other-config');
  });

  it('throws when CONFIG is not in the allowlist', () => {
    process.env.CONFIG = 'never-declared';
    expect(() => getActiveConfigName(workdir)).toThrow(/Unknown CONFIG/);
  });

  it('throws a malformed-configs error when configs.json is missing', () => {
    rmSync(join(workdir, 'configs.json'));
    expect(() => getActiveConfigName(workdir)).toThrow(/Failed to read configs\.json/);
  });
});

describe('configResolver: path-traversal defense (#141 review)', () => {
  // Class-scoped: any value containing path separators or `..` must
  // fail the safe-pattern check before allowlist lookup, regardless of
  // whether the value happens to also be missing from the allowlist.
  const unsafeNames = [
    '../etc',
    '..',
    'foo/bar',
    'foo\\bar',
    '/abs',
    '.hidden',
    'UPPER',
    'has space',
    '',
  ];

  for (const name of unsafeNames) {
    it(`rejects unsafe CONFIG value ${JSON.stringify(name)}`, () => {
      process.env.CONFIG = name;
      // An empty string falls back to the default; verify by including
      // it in unsafeNames as a sanity check that empty does NOT escape.
      if (name === '') {
        expect(getActiveConfigName(workdir)).toBe('camunda-oca');
        return;
      }
      expect(() => getActiveConfigName(workdir)).toThrow(/Invalid CONFIG value/);
    });
  }

  it('getActiveConfigDir resolves under configs/ for a valid name', () => {
    expect(getActiveConfigDir(workdir)).toBe(join(workdir, 'configs', 'camunda-oca'));
  });
});

describe('configResolver: per-config planner caps (#292)', () => {
  // The hard-coded `20`s in path-analyser/src/index.ts were lifted into
  // an optional `planner` block per config. Class-scoped guards below
  // pin: (1) absent block falls back to documented defaults; (2) a
  // present block overrides; (3) a partial block fills missing fields
  // from defaults; (4) the loader rejects malformed values up front
  // rather than letting them flow into BFS — a typo like
  // `"maxChainAlternatives": "twnety"` would otherwise coerce to NaN
  // inside the BFS comparison and silently emit zero scenarios per
  // endpoint, masking the config error as a generator bug.
  function writeConfig(planner: unknown): void {
    writeFileSync(
      join(workdir, 'configs.json'),
      JSON.stringify({
        default: 'camunda-oca',
        configs: { 'camunda-oca': planner === undefined ? {} : { planner } },
      }),
    );
  }

  it('returns defaults when no planner block is present', () => {
    writeConfig(undefined);
    expect(getActivePlannerConfig(workdir)).toEqual({
      maxChainAlternatives: 20,
      maxVariantsPerEndpoint: 20,
    });
  });

  it('reads both caps when fully specified', () => {
    writeConfig({ maxChainAlternatives: 5, maxVariantsPerEndpoint: 7 });
    expect(getActivePlannerConfig(workdir)).toEqual({
      maxChainAlternatives: 5,
      maxVariantsPerEndpoint: 7,
    });
  });

  it('fills missing fields from defaults when block is partial', () => {
    writeConfig({ maxChainAlternatives: 3 });
    expect(getActivePlannerConfig(workdir)).toEqual({
      maxChainAlternatives: 3,
      maxVariantsPerEndpoint: 20,
    });
  });

  it('throws when planner is not an object', () => {
    writeConfig(42);
    expect(() => getActivePlannerConfig(workdir)).toThrow(/planner must be an object/);
  });

  for (const bad of [0, -1, 1.5, '20', null, true]) {
    it(`throws when maxChainAlternatives is ${JSON.stringify(bad)}`, () => {
      writeConfig({ maxChainAlternatives: bad });
      expect(() => getActivePlannerConfig(workdir)).toThrow(/must be a positive integer/);
    });
  }

  it('throws when maxVariantsPerEndpoint is zero', () => {
    writeConfig({ maxVariantsPerEndpoint: 0 });
    expect(() => getActivePlannerConfig(workdir)).toThrow(/must be a positive integer/);
  });
});
