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

// Regression guard for PR #79 / issue #80 (no `__seededTenant` flag),
// issue #86 (universal-seed prologue collapsed to nullish-coalesce), and
// issue #136 (planner-authoritative seedBindings list).
//
// The universal-seed prologue derived from globalContextSeeds emits one
// idempotent line per seed:
//   ctx['<binding>'] = ctx['<binding>'] ?? seedBinding('<seedRule>');
// `??` short-circuits over both literal assignments from the bindings loop
// and the `=== undefined`-guarded auto-seed driven by
// `scenario.seedBindings` (issue #136 — runs *before* the universal-seed
// prologue so a duplicate seedBinding call there would be wasteful). When
// neither shape applies, `??` falls through to seedBinding(...). This
// replaces the pre-#86 unconditional `=== undefined` guard, which was
// dead code in the no-assignment case.
//
// These tests exercise the three shapes the bindings loop can produce for
// `tenantIdVar` (literal value, __PENDING__-from-seedBindings auto-seed,
// extracted-by-an-earlier-step) plus a control with no `tenantIdVar`
// binding at all, asserting the `??` line appears exactly once, the
// universal-seed prologue never re-emits the `=== undefined` form for
// that binding, and `__seededTenant` never appears anywhere in the output.
describe('emitter: universal-seed prologue (no __seededTenant flag, #79/#80; ?? form, #86; planner seedBindings, #136)', () => {
  const TENANT_FALLBACK = `ctx['tenantIdVar'] = ctx['tenantIdVar'] ?? seedBinding('tenantIdVar');`;
  // The pre-#86 universal-seed-prologue form. The bindings loop *also* emits
  // exactly this string for a `__PENDING__` binding listed in
  // `scenario.seedBindings`, so absence is asserted by counting occurrences
  // (0 for every shape *except* __PENDING__-with-seedBindings, where the
  // count is exactly 1 — proving the prologue did not also emit it).
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
    bindings: Record<string, string>,
    extras: {
      templateRefsTenant?: boolean;
      extractsTenant?: boolean;
      seedBindings?: string[];
    } = {},
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
          seedBindings: extras.seedBindings,
          requestPlan: [
            {
              operationId: 'createWidget',
              method: 'POST',
              pathTemplate: '/widgets',
              expect: { status: 200 },
              bodyTemplate: extras.templateRefsTenant
                ? { tenantId: `${'$'}{tenantIdVar}` }
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

  test('__PENDING__ tenantIdVar in seedBindings emits only the ?? fallback when tenantIdVar is also a globalContextSeeds entry (#157)', async () => {
    const content = await renderFirst(
      buildCollectionWithBindings(
        { tenantIdVar: '__PENDING__' },
        { templateRefsTenant: true, seedBindings: ['tenantIdVar'] },
      ),
    );
    // Issue #157: when the same binding name appears in BOTH scenario.seedBindings
    // (planner output) and globalContextSeeds (config), the universal-seed
    // prologue's `??` form is authoritative — it covers both `null` and
    // `undefined`, uses the explicit `seedRule` from the config (which can
    // differ from the binding name), and runs unconditionally before step 0.
    // The seedBindings loop must skip the binding so the emitted suite has
    // no `=== undefined` guard for it.
    //
    // Pre-#157 the emitter emitted both the guard and the `??` fallback for
    // every overlapping binding — three lines of dead code per scenario step.
    expect(countOccurrences(content, FULL_TENANT_GUARD)).toBe(0);
    expect(countOccurrences(content, TENANT_FALLBACK)).toBe(1);
    expect(content).not.toMatch(/__seededTenant/);
  });

  test('seedBindings entry NOT in globalContextSeeds still emits the `=== undefined` guard (#157 — pin both directions of the filter)', async () => {
    // Class-scoped guard for the new filter. The fix in #157 must only
    // drop bindings covered by globalContextSeeds; bindings that the
    // planner needs seeded pre-step-0 but which have no domain-semantics
    // entry must still produce the `=== undefined` guard form, because
    // the universal-seed prologue won't cover them.
    //
    // A binding NOT in globalContextSeeds and listed in seedBindings:
    const widgetKeyGuard = `if (ctx['widgetKeyVar'] === undefined) { ctx['widgetKeyVar'] = seedBinding('widgetKeyVar'); }`;
    const content = await renderFirst(
      buildCollectionWithBindings(
        { widgetKeyVar: '__PENDING__' },
        { seedBindings: ['widgetKeyVar'] },
      ),
    );
    expect(countOccurrences(content, widgetKeyGuard)).toBe(1);
    // And it does NOT receive a `??` line (because it's not in globalContextSeeds).
    expect(content).not.toContain(`ctx['widgetKeyVar'] = ctx['widgetKeyVar'] ?? seedBinding(`);
  });

  test('literal tenantIdVar still seeds even when an extract targets the same binding (#136)', async () => {
    // Pre-#136 the emitter skipped this literal assignment because
    // `tenantIdVar` appeared in `extractionVars` — that was the defect.
    // The extract runs AFTER the request body is built, so the body
    // would have referenced an unseeded `ctx.tenantIdVar` (=
    // undefined) and the broker would 400. The literal MUST be
    // emitted; the extract just overwrites it post-response with
    // whatever the server echoed.
    const content = await renderFirst(
      buildCollectionWithBindings(
        { tenantIdVar: 'acme' },
        { templateRefsTenant: true, extractsTenant: true },
      ),
    );
    expect(content).toContain(`ctx['tenantIdVar'] = "acme";`);
    expect(countOccurrences(content, TENANT_FALLBACK)).toBe(1);
    // No `=== undefined` guard either: the literal already covers the
    // pre-request need, and the universal-seed `??` short-circuits.
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
    expect(content).toContain(
      "import { extractInto, seedBinding, initSpecSalt } from './support/seeding';",
    );
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

  test('deploy-only scenario: sentinel local not emitted (deploy() receives strips, local is unused)', async () => {
    // Regression guard: when a scenario's only multipart step is a 200 createDeployment
    // step (routed through deploy()), the sentinel __<fieldName>IsDefault local must NOT
    // be emitted. deploy() receives strips as a JSON literal argument; it never reads the
    // prologue local. Emitting it produces an unused-variable Biome error in the generated
    // suite.
    const deployOnlyCollection: EndpointScenarioCollection = {
      endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'deploy case',
          operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'createDeployment',
              method: 'POST',
              pathTemplate: '/deployments',
              expect: { status: 200 },
              bodyKind: 'multipart',
              multipartTemplate: {
                fields: { tenantId: '${' + 'tenantIdVar}' },
                files: {},
              },
            },
          ],
        },
      ],
    };
    const [file] = await PlaywrightEmitter.emit(deployOnlyCollection, {
      outDir: '/unused',
      suiteName: 'createDeployment',
      mode: 'feature',
      globalContextSeeds: [TENANT_SEED],
    });
    const c = file.content;
    // Seed assignment still emitted (always needed)
    expect(c).toContain(`ctx['tenantIdVar'] = ctx['tenantIdVar'] ?? seedBinding('tenantIdVar');`);
    // Sentinel local must NOT be emitted — no inline multipart step uses it
    expect(c).not.toMatch(/__tenantIdIsDefault/);
    expect(c).not.toMatch(/&& __\w+IsDefault\) continue;/);
  });

  test('deploy step: no inline extractInto block emitted outside deploy() (no duplicate extraction)', async () => {
    // Regression guard: deploy() already extracts all known deployment response
    // fields (processDefinitionKeyVar, deploymentKeyVar, tenantIdVar, etc.)
    // internally. The emitter must NOT also emit a `const json = await resp.json()`
    // + extractInto loop for the same step — that would call json() twice and
    // duplicate every assignment. Class-scoped: asserts the emitted suite never
    // contains either artefact of the old inline extraction block after a deploy()
    // call, regardless of which extract entries the planner attached.
    const deployWithExtracts: EndpointScenarioCollection = {
      endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'deploy with extracts',
          operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
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
              extract: [
                { fieldPath: 'deploymentKey', bind: 'deploymentKeyVar' },
                {
                  fieldPath: 'deployments[0].processDefinition.processDefinitionKey',
                  bind: 'processDefinitionKeyVar',
                },
              ],
            },
          ],
        },
      ],
    };
    const [file] = await PlaywrightEmitter.emit(deployWithExtracts, {
      outDir: '/unused',
      suiteName: 'createDeployment',
      mode: 'feature',
    });
    const c = file.content;
    // deploy() call must be present
    expect(c).toContain('await deploy(ctx, request,');
    // No second json() read — deploy() owns the response body
    const jsonReads = c.match(/const json = await \w+\.json\(\);/g) ?? [];
    expect(jsonReads, 'resp.json() must not be called outside deploy()').toHaveLength(0);
    // No inline extractInto — all extraction delegated to deploy()
    const extractCalls = c.match(/extractInto\(ctx,/g) ?? [];
    expect(extractCalls, 'extractInto must not be emitted inline for deploy steps').toHaveLength(0);
    // extractInto must not be imported — suppressed calls must also suppress the import
    expect(c, 'extractInto must not be imported when no calls are emitted').not.toContain(
      'import { extractInto',
    );
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
// Wrap each request step in test.step()
// ---------------------------------------------------------------------------
//
// Each request step is wrapped in
// `await test.step('<operationId>', async () => { ... });` so the step
// appears as a labelled, collapsible group in the Playwright HTML report
// and trace viewer. The label is just the operationId — no `Step N:`
// prefix and no `// Step N: <op>` comment.
describe('PlaywrightEmitter — request steps wrapped in test.step()', () => {
  function multiStepCollection(): EndpointScenarioCollection {
    return {
      endpoint: { operationId: 'deleteWidget', method: 'POST', path: '/widgets/{id}/deletion' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          name: 'create then delete',
          operations: [
            { operationId: 'createWidget', method: 'POST', path: '/widgets' },
            { operationId: 'deleteWidget', method: 'POST', path: '/widgets/{id}/deletion' },
          ],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'createWidget',
              method: 'POST',
              pathTemplate: '/widgets',
              expect: { status: 200 },
              extract: [{ fieldPath: 'id', bind: 'idVar' }],
            },
            {
              operationId: 'deleteWidget',
              method: 'POST',
              pathTemplate: '/widgets/{id}/deletion',
              expect: { status: 204 },
            },
          ],
        },
      ],
    };
  }

  test('wraps each request step in await test.step(<operationId>, async () => { ... })', () => {
    const src = renderPlaywrightSuite(multiStepCollection(), {
      suiteName: 'deleteWidget',
      mode: 'feature',
    });
    expect(src).toContain('await test.step("createWidget", async () => {');
    expect(src).toContain('await test.step("deleteWidget", async () => {');
  });

  test('label is just the operationId — no "Step N:" prefix anywhere', () => {
    // Class-scoped guard: the step-index prefix is intentionally absent.
    // Any reintroduction of `Step <n>:` — whether as a comment or inside
    // a test.step label — fails this test.
    const src = renderPlaywrightSuite(multiStepCollection(), {
      suiteName: 'deleteWidget',
      mode: 'feature',
    });
    expect(src).not.toMatch(/\/\/\s*Step\s+\d+:/);
    expect(src).not.toMatch(/test\.step\(\s*['"`]Step\s+\d+:/);
  });

  test('does not reintroduce the legacy bare `{` step block', () => {
    // The legacy shape opened each step with a bare `{` preceded by a
    // `// Step N: <op>` comment. The current shape uses `await test.step(...)`,
    // and the only emitted bare block now belongs to the eventual-wait
    // emitter (`{` immediately after a `// Wait for ...` comment). This
    // guard targets the legacy shape specifically — a `// Step N:` line
    // immediately followed by a bare `{`.
    const src = renderPlaywrightSuite(multiStepCollection(), {
      suiteName: 'deleteWidget',
      mode: 'feature',
    });
    expect(src).not.toMatch(/\/\/ Step \d+: \w+\s*\n\s*\{/);
  });

  test('emits one test.step wrapper per request step', () => {
    const src = renderPlaywrightSuite(multiStepCollection(), {
      suiteName: 'deleteWidget',
      mode: 'feature',
    });
    const matches = src.match(/await test\.step\(/g) ?? [];
    expect(matches.length).toBe(2);
  });

  test('escapes operationIds that contain TS string metacharacters (Copilot PR #170 review)', () => {
    // Class-scoped guard: the label argument to test.step() must be a
    // syntactically valid TS string literal regardless of which
    // characters the OpenAPI `operationId` contains. The OpenAPI spec
    // does not formally restrict `operationId` to /[A-Za-z0-9_]+/, so an
    // upstream rename that introduces a single quote, backslash, or
    // newline must not produce an unparseable emitted suite (or, worse,
    // allow code-injection into the emitted file). Using
    // `JSON.stringify(operationId)` is the chokepoint that enforces this.
    const hostile = "weird'op\\with\nnewline";
    const src = renderPlaywrightSuite(
      {
        endpoint: { operationId: hostile, method: 'POST', path: '/x' },
        requiredSemanticTypes: [],
        optionalSemanticTypes: [],
        scenarios: [
          {
            id: 'sc1',
            name: 'hostile id',
            operations: [{ operationId: hostile, method: 'POST', path: '/x' }],
            producedSemanticTypes: [],
            satisfiedSemanticTypes: [],
            requestPlan: [
              {
                operationId: hostile,
                method: 'POST',
                pathTemplate: '/x',
                expect: { status: 200 },
              },
            ],
          },
        ],
      },
      { suiteName: 'hostile', mode: 'feature' },
    );
    // The emitted label is JSON.stringify(operationId): double-quoted,
    // with `'`, `\`, and `\n` escaped. The raw hostile string must NOT
    // appear unescaped inside a single-quoted literal next to test.step().
    expect(src).toContain(`await test.step(${JSON.stringify(hostile)}, async () => {`);
    expect(src).not.toMatch(/test\.step\('[^']*'[^,]*\\?\n/);
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

// ---------------------------------------------------------------------------
// Import gating: deploy() vs resolveFixture vs authHeaders
// ---------------------------------------------------------------------------
//
// These tests guard the three conditional import decisions added for the
// deploy() helper. Each decision has a class-scoped rule:
//
//   1. deploy-only suite (all createDeployment multipart steps are status 200)
//      → imports `deploy` from deployment, NOT resolveFixture, NOT authHeaders
//      (deploy() handles auth internally; no inline request uses authHeaders)
//
//   2. non-200 createDeployment multipart step (falls through to inline path)
//      → imports resolveFixture (the inline multipart path calls it), NOT deploy
//
//   3. mixed suite (200-deployment + non-deployment multipart)
//      → imports both deploy and resolveFixture
//
// Regression risk: a change to the isDeploymentStep condition or import
// flags that shifts a step between the deploy() path and the inline path
// can produce a missing import (compile error in the generated suite) or
// an unused import (Biome noUnusedImports error in the generated suite).

describe('emitter: conditional import gating for deploy() and resolveFixture', () => {
  function deployOnlyCollection(expectedStatus = 200): EndpointScenarioCollection {
    return {
      endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
      requiredSemanticTypes: [],
      optionalSemanticTypes: [],
      scenarios: [
        {
          id: 'sc1',
          operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
          producedSemanticTypes: [],
          satisfiedSemanticTypes: [],
          requestPlan: [
            {
              operationId: 'createDeployment',
              method: 'POST',
              pathTemplate: '/deployments',
              expect: { status: expectedStatus },
              bodyKind: 'multipart',
              multipartTemplate: { fields: {}, files: {} },
            },
          ],
        },
      ],
    };
  }

  test('deploy-only suite: imports deploy, not resolveFixture, not authHeaders', () => {
    const src = renderPlaywrightSuite(deployOnlyCollection(200), {
      suiteName: 'createDeployment',
      mode: 'feature',
      recordResponses: false,
    });
    expect(src).toContain("import { deploy } from './support/deployment';");
    expect(src).not.toContain('resolveFixture');
    // authHeaders is handled internally by deploy(); suite must not import it
    expect(src).not.toContain('authHeaders');
    expect(src).toContain("import { buildBaseUrl } from './support/env';");
    // Minimal fixture has no step.extract entries; extractInto is not needed
    expect(src).not.toContain('extractInto');
    expect(src).toContain("import { seedBinding, initSpecSalt } from './support/seeding';");
  });

  test('deploy-only suite: emits explicit expect(status).toBe(200) for each deploy step', () => {
    // The explicit assertion keeps expect from @playwright/test from becoming
    // unused in suites whose request plan consists entirely of deploy() steps,
    // and mirrors the status-assertion pattern emitted for inline request steps.
    const src = renderPlaywrightSuite(deployOnlyCollection(200), {
      suiteName: 'createDeployment',
      mode: 'feature',
      recordResponses: false,
    });
    expect(src).toContain('expect(resp1.status()).toBe(200)');
  });

  test('deploy step with placeholder-alias extract: emits extractInto and imports it', () => {
    // aliasProducerExtractsToPlaceholders can attach a placeholderAlias extract to a
    // createDeployment step (e.g. bind processDefinitionIdVar from the same fieldPath as
    // processDefinitionKeyVar when the next step's path uses {processDefinitionId}).
    // The emitter must emit this extractInto call even for deployment steps; skipping it
    // leaves the URL placeholder var unset in the generated test.
    const src = renderPlaywrightSuite(
      {
        endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
        requiredSemanticTypes: [],
        optionalSemanticTypes: [],
        scenarios: [
          {
            id: 'sc1',
            operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
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
                extract: [
                  {
                    fieldPath: 'deployments[0].processDefinition.processDefinitionKey',
                    bind: 'processDefinitionIdVar',
                    note: 'placeholderAlias',
                  },
                ],
              },
            ],
          },
        ],
      },
      { suiteName: 'createDeployment', mode: 'feature', recordResponses: false },
    );
    // The placeholder alias must be emitted even though the step goes through deploy()
    expect(src).toContain("extractInto(ctx, 'processDefinitionIdVar'");
    // extractInto must be imported
    expect(src).toContain(
      "import { extractInto, seedBinding, initSpecSalt } from './support/seeding';",
    );
  });

  test('non-200 createDeployment multipart: imports resolveFixture, not deploy', () => {
    // A non-200 createDeployment step (e.g. request-validation scenario) falls
    // through to the inline multipart path which calls resolveFixture.
    const src = renderPlaywrightSuite(deployOnlyCollection(400), {
      suiteName: 'createDeployment',
      mode: 'feature',
      recordResponses: false,
    });
    expect(src).not.toContain('import { deploy }');
    expect(src).toContain("import { resolveFixture } from './support/fixtures';");
    // Inline path uses authHeaders
    expect(src).toContain('authHeaders');
  });

  test('mixed suite (200-deployment + non-deployment multipart): imports both', () => {
    const src = renderPlaywrightSuite(
      {
        endpoint: { operationId: 'createDeployment', method: 'POST', path: '/deployments' },
        requiredSemanticTypes: [],
        optionalSemanticTypes: [],
        scenarios: [
          {
            id: 'sc1',
            operations: [{ operationId: 'createDeployment', method: 'POST', path: '/deployments' }],
            producedSemanticTypes: [],
            satisfiedSemanticTypes: [],
            requestPlan: [
              // 200 deployment step → deploy()
              {
                operationId: 'createDeployment',
                method: 'POST',
                pathTemplate: '/deployments',
                expect: { status: 200 },
                bodyKind: 'multipart',
                multipartTemplate: { fields: {}, files: {} },
              },
              // non-deployment multipart step → inline + resolveFixture
              {
                operationId: 'uploadDocument',
                method: 'POST',
                pathTemplate: '/documents',
                expect: { status: 200 },
                bodyKind: 'multipart',
                multipartTemplate: { fields: {}, files: { file: '@@FILE:test.txt' } },
              },
            ],
          },
        ],
      },
      { suiteName: 'createDeployment', mode: 'feature', recordResponses: false },
    );
    expect(src).toContain("import { deploy } from './support/deployment';");
    expect(src).toContain("import { resolveFixture } from './support/fixtures';");
    // authHeaders is needed for the inline uploadDocument step
    expect(src).toContain('authHeaders');
  });
});

// #175 — per-spec-file initSpecSalt emission
describe('emitter: initSpecSalt emission (#175)', () => {
  test('emitted suite imports initSpecSalt from the seeding module', () => {
    const src = renderPlaywrightSuite(COLLECTION, {
      suiteName: 'createWidget',
      mode: 'feature',
      recordResponses: false,
    });
    expect(src).toContain("import { seedBinding, initSpecSalt } from './support/seeding';");
  });

  test('emitted suite calls initSpecSalt with the suite name', () => {
    const src = renderPlaywrightSuite(COLLECTION, {
      suiteName: 'createWidget',
      mode: 'feature',
      recordResponses: false,
    });
    expect(src).toContain('initSpecSalt("createWidget");');
  });

  test('different suite names produce different initSpecSalt calls', () => {
    const src1 = renderPlaywrightSuite(COLLECTION, {
      suiteName: 'createRole',
      mode: 'feature',
      recordResponses: false,
    });
    const src2 = renderPlaywrightSuite(COLLECTION, {
      suiteName: 'assignRoleToClient',
      mode: 'feature',
      recordResponses: false,
    });
    expect(src1).toContain('initSpecSalt("createRole");');
    expect(src2).toContain('initSpecSalt("assignRoleToClient");');
    expect(src1).not.toContain('initSpecSalt("assignRoleToClient");');
    expect(src2).not.toContain('initSpecSalt("createRole");');
  });

  test('initSpecSalt call appears before test.describe', () => {
    const src = renderPlaywrightSuite(COLLECTION, {
      suiteName: 'createWidget',
      mode: 'feature',
      recordResponses: false,
    });
    const saltPos = src.indexOf('initSpecSalt("createWidget");');
    const describePos = src.indexOf("test.describe('createWidget'");
    expect(saltPos).toBeGreaterThan(-1);
    expect(describePos).toBeGreaterThan(-1);
    expect(saltPos).toBeLessThan(describePos);
  });
});
