import { describe, expect, test } from 'vitest';
import { renderPlaywrightSuite } from '../../path-analyser/src/codegen/playwright/emitter.ts';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.ts';

// Class-of-defect regression test for response shape assertion verbosity.
//
// Previously, response field assertions were emitted as verbose per-field
// expect() calls. They have been replaced with a single validateResponse()
// call from assert-json-body which validates the full JSON body against the
// OpenAPI spec, covering required fields, types, and nullable semantics.
//
// Class scope: the test verifies that for ANY scenario with a response shape
// (top-level, slices, or array-item fields) the emitter emits validateResponse
// and never emits the old per-field patterns (not.toBeNull, not.toBeUndefined,
// typeof checks, etc.).

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

describe('response shape assertions use validateResponse (replaces verbose per-field checks)', () => {
  test('required nullable field emits validateResponse, not per-field assertions', () => {
    const suite = renderPlaywrightSuite(
      makeCollection({ name: 'endDate', type: 'string', required: true, nullable: true }),
      { suiteName: 'getThing', mode: 'feature' },
    );
    expect(suite).toContain("import { validateResponse } from 'assert-json-body';");
    expect(suite).toContain('await validateResponse(');
    expect(suite).toContain('path: "/things/{id}"');
    expect(suite).not.toContain('expect(json.endDate).not.toBeUndefined();');
    expect(suite).not.toContain('expect(json.endDate).not.toBeNull();');
    expect(suite).not.toContain('if (json.endDate !== null) {');
  });

  test('required non-nullable field emits validateResponse, not per-field assertions', () => {
    const suite = renderPlaywrightSuite(
      makeCollection({ name: 'id', type: 'string', required: true, nullable: false }),
      { suiteName: 'getThing', mode: 'feature' },
    );
    expect(suite).toContain("import { validateResponse } from 'assert-json-body';");
    expect(suite).toContain('await validateResponse(');
    expect(suite).not.toContain('expect(json.id).not.toBeUndefined();');
    expect(suite).not.toContain('expect(json.id).not.toBeNull();');
  });

  test('validateResponse includes path, method, status and responsesFilePath', () => {
    const suite = renderPlaywrightSuite(
      makeCollection({ name: 'id', type: 'string', required: true, nullable: false }),
      { suiteName: 'getThing', mode: 'feature' },
    );
    expect(suite).toContain('path: "/things/{id}"');
    expect(suite).toContain("method: 'GET'");
    expect(suite).toContain("status: '200'");
    expect(suite).toContain('responsesFilePath: __responsesFile');
  });

  test('__responsesFile constant is emitted once per suite file', () => {
    const suite = renderPlaywrightSuite(
      makeCollection({ name: 'id', type: 'string', required: true, nullable: false }),
      { suiteName: 'getThing', mode: 'feature' },
    );
    expect(suite).toContain(
      "const __responsesFile = import.meta.dirname + '/json-body-assertions/responses.json';",
    );
    // Should appear exactly once
    const count = (suite.match(/__responsesFile\s*=/g) || []).length;
    expect(count).toBe(1);
  });

  test('slice scenario emits validateResponse, not per-field assertions', () => {
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
    expect(suite).toContain('await validateResponse(');
    expect(suite).not.toContain(
      'expect(json.deployments[0].processDefinition.tenantId).not.toBeNull();',
    );
    expect(suite).not.toContain('if (json.deployments[0].processDefinition.tenantId !== null) {');
  });

  test('array-item scenario emits validateResponse, not per-field assertions', () => {
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
    expect(suite).toContain('await validateResponse(');
    expect(suite).not.toContain('if (json.items[0].endDate !== null) {');
    expect(suite).not.toContain('expect(json.items[0].endDate).not.toBeNull();');
  });

  test('error scenario does NOT emit validateResponse', () => {
    const collection: EndpointScenarioCollection = {
      endpoint: { operationId: 'getThing', method: 'GET', path: '/things/{id}' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'not found',
          operations: [{ operationId: 'getThing', method: 'GET', path: '/things/{id}' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          responseShapeFields: [{ name: 'id', type: 'string', required: true, nullable: false }],
          expectedResult: { kind: 'error' },
          requestPlan: [
            {
              operationId: 'getThing',
              method: 'GET',
              pathTemplate: '/things/{id}',
              pathParams: [],
              expect: { status: 404 },
            },
          ],
        },
      ],
    };
    const suite = renderPlaywrightSuite(collection, { suiteName: 'getThing', mode: 'feature' });
    expect(suite).not.toContain('await validateResponse(');
  });

  // Class-scoped invariant over the real generated corpus: no generated spec
  // file contains the old verbose per-field assertion patterns.
  test('no generated test file contains old per-field assertion patterns', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve('path-analyser/dist/generated-tests');
    if (!fs.existsSync(dir)) {
      throw new Error(
        `Missing generated test artifacts at ${dir}. Run \`npm run testsuite:generate\` before running this invariant test.`,
      );
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.spec.ts'));
    const offenders: { file: string; pattern: string }[] = [];
    const forbidden = [
      /\.not\.toBeNull\(\)/,
      /\.not\.toBeUndefined\(\)/,
      /expect\(typeof json\./,
      /expect\(Number\.isInteger\(/,
      /expect\(Array\.isArray\(json\./,
      /if \(json[A-Za-z0-9_.[\]]+ !== null\) \{/,
    ];
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const re of forbidden) {
        if (re.test(content)) {
          offenders.push({ file: f, pattern: re.source });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
