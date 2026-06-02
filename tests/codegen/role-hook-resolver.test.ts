// Class-scoped regression guard for #350: the orchestrator's roleHook
// dispatch must treat declared-but-unprovided hooks as advisory (skip),
// not as a hard registration-time failure. This is what allows the
// PlaywrightEmitter to declare `roleHooks: ['deployment']` once and
// remain usable from configs that don't ship a deploymentGateway role
// bundle (e.g. camunda-hub, where 0/9 operations are multipart).
//
// Each `test(...)` block pins one named property of the contract
// documented in `materializer/src/roleHookResolver.ts`.

import {
  _resetRegistriesForTests,
  type EmitterStrategy,
  type RoleHookProvider,
  registerRoleHookProvider,
} from '@camunda8/emitter-sdk';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  RoleHookConflictError,
  resolveRoleExtras,
} from '../../materializer/src/roleHookResolver.ts';

const CTX = { repoRoot: '/tmp/never-read', configName: 'unit-test' };

function emitter(roleHooks: string[]): Pick<EmitterStrategy, 'id' | 'roleHooks'> {
  return { id: 'stub', roleHooks };
}

function provider(
  hook: string,
  role: string,
  extras: Record<string, unknown> | undefined,
): RoleHookProvider {
  return {
    hook,
    role,
    async compute() {
      return extras;
    },
  };
}

beforeEach(() => {
  _resetRegistriesForTests();
});

afterEach(() => {
  _resetRegistriesForTests();
});

describe('resolveRoleExtras (#350 — advisory roleHooks)', () => {
  test('declared hook without a registered provider is skipped (no throw)', async () => {
    // The pre-#350 orchestrator called process.exit(1) here. The contract
    // now is: the emitter's declaration is advisory, and configs that
    // don't dispatch any operation to the role need not vendor a provider.
    const result = await resolveRoleExtras(emitter(['deployment']), CTX);
    expect(result).toBeUndefined();
  });

  test('declared hook with a registered provider populates roleExtras under provider.role', async () => {
    registerRoleHookProvider(provider('deployment', 'deploymentGateway', { extracts: ['x'] }));
    const result = await resolveRoleExtras(emitter(['deployment']), CTX);
    expect(result).toBeDefined();
    expect(result?.get('deploymentGateway')).toEqual({ extracts: ['x'] });
  });

  test('provider returning undefined is treated as "nothing to contribute" — role omitted', async () => {
    registerRoleHookProvider(provider('deployment', 'deploymentGateway', undefined));
    const result = await resolveRoleExtras(emitter(['deployment']), CTX);
    expect(result).toBeUndefined();
  });

  test('mixed: one missing provider + one populated provider — populated wins, missing skipped', async () => {
    // Pins the class-scope guarantee: a single missing provider does not
    // poison the loop. Other hooks in the same emitter still run.
    registerRoleHookProvider(provider('cleanup', 'cleanupRole', { token: 'abc' }));
    const result = await resolveRoleExtras(emitter(['deployment', 'cleanup']), CTX);
    expect(result?.size).toBe(1);
    expect(result?.get('cleanupRole')).toEqual({ token: 'abc' });
    expect(result?.has('deploymentGateway')).toBe(false);
  });

  test('two providers populating the same role throw RoleHookConflictError (no silent overwrite)', async () => {
    registerRoleHookProvider(provider('hookA', 'sharedRole', { a: 1 }));
    registerRoleHookProvider(provider('hookB', 'sharedRole', { b: 2 }));
    await expect(resolveRoleExtras(emitter(['hookA', 'hookB']), CTX)).rejects.toThrowError(
      RoleHookConflictError,
    );
    await expect(resolveRoleExtras(emitter(['hookA', 'hookB']), CTX)).rejects.toThrowError(
      /attempted to overwrite extras for role "sharedRole"/,
    );
  });

  test('emitter without roleHooks returns undefined (no allocation, no work)', async () => {
    const result = await resolveRoleExtras({ id: 'stub' }, CTX);
    expect(result).toBeUndefined();
  });
});
