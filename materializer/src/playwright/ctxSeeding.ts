/**
 * Single source of truth for `ctx`-seeding lines in emitted Playwright
 * suites (#286).
 *
 * Two emitters write the seed prologue at the top of every test body:
 *  - `emitter.ts`             — per-endpoint feature / variant suites
 *  - `templateEmitter.ts`     — entity / edge lifecycle suites
 *
 * Pre-#286 the two sites grew the same logic independently and drifted
 * on (a) the per-scenario `seedBindings` form (`=== undefined` vs `??`)
 * and (b) the ordering of literals, seedBindings, and the universal-
 * seed prologue. The ordering drift was a latent bug: in
 * `templateEmitter.ts` a literal emitted AFTER the prologue would have
 * clobbered a `??`-seeded global if any scenario ever had a literal
 * whose name collided with a `globalContextSeeds` entry — the only
 * reason that never surfaced is that no scenario today has such a
 * collision.
 *
 * Canonical emission order (applied uniformly by both emitters):
 *
 *   1. Literal bindings from `scenario.bindings` (skip `PENDING_BINDING`).
 *   2. Per-scenario `seedBindings` (filtered against globalSeedNames so
 *      a binding handled by the prologue is not also seeded here).
 *   3. Universal-seed prologue from `globalContextSeeds`.
 *
 * Every seeded line uses the terse `??` form:
 *
 *   ctx['<k>'] = ctx['<k>'] ?? seedBinding('<rule>');
 *
 * `??` is safe at every step because (1) literals are emitted first
 * and a defined value short-circuits `??`, (2) `seedBindings` and the
 * prologue are mutually exclusive (the `globalSeedNames` filter
 * removes the overlap), (3) literals that happen to share a name with
 * a prologue entry survive the prologue unchanged (again — `??` short-
 * circuits on any defined value, including the empty string and `0`).
 *
 * `null` is NOT preserved: a literal `ctx['x'] = null` will be re-
 * seeded by a later prologue or seedBindings entry. The planner does
 * not emit `null` literals for any seeded binding today; if a future
 * planner change ever needs `null` to be distinct from "missing",
 * tighten back to `=== undefined` HERE (so both emitters move
 * together) rather than at the call sites.
 */

import { PENDING_BINDING } from 'path-analyser/types';

/**
 * Subset of {@link GlobalContextSeed} consumed by this helper. The
 * `templateEmitter` only knows about `binding` + `seedRule`; the
 * per-endpoint emitter consumes a richer shape (multipart sentinel
 * locals etc.) but emits those locals separately, after the helper.
 */
export interface CtxSeedingGlobal {
  readonly binding: string;
  readonly seedRule: string;
}

export interface EmitCtxSeedingOptions {
  /** Per-line indent. Two spaces for `emitter.ts`, four for `templateEmitter.ts`. */
  indent: string;
  /** Scenario's literal bindings; `PENDING_BINDING` values are skipped. */
  bindings: Readonly<Record<string, unknown>> | undefined;
  /** Planner-driven seed names. Already-known globals are filtered out internally. */
  seedBindings: readonly string[] | undefined;
  /** Universal-seed prologue entries (the ABox-driven list). */
  globalContextSeeds: readonly CtxSeedingGlobal[];
}

export function emitCtxSeeding(opts: EmitCtxSeedingOptions): string[] {
  const { indent, bindings, seedBindings, globalContextSeeds } = opts;
  const lines: string[] = [];
  const globalSeedNames = new Set(globalContextSeeds.map((s) => s.binding));

  const literalEntries = bindings
    ? Object.entries(bindings).filter(([, v]) => v !== PENDING_BINDING)
    : [];
  const seedNames = (seedBindings ?? []).filter((n) => !globalSeedNames.has(n));

  if (literalEntries.length > 0 || seedNames.length > 0) {
    lines.push(`${indent}// Seed scenario bindings`);
    for (const [k, v] of literalEntries) {
      lines.push(`${indent}ctx['${k}'] = ${JSON.stringify(v)};`);
    }
    for (const name of seedNames) {
      lines.push(`${indent}ctx['${name}'] = ctx['${name}'] ?? seedBinding('${name}');`);
    }
  }

  for (const seed of globalContextSeeds) {
    lines.push(
      `${indent}ctx['${seed.binding}'] = ctx['${seed.binding}'] ?? seedBinding('${seed.seedRule}');`,
    );
  }

  return lines;
}
