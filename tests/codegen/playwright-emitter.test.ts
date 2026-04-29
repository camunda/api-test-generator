import { describe, expect, test } from 'vitest';
import {
  PlaywrightEmitter,
  playwrightSuiteFileName,
  renderPlaywrightSuite,
} from '../../path-analyser/src/codegen/playwright/emitter.ts';
import type { EndpointScenarioCollection } from '../../path-analyser/src/types.ts';

const COLLECTION: EndpointScenarioCollection = {
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
    },
  ],
};

describe('PlaywrightEmitter (Emitter contract)', () => {
  test('id and name are stable identifiers', () => {
    expect(PlaywrightEmitter.id).toBe('playwright');
    expect(PlaywrightEmitter.name).toMatch(/Playwright/);
  });

  test('returns one EmittedFile per scenario collection with the expected file name', async () => {
    const files = await PlaywrightEmitter.emit(COLLECTION, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
    });
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('createWidget.feature.spec.ts');
    expect(files[0].relativePath).toBe(playwrightSuiteFileName(COLLECTION, 'feature'));
  });

  test('integration mode produces an integration.spec.ts file name', async () => {
    const files = await PlaywrightEmitter.emit(COLLECTION, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'integration',
    });
    expect(files[0].relativePath).toBe('createWidget.integration.spec.ts');
  });

  test('emit() is pure: does not touch the filesystem (outDir is unused)', async () => {
    // outDir is intentionally a non-existent path; emit() must not throw.
    await expect(
      PlaywrightEmitter.emit(COLLECTION, {
        outDir: '/this/does/not/exist',
        suiteName: 'createWidget',
        mode: 'feature',
      }),
    ).resolves.toBeDefined();
  });

  test('rendered suite contains the expected Playwright preamble and describe block', async () => {
    const [file] = await PlaywrightEmitter.emit(COLLECTION, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
    });
    expect(file.content).toContain("import { test, expect } from '@playwright/test'");
    expect(file.content).toContain("test.describe('createWidget'");
    expect(file.content).toContain("test('sc1 - happy path'");
  });

  test('renderPlaywrightSuite is byte-identical to the EmittedFile content', async () => {
    const [file] = await PlaywrightEmitter.emit(COLLECTION, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
    });
    const direct = renderPlaywrightSuite(COLLECTION, {
      suiteName: 'createWidget',
      mode: 'feature',
    });
    expect(file.content).toBe(direct);
  });
});

// Regression guard for PR #79 / issue #80: the emitter no longer declares or
// writes a `__seededTenant` flag. The `tenantIdVar` fallback is now a single
// idempotent `=== undefined` guard. These tests exercise the three shapes the
// bindings loop can produce for `tenantIdVar` (literal value, __PENDING__
// auto-seed, and extracted-by-an-earlier-step) plus a control with no
// `tenantIdVar` binding at all, asserting the simplified guard appears
// exactly once and `__seededTenant` never appears anywhere in the output.
describe('emitter: tenantIdVar seeding (no __seededTenant flag, #79/#80)', () => {
  const TENANT_FALLBACK = `if (ctx['tenantIdVar'] === undefined) { ctx['tenantIdVar'] = seedBinding('tenantIdVar'); }`;

  function buildCollectionWithBindings(
    bindings: Record<string, unknown>,
    extras: { templateRefsTenant?: boolean; extractsTenant?: boolean } = {},
  ): EndpointScenarioCollection {
    return {
      endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'tenant case',
          operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          bindings,
          requestPlan: [
            {
              operationId: 'createWidget',
              method: 'POST',
              pathTemplate: '/widgets',
              expect: { status: 200 },
              bodyTemplate: extras.templateRefsTenant
                ? { tenantId: '${' + 'tenantIdVar}' }
                : { name: 'static' },
              extract: extras.extractsTenant
                ? [{ fieldPath: 'tenantId', bind: 'tenantIdVar' }]
                : undefined,
            },
          ],
        },
      ],
    };
  }

  async function renderFirst(collection: EndpointScenarioCollection): Promise<string> {
    const [file] = await PlaywrightEmitter.emit(collection, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
    });
    return file.content;
  }

  test('literal tenantIdVar binding seeds the value and emits the simplified fallback', async () => {
    const content = await renderFirst(buildCollectionWithBindings({ tenantIdVar: 'acme' }));
    expect(content).toContain(`ctx['tenantIdVar'] = "acme";`);
    expect(content).toContain(TENANT_FALLBACK);
    expect(content).not.toMatch(/__seededTenant/);
  });

  test('__PENDING__ tenantIdVar referenced by a template emits a guarded auto-seed and the simplified fallback', async () => {
    const content = await renderFirst(
      buildCollectionWithBindings({ tenantIdVar: '__PENDING__' }, { templateRefsTenant: true }),
    );
    expect(content).toContain(
      `if (ctx['tenantIdVar'] === undefined) { ctx['tenantIdVar'] = seedBinding('tenantIdVar'); }`,
    );
    expect(content).toContain(TENANT_FALLBACK);
    expect(content).not.toMatch(/__seededTenant/);
  });

  test('extractionVars tenantIdVar skips eager seeding but still emits the simplified fallback', async () => {
    const content = await renderFirst(
      buildCollectionWithBindings(
        { tenantIdVar: 'ignored-because-extracted' },
        { extractsTenant: true },
      ),
    );
    expect(content).not.toContain(`ctx['tenantIdVar'] = "ignored-because-extracted";`);
    expect(content).toContain(TENANT_FALLBACK);
    expect(content).not.toMatch(/__seededTenant/);
  });

  test('no tenantIdVar binding at all still emits the simplified fallback (control)', async () => {
    const content = await renderFirst(buildCollectionWithBindings({}));
    expect(content).toContain(TENANT_FALLBACK);
    expect(content).not.toMatch(/__seededTenant/);
  });
});

// Regression guard for PR #84: the emitter collapses the per-extracted-field
// `const val_N_M = json...; if (val_N_M !== undefined) { ctx[...] = val_N_M; }`
// triple into a single `extractInto(ctx, '<bind>', json...)` call. The class-
// scoped assertions here lock that shape in: any reintroduction of the old
// `val_N_M` temporary or `!== undefined` ctx-assignment guard fails the test.
describe('emitter: extractInto helper for response extraction (#84)', () => {
  function buildCollectionWithExtracts(
    extracts: { fieldPath: string; bind: string }[],
  ): EndpointScenarioCollection {
    return {
      endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'extract case',
          operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'createWidget',
              method: 'POST',
              pathTemplate: '/widgets',
              expect: { status: 200 },
              extract: extracts,
            },
          ],
        },
      ],
    };
  }

  async function renderFirst(collection: EndpointScenarioCollection): Promise<string> {
    const [file] = await PlaywrightEmitter.emit(collection, {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
    });
    return file.content;
  }

  test('imports extractInto alongside seedBinding from the vendored support module', async () => {
    const content = await renderFirst(
      buildCollectionWithExtracts([{ fieldPath: 'widgetKey', bind: 'widgetKeyVar' }]),
    );
    expect(content).toContain("import { extractInto, seedBinding } from './support/seeding';");
  });

  test('emits exactly one extractInto(ctx, ...) call per extract entry', async () => {
    const content = await renderFirst(
      buildCollectionWithExtracts([
        { fieldPath: 'widgetKey', bind: 'widgetKeyVar' },
        { fieldPath: 'tenantId', bind: 'tenantIdVar' },
        { fieldPath: 'meta.createdBy', bind: 'createdByVar' },
      ]),
    );
    expect(content).toContain(`extractInto(ctx, 'widgetKeyVar', json?.widgetKey);`);
    expect(content).toContain(`extractInto(ctx, 'tenantIdVar', json?.tenantId);`);
    expect(content).toContain(`extractInto(ctx, 'createdByVar', json?.meta?.createdBy);`);
    const matches = content.match(/extractInto\(ctx, '/g) ?? [];
    expect(matches).toHaveLength(3);
  });

  test('reads the response body once per step (single `const json = await ...json()`)', async () => {
    const content = await renderFirst(
      buildCollectionWithExtracts([
        { fieldPath: 'a', bind: 'aVar' },
        { fieldPath: 'b', bind: 'bVar' },
      ]),
    );
    const jsonReads = content.match(/const json = await \w+\.json\(\);/g) ?? [];
    expect(jsonReads).toHaveLength(1);
  });

  test('does not reintroduce the legacy val_N_M temporary or !== undefined ctx guard', async () => {
    // Class-scoped guard: any reintroduction of the old shape — a
    // `const val_N_M` temporary or an `if (val_N_M !== undefined) { ctx[...] = ... }`
    // assignment guard — fails this test, regardless of which extract triggered it.
    const content = await renderFirst(
      buildCollectionWithExtracts([
        { fieldPath: 'widgetKey', bind: 'widgetKeyVar' },
        { fieldPath: 'tenantId', bind: 'tenantIdVar' },
      ]),
    );
    expect(content).not.toMatch(/const val_\d+_\d+\s*=/);
    expect(content).not.toMatch(/if\s*\(\s*val_\d+_\d+\s*!==\s*undefined\s*\)/);
    expect(content).not.toMatch(/if\s*\([^)]+!==\s*undefined\s*\)\s*\{\s*ctx\[/);
  });

  test('omits the extract block entirely when step.extract is missing or empty', async () => {
    const noExtracts = await renderFirst(buildCollectionWithExtracts([]));
    expect(noExtracts).not.toContain('extractInto(');
    expect(noExtracts).not.toContain('const json = await');
  });
});
