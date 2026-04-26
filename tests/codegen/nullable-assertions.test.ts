import { describe, expect, test } from 'vitest';
import { renderPlaywrightSuite } from '../../path-analyser/src/codegen/playwright/emitter.ts';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.ts';

// Class-of-defect regression test for the nullable propagation bug.
//
// The original bug: nullable required fields in an OpenAPI response
// (`nullable: true`) were emitted with `expect(x).not.toBeNull()`, causing
// every test that received a legitimate `null` value to fail.
//
// Class scope: the test verifies that for ANY nullable required field
// (top-level, slice-inner, or array-item-inner) the emitter never emits
// `.not.toBeNull()` and instead emits a `if (acc !== null) { ... }` guard.
// A test that only covered one location would let the same defect class
// reappear in a different emission site.

const REQ_PLAN: RequestStep[] = [
  {
    operationId: 'getThing',
    method: 'GET',
    pathTemplate: '/things/{id}',
    pathParams: [],
    expect: { status: 200 },
  },
];

function makeCollection(field: {
  name: string;
  type: string;
  required: true;
  nullable: boolean;
}): EndpointScenarioCollection {
  return {
    endpoint: { operationId: 'getThing', method: 'GET', path: '/things/{id}' },
    requiredSemanticTypes: [],
    optionalSemanticTypes: [],
    scenarios: [
      {
        id: 'sc1',
        name: 'returns thing',
        operations: [{ operationId: 'getThing', method: 'GET', path: '/things/{id}' }],
        producedSemanticTypes: [],
        satisfiedSemanticTypes: [],
        responseShapeFields: [field],
        requestPlan: REQ_PLAN,
      },
    ],
  };
}

describe('nullable required field assertions (regression for #1)', () => {
  test('top-level nullable required field is guarded, never asserted .not.toBeNull()', () => {
    const suite = renderPlaywrightSuite(
      makeCollection({ name: 'endDate', type: 'string', required: true, nullable: true }),
      { suiteName: 'getThing', mode: 'feature' },
    );
    expect(suite).toContain('expect(json.endDate).not.toBeUndefined();');
    expect(suite).toContain('if (json.endDate !== null) {');
    expect(suite).not.toContain('expect(json.endDate).not.toBeNull();');
  });

  test('top-level NON-nullable required field still emits .not.toBeNull() (control)', () => {
    const suite = renderPlaywrightSuite(
      makeCollection({ name: 'id', type: 'string', required: true, nullable: false }),
      { suiteName: 'getThing', mode: 'feature' },
    );
    expect(suite).toContain('expect(json.id).not.toBeUndefined();');
    expect(suite).toContain('expect(json.id).not.toBeNull();');
    expect(suite).not.toContain('if (json.id !== null) {');
  });

  test('slice inner nullable required field is guarded, never asserted .not.toBeNull()', () => {
    const collection: EndpointScenarioCollection = {
      endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'deploy',
          operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          responseShapeFields: [
            { name: 'deployments', type: 'array', required: true, nullable: false },
          ],
          responseNestedSlices: {
            processDefinition: [
              { name: 'tenantId', type: 'string', required: true, nullable: true },
            ],
          },
          requestPlan: [
            {
              operationId: 'createDeployment',
              method: 'POST',
              pathTemplate: '/deployments',
              expect: { status: 200 },
              expectedDeploymentSlices: ['processDefinition'],
            },
          ],
        },
      ],
    };
    const suite = renderPlaywrightSuite(collection, {
      suiteName: 'createDeployment',
      mode: 'feature',
    });
    expect(suite).toContain('if (json.deployments[0].processDefinition.tenantId !== null) {');
    expect(suite).not.toContain(
      'expect(json.deployments[0].processDefinition.tenantId).not.toBeNull();',
    );
  });

  test('array-item inner nullable required field is guarded, never asserted .not.toBeNull()', () => {
    const collection: EndpointScenarioCollection = {
      endpoint: { operationId: 'searchItems', method: 'POST', path: '/items/search' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'search',
          operations: [{ operationId: 'searchItems', method: 'POST', path: '/items/search' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          responseShapeFields: [{ name: 'items', type: 'array', required: true, nullable: false }],
          responseArrayItemFields: {
            items: [{ name: 'endDate', type: 'string', required: true, nullable: true }],
          },
          requestPlan: [
            {
              operationId: 'searchItems',
              method: 'POST',
              pathTemplate: '/items/search',
              expect: { status: 200 },
            },
          ],
        },
      ],
    };
    const suite = renderPlaywrightSuite(collection, {
      suiteName: 'searchItems',
      mode: 'feature',
    });
    expect(suite).toContain('if (json.items[0].endDate !== null) {');
    expect(suite).not.toContain('expect(json.items[0].endDate).not.toBeNull();');
  });

  // Class-scoped invariant over the real generated corpus: across all
  // generated tests, no `.not.toBeNull()` assertion targets a path that
  // is ALSO guarded with `if (... !== null)` elsewhere in the same file.
  // (If the emitter regressed and started emitting both for the same path,
  // this would catch it without us having to enumerate every nullable field.)
  test('no generated test contains both .not.toBeNull() AND if(... !== null) for the same path', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve('path-analyser/dist/generated-tests');
    if (!fs.existsSync(dir)) {
      throw new Error(
        `Missing generated test artifacts at ${dir}. Generate the path-analyser pipeline outputs (e.g. \`npm run snapshot:regenerate\`) before running this invariant test.`,
      );
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.spec.ts'));
    const offenders: { file: string; path: string }[] = [];
    const guardRe = /if \((json[A-Za-z0-9_.[\]]+) !== null\) \{/g;
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      const matches = content.matchAll(guardRe);
      for (const m of matches) {
        const guarded = m[1];
        if (content.includes(`expect(${guarded}).not.toBeNull();`)) {
          offenders.push({ file: f, path: guarded });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
