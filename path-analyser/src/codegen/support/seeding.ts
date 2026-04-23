// Centralized seeding utilities for generated Playwright tests.
// Provides pattern-based value generation with optional deterministic mode.
// Deterministic mode: set TEST_SEED to a stable string (e.g. commit hash) to make outputs reproducible.
import { createRequire } from 'module';

const localRequire =
  typeof createRequire === 'function' ? createRequire(import.meta.url) : (undefined as any);

export type SeedOptions = {};

interface SeedRule {
  match: RegExp | ((name: string) => boolean);
  gen: (name: string, env: SeedEnv) => string;
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

const globalEnv: SeedEnv = (() => {
  const seedStr = process.env.TEST_SEED;
  const deterministic = !!seedStr;
  let seedNum = 0;
  if (seedStr) {
    // hash string to 32-bit int
    for (let i = 0; i < seedStr.length; i++)
      seedNum = (Math.imul(31, seedNum) + seedStr.charCodeAt(i)) | 0;
  } else {
    seedNum = Date.now() ^ (Math.random() * 0xffffffff);
  }
  const rand = deterministic ? mulberry32(seedNum >>> 0) : Math.random;
  const counters = new Map<string, number>();
  const env: SeedEnv = {
    random: () => rand().toString(36).slice(2),
    counter: (bucket = 'default') => {
      const v = (counters.get(bucket) || 0) + 1;
      counters.set(bucket, v);
      return v;
    },
    runId: deterministic ? 'det-' + seedStr : 'rt-' + Date.now().toString(36),
    deterministic,
  };
  return env;
})();

/**
 * Short suffix for test fixture identifiers (e.g. `tenantId_5l5k`).
 *
 * When `TEST_SEED` is set, the suffix is derived deterministically from the
 * input `key` via FNV-1a hash, so repeated pipeline runs produce identical
 * output regardless of call ordering across modules. When `TEST_SEED` is
 * unset, falls back to `Math.random()` to preserve historical uniqueness.
 *
 * Pass a stable, unique `key` (e.g. the variable name plus a discriminator)
 * for reproducible output; reuse the same key only when collisions are OK.
 */
export function deterministicSuffix(key: string, length = 4): string {
  if (!process.env.TEST_SEED) {
    return Math.random().toString(36).slice(2, 2 + length);
  }
  // FNV-1a 32-bit hash, seeded by TEST_SEED so different runs give different
  // (but reproducible) suffixes.
  let h = 0x811c9dc5;
  const seed = process.env.TEST_SEED;
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let data: any;
    if (localRequire) {
      data = localRequire('./seed-rules.json');
    }
    if (data && Array.isArray(data.rules)) {
      rules = data.rules.map((r: any) => {
        const rawMatch: string = r.match;
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
        const template: string = r.template;
        return {
          match: matcher,
          gen: (name: string, env: SeedEnv) => expandTemplate(template, name, env),
        } as SeedRule;
      });
    }
  } catch (e) {
    // Fallback to internal defaults if JSON load fails
    rules = [
      {
        match: /(correlation)/i,
        gen: (n, e) => `corr-${e.runId}-${e.counter('corr')}-${e.random().slice(0, 4)}`,
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
    return '${' + expr + '}';
  });
}

export function seedBinding(varName: string, _opts?: SeedOptions): string {
  loadRules();
  for (const r of rules) {
    const m = r.match instanceof RegExp ? r.match.test(varName) : r.match(varName);
    if (m) return r.gen(varName, globalEnv);
  }
  // Should never reach here due to fallback rule
  return varName + '-' + globalEnv.random().slice(0, 6);
}

export function debugSeed(varName: string): string {
  return seedBinding(varName);
}
