// Tests for materializer/src/playwright/support/seeding.ts
// Focus: per-spec-file salt (#175) — cross-worker id collision prevention.
import { afterEach, describe, expect, test } from 'vitest';
import { initSpecSalt, seedBinding } from '../../materializer/src/playwright/support/seeding.ts';

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
