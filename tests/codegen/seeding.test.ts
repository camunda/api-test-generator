// Tests for materializer/src/playwright/support/seeding.ts
// Focus:
//   - per-spec-file salt (#175) — cross-worker id collision prevention.
//   - per-process runNonce (#304) — cross-run identifier uniqueness when
//     the caller passes `{ unique: true }`. Non-unique calls remain fully
//     deterministic so snapshot-comparable bindings keep their values.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  _resetSeedingForTest,
  initSpecSalt,
  seedBinding,
} from '../../materializer/src/playwright/support/seeding.ts';

describe('seeding: per-spec-file salt (#175)', () => {
  afterEach(() => {
    // Reset to no salt so other tests in this file start from a clean state.
    initSpecSalt('');
  });

  test('same seedBinding key with different spec salts produces different values', () => {
    initSpecSalt('specA');
    const valA = seedBinding('roleIdVar');
    initSpecSalt('specB');
    const valB = seedBinding('roleIdVar');
    expect(valA).not.toBe(valB);
  });

  test('same spec salt produces the same first value (deterministic)', () => {
    initSpecSalt('createRole');
    const val1 = seedBinding('roleIdVar');
    initSpecSalt('createRole');
    const val2 = seedBinding('roleIdVar');
    expect(val1).toBe(val2);
  });

  test('all parallel-spec collisions avoided: N distinct salts produce N distinct first values', () => {
    const specs = [
      'createRole',
      'assignRoleToClient',
      'searchMappingRulesForRole',
      'createGroup',
      'createTenant',
      'createUser',
      'createClusterVariable',
    ];
    const values = specs.map((salt) => {
      initSpecSalt(salt);
      return seedBinding('roleIdVar');
    });
    const unique = new Set(values);
    expect(unique.size).toBe(specs.length);
  });
});

describe('seeding: per-process runNonce for { unique: true } bindings (#304)', () => {
  beforeEach(() => {
    _resetSeedingForTest();
    delete process.env.TEST_RUN_NONCE;
  });

  afterEach(() => {
    _resetSeedingForTest();
    delete process.env.TEST_RUN_NONCE;
  });

  test('two simulated process invocations of seedBinding({ unique: true }) produce different values', () => {
    initSpecSalt('createRole');
    const valRun1 = seedBinding('roleIdVar', { unique: true });
    // Simulate a fresh process by clearing per-process state (incl. nonce).
    _resetSeedingForTest();
    initSpecSalt('createRole');
    const valRun2 = seedBinding('roleIdVar', { unique: true });
    expect(valRun1).not.toBe(valRun2);
  });

  test('without { unique: true } the value is identical across simulated process invocations (snapshot determinism preserved)', () => {
    initSpecSalt('createRole');
    const valRun1 = seedBinding('roleIdVar');
    _resetSeedingForTest();
    initSpecSalt('createRole');
    const valRun2 = seedBinding('roleIdVar');
    expect(valRun1).toBe(valRun2);
  });

  test('within a single process the unique value is stable across calls (parallel workers / retries see the same id)', () => {
    initSpecSalt('createRole');
    const valFirst = seedBinding('roleIdVar', { unique: true });
    // No reset — same process. The nonce must be cached so subsequent
    // calls in the same Playwright run (different test bodies, retried
    // attempts) see the same identifier.
    initSpecSalt('createRole');
    const valSecond = seedBinding('roleIdVar', { unique: true });
    expect(valFirst).toBe(valSecond);
  });

  test('TEST_RUN_NONCE env var pins the nonce so two simulated invocations replay identically', () => {
    process.env.TEST_RUN_NONCE = 'pinned-replay-nonce-abc';
    initSpecSalt('createRole');
    const valRun1 = seedBinding('roleIdVar', { unique: true });
    _resetSeedingForTest();
    process.env.TEST_RUN_NONCE = 'pinned-replay-nonce-abc';
    initSpecSalt('createRole');
    const valRun2 = seedBinding('roleIdVar', { unique: true });
    expect(valRun1).toBe(valRun2);
  });

  test('unique and non-unique values for the same binding differ within a single process (distinct PRNG sequences)', () => {
    initSpecSalt('createRole');
    const det = seedBinding('roleIdVar');
    const uniq = seedBinding('roleIdVar', { unique: true });
    expect(det).not.toBe(uniq);
  });
});
