/**
 * Lifecycle suites call `validateResponse` for a step whose route has a response schema, like the
 * per-endpoint feature specs do, and for no other step.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  emitTemplateSuites,
  responseRouteKey,
} from '../../materializer/src/playwright/templateEmitter.ts';

const SCENARIO: unknown = {
  templateName: 'EdgeLifecycle',
  subjectName: 'WidgetMembership',
  subjectKind: 'Edge',
  scenario: {
    templateName: 'EdgeLifecycle',
    subjectName: 'WidgetMembership',
    subjectKind: 'Edge',
    steps: [
      {
        kind: 'prereqChain',
        targetOperationId: 'addWidget',
        operations: [],
        bindings: { widgetVar: 'w' },
        seedBindings: [],
        requestPlan: [],
      },
      {
        kind: 'invoke',
        operationId: 'addWidget',
        inputs: {},
        produces: {},
        requestPlan: {
          operationId: 'addWidget',
          method: 'POST',
          pathTemplate: '/widgets',
          expect: { status: 200 },
          bodyTemplate: {},
          bodyKind: 'json',
        },
      },
      {
        kind: 'observe',
        operationId: 'searchWidgets',
        inputs: {},
        requestPlan: {
          operationId: 'searchWidgets',
          method: 'POST',
          pathTemplate: '/widgets/search',
          expect: { status: 200 },
          bodyTemplate: {},
          bodyKind: 'json',
        },
        assertion: {
          kind: 'membership',
          expect: 'present',
          arrayPath: ['items'],
          elementField: 'name',
          membershipSemanticType: 'Widget',
        },
      },
      {
        kind: 'invoke',
        operationId: 'removeWidget',
        inputs: {},
        produces: {},
        requestPlan: {
          operationId: 'removeWidget',
          method: 'DELETE',
          pathTemplate: '/widgets/{id}',
          expect: { status: 204 },
        },
      },
      {
        kind: 'observe',
        operationId: 'searchWidgets',
        inputs: {},
        requestPlan: {
          operationId: 'searchWidgets',
          method: 'POST',
          pathTemplate: '/widgets/search',
          expect: { status: 200 },
          bodyTemplate: {},
          bodyKind: 'json',
        },
        assertion: {
          kind: 'membership',
          expect: 'absent',
          arrayPath: ['items'],
          elementField: 'name',
          membershipSemanticType: 'Widget',
        },
      },
    ],
    bindings: { Widget: 'widgetVar' },
    eventuallyConsistentOps: [],
  },
};

let tempDir: string;
let n = 0;

async function emit(validatedRoutes?: ReadonlySet<string>): Promise<string> {
  const scenariosDir = path.join(tempDir, `scenarios${n}`);
  const outDir = path.join(tempDir, `out${n++}`);
  await fs.mkdir(scenariosDir, { recursive: true });
  await fs.writeFile(path.join(scenariosDir, 'W.json'), JSON.stringify(SCENARIO), 'utf8');
  await emitTemplateSuites({ scenariosDir, outDir, globalContextSeeds: [], validatedRoutes });
  return fs.readFile(path.join(outDir, 'WidgetMembership.lifecycle.spec.ts'), 'utf8');
}

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(tmpdir(), 'lifecycle-validate-'));
});
afterAll(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

const count = (s: string) => s.split('await validateResponse(').length - 1;

describe('lifecycle response validation', () => {
  it('validates the steps whose route has a schema and adds the import and schema path', async () => {
    const src = await emit(
      new Set([
        responseRouteKey('POST', '/widgets', 200),
        responseRouteKey('POST', '/widgets/search', 200),
      ]),
    );
    // addWidget, the present observe and the absent observe (all 200); the 204 delete is skipped.
    expect(count(src)).toBe(3);
    expect(src).toContain("import { validateResponse } from 'assert-json-body';");
    expect(src).toContain('../../json-body-assertions/responses.json');
    expect(src).toMatch(/path: "\/widgets", method: "POST", status: "200"/);
  });

  it('skips a route that has no schema, and a route with a different method or status', async () => {
    const src = await emit(
      new Set([
        responseRouteKey('POST', '/widgets/search', 200),
        responseRouteKey('GET', '/widgets', 200),
        responseRouteKey('DELETE', '/widgets/{id}', 200),
      ]),
    );
    expect(count(src)).toBe(2);
    expect(src).not.toMatch(/path: "\/widgets", method/);
    expect(src).not.toMatch(/method: "DELETE", status/);
  });

  it('validates nothing and imports nothing without routes, and does not leak between calls', async () => {
    await emit(new Set([responseRouteKey('POST', '/widgets', 200)]));
    const src = await emit();
    expect(count(src)).toBe(0);
    expect(src).not.toContain('assert-json-body');
    expect(src).not.toContain('__responsesFile');
  });
});
