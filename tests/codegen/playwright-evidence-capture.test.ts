import { describe, expect, test } from 'vitest';
import { attachEvidenceOnFailure } from '../../materializer/src/playwright/support/evidence.ts';
import { PlaywrightEmitter } from '../../materializer/src/playwright/emitter.ts';
import type { EndpointScenarioCollection } from '../../path-analyser/src/types.ts';

// Class-scoped guard (#527/#528): evidence capture is cross-cutting codegen
// behavior — a future refactor to emitter.ts/stepRenderer.ts/templateEmitter.ts
// could silently drop the import or the attachEvidenceOnFailure() call while
// every other existing test stays green. These assertions pin both halves
// (emitted import + emitted call) so that regression fails loudly here.

function ctxBase() {
  return {
    outDir: '/unused',
    suiteName: 'createWidget',
    mode: 'feature' as const,
    configName: 'test',
    resolveConfigPath: (rel: string) => `/unused/${rel}`,
  };
}

const COLLECTION_INLINE_STEP: EndpointScenarioCollection = {
  endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      requestPlan: [
        {
          operationId: 'createWidget',
          method: 'POST',
          pathTemplate: '/widgets',
          expect: { status: 200 },
          bodyKind: 'json',
          bodyTemplate: { name: 'static' },
        },
      ],
    },
  ],
};

const COLLECTION_WITH_SHAPE_VALIDATION: EndpointScenarioCollection = {
  endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
  requiredSemanticTypes: [],
  optionalSemanticTypes: [],
  scenarios: [
    {
      id: 'sc1',
      name: 'happy path',
      operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
      producedSemanticTypes: [],
      satisfiedSemanticTypes: [],
      responseShapeFields: [{ name: 'widgetKey', type: 'string' }],
      requestPlan: [
        {
          operationId: 'createWidget',
          method: 'POST',
          pathTemplate: '/widgets',
          expect: { status: 200 },
          bodyKind: 'json',
          bodyTemplate: { name: 'static' },
        },
      ],
    },
  ],
};

describe('emitter: evidence capture emission', () => {
  test('inline request step emits the evidence import, testInfo param, and an attach call with headers/body', async () => {
    const [file] = await PlaywrightEmitter.emit(COLLECTION_INLINE_STEP, ctxBase());
    expect(file.content).toContain("import { attachEvidenceOnFailure } from './support/evidence';");
    expect(file.content).toContain('async ({ request }, testInfo) => {');
    expect(file.content).toContain('await attachEvidenceOnFailure(testInfo, resp1, {');
    expect(file.content).toContain('headers');
    expect(file.content).toContain('body: body1');
  });

  test('a validateResponse shape-check final step wraps it in try/catch and attaches on failure', async () => {
    const [file] = await PlaywrightEmitter.emit(COLLECTION_WITH_SHAPE_VALIDATION, ctxBase());
    expect(file.content).toContain('try {');
    expect(file.content).toContain('await validateResponse(');
    expect(file.content).toContain('} catch (e) {');
    expect(file.content).toContain('await attachEvidenceOnFailure(testInfo, resp1, {');
    // Non-role-bound step: url/headers/body are genuinely in scope from the
    // same test.step, so the catch block must reuse them, not fall back to
    // the role-bound-only `{ url: resp.url() }` minimal shape.
    expect(file.content).toContain('String(e)');
  });
});

describe('attachEvidenceOnFailure runtime behavior', () => {
  function makeRes(overrides: Partial<{ status: number; statusText: string; text: string; headers: Record<string, string> }>) {
    const status = overrides.status ?? 200;
    const statusText = overrides.statusText ?? 'OK';
    const text = overrides.text ?? '';
    const headers = overrides.headers ?? {};
    return {
      status: () => status,
      statusText: () => statusText,
      text: async () => text,
      headers: () => headers,
    };
  }

  function makeTestInfo() {
    const attached: { name: string; body: string }[] = [];
    return {
      testInfo: { attach: async (name: string, opts: { body: string }) => { attached.push({ name, body: opts.body }); } },
      attached,
    };
  }

  test('does not attach anything when the status matches and there is no shapeError', async () => {
    const { testInfo, attached } = makeTestInfo();
    await attachEvidenceOnFailure(testInfo, makeRes({ status: 200 }), {
      operationId: 'op',
      method: 'GET',
      url: 'http://x/y',
      expectedStatus: 200,
    });
    expect(attached).toHaveLength(0);
  });

  test('attaches request.json/response.json on a status mismatch', async () => {
    const { testInfo, attached } = makeTestInfo();
    await attachEvidenceOnFailure(testInfo, makeRes({ status: 401, text: '' }), {
      operationId: 'createWidget',
      method: 'POST',
      url: 'http://x/widgets',
      headers: { Authorization: 'Bearer super-secret-token' },
      body: { name: 'foo' },
      expectedStatus: 200,
    });
    expect(attached.map((a) => a.name)).toEqual(['request.json', 'response.json']);
    const req = JSON.parse(attached[0].body);
    expect(req.operationId).toBe('createWidget');
    expect(req.body).toEqual({ name: 'foo' });
    // Header VALUES must never appear — only names (see the redaction test below).
    expect(attached[0].body).not.toContain('super-secret-token');
    expect(req.headerNames).toEqual(['Authorization']);
  });

  test('attaches on a shapeError even when the status matches', async () => {
    const { testInfo, attached } = makeTestInfo();
    await attachEvidenceOnFailure(
      testInfo,
      makeRes({ status: 200, text: '{"unexpected":true}' }),
      { operationId: 'op', method: 'GET', url: 'http://x', expectedStatus: 200 },
      'Expected status 200, received status 200 but shape mismatched',
    );
    expect(attached).toHaveLength(2);
    const resp = JSON.parse(attached[1].body);
    expect(resp.shapeError).toContain('shape mismatched');
  });

  test('never attaches header values, only header names', async () => {
    const { testInfo, attached } = makeTestInfo();
    await attachEvidenceOnFailure(testInfo, makeRes({ status: 500 }), {
      operationId: 'op',
      method: 'POST',
      url: 'http://x',
      headers: { Authorization: 'Bearer marker-secret-value', Cookie: 'session=marker-secret-cookie' },
      expectedStatus: 200,
    });
    const wholeArtifact = attached.map((a) => a.body).join('\n');
    expect(wholeArtifact).not.toContain('marker-secret-value');
    expect(wholeArtifact).not.toContain('marker-secret-cookie');
    const req = JSON.parse(attached[0].body);
    expect(req.headerNames).toEqual(['Authorization', 'Cookie']);
  });

  test('preserves a literal JSON null response body (not the string "null")', async () => {
    const { testInfo, attached } = makeTestInfo();
    await attachEvidenceOnFailure(testInfo, makeRes({ status: 500, text: 'null' }), {
      operationId: 'op',
      method: 'GET',
      url: 'http://x',
      expectedStatus: 200,
    });
    const resp = JSON.parse(attached[1].body);
    expect(resp.body).toBeNull();
  });

  test('caps an oversized response body and records truncation metadata', async () => {
    const { testInfo, attached } = makeTestInfo();
    const bigBody = 'x'.repeat(70 * 1024);
    await attachEvidenceOnFailure(testInfo, makeRes({ status: 500, text: bigBody }), {
      operationId: 'op',
      method: 'GET',
      url: 'http://x',
      expectedStatus: 200,
    });
    const resp = JSON.parse(attached[1].body);
    expect(resp.bodyTruncated).toBe(true);
    expect(resp.bodyOriginalBytes).toBe(70 * 1024);
    expect(resp.body.length).toBeLessThan(70 * 1024);
  });
});
