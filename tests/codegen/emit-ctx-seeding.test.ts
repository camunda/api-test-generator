/**
 * Unit tests for `emitCtxSeeding` — the single source of truth for
 * ctx-seeding line emission shared by `emitter.ts` and
 * `templateEmitter.ts` (#286).
 *
 * # The defect class this file pins (#320)
 *
 * `computeUniqueBindings` (#304 / #318) correctly identifies which ctx
 * binding names must be seeded with `{ unique: true }` to diverge across
 * separate run invocations. But the literal-write branch of
 * `emitCtxSeeding` writes `ctx['<k>'] = <literalJSON>;` UNCONDITIONALLY
 * for every `bindings` entry whose value is not `PENDING_BINDING` — even
 * if `<k>` is in `uniqueBindings`. The subsequent
 * `ctx['<k>'] = ctx['<k>'] ?? seedBinding('<k>', { unique: true });` line
 * is never emitted for that name (the planner-side `seedBindings` list
 * already short-circuits at the literal), and even if it were, the `??`
 * fallback short-circuits because the literal is defined. The literal
 * wins, the seed is bypassed, and the second invocation against the same
 * cluster 409s on the previous run's identifier.
 *
 * Real-world reproducer at the time of writing (May 2026):
 *   generated/camunda-oca/playwright/unassignMappingRuleFromGroup.feature.spec.ts
 * emits `ctx.groupIdVar = 'group_1k29';` and 409s on the second run.
 *
 * # What the fix does
 *
 * In `emitCtxSeeding`:
 *   - Skip literal entries whose key is in `uniqueBindings`.
 *   - Add those stripped keys to the seedNames list so a
 *     `seedBinding(name, { unique: true })` line gets emitted.
 *
 * # Class scope
 *
 * The first test pins the specific reproducer shape; the second covers
 * the class of defect (every literal whose name is in `uniqueBindings`
 * must be stripped, regardless of how many or what value). The "no
 * over-strip" tests guard against a fix that would also strip
 * deterministic literals for names NOT in `uniqueBindings` — the
 * existing literal-seeded pathway is correct and must be preserved.
 */

import { describe, expect, it } from 'vitest';
import { emitCtxSeeding } from '../../materializer/src/playwright/ctxSeeding.ts';
import { PENDING_BINDING } from '../../path-analyser/src/types.ts';

describe('emitCtxSeeding: unique-binding override of literal (#320)', () => {
  it('strips a literal write for a binding flagged as unique and emits a {unique:true} seed line instead', () => {
    // Real-world reproducer shape: planner pre-minted a deterministic
    // literal for `groupIdVar` into `scenario.bindings`, the materializer
    // separately flagged `groupIdVar` unique because it is consumed by a
    // 409-declaring step. Pre-fix the literal line is emitted and the
    // seed line is not. Post-fix the literal line is suppressed and the
    // seed line is emitted with `{ unique: true }`.
    const lines = emitCtxSeeding({
      indent: '  ',
      bindings: { groupIdVar: 'group_1k29' },
      seedBindings: [],
      globalContextSeeds: [],
      uniqueBindings: new Set(['groupIdVar']),
    });
    const joined = lines.join('\n');
    expect(
      joined,
      'must NOT contain the deterministic literal write for a unique binding',
    ).not.toContain(`ctx['groupIdVar'] = "group_1k29"`);
    expect(
      joined,
      'must emit a seedBinding(..., { unique: true }) line for the stripped binding',
    ).toContain(
      `ctx['groupIdVar'] = ctx['groupIdVar'] ?? seedBinding('groupIdVar', { unique: true });`,
    );
  });

  it('class-scoped: every literal whose key is in uniqueBindings is stripped, regardless of value or count', () => {
    // Three literals, two of which are in the unique set. The third
    // (`tenantIdVar`) is not — its literal write must survive. This
    // pins the class of defect: any literal in `bindings` whose key is
    // in `uniqueBindings` leaks through, not just the specific
    // `groupIdVar` instance.
    const lines = emitCtxSeeding({
      indent: '  ',
      bindings: {
        groupIdVar: 'group_1k29',
        mappingRuleIdVar: 'mappingRule_15do',
        tenantIdVar: 'default-tenant',
      },
      seedBindings: [],
      globalContextSeeds: [],
      uniqueBindings: new Set(['groupIdVar', 'mappingRuleIdVar']),
    });
    const joined = lines.join('\n');
    // Stripped literals: neither value appears as a literal write.
    expect(joined).not.toContain(`ctx['groupIdVar'] = "group_1k29"`);
    expect(joined).not.toContain(`ctx['mappingRuleIdVar'] = "mappingRule_15do"`);
    // Replaced with unique seed lines.
    expect(joined).toContain(
      `ctx['groupIdVar'] = ctx['groupIdVar'] ?? seedBinding('groupIdVar', { unique: true });`,
    );
    expect(joined).toContain(
      `ctx['mappingRuleIdVar'] = ctx['mappingRuleIdVar'] ?? seedBinding('mappingRuleIdVar', { unique: true });`,
    );
    // Non-unique literal is preserved verbatim (no over-strip).
    expect(joined).toContain(`ctx['tenantIdVar'] = "default-tenant";`);
  });

  it('does NOT over-strip: literal writes for non-unique bindings are preserved when uniqueBindings is empty', () => {
    // Class-scoped guard against a fix that would also drop literals
    // for names not in `uniqueBindings`. The existing deterministic-
    // literal pathway is correct for snapshot comparability and must
    // be preserved (#286, #304 doc comment header).
    const lines = emitCtxSeeding({
      indent: '  ',
      bindings: { thingIdVar: 'thing_deterministic', nameVar: 'name_abc' },
      seedBindings: [],
      globalContextSeeds: [],
      uniqueBindings: new Set(),
    });
    const joined = lines.join('\n');
    expect(joined).toContain(`ctx['thingIdVar'] = "thing_deterministic";`);
    expect(joined).toContain(`ctx['nameVar'] = "name_abc";`);
  });

  it('does NOT over-strip: literal writes survive when uniqueBindings is undefined (back-compat default)', () => {
    // `uniqueBindings` is optional. Callers that do not yet pass it (or
    // older tests) must continue to see literals written verbatim.
    const lines = emitCtxSeeding({
      indent: '  ',
      bindings: { thingIdVar: 'thing_deterministic' },
      seedBindings: [],
      globalContextSeeds: [],
    });
    const joined = lines.join('\n');
    expect(joined).toContain(`ctx['thingIdVar'] = "thing_deterministic";`);
  });

  it('PENDING_BINDING entries continue to be skipped even when in the unique set', () => {
    // `PENDING_BINDING` (`__PENDING__`) is the planner's sentinel for
    // "no literal known — route through seedBindings". It must continue
    // to be skipped on the literal pass regardless of unique-set
    // membership, otherwise we'd write `ctx['nameVar'] = "__PENDING__";`
    // and clobber the seed call below.
    const lines = emitCtxSeeding({
      indent: '  ',
      bindings: { nameVar: PENDING_BINDING },
      seedBindings: ['nameVar'],
      globalContextSeeds: [],
      uniqueBindings: new Set(['nameVar']),
    });
    const joined = lines.join('\n');
    expect(joined).not.toContain('__PENDING__');
    expect(joined).toContain(
      `ctx['nameVar'] = ctx['nameVar'] ?? seedBinding('nameVar', { unique: true });`,
    );
  });

  it('does not duplicate a seed line when the same name is both in seedBindings and stripped-as-unique-literal', () => {
    // Defensive guard against the fix double-adding a name that is
    // already in `seedBindings`. The emitter must dedupe.
    const lines = emitCtxSeeding({
      indent: '  ',
      bindings: { groupIdVar: 'group_1k29' },
      seedBindings: ['groupIdVar'],
      globalContextSeeds: [],
      uniqueBindings: new Set(['groupIdVar']),
    });
    const seedLineCount = lines.filter((l) =>
      l.includes(`seedBinding('groupIdVar', { unique: true })`),
    ).length;
    expect(seedLineCount).toBe(1);
  });
});
