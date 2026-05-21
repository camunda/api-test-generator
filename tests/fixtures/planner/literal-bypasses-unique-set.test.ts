/**
 * Planner contract fixture — literal bindings bypass the {unique:true}
 * tagging set (camunda/api-test-generator#320, follow-up to #304/#318).
 *
 * # The defect class this fixture pins
 *
 * #304/#318 made client-minted identifiers consumed by HTTP-409-declaring
 * operations cross-run-unique, by emitting `seedBinding(name, { unique: true })`
 * at the call site. The materializer's `computeUniqueBindings` walks the
 * request plan and flags exactly those bindings — the implementation is
 * correct.
 *
 * The gap: when the planner pre-mints a **deterministic literal value** into
 * `scenario.bindings` for that same slot (via the establisher-chaining path
 * in `scenarioGenerator.ts`), the literal short-circuits
 * `computeSeedBindings`. The slot then never appears in `scenario.seedBindings`,
 * so the emitter writes a hard-coded literal line:
 *
 *   ctx['groupIdVar'] = 'group_1k29';
 *
 * instead of the unique-tagged seed call:
 *
 *   ctx['groupIdVar'] = ctx['groupIdVar'] ?? seedBinding('groupIdVar', { unique: true });
 *
 * A re-run against the same cluster then 409s on the literal identifier.
 *
 * Real-world reproducer at the time of writing (May 2026):
 *   generated/camunda-oca/playwright/unassignMappingRuleFromGroup.feature.spec.ts
 * emits `ctx.groupIdVar = 'group_1k29';` and 409s on the second run.
 *
 * # What this fixture asserts (pre-fix, against `main`)
 *
 * The three assertions together encode the latent inconsistency:
 *
 *   1. The materializer's unique predicate already thinks `groupIdVar` is
 *      cross-run-unique-eligible.
 *   2. The planner's seed-list computation drops it (because of the literal).
 *   3. The scenario therefore holds a literal in `bindings` AND the same key
 *      is in the materializer's unique set — the asymmetry that produces the
 *      bug.
 *
 * # Lifecycle
 *
 * Per AGENTS.md green/green discipline for cross-cutting planner changes,
 * this PR (PR1 of two) lands the fixture pinning the **current** behaviour
 * so reviewers can see that the test apparatus genuinely changes when the
 * fix lands. PR2 (the planner-side fix for #320) inverts the assertions in
 * this file:
 *
 *   - `computeSeedBindings(...)` MUST include `groupIdVar`.
 *   - `scenario.uniqueBindings` MUST include `groupIdVar`.
 *   - `scenario.bindings` MUST NOT carry the literal for that key.
 *
 * The inversion belongs in the fix PR — flipping it here would defeat the
 * point of the guard.
 *
 * # Why class-scoped
 *
 * The assertions are written against the planner+materializer surfaces
 * directly (not against a specific generated spec file), so they capture the
 * **category** of defect: any literal in `scenario.bindings` whose key is
 * also in the unique set leaks through to emitters. A test that only
 * inspected `unassignMappingRuleFromGroup.feature.spec.ts` would rot the
 * first time the planner's establisher choice for that endpoint changed.
 */

import { describe, expect, it } from 'vitest';
import { computeUniqueBindings } from '../../../materializer/src/playwright/ctxSeeding.ts';
import { computeSeedBindings } from '../../../path-analyser/src/seedBindings.ts';
import type { EndpointScenario, RequestStep } from '../../../path-analyser/src/types.ts';

function scenarioOf(partial: Partial<EndpointScenario>): EndpointScenario {
  return {
    id: partial.id ?? 'scenario-1',
    operations: partial.operations ?? [],
    producedSemanticTypes: partial.producedSemanticTypes ?? [],
    satisfiedSemanticTypes: partial.satisfiedSemanticTypes ?? [],
    bindings: partial.bindings,
    requestPlan: partial.requestPlan,
  };
}

/**
 * Minimal reproducer of the establisher-chain shape that surfaces the bug:
 *
 *   step 0: createGroup (POST /groups, declares 409, body reads `${groupIdVar}`,
 *           extracts `groupId` → `groupIdVar` from the response)
 *   step 1: unassignMappingRuleFromGroup (DELETE /groups/{groupId}/...)
 *
 * The planner has already minted a deterministic literal for `groupIdVar`
 * and parked it in `scenario.bindings`. `nameVar` is left as `__PENDING__`
 * for contrast — it has no literal, so it routes through `seedBinding`
 * normally and (post-#318) gets `{ unique: true }`.
 */
function makeCreateGroupChainScenario(): EndpointScenario {
  const createGroup: RequestStep = {
    operationId: 'createGroup',
    method: 'POST',
    pathTemplate: '/groups',
    expect: { status: 201 },
    bodyKind: 'json',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional generator template placeholders, not JS interpolation
    bodyTemplate: { groupId: '${groupIdVar}', name: '${nameVar}' },
    extract: [{ fieldPath: 'groupId', bind: 'groupIdVar', semantic: 'GroupId' }],
    declares409: true,
  };
  const consume: RequestStep = {
    operationId: 'unassignMappingRuleFromGroup',
    method: 'DELETE',
    pathTemplate: '/groups/{groupId}/mapping-rules/{mappingRuleId}',
    expect: { status: 204 },
  };
  return scenarioOf({
    bindings: {
      groupIdVar: 'group_1k29',
      nameVar: '__PENDING__',
    },
    requestPlan: [createGroup, consume],
  });
}

describe('planner: literal bindings bypass the {unique:true} set (#320)', () => {
  describe('createGroup establisher chain (real-world reproducer shape)', () => {
    it('materializer predicate ALREADY flags groupIdVar as unique-eligible', () => {
      // Locks in the predicate's correctness — the bug isn't here. If this
      // assertion ever fails it's a regression in the unique predicate
      // itself (#304/#318), not in the planner.
      const scenario = makeCreateGroupChainScenario();
      const unique = computeUniqueBindings(scenario.requestPlan);
      expect(unique.has('groupIdVar')).toBe(true);
      // Class-scoped sanity: nameVar (also client-minted, also consumed by
      // the 409-declaring step) is flagged too, so the predicate's coverage
      // is symmetric across literal-vs-PENDING slots.
      expect(unique.has('nameVar')).toBe(true);
    });

    it('planner currently DROPS groupIdVar from the seed list because of the literal (#320 bug)', () => {
      // This is the bug. `groupIdVar` reads from step 0's body, no earlier
      // step extracts it, and `scenario.bindings.groupIdVar` is a non-PENDING
      // literal — so `computeSeedBindings` short-circuits at the
      // `literalBindings.has(v)` check. The downstream emitter therefore
      // never wraps `groupIdVar` in a `seedBinding(..., { unique: true })`
      // call, and the literal lands verbatim in the generated spec.
      //
      // PR2 (the fix) makes this assertion fail by teaching `computeSeedBindings`
      // to skip the literal-short-circuit when the binding is in the unique
      // set, and by stripping the literal from `scenario.bindings`. When
      // inverting this assertion in PR2, also assert `bindings.groupIdVar`
      // is undefined and `scenario.uniqueBindings` includes `groupIdVar`.
      const scenario = makeCreateGroupChainScenario();
      const seeds = computeSeedBindings(scenario);
      expect(seeds).not.toContain('groupIdVar');
      // Class-scoped: nameVar (PENDING, also in the unique set) routes
      // through seedBindings normally and gets `{ unique: true }` at the
      // emit site — only the literal-pre-empted slot leaks.
      expect(seeds).toContain('nameVar');
    });

    it('the unique set and the seed list disagree on groupIdVar — the #320 asymmetry', () => {
      // Compact restatement of the gap: any binding in `unique \ seeds` is
      // a slot the emitter wanted to cross-run-unique but cannot, because
      // the literal pre-empts the seed call.
      //
      // PR2 closes the gap by routing such bindings into `seeds` and out
      // of `scenario.bindings`. After the fix, `unique \ seeds` is empty
      // for every scenario — a property the Layer-3 invariant in PR2
      // sweeps across the whole bundled spec.
      const scenario = makeCreateGroupChainScenario();
      const unique = computeUniqueBindings(scenario.requestPlan);
      const seeds = new Set(computeSeedBindings(scenario));
      const gap = [...unique].filter((b) => !seeds.has(b));
      expect(gap).toContain('groupIdVar');
    });
  });
});
