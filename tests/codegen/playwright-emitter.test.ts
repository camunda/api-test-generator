import { describe, expect, test } from 'vitest';
import {
  PlaywrightEmitter,
  playwrightSuiteFileName,
  renderPlaywrightSuite,
} from '../../path-analyser/src/codegen/playwright/emitter.ts';
import type {
  EndpointScenarioCollection,
  GlobalContextSeed,
} from '../../path-analyser/src/types.ts';

// The tenant-related tests below all derive the emitter's universal-seed
// behaviour from this fixture, mirroring the entry shipped in
// path-analyser/domain-semantics.json so the assertions track production
// configuration shape.
const TENANT_SEED: GlobalContextSeed = {
  binding: 'tenantIdVar',
  fieldName: 'tenantId',
  seedRule: 'tenantIdVar',
  defaultSentinel: '<default>',
  stripFromMultipartWhenDefault: true,
};

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
      globalContextSeeds: [TENANT_SEED],
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

// Regression guard for #87: the emitter contains zero hard-coded bind names
// or sentinel string literals. Every "tenant"-flavoured branch must derive
// from a globalContextSeeds entry passed via EmitContext. The tests here
// pin both halves of that contract:
//
//   1. A class-scoped source scan rejects reintroduction of the literals
//      'tenantIdVar', 'tenantId', '<default>', or '__seededTenant' anywhere
//      in path-analyser/src/codegen/playwright/emitter.ts.
//   2. Parallel-entry test: a *second* globalContextSeeds entry produces
//      parallel code with no further emitter changes — proving the loop is
//      generic and not a one-off branch dressed up as a loop.
//   3. Empty-seeds test: when no seeds are supplied, no universal-seed
//      prologue is emitted and no multipart strip branch is inserted.
describe('emitter: globalContextSeeds is the only source of universal-seed knowledge (#87)', () => {
  test('emitter.ts source contains no hard-coded tenant bind names or sentinel strings (any quote style)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const emitterPath = path.resolve(here, '../../path-analyser/src/codegen/playwright/emitter.ts');
    const source = await fs.readFile(emitterPath, 'utf8');
    // Strip line comments so the issue/PR cross-references in JSDoc don't
    // false-positive. Block comments are kept intentionally — a block
    // comment matching one of these literals is still a smell.
    const codeOnly = source
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    // Match any quote style (single, double, backtick) so re-introducing
    // the same coupling via "tenantIdVar" or `tenantIdVar` is also caught.
    const forbiddenPatterns = [
      { label: 'quoted tenantIdVar', pattern: /['"`]tenantIdVar['"`]/ },
      { label: 'quoted tenantId', pattern: /['"`]tenantId['"`]/ },
      { label: 'quoted <default>', pattern: /['"`]<default>['"`]/ },
      { label: 'bare __seededTenant', pattern: /\b__seededTenant\b/ },
      { label: 'quoted __seededTenant', pattern: /['"`]__seededTenant['"`]/ },
    ];
    for (const { label, pattern } of forbiddenPatterns) {
      expect(codeOnly, `emitter.ts must not contain ${label} (issue #87)`).not.toMatch(pattern);
    }
  });

  function buildCollectionWithMultipart(): EndpointScenarioCollection {
    return {
      endpoint: { operationId: 'createWidget', method: 'POST', path: '/widgets' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'multipart case',
          operations: [{ operationId: 'createWidget', method: 'POST', path: '/widgets' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'createWidget',
              method: 'POST',
              pathTemplate: '/widgets',
              expect: { status: 200 },
              bodyKind: 'multipart',
              multipartTemplate: {
                fields: { tenantId: '${' + 'tenantIdVar}', orgId: '${' + 'orgIdVar}' },
                files: {},
              },
            },
          ],
        },
      ],
    };
  }

  test('a second globalContextSeeds entry produces parallel seed + strip code', async () => {
    const orgSeed: GlobalContextSeed = {
      binding: 'orgIdVar',
      fieldName: 'orgId',
      seedRule: 'orgIdVar',
      defaultSentinel: '<root>',
      stripFromMultipartWhenDefault: true,
    };
    const [file] = await PlaywrightEmitter.emit(buildCollectionWithMultipart(), {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
      globalContextSeeds: [TENANT_SEED, orgSeed],
    });
    const c = file.content;
    // Both seeds emit an idempotent ?? guard.
    expect(c).toContain(
      `if (ctx['tenantIdVar'] === undefined) { ctx['tenantIdVar'] = seedBinding('tenantIdVar'); }`,
    );
    expect(c).toContain(
      `if (ctx['orgIdVar'] === undefined) { ctx['orgIdVar'] = seedBinding('orgIdVar'); }`,
    );
    // Both seeds declare a sentinel local named after the field.
    expect(c).toContain(`const __tenantIdIsDefault = ctx['tenantIdVar'] === '<default>';`);
    expect(c).toContain(`const __orgIdIsDefault = ctx['orgIdVar'] === '<root>';`);
    // Both seeds insert a parallel multipart-strip branch.
    expect(c).toContain(`if (k === 'tenantId' && __tenantIdIsDefault) continue;`);
    expect(c).toContain(`if (k === 'orgId' && __orgIdIsDefault) continue;`);
  });

  test('without seeds the emitter writes no universal-seed prologue and no multipart strip branch', async () => {
    const [file] = await PlaywrightEmitter.emit(buildCollectionWithMultipart(), {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
      // no globalContextSeeds
    });
    const c = file.content;
    expect(c).not.toMatch(/IsDefault\b/);
    expect(c).not.toMatch(/seedBinding\('tenantIdVar'\)/);
    expect(c).not.toMatch(/&& __\w+IsDefault\) continue;/);
  });

  test('seed without stripFromMultipartWhenDefault emits the guard but no strip branch', async () => {
    const seedOnly: GlobalContextSeed = {
      binding: 'tenantIdVar',
      fieldName: 'tenantId',
      seedRule: 'tenantIdVar',
    };
    const [file] = await PlaywrightEmitter.emit(buildCollectionWithMultipart(), {
      outDir: '/unused',
      suiteName: 'createWidget',
      mode: 'feature',
      globalContextSeeds: [seedOnly],
    });
    const c = file.content;
    expect(c).toContain(
      `if (ctx['tenantIdVar'] === undefined) { ctx['tenantIdVar'] = seedBinding('tenantIdVar'); }`,
    );
    expect(c).not.toMatch(/__tenantIdIsDefault/);
    expect(c).not.toMatch(/&& __\w+IsDefault\) continue;/);
  });
});
