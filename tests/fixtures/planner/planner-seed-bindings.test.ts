/**
 * Planner contract fixtures — seedBindings (camunda/api-test-generator#136).
 *
 * The planner is the authority on which scenario bindings need a runtime
 * `seedBinding(name)` call before step 0. Emitters consume
 * `scenario.seedBindings` verbatim. These fixtures pin the contract on
 * synthetic `EndpointScenario` shapes so the planner-side answer is
 * tested independently of any specific emitter.
 *
 * Class-scoped invariant guarded here: every binding read by some step
 * S of the request plan whose value is not a literal in
 * `scenario.bindings` and is not produced by an extract on a strictly
 * earlier step must appear in `scenario.seedBindings`. The defect class
 * #136 reproduces is exactly this property failing for the establisher's
 * own base scenario, where the body input is also extracted from the
 * response of the same step.
 */
import { describe, expect, it } from 'vitest';
import { computeSeedBindings } from '../../../path-analyser/src/seedBindings.ts';
import type { EndpointScenario } from '../../../path-analyser/src/types.ts';

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

describe('computeSeedBindings (#136)', () => {
  describe("establisher's own base scenario echoes input in response", () => {
    it('lists the body-input binding even when the same step extracts it', () => {
      // Mirrors createUser: body sends `username: ${usernameVar}`, and
      // the same step extracts `username` from the response into
      // `usernameVar`. Pre-#136 the Playwright emitter dropped the
      // seedBinding line on the assumption that the extract would
      // supply the value — but the extract runs AFTER the request
      // body is built, so without a seed the body sends `undefined`.
      const scenario = scenarioOf({
        bindings: { usernameVar: '__PENDING__' },
        requestPlan: [
          {
            operationId: 'createUser',
            method: 'POST',
            pathTemplate: '/v2/users',
            expect: { status: 201 },
            bodyKind: 'json',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional fixture data — these are template placeholder strings
            bodyTemplate: { username: '${usernameVar}', password: '${passwordVar}' },
            extract: [{ fieldPath: 'username', bind: 'usernameVar', semantic: 'Username' }],
          },
        ],
      });
      const seeds = computeSeedBindings(scenario);
      expect(seeds).toContain('usernameVar');
      // Class-scoped: passwordVar (PENDING, not extracted) must also be
      // listed. Without this assertion a fix that only special-cased
      // "extracted-and-input on the same step" would still leave a
      // hole for unrelated PENDING body inputs.
      expect(seeds).toContain('passwordVar');
    });
  });

  describe('chained producer + consumer', () => {
    it('omits a binding extracted by an earlier step', () => {
      // createUser (step 0) extracts usernameVar from its response;
      // getUser (step 1) reads `${usernameVar}` from its path. The
      // consumer step does not need a runtime seed because the producer
      // step supplies the value before the consumer runs. The producer
      // itself still needs the binding seeded at scenario start
      // because step 0's body is built before step 0's extract runs.
      const scenario = scenarioOf({
        bindings: { usernameVar: '__PENDING__' },
        requestPlan: [
          {
            operationId: 'createUser',
            method: 'POST',
            pathTemplate: '/v2/users',
            expect: { status: 201 },
            bodyKind: 'json',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional fixture data — these are template placeholder strings
            bodyTemplate: { username: '${usernameVar}' },
            extract: [{ fieldPath: 'username', bind: 'usernameVar' }],
          },
          {
            operationId: 'getUser',
            method: 'GET',
            pathTemplate: '/v2/users/{username}',
            expect: { status: 200 },
          },
        ],
      });
      const seeds = computeSeedBindings(scenario);
      // Step 0 reads usernameVar; nothing extracts it before step 0
      // runs, so it must be seeded.
      expect(seeds).toEqual(['usernameVar']);
    });
  });

  describe('literal binding values', () => {
    it('omits bindings whose value is a non-PENDING literal', () => {
      // Establisher chained as a producer mints a deterministic value
      // into bindings (scenarioGenerator.ts:867-952), so the binding
      // is a literal string, not __PENDING__. Emitters render this as
      // `ctx['k'] = "<value>";` directly — no seedBinding() call.
      const scenario = scenarioOf({
        bindings: { tenantIdVar: 'tenant-abc123', usernameVar: '__PENDING__' },
        requestPlan: [
          {
            operationId: 'createUser',
            method: 'POST',
            pathTemplate: '/v2/users',
            expect: { status: 201 },
            bodyKind: 'json',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional fixture data — these are template placeholder strings
            bodyTemplate: { username: '${usernameVar}', tenantId: '${tenantIdVar}' },
          },
        ],
      });
      expect(computeSeedBindings(scenario)).toEqual(['usernameVar']);
    });
  });

  describe('path placeholders', () => {
    it('lists placeholder-derived var names that no step extracts', () => {
      // pathTemplate `/v2/users/{userKey}` is rendered as
      // `ctx.userKeyVar` by the URL emitter. If no producer step
      // extracts userKeyVar, it must be seeded at scenario start —
      // otherwise the URL contains a literal `${userKey}` that the
      // broker rejects.
      const scenario = scenarioOf({
        bindings: { userKeyVar: '__PENDING__' },
        requestPlan: [
          {
            operationId: 'getUser',
            method: 'GET',
            pathTemplate: '/v2/users/{userKey}',
            expect: { status: 200 },
          },
        ],
      });
      expect(computeSeedBindings(scenario)).toEqual(['userKeyVar']);
    });
  });

  describe('multipart templates', () => {
    it('treats multipart fields the same as JSON body fields', () => {
      const scenario = scenarioOf({
        bindings: { fileNameVar: '__PENDING__' },
        requestPlan: [
          {
            operationId: 'createDocument',
            method: 'POST',
            pathTemplate: '/v2/documents',
            expect: { status: 201 },
            bodyKind: 'multipart',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional fixture data — these are template placeholder strings
            multipartTemplate: { fileName: '${fileNameVar}' },
          },
        ],
      });
      expect(computeSeedBindings(scenario)).toEqual(['fileNameVar']);
    });
  });

  describe('first-read order is preserved', () => {
    it('orders entries by first appearance across the plan', () => {
      const scenario = scenarioOf({
        bindings: {
          aVar: '__PENDING__',
          bVar: '__PENDING__',
          cVar: '__PENDING__',
        },
        requestPlan: [
          {
            operationId: 'op1',
            method: 'POST',
            pathTemplate: '/x',
            expect: { status: 201 },
            bodyKind: 'json',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional fixture data — these are template placeholder strings
            bodyTemplate: { b: '${bVar}', a: '${aVar}' },
          },
          {
            operationId: 'op2',
            method: 'POST',
            pathTemplate: '/y',
            expect: { status: 201 },
            bodyKind: 'json',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional fixture data — these are template placeholder strings
            bodyTemplate: { c: '${cVar}', a: '${aVar}' },
          },
        ],
      });
      // Object.values iterates in insertion order, so op1 reads bVar
      // before aVar; op2 introduces cVar. aVar must not be re-listed.
      expect(computeSeedBindings(scenario)).toEqual(['bVar', 'aVar', 'cVar']);
    });
  });

  describe('absent / empty plan', () => {
    it('returns [] when there is no request plan', () => {
      expect(computeSeedBindings(scenarioOf({}))).toEqual([]);
    });
    it('returns [] when the plan is empty', () => {
      expect(computeSeedBindings(scenarioOf({ requestPlan: [] }))).toEqual([]);
    });
  });
});
