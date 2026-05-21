import type { EmitterStrategy, RoleHookProvider } from './types.js';

/**
 * Process-wide registry of {@link EmitterStrategy} implementations
 * keyed by stable id.
 *
 * Idempotent: registering the same emitter id twice with the same
 * instance is a no-op; registering a different instance with an
 * existing id throws so configuration drift is caught loudly at boot.
 */
const emitters = new Map<string, EmitterStrategy>();

export function registerEmitter(emitter: EmitterStrategy): void {
  const existing = emitters.get(emitter.id);
  if (existing && existing !== emitter) {
    throw new Error(
      `Emitter id collision: '${emitter.id}' is already registered to a different instance ('${existing.name}'). ` +
        'Each emitter id must map to exactly one implementation.',
    );
  }
  emitters.set(emitter.id, emitter);
}

export function getEmitter(id: string): EmitterStrategy | undefined {
  return emitters.get(id);
}

export function listEmitters(): EmitterStrategy[] {
  return [...emitters.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Process-wide registry of {@link RoleHookProvider}s keyed by hook name.
 * Multiple providers for the same hook are not permitted (a hook name
 * is a singleton contract); the orchestrator will fail loudly on collision.
 */
const roleHookProviders = new Map<string, RoleHookProvider>();

export function registerRoleHookProvider(provider: RoleHookProvider): void {
  const existing = roleHookProviders.get(provider.hook);
  if (existing && existing !== provider) {
    throw new Error(
      `Role-hook provider collision: hook '${provider.hook}' is already registered to a different provider. ` +
        'Each hook name must map to exactly one provider.',
    );
  }
  roleHookProviders.set(provider.hook, provider);
}

export function getRoleHookProvider(hook: string): RoleHookProvider | undefined {
  return roleHookProviders.get(hook);
}

export function listRoleHookProviders(): RoleHookProvider[] {
  return [...roleHookProviders.values()].sort((a, b) => a.hook.localeCompare(b.hook));
}

/**
 * Test-only: clear both registries. Exported from the package barrel
 * for unit-test use, but not part of the stable public emitter contract —
 * production emitters must not call this. The leading underscore signals
 * the unsupported status.
 */
export function _resetRegistriesForTests(): void {
  emitters.clear();
  roleHookProviders.clear();
}
