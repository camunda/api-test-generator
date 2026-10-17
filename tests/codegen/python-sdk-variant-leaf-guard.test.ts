// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal `${var}` placeholders appear in test fixture data that mimics planner bodyTemplate strings.
import { describe, expect, test } from 'vitest';
import { renderPythonSuite } from '../../materializer/src/python-sdk/emitter.js';
import type {
  EndpointScenario,
  EndpointScenarioCollection,
  RequestStep,
} from '../../path-analyser/src/types.ts';

// A variant scenario exists to send one optional field (its "variant leaf",
// `populatesSubShape.leafPaths`). The planner writes that field into the final
// request body as a whole-string `${var}` placeholder bound by an earlier step.
// When no earlier step produced the value, the binding is None, `prune_nulls`
// drops the field, and the request no longer exercises what the test is named
// for — yet it still passes. The emitter must fail such a test instead.

const warmUp: RequestStep = {
  operationId: 'getJobErrorStatistics',
  method: 'POST',
  pathTemplate: '/jobs/statistics/errors',
  bodyKind: 'json',
  bodyTemplate: {},
  extract: [{ fieldPath: 'page.endCursor', bind: 'endCursorVar' }],
  expect: { status: 200 },
};

function finalStep(bodyTemplate: Record<string, unknown>): RequestStep {
  return { ...warmUp, extract: undefined, bodyTemplate };
}

function variantCollection(
  steps: RequestStep[],
  populatesSubShape: EndpointScenario['populatesSubShape'],
): EndpointScenarioCollection {
  const last = steps[steps.length - 1];
  const ref = { operationId: last.operationId, method: last.method, path: last.pathTemplate };
  return {
    endpoint: ref,
    requiredSemanticTypes: [],
    optionalSemanticTypes: [],
    scenarios: [
      {
        id: 'variant-1',
        name: 'cursor variant',
        strategy: 'optionalSubShapeVariant',
        populatesSubShape,
        operations: steps.map((s) => ({
          operationId: s.operationId,
          method: s.method,
          path: s.pathTemplate,
        })),
        producedSemanticTypes: [],
        satisfiedSemanticTypes: [],
        requestPlan: steps,
      },
    ],
  };
}

const GUARD_PREFIX = 'variant field unbound';

describe('python-sdk emitter: a variant fails when its own field is unbound', () => {
  test('guards the variant leaf binding immediately before the final request', () => {
    const out = renderPythonSuite(
      variantCollection([warmUp, finalStep({ page: { after: '${endCursorVar}' } })], {
        rootPath: 'page',
        leafPaths: ['page.after'],
        leafSemantics: ['EndCursor'],
      }),
    );
    const guard = "    assert ctx.get('endCursorVar') is not None, (";
    expect(out).toContain(guard);
    expect(out).toContain(GUARD_PREFIX);
    expect(out).toContain('page.after');
    const guardAt = out.indexOf(guard);
    expect(guardAt).toBeGreaterThan(out.indexOf('# Step 1:'));
    expect(guardAt).toBeLessThan(out.indexOf('# Step 2:'));
  });

  test('follows array segments in the leaf path', () => {
    const out = renderPythonSuite(
      variantCollection(
        [warmUp, finalStep({ filter: { $or: [{ incidentKey: '${incidentKeyVar}' }] } })],
        {
          rootPath: 'filter.$or[]',
          leafPaths: ['filter.$or[].incidentKey'],
          leafSemantics: ['IncidentKey'],
        },
      ),
    );
    expect(out).toContain("assert ctx.get('incidentKeyVar') is not None, (");
  });

  test('does not guard a leaf that carries a literal value (minted, never None)', () => {
    const out = renderPythonSuite(
      variantCollection([warmUp, finalStep({ tags: ['tag-abc'] })], {
        rootPath: '',
        leafPaths: ['tags[]'],
        leafSemantics: ['Tag'],
      }),
    );
    expect(out).not.toContain(GUARD_PREFIX);
  });

  test('does not guard ${RANDOM}, which always renders as a literal', () => {
    const out = renderPythonSuite(
      variantCollection([warmUp, finalStep({ name: '${RANDOM}' })], {
        rootPath: '',
        leafPaths: ['name'],
        leafSemantics: ['Name'],
      }),
    );
    expect(out).not.toContain(GUARD_PREFIX);
  });

  test('does not guard non-variant scenarios', () => {
    const collection = variantCollection(
      [warmUp, finalStep({ page: { after: '${endCursorVar}' } })],
      undefined,
    );
    expect(renderPythonSuite(collection)).not.toContain(GUARD_PREFIX);
  });
});
