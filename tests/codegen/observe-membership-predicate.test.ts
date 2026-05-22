/**
 * Unit tests for the EdgeLifecycle observe-membership step's
 * `awaitEventually` predicate.
 *
 * # Defect class pinned here
 *
 * For an EC observe-membership step, the emitter wraps the search call
 * in `awaitEventually(...)` but does NOT pass a custom `predicate:`.
 * The runtime then falls back to the default predicate for POST /search
 * (`isNonEmptyItemsPage` — `items.length > 0`). That default is wrong
 * for BOTH directions of the membership assertion:
 *
 *   - `expect: 'present'` — the default treats any non-empty page as
 *     "consistent", regardless of whether the target binding value is
 *     actually in the page. The membership assertion that runs after
 *     can fail intermittently when the indexer has surfaced *some*
 *     items but not yet the one the test cares about.
 *
 *   - `expect: 'absent'` — the default keeps polling until the page is
 *     non-empty. After a `revoke` (e.g. unassignUserFromTenant) the
 *     tenant may have zero remaining users, so `items` stays `[]` and
 *     `awaitEventually` exhausts the budget and throws
 *     `EventualConsistencyTimeoutError` — even though the deletion
 *     succeeded and the absent assertion would have passed on the very
 *     first attempt. This is the failure mode observed in PR #343's
 *     follow-up on TenantUserMembership.lifecycle.spec.ts.
 *
 * The fix is for `appendObserveMembershipStep` to emit a polarity-aware
 * predicate over the parsed body, walking the planner-declared
 * `arrayPath` → `elementField` chain and asserting (in)membership of
 * `ctx[<bindingName>]` to match the step's `expect` direction. The
 * outer membership assertion remains the source of truth; the
 * predicate's only job is to drive eventual-consistency polling
 * toward the same observable state.
 *
 * # Class scope
 *
 * Both tests below run `emitTemplateSuites` against a tiny synthesised
 * scenario file so they exercise the production emitter end-to-end —
 * not a unit slice of a render helper. The first asserts the
 * present-observe predicate; the second asserts the absent-observe
 * predicate. Both must reference `ctx['usernameVar']` and must encode
 * the correct polarity. A regression on either branch (predicate
 * missing, polarity flipped, ctx binding name wrong) fails the
 * corresponding test.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emitTemplateSuites } from '../../materializer/src/playwright/templateEmitter.ts';

const SCENARIO: unknown = {
  templateName: 'EdgeLifecycle',
  subjectName: 'TenantUserMembership',
  subjectKind: 'Edge',
  scenario: {
    templateName: 'EdgeLifecycle',
    subjectName: 'TenantUserMembership',
    subjectKind: 'Edge',
    steps: [
      {
        kind: 'prereqChain',
        targetOperationId: 'assignUserToTenant',
        operations: [],
        bindings: { tenantIdVar: 'tenant_x', usernameVar: 'user_x' },
        seedBindings: [],
        requestPlan: [],
      },
      {
        kind: 'invoke',
        operationId: 'assignUserToTenant',
        inputs: { TenantId: 'tenantIdVar', Username: 'usernameVar' },
        produces: {},
        requestPlan: {
          operationId: 'assignUserToTenant',
          method: 'PUT',
          pathTemplate: '/tenants/{tenantId}/users/{username}',
          expect: { status: 204 },
        },
      },
      {
        kind: 'observe',
        operationId: 'searchUsersForTenant',
        inputs: { TenantId: 'tenantIdVar' },
        requestPlan: {
          operationId: 'searchUsersForTenant',
          method: 'POST',
          pathTemplate: '/tenants/{tenantId}/users/search',
          expect: { status: 200 },
          bodyTemplate: {},
          bodyKind: 'json',
        },
        assertion: {
          kind: 'membership',
          expect: 'present',
          arrayPath: ['items'],
          elementField: 'username',
          membershipSemanticType: 'Username',
        },
      },
      {
        kind: 'invoke',
        operationId: 'unassignUserFromTenant',
        inputs: { TenantId: 'tenantIdVar', Username: 'usernameVar' },
        produces: {},
        requestPlan: {
          operationId: 'unassignUserFromTenant',
          method: 'DELETE',
          pathTemplate: '/tenants/{tenantId}/users/{username}',
          expect: { status: 204 },
        },
      },
      {
        kind: 'observe',
        operationId: 'searchUsersForTenant',
        inputs: { TenantId: 'tenantIdVar' },
        requestPlan: {
          operationId: 'searchUsersForTenant',
          method: 'POST',
          pathTemplate: '/tenants/{tenantId}/users/search',
          expect: { status: 200 },
          bodyTemplate: {},
          bodyKind: 'json',
        },
        assertion: {
          kind: 'membership',
          expect: 'absent',
          arrayPath: ['items'],
          elementField: 'username',
          membershipSemanticType: 'Username',
        },
      },
    ],
    bindings: { TenantId: 'tenantIdVar', Username: 'usernameVar' },
    eventuallyConsistentOps: ['searchUsersForTenant'],
  },
};

let tempDir: string;
let suiteSource: string;

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(tmpdir(), 'observe-membership-pred-'));
  const scenariosDir = path.join(tempDir, 'scenarios');
  const outDir = path.join(tempDir, 'out');
  await fs.mkdir(scenariosDir, { recursive: true });
  await fs.writeFile(
    path.join(scenariosDir, 'TenantUserMembership.json'),
    JSON.stringify(SCENARIO),
    'utf8',
  );
  await emitTemplateSuites({
    scenariosDir,
    outDir,
    globalContextSeeds: [],
  });
  suiteSource = await fs.readFile(
    path.join(outDir, 'TenantUserMembership.lifecycle.spec.ts'),
    'utf8',
  );
});

afterAll(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

/**
 * Slice the emitted spec into the two observe-step bodies so each
 * assertion only inspects the section it cares about. The label-based
 * split is robust to formatting changes elsewhere in the file.
 */
function sliceStep(label: string): string {
  const start = suiteSource.indexOf(`await test.step('${label}'`);
  expect(
    start,
    `expected to find a test.step labelled '${label}' in emitted suite`,
  ).toBeGreaterThanOrEqual(0);
  const after = suiteSource.indexOf("await test.step('", start + 1);
  return suiteSource.slice(start, after === -1 ? undefined : after);
}

describe('observe-membership predicate (#342 follow-up)', () => {
  it('emits a present-polarity predicate that requires the binding value to be in the items page', () => {
    const block = sliceStep('observe (present)');
    // Predicate must be present (otherwise the default `items.length > 0`
    // fires, which can race the indexer surfacing the specific entity
    // the test cares about).
    expect(block).toMatch(/predicate:\s*\(body\)\s*=>/);
    // Predicate must reference the membership binding via ctx.
    expect(block).toContain("ctx['usernameVar']");
    // Polarity: present → predicate returns true when value IS in items.
    expect(block).toMatch(/\.includes\(\s*ctx\['usernameVar'\]\s*\)/);
    // Negation absent for the present case.
    expect(block).not.toMatch(/!\s*[A-Za-z_]\w*\.includes\(\s*ctx\['usernameVar'\]\s*\)/);
  });

  it('emits an absent-polarity predicate that requires the binding value to be missing from the items page', () => {
    const block = sliceStep('observe (absent)');
    expect(block).toMatch(/predicate:\s*\(body\)\s*=>/);
    expect(block).toContain("ctx['usernameVar']");
    // Polarity: absent → predicate returns true when value is NOT in items.
    expect(block).toMatch(/!\s*[A-Za-z_]\w*\.includes\(\s*ctx\['usernameVar'\]\s*\)/);
  });
});
