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
 *   1. Literal bindings from `scenario.bindings` (skip `PENDING_BINDING`,
 *      AND skip names present in `uniqueBindings` — those need a
 *      `{ unique: true }` seed and are re-routed into step 2 below, see
 *      #320).
 *   2. Per-scenario `seedBindings` (filtered against globalSeedNames so
 *      a binding handled by the prologue is not also seeded here), plus
 *      any names whose literal was stripped by step 1's unique-set
 *      exclusion.
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

import { planCtxSeeding } from '@camunda8/emitter-sdk';

// The seeding and uniqueness decisions live in the language-neutral
// lowering module so every emitter makes the same ones (#812). This file
// only renders them as TypeScript.
export { computeUniqueBindings } from '@camunda8/emitter-sdk';

/**
 * Subset of {@link GlobalContextSeed} consumed by this helper. The
 * `templateEmitter` only knows about `binding` + `seedRule`; the
 * per-endpoint emitter consumes a richer shape (multipart sentinel
 * locals etc.) but emits those locals separately, after the helper.
 */
export interface CtxSeedingGlobal {
  readonly binding: string;
  readonly seedRule: string;
  /**
   * If true, the universal-seed prologue does NOT auto-seed this
   * binding. The binding is seeded only when a per-scenario step
   * names it via `scenario.seedBindings`. For scenarios that don't
   * seed it, the binding stays `undefined` and the consuming
   * request omits the field on the wire (#342).
   */
  readonly omitWhenUnbound?: boolean;
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
  /**
   * Binding names that must be seeded with `{ unique: true }` so they
   * diverge across separate run invocations. Populated by the emitter
   * for client-minted identifiers consumed by operations that declare an
   * HTTP 409 (Conflict) response — re-runs would otherwise collide on
   * the previous run's identifiers (#304).
   *
   * **Keyed by binding name** (the ctx key being seeded), NOT by seed
   * rule. For the `seedNames` loop the two coincide; for the
   * `globalContextSeeds` loop the emitted `seedBinding(seedRule, ...)`
   * call uses `seedRule` as the name argument while uniqueness is
   * decided by membership of the ctx `binding` in this set. The
   * resulting `seedBinding('seedRule', { unique: true })` is still
   * correct: `seedBinding`'s name arg drives the per-binding counter
   * seed, while the `unique` flag toggles which PRNG env is used.
   */
  uniqueBindings?: ReadonlySet<string>;
  /**
   * Maps a binding name (scenario literal or seeded) to an environment-variable
   * name that overrides its value at runtime (the positive-suite analogue of
   * the negative suite's `RV_FIXTURE_*`). For a binding `k` in this map the
   * emitted line becomes
   *
   *   ctx['k'] = ctx['k'] ?? (process.env[<ENV>] || <seed>);
   *
   * for seeded bindings (common case for `acceptsExternal` components), or
   *
   *   ctx['k'] = process.env[<ENV>] || <literal>;
   *
   * for literal bindings (e.g. model-derived literals that are always emitted).
   * In both cases an unset or empty env var falls back to the deterministic
   * seed/literal — keeping offline/snapshot runs reproducible. An e2e driver
   * (e.g. scripts/e2e/run-hub.sh) sets the env var to supply a real,
   * server-known value for a client-minted input that has no producer (e.g.
   * a workspace member's email, which must be an existing Hub user).
   * `globalContextSeeds` (universal per-spec prologue seeds) are not affected
   * by this map — they always use plain seed calls.
   */
  fixtureEnvByBinding?: Readonly<Record<string, string>>;
}

function seedCall(name: string, unique: boolean): string {
  return unique ? `seedBinding('${name}', { unique: true })` : `seedBinding('${name}')`;
}

export function emitCtxSeeding(opts: EmitCtxSeedingOptions): string[] {
  const { indent } = opts;
  const ops = planCtxSeeding(opts);
  const lines: string[] = [];
  if (ops.some((op) => op.group === 'scenario')) lines.push(`${indent}// Seed scenario bindings`);
  for (const op of ops) {
    const env = op.envOverride === undefined ? undefined : JSON.stringify(op.envOverride);
    if (op.kind === 'literal') {
      const literal = JSON.stringify(op.value);
      lines.push(
        env
          ? `${indent}ctx['${op.binding}'] = process.env[${env}] || ${literal};`
          : `${indent}ctx['${op.binding}'] = ${literal};`,
      );
      continue;
    }
    const seed = seedCall(op.rule, op.unique);
    lines.push(
      env
        ? `${indent}ctx['${op.binding}'] = ctx['${op.binding}'] ?? (process.env[${env}] || ${seed});`
        : `${indent}ctx['${op.binding}'] = ctx['${op.binding}'] ?? ${seed};`,
    );
  }
  return lines;
}
