import type { Emitter } from './emitter.js';

/**
 * Registry of {@link Emitter} implementations keyed by stable id.
 *
 * The registry is process-wide and idempotent: registering the same emitter
 * id twice with the same instance is a no-op; registering a different
 * instance with an existing id throws so configuration drift is caught
 * loudly at boot.
 */
const emitters = new Map<string, Emitter>();

export function registerEmitter(emitter: Emitter): void {
  const existing = emitters.get(emitter.id);
  if (existing && existing !== emitter) {
    throw new Error(
      `Emitter id collision: '${emitter.id}' is already registered to a different instance ('${existing.name}'). ` +
        'Each emitter id must map to exactly one implementation.',
    );
  }
  emitters.set(emitter.id, emitter);
}

export function getEmitter(id: string): Emitter | undefined {
  return emitters.get(id);
}

export function listEmitters(): Emitter[] {
  return [...emitters.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Test-only: clear the registry. Not exported from the package barrel. */
export function _resetEmittersForTests(): void {
  emitters.clear();
}
