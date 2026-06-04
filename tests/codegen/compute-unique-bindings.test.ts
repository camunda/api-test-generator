// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal `${var}` placeholders appear in test fixture data that mimics planner bodyTemplate strings.
import { describe, expect, it } from 'vitest';
import { computeUniqueBindings } from '../../materializer/src/playwright/ctxSeeding.ts';
import type { RequestStep } from '../../path-analyser/src/types.ts';

/**
 * Focused unit tests for the per-scenario `computeUniqueBindings` helper.
 * The bulk of #304 behaviour is covered end-to-end by the L3 invariants in
 * `configs/camunda-oca/regression-invariants.test.ts`, but the path-
 * template ctx-name derivation (post-#318 review fix) is subtle enough
 * to warrant a layer-1-style unit test so a regression points at the
 * helper, not at the emitted suites.
 */

function step(overrides: Partial<RequestStep> = {}): RequestStep {
  const base: RequestStep = {
    operationId: 'op',
    method: 'POST',
    pathTemplate: '/x',
    expect: { status: 200 },
  };
  return { ...base, ...overrides };
}

describe('computeUniqueBindings (#304 / #318 review)', () => {
  it('returns an empty set for an empty or undefined requestPlan', () => {
    expect(computeUniqueBindings(undefined)).toEqual(new Set());
    expect(computeUniqueBindings([])).toEqual(new Set());
  });

  it('tags body-template placeholders consumed by 409-declaring steps', () => {
    const plan: RequestStep[] = [
      step({
        operationId: 'createUser',
        declares409: true,
        bodyTemplate: { username: '${usernameVar}', password: '${passwordVar}' },
      }),
    ];
    expect(computeUniqueBindings(plan)).toEqual(new Set(['usernameVar', 'passwordVar']));
  });

  it('does NOT tag bindings consumed by non-409 steps', () => {
    const plan: RequestStep[] = [
      step({
        operationId: 'searchUsers',
        declares409: false,
        bodyTemplate: { filter: '${filterVar}' },
      }),
    ];
    expect(computeUniqueBindings(plan)).toEqual(new Set());
  });

  it('does NOT tag server-extracted bindings even when consumed by 409 steps', () => {
    // First step creates a Role, extracting `roleIdVar` from the response.
    // Second step is a 409-declaring assign that consumes `roleIdVar` in
    // its body — but it's server-minted, so we must not tag it unique.
    const plan: RequestStep[] = [
      step({
        operationId: 'createRole',
        declares409: true,
        bodyTemplate: { name: '${nameVar}' },
        extract: [{ fieldPath: 'roleId', bind: 'roleIdVar' }],
      }),
      step({
        operationId: 'assignRoleToUser',
        declares409: true,
        bodyTemplate: { roleId: '${roleIdVar}' },
      }),
    ];
    const unique = computeUniqueBindings(plan);
    expect(unique.has('nameVar')).toBe(true);
    expect(unique.has('roleIdVar')).toBe(false);
  });

  it('derives ctx binding names from `{param}` placeholders in pathTemplate via camelCase + "Var" suffix (#318 review)', () => {
    // The emitter's URL substitution uses `ctx.${camelCase(p)}Var`, so the
    // unique set must contain that derived name — NOT the raw placeholder.
    // Without this transform, path-only client-minted identifiers on
    // 409-declaring ops would silently miss { unique: true } tagging.
    const plan: RequestStep[] = [
      step({
        operationId: 'updateUser',
        method: 'PUT',
        pathTemplate: '/v2/users/{username}/roles/{roleName}',
        declares409: true,
      }),
    ];
    const unique = computeUniqueBindings(plan);
    expect(unique.has('usernameVar')).toBe(true);
    expect(unique.has('roleNameVar')).toBe(true);
    // Raw placeholder names must NOT appear — they don't match any ctx key.
    expect(unique.has('username')).toBe(false);
    expect(unique.has('roleName')).toBe(false);
  });

  it('walks multipartTemplate placeholders', () => {
    const plan: RequestStep[] = [
      step({
        operationId: 'createResource',
        declares409: true,
        bodyKind: 'multipart',
        multipartTemplate: [{ name: 'resourceName', value: '${resourceNameVar}' }],
      }),
    ];
    expect(computeUniqueBindings(plan)).toEqual(new Set(['resourceNameVar']));
  });

  it('excludes authoritative model-derived literals from the unique set (#172)', () => {
    // createProcessInstance declares 409 and references BOTH a client-minted
    // identifier (`nameVar`) and a modelDerived element id (`elementIdVar`)
    // in its body. Without the exclusion, `computeUniqueBindings` sweeps
    // BOTH into the unique set, and the emitter strips the planner's literal
    // `elementIdVar=Event_1ma9skw` and re-seeds it — re-introducing the
    // broker-invalid synthetic value #172 fixed. The planner marks
    // `elementIdVar` on `scenario.modelDerivedLiteralBindings`; passing it as
    // the exclusion arg must drop ONLY that name, leaving `nameVar` unique.
    const plan: RequestStep[] = [
      step({
        operationId: 'createProcessInstance',
        declares409: true,
        bodyTemplate: {
          name: '${nameVar}',
          startInstructions: [{ elementId: '${elementIdVar}' }],
        },
      }),
    ];
    expect(computeUniqueBindings(plan)).toEqual(new Set(['nameVar', 'elementIdVar']));
    expect(computeUniqueBindings(plan, ['elementIdVar'])).toEqual(new Set(['nameVar']));
    // A Set exclusion arg is accepted identically to an array.
    expect(computeUniqueBindings(plan, new Set(['elementIdVar']))).toEqual(new Set(['nameVar']));
    // Excluding a name that was never unique is a no-op (never throws).
    expect(computeUniqueBindings(plan, ['notPresentVar'])).toEqual(
      new Set(['nameVar', 'elementIdVar']),
    );
  });
});
