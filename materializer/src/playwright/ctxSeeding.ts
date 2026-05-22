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

import type { RequestStep } from 'path-analyser/types';
import { PENDING_BINDING } from 'path-analyser/types';
import { camelCase } from './stepRenderer.js';

/**
 * Compute the set of binding names that must be seeded with
 * `{ unique: true }` for a given scenario's `requestPlan`.
 *
 * A binding qualifies as **unique** iff:
 *
 *   1. It is **client-minted** — referenced as a `${binding}` placeholder
 *      in some step's `bodyTemplate` or as a `pathParams[].var`, AND
 *   2. It is NOT extracted from any earlier step's response (i.e. not
 *      bound via `extract[].bind` before its first consuming step), AND
 *   3. The consuming step's operation declares an HTTP 409 (Conflict)
 *      response in the OpenAPI spec (`step.declares409 === true`,
 *      stamped by the planner from `Operation.responseLeafPaths['409']`).
 *
 * Without (3) the binding is safe to re-seed deterministically: the server
 * will not 409 on a re-run, so cross-run uniqueness is unnecessary and
 * keeping the seed deterministic preserves snapshot comparability.
 *
 * Without (2) the binding is server-minted (the client never sends it as
 * input to the create endpoint); marking it unique would have no effect.
 *
 * See #304 for the underlying re-runnability problem and the design
 * rationale (criterion = 409 declared ∧ client-minted).
 */
export function computeUniqueBindings(
  requestPlan: readonly RequestStep[] | undefined,
): Set<string> {
  const unique = new Set<string>();
  if (!requestPlan || requestPlan.length === 0) return unique;
  const extracted = new Set<string>();
  for (const step of requestPlan) {
    if (step.declares409) {
      for (const ref of collectBindingRefs(step)) {
        if (!extracted.has(ref)) unique.add(ref);
      }
    }
    for (const e of step.extract ?? []) extracted.add(e.bind);
  }
  return unique;
}

function collectBindingRefs(step: RequestStep): Set<string> {
  const refs = new Set<string>();
  for (const p of step.pathParams ?? []) refs.add(p.var);
  collectPathTemplateRefs(step.pathTemplate, refs);
  walkForPlaceholders(step.bodyTemplate, refs);
  walkForPlaceholders(step.multipartTemplate, refs);
  return refs;
}

const PATH_PLACEHOLDER_RE = /\{([A-Za-z_$][\w$]*)\}/g;
const PLACEHOLDER_RE = /\\?\$\{([^}]+)\}/g;

function collectPathTemplateRefs(pathTemplate: string | undefined, out: Set<string>): void {
  if (!pathTemplate) return;
  // Mirror stepRenderer.buildUrlExpression: every `{param}` placeholder in
  // the URL is substituted at runtime as `ctx.${camelCase(param)}Var`, so
  // the corresponding ctx binding name is `${camelCase(param)}Var` — NOT
  // the raw placeholder name. Without this transform, path-only client-
  // minted identifiers (e.g. usernameVar consumed by a 409-declaring
  // DELETE /users/{username}) would never match the seeded ctx binding
  // set and would silently miss `{ unique: true }` tagging. (#318 review.)
  for (const m of pathTemplate.matchAll(PATH_PLACEHOLDER_RE)) {
    out.add(`${camelCase(m[1])}Var`);
  }
}

function walkForPlaceholders(node: unknown, out: Set<string>): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    for (const m of node.matchAll(PLACEHOLDER_RE)) out.add(m[1]);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) walkForPlaceholders(v, out);
    return;
  }
  if (typeof node === 'object') {
    // biome-ignore lint/plugin: narrowed to non-null object above; Record cast is contract-safe.
    for (const v of Object.values(node as Record<string, unknown>)) walkForPlaceholders(v, out);
  }
}

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
}

function seedCall(name: string, unique: boolean): string {
  return unique ? `seedBinding('${name}', { unique: true })` : `seedBinding('${name}')`;
}

export function emitCtxSeeding(opts: EmitCtxSeedingOptions): string[] {
  const { indent, bindings, seedBindings, globalContextSeeds, uniqueBindings } = opts;
  const unique = uniqueBindings ?? new Set<string>();
  const lines: string[] = [];
  // `omitWhenUnbound` seeds are excluded from the universal prologue
  // but remain eligible for per-scenario seeding via `seedBindings`,
  // so they are NOT added to `globalSeedNames` (which is the
  // "don't seed twice" filter for the `seedNames` step). See #342.
  const globalSeedNames = new Set(
    globalContextSeeds.filter((s) => !s.omitWhenUnbound).map((s) => s.binding),
  );

  // Literal writes from `scenario.bindings`, with two exclusions:
  //   - `PENDING_BINDING` sentinel — routes through `seedBindings` instead.
  //   - Names flagged unique by `uniqueBindings` — a deterministic literal
  //     would defeat the `{ unique: true }` seed it needs (#320). The
  //     literal is stripped here and the name is re-routed into
  //     `seedNames` below so a `seedBinding(name, { unique: true })`
  //     line is emitted in its place.
  const literalEntries = bindings
    ? Object.entries(bindings).filter(([k, v]) => v !== PENDING_BINDING && !unique.has(k))
    : [];
  const strippedForUnique = bindings
    ? Object.entries(bindings)
        .filter(([k, v]) => v !== PENDING_BINDING && unique.has(k))
        .map(([k]) => k)
    : [];
  const seedNames = Array.from(new Set([...(seedBindings ?? []), ...strippedForUnique])).filter(
    (n) => !globalSeedNames.has(n),
  );

  if (literalEntries.length > 0 || seedNames.length > 0) {
    lines.push(`${indent}// Seed scenario bindings`);
    for (const [k, v] of literalEntries) {
      lines.push(`${indent}ctx['${k}'] = ${JSON.stringify(v)};`);
    }
    for (const name of seedNames) {
      lines.push(
        `${indent}ctx['${name}'] = ctx['${name}'] ?? ${seedCall(name, unique.has(name))};`,
      );
    }
  }

  for (const seed of globalContextSeeds) {
    if (seed.omitWhenUnbound) continue;
    lines.push(
      `${indent}ctx['${seed.binding}'] = ctx['${seed.binding}'] ?? ${seedCall(seed.seedRule, unique.has(seed.binding))};`,
    );
  }

  return lines;
}
