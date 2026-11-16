import { describe, expect, it } from 'vitest';
import type { CanonicalShape } from '../../../path-analyser/src/index.ts';
import { buildRequestPlan } from '../../../path-analyser/src/index.ts';
import type {
  EndpointScenario,
  OperationGraph,
  OperationNode,
  RequestOneOfGroupSummary,
  RequestStep,
  ResponseShapeSummary,
} from '../../../path-analyser/src/types.ts';

/**
 * Layer-2 planner fixture for the position-based final step (fdf2766).
 *
 * `buildRequestPlan` decides per-step behaviour from an `isFinal` flag. It
 * used to derive that flag by IDENTITY:
 *
 *     const lastOpId = scenario.operations[scenario.operations.length - 1].operationId;
 *     for (const opRef of scenario.operations) {
 *       const isFinal = opRef.operationId === lastOpId;   // ← matches EVERY occurrence
 *
 * When the same operationId appears more than once in a chain, that comparison
 * is true for every occurrence, so each one was treated as the final step.
 * fdf2766 replaced it with a POSITION test (`opIndex === length - 1`).
 *
 * This is not a hypothetical: 106 scenarios in the current camunda-oca output
 * repeat an operationId in their requestPlan — 105 of the 387 variant scenarios
 * (most cursor variants call the same search operation twice: once to warm the
 * page, once as the endpoint) plus the migration feature chain
 * `createDeployment > createDeployment > createProcessInstance >
 * migrateProcessInstance`.
 *
 * Each `it` below pins one consequence of the flag, so a regression names the
 * exact behaviour that broke instead of surfacing as hundreds of changed
 * generated files. Every assertion here is sensitive to the identity-vs-position
 * distinction: under the old code BOTH occurrences were final, so the plan had
 * four steps, both bodies were the endpoint variant, both statuses were the
 * error code, the producer extracts were missing, and the replay step was
 * duplicated.
 */

const OP = 'opA';

/**
 * A minimal graph whose single operation both produces a semantic type on its
 * response (driving the producer-extract block, which only runs on NON-final
 * steps) and declares a oneOf request group (driving the endpoint-vs-prereq
 * body choice, which `buildRequestBodyFromCanonical` keys off `isFinal`).
 */
function makeGraph(): OperationGraph {
  const node: OperationNode = {
    operationId: OP,
    method: 'POST',
    path: `/${OP}`,
    requires: { required: [], optional: [] },
    produces: [],
    // Read by the `!isFinal` producer-extract block, keyed by the operation's
    // success status (`successStatusByOp[OP]` below).
    responseSemanticTypes: {
      '200': [{ semanticType: 'ThingKey', fieldPath: 'thingKey' }],
    },
  };
  return {
    operations: { [OP]: node },
    producersByType: {},
  };
}

/**
 * The endpoint's response shape. Read by the `isFinal && resp?.fields?.length`
 * block, which emits a semantic extract for every annotated field — the
 * final-step counterpart of the producer-extract block.
 */
function makeResponseShape(): ResponseShapeSummary {
  return {
    operationId: OP,
    contentTypes: ['application/json'],
    fields: [{ name: 'finalKey', type: 'string', semantic: 'FinalKey' }],
    successStatus: 200,
  };
}

/**
 * Two oneOf variants with disjoint required fields. The endpoint (final) step
 * selects the variant named by `scenario.requestVariants`; a prerequisite
 * (non-final) step ignores that and prefers a variant whose required field
 * looks like a key (`/Key$/`). The two therefore emit different bodies, which
 * is what makes "only the last occurrence gets the final body" observable.
 */
function makeRequestGroups(): Record<string, RequestOneOfGroupSummary[]> {
  return {
    [OP]: [
      {
        operationId: OP,
        groupId: 'g1',
        unionFields: ['alphaKey', 'betaName'],
        variants: [
          {
            groupId: 'g1',
            variantName: 'v-alpha',
            required: ['alphaKey'],
            optional: [],
            fieldTypes: { alphaKey: 'string' },
          },
          {
            groupId: 'g1',
            variantName: 'v-beta',
            required: ['betaName'],
            optional: [],
            fieldTypes: { betaName: 'string' },
          },
        ],
      },
    ],
  };
}

function makeCanonical(): Record<string, CanonicalShape> {
  // An empty node list is enough: the oneOf branch synthesises from the chosen
  // variant's `required`, not from canonical nodes.
  return { [OP]: { requestByMediaType: { 'application/json': [] } } };
}

/** The scenario under test: `opA` appears twice, and is also the endpoint. */
function makeScenario(): EndpointScenario {
  return {
    id: 'fixture-1',
    operations: [
      { operationId: OP, method: 'POST', path: `/${OP}` },
      { operationId: OP, method: 'POST', path: `/${OP}` },
    ],
    producedSemanticTypes: [],
    satisfiedSemanticTypes: [],
    // A conflict replay: the documented shape for a duplicateTest scenario is
    // `expectedResult.kind === 'error'` with the conflict code, which
    // `determineExpectedStatus` applies to the FINAL step only.
    expectedResult: { kind: 'error', code: '409' },
    duplicateTest: { mode: 'conflict', policy: 'conflict' },
    requestVariants: [{ groupId: 'g1', variant: 'v-beta', richness: 'minimal' }],
  };
}

function plan() {
  return buildRequestPlan(
    makeScenario(),
    makeResponseShape(),
    makeGraph(),
    makeCanonical(),
    makeRequestGroups(),
    // The operation's own declared success status. `determineExpectedStatus`
    // prefers it for every step, so a non-final step expects 200 while the
    // final step takes the scenario's error code instead. It also keys the
    // producer-extract lookup (`responseSemanticTypes[String(stepSuccess)]`).
    { [OP]: 200 },
  );
}

function binds(step: RequestStep | undefined): string[] {
  return (step?.extract ?? []).map((e) => e.bind);
}

/** Narrows `bodyTemplate` (typed `unknown`) without a type assertion. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bodyKeys(step: RequestStep | undefined): string[] {
  const body = step?.bodyTemplate;
  return isRecord(body) ? Object.keys(body) : [];
}

describe('buildRequestPlan: the final step is chosen by position, not by operationId', () => {
  it('emits one step per operation plus a single duplicateTest replay step', () => {
    const steps = plan();
    // Two occurrences + exactly one replay. Under the identity comparison both
    // occurrences were final, so each appended a replay and the plan had four.
    expect(steps.map((s) => s.operationId)).toEqual([OP, OP, OP]);
    const replays = steps.filter((s) => s.notes?.includes('duplicate-invocation'));
    expect(replays).toHaveLength(1);
  });

  it('appends the duplicateTest replay step after the LAST occurrence only', () => {
    const steps = plan();
    const replay = steps[2];
    expect(replay?.notes).toContain('duplicate-invocation');
    expect(replay?.expect.status).toBe(409);
    // The replay is a copy of the final step, so it carries the final body.
    expect(bodyKeys(replay)).toEqual(['betaName']);
  });

  it('gives the earlier occurrence the producer extracts, and withholds the final-step extracts', () => {
    const steps = plan();
    // Producer extracts come from `responseSemanticTypes` and are emitted only
    // on NON-final steps. The earlier occurrence must carry them.
    expect(binds(steps[0])).toContain('thingKeyVar');
    // Final-step extracts come from the endpoint response shape and are emitted
    // only on the FINAL step, so the earlier occurrence must not carry them.
    expect(binds(steps[0])).not.toContain('finalKeyVar');
  });

  it('gives only the last occurrence the final-step extracts', () => {
    const steps = plan();
    expect(binds(steps[1])).toContain('finalKeyVar');
    // …and it is final, so it no longer runs the producer-extract block.
    expect(binds(steps[1])).not.toContain('thingKeyVar');
    // Exactly one of the two occurrences may carry the endpoint response
    // extract. Under the identity comparison both were final, so both did
    // (and each also grew a replay step, shifting this one off the plan).
    const withFinalExtract = steps.slice(0, 2).filter((s) => binds(s).includes('finalKeyVar'));
    expect(withFinalExtract).toHaveLength(1);
  });

  it('applies the final-step expected status to the last occurrence only', () => {
    const steps = plan();
    expect(steps[0]?.expect.status).toBe(200);
    expect(steps[1]?.expect.status).toBe(409);
  });

  it('builds the endpoint (final) body for the last occurrence only', () => {
    const steps = plan();
    // A prerequisite step ignores `requestVariants` and prefers the key-shaped
    // variant; the endpoint step honours the scenario's selected variant.
    expect(bodyKeys(steps[0])).toEqual(['alphaKey']);
    expect(bodyKeys(steps[1])).toEqual(['betaName']);
  });
});
