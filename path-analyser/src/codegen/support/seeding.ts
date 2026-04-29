// Centralized seeding utilities for generated Playwright tests.
// Provides pattern-based value generation with optional deterministic mode.
// Deterministic mode: set TEST_SEED to a stable string (e.g. commit hash) to make outputs reproducible.
import { createRequire } from 'node:module';

type LocalRequire = ((id: string) => unknown) | undefined;
const localRequire: LocalRequire =
  typeof createRequire === 'function' ? createRequire(import.meta.url) : undefined;

export type SeedOptions = Record<string, never>;

interface SeedRule {
  match: RegExp | ((name: string) => boolean);
  gen: (name: string, env: SeedEnv) => string;
}

interface RawSeedRule {
  match: string;
  template: string;
}

interface SeedRulesFile {
  rules: RawSeedRule[];
}

function isRawSeedRule(v: unknown): v is RawSeedRule {
  if (!v || typeof v !== 'object') return false;
  return (
    typeof Reflect.get(v, 'match') === 'string' && typeof Reflect.get(v, 'template') === 'string'
  );
}

function isSeedRulesFile(v: unknown): v is SeedRulesFile {
  return !!v && typeof v === 'object' && Array.isArray(Reflect.get(v, 'rules'));
}

interface SeedEnv {
  random: () => string; // returns base36 random string w/out leading '0.'
  counter: (bucket?: string) => number;
  runId: string; // derived from seed or timestamp
  deterministic: boolean;
}

// Simple mulberry32 implementation for deterministic PRNG
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Resolve the active seed string. Determinism is the default — generator
 * output is byte-reproducible across runs and machines unless the caller
 * explicitly opts out by setting `TEST_SEED=random`.
 *
 * - unset / `'snapshot-baseline'` (the default): deterministic.
 * - any other non-empty string: deterministic (seeded by that string).
 * - `'random'`: nondeterministic (`Math.random()` fallback). Used only
 *   when explicitly requested for live-broker exploration.
 */
const DEFAULT_SEED = 'snapshot-baseline';
function resolveSeed(): { seed: string; random: boolean } {
  const raw = process.env.TEST_SEED;
  if (raw === 'random') return { seed: '', random: true };
  return { seed: raw && raw.length > 0 ? raw : DEFAULT_SEED, random: false };
}

const globalEnv: SeedEnv = (() => {
  const { seed: seedStr, random } = resolveSeed();
  let seedNum = 0;
  if (random) {
    seedNum = Date.now() ^ (Math.random() * 0xffffffff);
  } else {
    // hash string to 32-bit int
    for (let i = 0; i < seedStr.length; i++)
      seedNum = (Math.imul(31, seedNum) + seedStr.charCodeAt(i)) | 0;
  }
  const rand = random ? Math.random : mulberry32(seedNum >>> 0);
  const counters = new Map<string, number>();
  const env: SeedEnv = {
    random: () => rand().toString(36).slice(2),
    counter: (bucket = 'default') => {
      const v = (counters.get(bucket) || 0) + 1;
      counters.set(bucket, v);
      return v;
    },
    runId: random ? `rt-${Date.now().toString(36)}` : `det-${seedStr}`,
    deterministic: !random,
  };
  return env;
})();

/**
 * Short suffix for test fixture identifiers (e.g. `tenantId_5l5k`).
 *
 * Deterministic by default: the suffix is derived from the input `key`
 * via FNV-1a hash, mixed with the active seed (`TEST_SEED` or its default
 * `'snapshot-baseline'`). Repeated pipeline runs produce identical output
 * regardless of call ordering across modules.
 *
 * Pass `TEST_SEED=random` to force `Math.random()` fallback (only useful
 * for live-broker exploration where unique-per-run ids are desired).
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

// Dynamic rule loading from external JSON (seed-rules.json)
let rules: SeedRule[] = [];
let rulesLoaded = false;

function loadRules() {
  if (rulesLoaded) return;
  rulesLoaded = true;
  try {
    // Use dynamic import to allow bundlers / TS to include JSON; fallback if not found
    let data: unknown;
    if (localRequire) {
      data = localRequire('./seed-rules.json');
    }
    if (isSeedRulesFile(data)) {
      rules = data.rules.filter(isRawSeedRule).map((r): SeedRule => {
        const rawMatch = r.match;
        let matcher: RegExp | ((name: string) => boolean);
        if (rawMatch === '*') {
          matcher = () => true;
        } else if (rawMatch.startsWith('/') && rawMatch.lastIndexOf('/') > 0) {
          const last = rawMatch.lastIndexOf('/');
          const pattern = rawMatch.slice(1, last);
          const flags = rawMatch.slice(last + 1);
          matcher = new RegExp(pattern, flags);
        } else {
          matcher = new RegExp(rawMatch);
        }
        const template = r.template;
        return {
          match: matcher,
          gen: (name: string, env: SeedEnv) => expandTemplate(template, name, env),
        };
      });
    }
  } catch (_e) {
    // Fallback to internal defaults if JSON load fails
    rules = [
      {
        match: /(correlation)/i,
        gen: (_n, e) => `corr-${e.runId}-${e.counter('corr')}-${e.random().slice(0, 4)}`,
      },
      {
        match: /(key|id)$/i,
        gen: (n, e) => `${n}-${e.runId}-${e.counter('id')}-${e.random().slice(0, 6)}`,
      },
      { match: /name/i, gen: (n, e) => `${n}-${e.random().slice(0, 8)}` },
      { match: () => true, gen: (n, e) => `${n}-${e.random().slice(0, 6)}` },
    ];
  }
  // Ensure a fallback rule exists
  if (
    !rules.some(
      (r) =>
        (r.match instanceof Function && r.match('___fallback_check___')) ||
        (r.match instanceof RegExp && r.match.test('anythingfallback')),
    )
  ) {
    rules.push({ match: () => true, gen: (n, e) => `${n}-${e.random().slice(0, 6)}` });
  }
}

function expandTemplate(tpl: string, varName: string, env: SeedEnv): string {
  return tpl.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    if (expr === 'var') return varName;
    if (expr === 'runId') return env.runId;
    if (expr.startsWith('rand:')) {
      const n = parseInt(expr.split(':')[1] || '6', 10);
      return env.random().slice(0, n);
    }
    if (expr.startsWith('counter')) {
      const parts = expr.split(':');
      const bucket = parts[1] || 'default';
      return String(env.counter(bucket));
    }
    return `\${${expr}}`;
  });
}

export function seedBinding(varName: string, _opts?: SeedOptions): string {
  loadRules();
  for (const r of rules) {
    const m = r.match instanceof RegExp ? r.match.test(varName) : r.match(varName);
    if (m) return r.gen(varName, globalEnv);
  }
  // Should never reach here due to fallback rule
  return `${varName}-${globalEnv.random().slice(0, 6)}`;
}

export function debugSeed(varName: string): string {
  return seedBinding(varName);
}

/**
 * Conditionally bind an extracted response value into the scenario context.
 *
 * Preserves the existing binding when `value` is `undefined` so that:
 *   - seeded values (from `seedBinding`) survive a missing response field
 *   - earlier extracts in the same scenario aren't clobbered by later steps
 *     whose response shape doesn't include the same field
 *
 * Note: `null` is treated as a real overwrite (matches the prior emitter
 * semantics, which only guarded against `undefined`).
 */
export function extractInto(ctx: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) ctx[key] = value;
}
