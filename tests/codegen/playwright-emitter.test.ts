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

// Regression guard for PR #79 / issue #80 (no `__seededTenant` flag) and
// issue #86 (universal-seed prologue collapsed to nullish-coalesce).
//
// The universal-seed prologue derived from globalContextSeeds emits one
// idempotent line per seed:
//   ctx['<binding>'] = ctx['<binding>'] ?? seedBinding('<seedRule>');
// `??` short-circuits over both literal assignments from the bindings loop
// and the `__PENDING__`-guarded auto-seed (which still uses `=== undefined`
// in the bindings loop because it runs *before* the universal-seed prologue
// and a duplicate seedBinding call there would be wasteful). When no
// bindings-loop assignment exists for the seed, `??` falls through to
// seedBinding(...). This replaces the pre-#86 unconditional `=== undefined`
// guard, which was dead code in the no-assignment case.
//
// These tests exercise the three shapes the bindings loop can produce for
// `tenantIdVar` (literal value, __PENDING__ auto-seed, extracted-by-an-
// earlier-step) plus a control with no `tenantIdVar` binding at all,
// asserting the `??` line appears exactly once, the universal-seed prologue
// never re-emits the `=== undefined` form for that binding, and
// `__seededTenant` never appears anywhere in the output.
describe('emitter: universal-seed prologue (no __seededTenant flag, #79/#80; ?? form, #86)', () => {
  const TENANT_FALLBACK = `ctx['tenantIdVar'] = ctx['tenantIdVar'] ?? seedBinding('tenantIdVar');`;
  // The pre-#86 universal-seed-prologue form. The bindings loop *also* emits
  // exactly this string for a `__PENDING__` binding referenced by a template,
  // so absence is asserted by counting occurrences (0 for every shape *except*
  // __PENDING__-referenced-by-template, where the count is exactly 1 — proving
  // the prologue did not also emit it).
  const FULL_TENANT_GUARD = `if (ctx['tenantIdVar'] === undefined) { ctx['tenantIdVar'] = seedBinding('tenantIdVar'); }`;

  // Count occurrences of `needle` in `haystack` without regex escaping.
  function countOccurrences(haystack: string, needle: string): number {
    if (needle.length === 0) return 0;
    let count = 0;
    let from = 0;
    while (true) {
      const i = haystack.indexOf(needle, from);
      if (i === -1) return count;
      count += 1;
      from = i + needle.length;
    }
  }

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

  test('literal tenantIdVar binding seeds the value and emits the ?? fallback exactly once', async () => {
    const content = await renderFirst(buildCollectionWithBindings({ tenantIdVar: 'acme' }));
    expect(content).toContain(`ctx['tenantIdVar'] = "acme";`);
    expect(countOccurrences(content, TENANT_FALLBACK)).toBe(1);
    // The universal-seed prologue must not reintroduce the pre-#86 `=== undefined` guard.
    // Bindings loop emits a literal here, not a guard, so the full guard count is 0.
    expect(countOccurrences(content, FULL_TENANT_GUARD)).toBe(0);
    expect(content).not.toMatch(/__seededTenant/);
  });

  test('__PENDING__ tenantIdVar referenced by a template emits a guarded auto-seed and the ?? fallback exactly once', async () => {
    const content = await renderFirst(
      buildCollectionWithBindings({ tenantIdVar: '__PENDING__' }, { templateRefsTenant: true }),
    );
    // The in-bindings-loop `=== undefined` guard for __PENDING__ is intentional —
    // it runs *before* the universal-seed prologue, and a duplicate seedBinding
    // call there would be wasted. The ?? line then short-circuits over it.
    //
    // Asserting exactly-one occurrence is a class-scoped guard against the
    // emitter regressing and re-emitting the pre-#86 guard form in the
    // universal-seed prologue as well (which would push the count to 2).
    expect(countOccurrences(content, FULL_TENANT_GUARD)).toBe(1);
    expect(countOccurrences(content, TENANT_FALLBACK)).toBe(1);
    expect(content).not.toMatch(/__seededTenant/);
  });

  test('extractionVars tenantIdVar skips eager seeding but still emits the ?? fallback exactly once', async () => {
    const content = await renderFirst(
      buildCollectionWithBindings(
        { tenantIdVar: 'ignored-because-extracted' },
        { extractsTenant: true },
      ),
    );
    expect(content).not.toContain(`ctx['tenantIdVar'] = "ignored-because-extracted";`);
    expect(countOccurrences(content, TENANT_FALLBACK)).toBe(1);
    // Bindings loop skips this case (extraction wins); prologue must not
    // re-emit the pre-#86 guard either.
    expect(countOccurrences(content, FULL_TENANT_GUARD)).toBe(0);
    expect(content).not.toMatch(/__seededTenant/);
  });

  test('no tenantIdVar binding at all emits the ?? fallback exactly once (#86: was previously a dead `=== undefined` guard)', async () => {
    const content = await renderFirst(buildCollectionWithBindings({}));
    expect(countOccurrences(content, TENANT_FALLBACK)).toBe(1);
    // Pre-#86 dead-guard must not reappear when the bindings loop assigned nothing.
    expect(countOccurrences(content, FULL_TENANT_GUARD)).toBe(0);
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
    // Both seeds emit an idempotent ?? assignment in the universal-seed prologue (#86).
    expect(c).toContain(`ctx['tenantIdVar'] = ctx['tenantIdVar'] ?? seedBinding('tenantIdVar');`);
    expect(c).toContain(`ctx['orgIdVar'] = ctx['orgIdVar'] ?? seedBinding('orgIdVar');`);
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
    expect(c).toContain(`ctx['tenantIdVar'] = ctx['tenantIdVar'] ?? seedBinding('tenantIdVar');`);
    expect(c).not.toMatch(/__tenantIdIsDefault/);
    expect(c).not.toMatch(/&& __\w+IsDefault\) continue;/);
  });
});

// Boundary safety guards (#87 review): the public emitter entry points
// re-validate `globalContextSeeds` so a programmatic caller that bypasses
// the loader (codegen/index.ts) still cannot smuggle malformed input
// through to the string-interpolation sites in the emitted suite.
describe('emitter: boundary safety re-validation (#87 review)', () => {
  test('rejects unsafe identifier in binding via PlaywrightEmitter.emit', async () => {
    const badSeed = {
      binding: 'tenant-id', // '-' is not safe-identifier syntax
      fieldName: 'tenantId',
      seedRule: 'tenantIdVar',
    } satisfies GlobalContextSeed;
    await expect(
      PlaywrightEmitter.emit(COLLECTION, {
        outDir: '/unused',
        suiteName: 'createWidget',
        mode: 'feature',
        globalContextSeeds: [badSeed],
      }),
    ).rejects.toThrow(/globalContextSeedSafeIdentifier|safe identifier/);
  });

  test('rejects duplicate fieldName via renderPlaywrightSuite', () => {
    const seedA: GlobalContextSeed = {
      binding: 'tenantIdVar',
      fieldName: 'tenantId',
      seedRule: 'tenantIdVar',
    };
    const seedB: GlobalContextSeed = {
      binding: 'orgIdVar',
      fieldName: 'tenantId', // duplicate
      seedRule: 'orgIdVar',
    };
    expect(() =>
      renderPlaywrightSuite(COLLECTION, {
        suiteName: 'createWidget',
        mode: 'feature',
        globalContextSeeds: [seedA, seedB],
      }),
    ).toThrow(/globalContextSeedFieldNameUnique|duplicate fieldName/);
  });

  test('rejects unsafe sentinel (newline) via renderPlaywrightSuite', () => {
    const badSeed: GlobalContextSeed = {
      binding: 'tenantIdVar',
      fieldName: 'tenantId',
      seedRule: 'tenantIdVar',
      defaultSentinel: 'line1\nline2',
    };
    expect(() =>
      renderPlaywrightSuite(COLLECTION, {
        suiteName: 'createWidget',
        mode: 'feature',
        globalContextSeeds: [badSeed],
      }),
    ).toThrow(/globalContextSeedSentinelSafe|line terminator|control char/);
  });

  test('accepts the production tenant seed shape', () => {
    expect(() =>
      renderPlaywrightSuite(COLLECTION, {
        suiteName: 'createWidget',
        mode: 'feature',
        globalContextSeeds: [TENANT_SEED],
      }),
    ).not.toThrow();
  });

  test('empty seeds array is a no-op (no validation triggered)', () => {
    expect(() =>
      renderPlaywrightSuite(COLLECTION, {
        suiteName: 'createWidget',
        mode: 'feature',
        globalContextSeeds: [],
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// #106 — eventual-consistency wrapping
// ---------------------------------------------------------------------------
//
// Class-scoped guarantee: a request step is wrapped with awaitEventually()
// iff its operation is flagged `eventuallyConsistent` AND it is a read
// shape (GET or POST .../search) AND it expects a 200. Write steps that
// are themselves EC are NOT wrapped — the indexer lag manifests on the
// next read, not on the write call. Error scenarios (non-200 expected)
// are NOT wrapped.

function ecCollection(
  scenarios: EndpointScenarioCollection['scenarios'],
): EndpointScenarioCollection {
  return {
    endpoint: { operationId: 'searchWidgets', method: 'POST', path: '/widgets/search' },
    requiredSemanticTypes: [],
    optionalSemanticTypes: [],
    scenarios,
  };
}

describe('PlaywrightEmitter — eventual-consistency wrapping (#106)', () => {
  test('imports awaitEventually only when at least one step needs wrapping', () => {
    const withEc = renderPlaywrightSuite(
      ecCollection([
        {
          id: 'sc1',
          operations: [
            {
              operationId: 'searchWidgets',
              method: 'POST',
              path: '/widgets/search',
              eventuallyConsistent: true,
            },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'searchWidgets',
              method: 'POST',
              pathTemplate: '/widgets/search',
              expect: { status: 200 },
            },
          ],
        },
      ]),
      { suiteName: 'searchWidgets', mode: 'feature' },
    );
    expect(withEc).toContain("import { awaitEventually } from './support/await-eventually';");
    expect(withEc).toContain('await awaitEventually(');

    const withoutEc = renderPlaywrightSuite(COLLECTION, {
      suiteName: 'createWidget',
      mode: 'feature',
    });
    expect(withoutEc).not.toContain('awaitEventually');
  });

  test('wraps POST .../search reads when eventuallyConsistent', () => {
    const src = renderPlaywrightSuite(
      ecCollection([
        {
          id: 'sc1',
          operations: [
            {
              operationId: 'searchWidgets',
              method: 'POST',
              path: '/widgets/search',
              eventuallyConsistent: true,
            },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'searchWidgets',
              method: 'POST',
              pathTemplate: '/widgets/search',
              expect: { status: 200 },
            },
          ],
        },
      ]),
      { suiteName: 'searchWidgets', mode: 'feature' },
    );
    expect(src).toContain("operationId: 'searchWidgets'");
    expect(src).toMatch(/await awaitEventually\(/);
    expect(src).toContain("method: 'POST'");
  });

  test('wraps GET reads when eventuallyConsistent', () => {
    const src = renderPlaywrightSuite(
      {
        endpoint: { operationId: 'getWidget', method: 'GET', path: '/widgets/{key}' },
        requiredSemanticTypes: [],
        optionalSemanticTypes: [],
        scenarios: [
          {
            id: 'sc1',
            operations: [
              {
                operationId: 'getWidget',
                method: 'GET',
                path: '/widgets/{key}',
                eventuallyConsistent: true,
              },
            ],
            producedSemanticTypes: [],
            satisfiedSemanticTypes: [],
            requestPlan: [
              {
                operationId: 'getWidget',
                method: 'GET',
                pathTemplate: '/widgets/{key}',
                expect: { status: 200 },
              },
            ],
          },
        ],
      },
      { suiteName: 'getWidget', mode: 'feature' },
    );
    expect(src).toMatch(/await awaitEventually\(/);
    expect(src).toContain("method: 'GET'");
  });

  test('does NOT wrap write steps even when flagged eventuallyConsistent', () => {
    // createDeployment is itself EC (indexing), but POST /deployments is
    // a write, not a read. Wrapping it would never satisfy the default
    // items.length predicate.
    const src = renderPlaywrightSuite(
      {
        endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
        requiredSemanticTypes: [],
        optionalSemanticTypes: [],
        scenarios: [
          {
            id: 'sc1',
            operations: [
              {
                operationId: 'createDeployment',
                method: 'POST',
                path: '/deployments',
                eventuallyConsistent: true,
              },
            ],
            producedSemanticTypes: [],
            satisfiedSemanticTypes: [],
            requestPlan: [
              {
                operationId: 'createDeployment',
                method: 'POST',
                pathTemplate: '/deployments',
                expect: { status: 200 },
                bodyKind: 'multipart',
                multipartTemplate: { fields: {}, files: {} },
              },
            ],
          },
        ],
      },
      { suiteName: 'createDeployment', mode: 'feature' },
    );
    expect(src).not.toContain('awaitEventually');
  });

  test('does NOT wrap error scenarios (non-200 expected status)', () => {
    const src = renderPlaywrightSuite(
      ecCollection([
        {
          id: 'sc1',
          operations: [
            {
              operationId: 'searchWidgets',
              method: 'POST',
              path: '/widgets/search',
              eventuallyConsistent: true,
            },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          expectedResult: { kind: 'error' },
          requestPlan: [
            {
              operationId: 'searchWidgets',
              method: 'POST',
              pathTemplate: '/widgets/search',
              expect: { status: 400 },
            },
          ],
        },
      ]),
      { suiteName: 'searchWidgets', mode: 'feature' },
    );
    expect(src).not.toContain('awaitEventually');
  });

  test('only wraps the read step in a multi-step write-then-read chain', () => {
    // Chain: createDeployment (write, EC) → createProcessInstance (write) →
    // searchProcessInstances (read, EC). Only the search must be wrapped.
    const src = renderPlaywrightSuite(
      {
        endpoint: {
          operationId: 'searchProcessInstances',
          method: 'POST',
          path: '/process-instances/search',
        },
        requiredSemanticTypes: [],
        optionalSemanticTypes: [],
        scenarios: [
          {
            id: 'sc1',
            operations: [
              {
                operationId: 'createDeployment',
                method: 'POST',
                path: '/deployments',
                eventuallyConsistent: true,
              },
              { operationId: 'createProcessInstance', method: 'POST', path: '/process-instances' },
              {
                operationId: 'searchProcessInstances',
                method: 'POST',
                path: '/process-instances/search',
                eventuallyConsistent: true,
              },
            ],
            producedSemanticTypes: [],
            satisfiedSemanticTypes: [],
            requestPlan: [
              {
                operationId: 'createDeployment',
                method: 'POST',
                pathTemplate: '/deployments',
                expect: { status: 200 },
                bodyKind: 'multipart',
                multipartTemplate: { fields: {}, files: {} },
              },
              {
                operationId: 'createProcessInstance',
                method: 'POST',
                pathTemplate: '/process-instances',
                expect: { status: 200 },
                bodyKind: 'json',
                bodyTemplate: {},
              },
              {
                operationId: 'searchProcessInstances',
                method: 'POST',
                pathTemplate: '/process-instances/search',
                expect: { status: 200 },
                bodyKind: 'json',
                bodyTemplate: {},
              },
            ],
          },
        ],
      },
      { suiteName: 'searchProcessInstances', mode: 'feature' },
    );
    // Exactly one wrap, on the search read.
    const matches = src.match(/awaitEventually\(/g) ?? [];
    expect(matches.length).toBe(1);
    expect(src).toContain("operationId: 'searchProcessInstances'");
  });
});
