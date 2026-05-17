// Deterministic ID helper used by the planner (path-analyser) at codegen
// time to produce stable test-fixture identifiers across runs and
// machines.
//
// NOTE: this is intentionally duplicated with the runtime-side
// `materializer/src/support/seeding.ts`'s `deterministicSuffix`. That
// file is vendored verbatim into every emitted Playwright suite and
// MUST stay self-contained (no cross-workspace imports). When the
// algorithm changes, update both copies and verify the
// `tests/regression/...` invariants (test-id stability) still hold.

const DEFAULT_SEED = 'snapshot-baseline';

function resolveSeed(): { seed: string; random: boolean } {
  const raw = process.env.TEST_SEED;
  if (raw === 'random') return { seed: '', random: true };
  return { seed: raw && raw.length > 0 ? raw : DEFAULT_SEED, random: false };
}

/**
 * Short suffix for test fixture identifiers (e.g. `tenantId_5l5k`).
 *
 * Deterministic by default: the suffix is derived from the input `key`
 * via FNV-1a hash, mixed with the active seed (`TEST_SEED` or its
 * default `'snapshot-baseline'`). Repeated pipeline runs produce
 * identical output regardless of call ordering across modules.
 *
 * Pass `TEST_SEED=random` to force `Math.random()` fallback (only
 * useful for live-broker exploration where unique-per-run ids are
 * desired).
 */
export function deterministicSuffix(key: string, length = 4): string {
  const { seed, random } = resolveSeed();
  if (random) {
    return Math.random()
      .toString(36)
      .slice(2, 2 + length);
  }
  // FNV-1a 32-bit hash, seeded by the resolved seed.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(length, '0').slice(0, length);
}
