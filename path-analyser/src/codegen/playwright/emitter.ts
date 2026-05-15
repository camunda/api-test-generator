import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assertSafeGlobalContextSeeds } from '../../domainSemanticsValidator.js';
import type {
  EndpointScenario,
  EndpointScenarioCollection,
  EventualWaitSpec,
  GlobalContextSeed,
  RequestStep,
} from '../../types.js';
import type { EmitContext, EmittedFile, Emitter } from '../emitter.js';
import { materializeFixtures, materializeSupport } from './materialize-support.js';

interface EmitOptions {
  outDir: string;
  suiteName?: string;
  mode?: 'feature' | 'integration' | 'variant';
  /**
   * See {@link EmitContext.globalContextSeeds}. Forwarded verbatim from the
   * orchestrator so this entry point and {@link PlaywrightEmitter.emit}
   * produce identical output for the same inputs.
   */
  globalContextSeeds?: readonly GlobalContextSeed[];
  /**
   * See {@link EmitContext.recordResponses}. Default `true` (preserves
   * pre-config behaviour); set to `false` to drop the per-step
   * `recordResponse({...})` block and the `recorder` import from the
   * emitted suite.
   */
  recordResponses?: boolean;
}

/**
 * Build the file name a scenario collection lowers to. Exposed for the
 * Emitter wrapper so it can return a relative path without re-deriving it.
 */
export function playwrightSuiteFileName(
  collection: EndpointScenarioCollection,
  mode: 'feature' | 'integration' | 'variant',
): string {
  return `${collection.endpoint.operationId}.${mode}.spec.ts`;
}

/**
 * Pure rendering entry point — returns the suite source as a string.
 * Used by the {@link PlaywrightEmitter} strategy and by callers that want
 * the source without writing it.
 */
export function renderPlaywrightSuite(
  collection: EndpointScenarioCollection,
  opts: {
    suiteName?: string;
    mode?: 'feature' | 'integration' | 'variant';
    globalContextSeeds?: readonly GlobalContextSeed[];
    recordResponses?: boolean;
  },
): string {
  return buildSuiteSource(collection, {
    outDir: '',
    suiteName: opts.suiteName,
    mode: opts.mode,
    globalContextSeeds: opts.globalContextSeeds,
    recordResponses: opts.recordResponses,
  });
}

/**
 * Legacy filesystem-writing entry point. Retained for backwards compatibility
 * with the existing `codegen:playwright` script. New callers should use the
 * {@link PlaywrightEmitter} via the registry.
 *
 * Vendors the runtime support helpers into `<outDir>/support/` so the
 * emitted suite is self-contained — direct callers of this function get a
 * runnable suite without needing to call {@link materializeSupport}
 * separately.
 */
export async function emitPlaywrightSuite(
  collection: EndpointScenarioCollection,
  opts: EmitOptions,
) {
  await fs.mkdir(opts.outDir, { recursive: true });
  // Keep the legacy entry point aligned with the new recordResponses contract:
  // when the caller opts out of the recorder, the per-step block and the
  // `recorder` import are already absent from the rendered source, so
  // recorder.ts must also be absent from the vendored support/ directory.
  // Default true (preserves pre-config behaviour, matching renderPlaywrightSuite).
  const recordResponses = opts.recordResponses ?? true;
  const excludeSupportFiles = recordResponses ? undefined : ['recorder.ts'];
  await materializeSupport(opts.outDir, undefined, undefined, true, excludeSupportFiles);
  await materializeFixtures(opts.outDir);
  const file = path.join(opts.outDir, playwrightSuiteFileName(collection, opts.mode || 'feature'));
  const code = renderPlaywrightSuite(collection, opts);
  await fs.writeFile(file, code, 'utf8');
  return file;
}

/**
 * {@link Emitter} implementation for Playwright/REST tests. Pure: returns
 * an in-memory {@link EmittedFile} list and never touches the filesystem.
 */
export const PlaywrightEmitter: Emitter = {
  id: 'playwright',
  name: 'Playwright (REST)',
  async emit(collection: EndpointScenarioCollection, ctx: EmitContext): Promise<EmittedFile[]> {
    const content = renderPlaywrightSuite(collection, {
      suiteName: ctx.suiteName,
      mode: ctx.mode,
      globalContextSeeds: ctx.globalContextSeeds,
      recordResponses: ctx.recordResponses,
    });
    return [
      {
        relativePath: playwrightSuiteFileName(collection, ctx.mode),
        content,
      },
    ];
  },
};

function buildSuiteSource(collection: EndpointScenarioCollection, opts: EmitOptions): string {
  // Boundary safety re-check (#87 review): every public entry point —
  // renderPlaywrightSuite, emitPlaywrightSuite, PlaywrightEmitter.emit —
  // funnels through here. Re-validating means a programmatic caller that
  // bypasses the loader cannot smuggle malformed seeds through to the
  // string-interpolation sites below. The loader (codegen/index.ts) also
  // validates, so this is intentionally redundant defense-in-depth.
  //
  // Validate whenever the caller supplied *anything* for globalContextSeeds
  // (including `[]`, non-arrays, or otherwise iterable values). The previous
  // `length > 0` short-circuit could be bypassed by a non-array with no
  // `length` property, leaving downstream `for (const seed of …)` to throw
  // a less actionable error. assertSafeGlobalContextSeeds is the single
  // chokepoint that enforces both Array-ness and per-entry safety.
  if (opts.globalContextSeeds !== undefined) {
    assertSafeGlobalContextSeeds(opts.globalContextSeeds);
  }
  const lines: string[] = [];
  const suiteName = opts.suiteName || collection.endpoint.operationId;

  // Determine upfront whether any scenario will emit a validateResponse() call
  // so we can conditionally include the import and constant.
  const needsValidation = collection.scenarios.some(
    (s) =>
      Array.isArray(s.responseShapeFields) &&
      s.responseShapeFields.length > 0 &&
      !(s.expectedResult && s.expectedResult.kind === 'error'),
  );

  // Determine upfront whether any scenario will wrap a step with
  // awaitEventually() so we can conditionally include the import. Two
  // wrap-triggers fire today:
  //   1. stepNeedsAwait() — a read-shape step belonging to an eventually
  //      consistent operation (`s.operations[].eventuallyConsistent`,
  //      from the `x-eventually-consistent` vendor extension).
  //   2. eventualWaitsAfter — a producer step has been annotated with an
  //      eventual-state wait by the planner (#159 PR B). The wait is
  //      rendered as a standalone `awaitEventually(...)` block after the
  //      producer's request/expect block; this trigger ensures the
  //      import is present even when no step is itself an EC read.
  const needsAwaitEventually = collection.scenarios.some(
    (s) =>
      stepNeedsAwait(s).length > 0 ||
      (s.requestPlan ?? []).some((step) => (step.eventualWaitsAfter?.length ?? 0) > 0),
  );

  // Default `recordResponses` to true so callers that omit the option keep
  // the pre-config behaviour. Threaded down into renderScenarioTest so the
  // per-step block tracks the same flag as the import statement.
  const recordResponses = opts.recordResponses ?? true;

  // Import only test & expect; request fixture is provided per-test via parameters
  lines.push("import { test, expect } from '@playwright/test';");
  if (needsValidation) {
    lines.push("import { validateResponse } from 'assert-json-body';");
  }
  // Import vendored helpers from the suite-local ./support/ directory.
  // materializeSupport() copies these files alongside the emitted specs so
  // the generated suite has no dependency on this generator project.
  if (recordResponses) {
    lines.push("import { recordResponse, sanitizeBody } from './support/recorder';");
  }
  // extractInto is used in the per-step extract loop. For deploy() steps only
  // placeholderAlias extracts are emitted (all others are handled internally by
  // deploy()). Mirror that filter here so the import is not emitted when all
  // extracts for a deployment step are non-alias entries — those generate no
  // extractInto() calls in the suite, which would produce a Biome noUnusedImports
  // error.
  const hasAnyExtract = collection.scenarios.some((s) =>
    (s.requestPlan ?? []).some((step) => {
      const isDeployStep =
        step.operationId === 'createDeployment' &&
        step.bodyKind === 'multipart' &&
        !!step.multipartTemplate &&
        step.expect.status === 200;
      const relevant = isDeployStep
        ? (step.extract ?? []).filter((ex) => ex.note === 'placeholderAlias')
        : (step.extract ?? []);
      return relevant.length > 0;
    }),
  );
  if (hasAnyExtract) {
    lines.push("import { extractInto, seedBinding, initSpecSalt } from './support/seeding';");
  } else {
    lines.push("import { seedBinding, initSpecSalt } from './support/seeding';");
  }
  // deploy() is emitted for 200-expected createDeployment multipart steps; resolveFixture
  // is emitted for any step that falls through to the inline multipart path — this includes
  // non-createDeployment multipart steps AND createDeployment steps with a non-200 expected
  // status (which are not routed through deploy()). Mirror the isDeploymentStep condition
  // exactly so the two flags stay in sync.
  const hasDeploymentMultipart = collection.scenarios.some((s) =>
    (s.requestPlan ?? []).some(
      (step) =>
        step.operationId === 'createDeployment' &&
        step.bodyKind === 'multipart' &&
        !!step.multipartTemplate &&
        step.expect.status === 200,
    ),
  );
  const hasOtherMultipart = collection.scenarios.some((s) =>
    (s.requestPlan ?? []).some(
      (step) =>
        step.bodyKind === 'multipart' &&
        !!step.multipartTemplate &&
        !(step.operationId === 'createDeployment' && step.expect.status === 200),
    ),
  );
  // authHeaders is used in inline request steps and awaitEventually witness blocks.
  // deploy() calls authHeaders internally, so deploy()-only suites don't need this import.
  const hasInlineRequestStep = collection.scenarios.some((s) =>
    (s.requestPlan ?? []).some(
      (step) =>
        !(
          step.operationId === 'createDeployment' &&
          step.bodyKind === 'multipart' &&
          !!step.multipartTemplate &&
          step.expect.status === 200
        ),
    ),
  );
  if (hasInlineRequestStep || needsAwaitEventually) {
    lines.push("import { buildBaseUrl, authHeaders } from './support/env';");
  } else {
    lines.push("import { buildBaseUrl } from './support/env';");
  }
  if (hasDeploymentMultipart) {
    lines.push("import { deploy } from './support/deployment';");
  }
  if (hasOtherMultipart) {
    lines.push("import { resolveFixture } from './support/fixtures';");
  }
  if (needsAwaitEventually) {
    lines.push("import { awaitEventually } from './support/await-eventually';");
  }
  lines.push('');
  lines.push(`initSpecSalt(${JSON.stringify(suiteName)});`);
  if (needsValidation) {
    // Resolve responses.json relative to this spec file so the suite is
    // portable regardless of the working directory the test runner uses.
    lines.push('');
    lines.push(
      "const __responsesFile = import.meta.dirname + '/json-body-assertions/responses.json';",
    );
  }
  lines.push('');
  lines.push(`test.describe('${suiteName}', () => {`);
  const seeds = opts.globalContextSeeds ?? [];
  for (const scenario of collection.scenarios) {
    lines.push(renderScenarioTest(scenario, seeds, recordResponses));
  }
  lines.push('});');
  return lines.join('\n');
}

function renderScenarioTest(
  s: EndpointScenario,
  globalContextSeeds: readonly GlobalContextSeed[],
  recordResponses: boolean,
): string {
  const title = `${s.id} - ${escapeQuotes(s.name || 'scenario')}`;
  const body: string[] = [];
  body.push(`test('${title}', async ({ request }) => {`);
  if (s.description) {
    const desc = String(s.description).trim();
    // Wrap long description lines at ~100 chars for readability
    const wrapped: string[] = [];
    const words = desc.split(/\s+/);
    let line = '';
    for (const w of words) {
      if (`${line} ${w}`.trim().length > 100) {
        wrapped.push(line.trim());
        line = w;
      } else {
        line += (line ? ' ' : '') + w;
      }
    }
    if (line) wrapped.push(line.trim());
    for (const l of wrapped) body.push(`  // ${l}`);
  }
  body.push(`  const baseUrl = buildBaseUrl();`);
  // `unknown` (not `any`) keeps the emitted suite biome-clean while still
  // accepting the wide value space we shovel through ctx (string ids,
  // numeric keys, structured response payloads). Reads from ctx flow into
  // request bodies that are themselves untyped, so no narrowing is needed.
  body.push(`  const ctx: Record<string, unknown> = {};`);
  // Runtime seeding has two distinct sources, both of which must complete
  // before step 0 begins:
  //
  //   1. Planner-driven (`scenario.seedBindings`, #136): the planner is
  //      the authority on which bindings need a `seedBinding()` call
  //      because a later step references them but no extract has
  //      produced them yet. Pre-#136 the emitter re-derived this from
  //      `bindings ∪ requestPlan` and skipped any PENDING binding that
  //      appeared as an extract target anywhere in the plan — which broke
  //      the establisher's own base scenario, where the body input is
  //      also extracted from the same step's response (extract runs AFTER
  //      the request body is built, so no seed → undefined → 400). We now
  //      trust the planner's list verbatim.
  //
  //   2. Config-driven (`globalContextSeeds`, sourced from
  //      `domain-semantics.json`): every emitted scenario must seed
  //      certain universal bindings (e.g. the default-tenant identifier
  //      under single-tenant mode). Handled by the "universal-seed
  //      prologue" further down.
  //
  // When the same binding name appears in BOTH lists, the universal-seed
  // prologue is authoritative (#157): its `??` form is strictly more
  // defensive (covers `null` and `undefined`), uses the explicit
  // `seedRule` from the config (which can differ from the binding name),
  // and runs unconditionally before step 0. We therefore filter such
  // names out of `seedBindingsList` so the redundant `=== undefined`
  // guard isn't emitted. The `bindings` loop still emits literal
  // (non-PENDING) values; the seedBindings list never contains literals
  // (computeSeedBindings filters them out), so the loops are
  // non-overlapping.
  const globalSeedNames = new Set(globalContextSeeds.map((seed) => seed.binding));
  const seedBindingsList = (s.seedBindings ?? []).filter((k) => !globalSeedNames.has(k));
  if (s.bindings && Object.keys(s.bindings).length) {
    body.push('  // Seed scenario bindings');
    for (const [k, v] of Object.entries(s.bindings)) {
      if (v === '__PENDING__') continue; // handled by seedBindings below
      // Literal bindings flow into ctx unconditionally so any later
      // step (or the same step's body) can read the planner-minted
      // value before any extract overwrites it. The seedBindings list
      // never contains literals (computeSeedBindings filters them
      // out), so emitting both is safe.
      body.push(`  ctx['${k}'] = ${JSON.stringify(v)};`);
    }
  }
  if (seedBindingsList.length) {
    if (!s.bindings || !Object.keys(s.bindings).length) {
      body.push('  // Seed scenario bindings');
    }
    for (const k of seedBindingsList) {
      // `=== undefined` (not `??`) so a literal-bound binding above
      // that happens to share a name with a seedBindings entry — not
      // possible today (computeSeedBindings filters literals) but
      // belt-and-braces — does not get re-seeded.
      body.push(`  if (ctx['${k}'] === undefined) { ctx['${k}'] = seedBinding('${k}'); }`);
    }
  }
  // Universal-seed prologue derived from domain-semantics.json#globalContextSeeds.
  // Each entry emits a single nullish-coalesced assignment that is idempotent
  // over both bindings-loop outcomes above:
  //   - literal binding (`ctx['<k>'] = "value";`) — `??` short-circuits, value preserved
  //   - no assignment at all (fresh `ctx`) — `??` falls through to seedBinding(...)
  // The seedBindings loop above no longer overlaps with this prologue
  // (#157 — globalContextSeeds names are filtered out of seedBindingsList),
  // so this is the authoritative pre-step-0 seeder for every entry here.
  // `??` (not `=== undefined`) is intentional: any nullish binding value
  // (`null` or `undefined`) is treated as missing and triggers seeding.
  // The planner does not currently emit `null` literals in `s.bindings`
  // for any global seed; revisit before tightening to `=== undefined`
  // if a future seed ever needs `null` to remain distinct from "missing".
  //
  // Entries that declare a defaultSentinel + stripFromMultipartWhenDefault
  // also emit a `__<fieldName>IsDefault` local that drives the multipart
  // skip branch below — this is the only place the emitter knows about the
  // sentinel.
  //
  // The local is only emitted when the scenario has at least one inline
  // multipart step (i.e. a multipart step that is NOT routed through
  // deploy()). deploy() steps pass strips as a JSON literal argument and
  // never read the prologue local; omitting it for deploy-only scenarios
  // prevents an unused-variable error in the generated suite.
  //
  // Safety: `binding`, `fieldName`, `seedRule` are all required by the
  // domain-semantics validator (#87) to match `/^[A-Za-z_$][A-Za-z0-9_$]*$/`,
  // and `defaultSentinel` is required to contain no single quotes,
  // backslashes, or line terminators. That lets us interpolate them
  // directly into emitted single-quoted TS string literals without an
  // escape pass.
  const hasInlineMultipartStep = (s.requestPlan ?? []).some(
    (step) =>
      step.bodyKind === 'multipart' &&
      !!step.multipartTemplate &&
      !(step.operationId === 'createDeployment' && step.expect.status === 200),
  );
  const sentinelLocals = new Map<string, string>(); // fieldName -> local var name
  for (const seed of globalContextSeeds) {
    body.push(
      `  ctx['${seed.binding}'] = ctx['${seed.binding}'] ?? seedBinding('${seed.seedRule}');`,
    );
    if (
      hasInlineMultipartStep &&
      seed.stripFromMultipartWhenDefault &&
      seed.defaultSentinel !== undefined
    ) {
      const local = `__${seed.fieldName}IsDefault`;
      sentinelLocals.set(seed.fieldName, local);
      body.push(`  const ${local} = ctx['${seed.binding}'] === '${seed.defaultSentinel}';`);
    }
  }
  if (!s.requestPlan) {
    body.push('  // No request plan available');
    body.push('});');
    return body.join('\n');
  }
  const requestPlan = s.requestPlan;
  const awaitStepIndices = new Set(stepNeedsAwait(s));
  requestPlan.forEach((step: RequestStep, idx: number) => {
    const varName = `resp${idx + 1}`;
    const urlExpr = buildUrlExpression(step.pathTemplate);
    const method = step.method.toLowerCase();
    const isFinal = idx === requestPlan.length - 1;
    const hasShape = Array.isArray(s.responseShapeFields) && s.responseShapeFields.length > 0;
    // Ensure prerequisite createProcessInstance always supplies a processDefinitionKey when available
    if (step.operationId === 'createProcessInstance' && step.bodyKind === 'json') {
      if (!step.bodyTemplate || Object.keys(step.bodyTemplate).length === 0) {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal `${var}` placeholder consumed by downstream emitter
        step.bodyTemplate = { processDefinitionKey: '${processDefinitionKeyVar}' };
      }
    }
    // Each request step is wrapped in `await test.step(...)` so it shows
    // up as a labelled, collapsible group in the Playwright HTML report
    // and trace viewer, with per-step timing and failure attribution to
    // the named step. Cross-step state flows through `ctx` declared in
    // the outer test scope; the per-step locals (resp/body/json) stay
    // confined to the callback.
    body.push(`  await test.step(${JSON.stringify(step.operationId)}, async () => {`);

    // createDeployment multipart steps use the deploy() helper which encapsulates
    // multipart body building, @@FILE: resolution, auth, HTTP POST, status
    // assertion (throws on non-200), and extraction of all known deployment
    // response fields into ctx. This keeps each deployment step as a single
    // declarative call instead of ~35 lines of boilerplate.
    // Only route 200-expected steps through deploy(): the helper hard-codes a
    // 200 assertion, so a step with a declared non-200 expected status must
    // fall through to the normal request path where step.expect.status is honoured.
    const isDeploymentStep =
      step.operationId === 'createDeployment' &&
      step.bodyKind === 'multipart' &&
      !!step.multipartTemplate &&
      step.expect.status === 200;
    if (isDeploymentStep && step.multipartTemplate) {
      const tpl = JSON.stringify(step.multipartTemplate, null, 2).replace(
        /"\\?\$\{([^}]+)\}"/g,
        (_, v) => `ctx["${v}"]`,
      );
      // Indent all lines after the first so the object literal aligns under
      // the opening `{` in the deploy() call.
      const tplIndented = tpl
        .split('\n')
        .map((line: string, i: number) => (i === 0 ? line : `    ${line}`))
        .join('\n');
      // Derive strip rules from globalContextSeeds so deploy() has no
      // hard-coded domain knowledge about sentinel values or field names.
      const strips = globalContextSeeds
        .filter((seed) => seed.stripFromMultipartWhenDefault && seed.defaultSentinel !== undefined)
        .map((seed) => ({ fieldName: seed.fieldName, sentinel: seed.defaultSentinel }));
      const stripsArg = strips.length > 0 ? `, ${JSON.stringify(strips)}` : '';
      body.push(
        `    const ${varName} = await deploy(ctx, request, ${tplIndented}, baseUrl${stripsArg});`,
      );
      // Explicit status assertion mirrors the normal request path so the
      // generated suite's assertion pattern is consistent across all steps.
      // deploy() also throws on non-200 with the response body, but the
      // expect() call keeps the declared expectation visible in the test.
      body.push(`    expect(${varName}.status()).toBe(${step.expect.status});`);
    } else {
      body.push(`    const url = baseUrl + ${urlExpr};`);
      const bodyVar = `body${idx + 1}`;
      if (step.bodyKind === 'json' && step.bodyTemplate) {
        const json = JSON.stringify(step.bodyTemplate, null, 4).replace(
          /"\\?\$\{([^}]+)\}"/g,
          (_, v) => `ctx["${v}"]`,
        );
        body.push(`    const ${bodyVar} = ${json};`);
      } else if (step.bodyKind === 'multipart' && step.multipartTemplate) {
        // Non-createDeployment multipart template
        const tpl = JSON.stringify(step.multipartTemplate, null, 4).replace(
          /"\\?\$\{([^}]+)\}"/g,
          (_, v) => `ctx["${v}"]`,
        );
        body.push(`    const ${bodyVar} = ${tpl};`);
      }
      const opts: string[] = [];
      opts.push('headers: await authHeaders()');
      if (step.bodyKind === 'json' && step.bodyTemplate) opts.push(`data: ${bodyVar}`);
      if (step.bodyKind === 'multipart' && step.multipartTemplate) {
        // Convert template to Playwright's expected multipart shape: a keyed object map.
        // Field values are stringified (`String(v)`); file values are passed as
        // `{ name, mimeType, buffer }`. The element type below mirrors the
        // permissive subset of Playwright's `multipart` option that we actually
        // emit, so the generated suite typechecks under `strict: true` when
        // `request.post({ multipart })` is called.
        body.push(
          `    const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {};`,
        );
        body.push(`    for (const [k,v] of Object.entries(${bodyVar}.fields||{})) {`);
        // Emit a strip branch for every globalContextSeeds entry whose
        // sentinel local was declared in the prologue. The emitter never
        // hard-codes a field name here — the field name is the metadata key
        // and the local was named after it.
        for (const [fieldName, local] of sentinelLocals) {
          body.push(`      if (k === '${fieldName}' && ${local}) continue;`);
        }
        body.push(`      if (v !== undefined && v !== null) multipart[k] = String(v);`);
        body.push(`    }`);
        body.push(`    for (const [k,v] of Object.entries(${bodyVar}.files||{})) {
        if (typeof v === 'string' && v.startsWith('@@FILE:')) {
          const p = v.slice('@@FILE:'.length);
          const buf = await resolveFixture(p);
          const name = p.split('/').pop() || 'file';
          multipart[k] = { name, mimeType: 'application/octet-stream', buffer: buf };
        } else {
          multipart[k] = String(v);
        }
      }`);
        opts.push('multipart: multipart');
      }
      // (#106) Eventually-consistent reads are wrapped with awaitEventually(),
      // which retries the same request within a budget until the response is
      // observably consistent (default predicate for POST .../search:
      // `body.items.length > 0`; for GET: any 200) and returns the final
      // APIResponse. Non-EC steps go straight through `request.${method}`.
      if (awaitStepIndices.has(idx)) {
        body.push(`    const ${varName} = await awaitEventually(`);
        body.push(`      async () => request.${method}(url, { ${opts.join(', ')} }),`);
        body.push(
          `      { method: '${step.method.toUpperCase()}', operationId: '${step.operationId}' },`,
        );
        body.push(`    );`);
      } else {
        body.push(`    const ${varName} = await request.${method}(url, { ${opts.join(', ')} });`);
      }
      body.push(`    if (${varName}.status() !== ${step.expect.status}) {`);
      body.push(`      try { console.error('Response body:', await ${varName}.text()); } catch {}`);
      body.push(`    }`);
      body.push(`    expect(${varName}.status()).toBe(${step.expect.status});`);
    }
    // Record observation for this step (best-effort). Only capture response shapes for 200 responses.
    // For deploy() steps the helper throws on non-200, so __status is always 200 when this block runs.
    if (recordResponses) {
      body.push(`    try {`);
      body.push(`      const __status = ${varName}.status();`);
      // `unknown` + assigned-or-stays-undefined; the subsequent
      // `bodyJson !== undefined` guard before sanitizeBody() preserves the
      // contract. Drops both the noExplicitAny error and the
      // noUselessUndefinedInitialization info from the generated suite.
      body.push(`      let bodyJson: unknown;`);
      body.push(
        `      if (__status === 200) { try { bodyJson = await ${varName}.json(); } catch {} }`,
      );
      body.push(`      await recordResponse({`);
      body.push(`        timestamp: new Date().toISOString(),`);
      // Use the step's declared operationId instead of indexing scenario.operations (which may have fewer entries than request steps, e.g. duplicate tests)
      body.push(`        operationId: '${step.operationId}',`);
      body.push(`        scenarioId: '${s.id}',`);
      body.push(`        scenarioName: ${JSON.stringify(s.name || '')},`);
      body.push(`        stepIndex: ${idx},`);
      body.push(`        isFinal: ${isFinal},`);
      body.push(`        method: '${step.method}',`);
      body.push(`        pathTemplate: ${JSON.stringify(step.pathTemplate)},`);
      body.push(`        status: __status,`);
      body.push(`        expectedStatus: ${step.expect.status},`);
      body.push(`        errorScenario: ${s.expectedResult && s.expectedResult.kind === 'error'},`);
      body.push(
        `        bodyShape: (__status === 200 && bodyJson !== undefined) ? sanitizeBody(bodyJson) : undefined`,
      );
      body.push(`      });`);
      body.push(`    } catch {}`);
    }
    // If this is the final step and scenario expects a success body, validate response shape
    const isErrorScenario = s.expectedResult && s.expectedResult.kind === 'error';
    if (isFinal && hasShape && !isErrorScenario) {
      // Use JSON.stringify for every value so the emitted route spec is uniformly
      // double-quoted (no mixed single/double quotes) and any special characters
      // in the path template are correctly escaped.
      const routeSpec = `{ path: ${JSON.stringify(step.pathTemplate)}, method: ${JSON.stringify(step.method.toUpperCase())}, status: ${JSON.stringify(String(step.expect.status))} }`;
      body.push(
        `    await validateResponse(${routeSpec}, ${varName}, { responsesFilePath: __responsesFile });`,
      );
    }
    // Extraction. `extractInto` is the vendored helper from support/seeding.ts;
    // it skips the assignment when the value is `undefined` so seeded bindings
    // and earlier extracts in the same scenario aren't clobbered by a later step
    // whose response shape omits the field.
    // deploy() steps: deploy() already extracts all known deployment response
    // fields internally (processDefinitionKeyVar, deploymentKeyVar, tenantIdVar,
    // etc.). Emitting those same extractInto() calls outside the helper would
    // call resp.json() a second time and duplicate every assignment.
    // Exception: placeholderAlias entries (note === 'placeholderAlias') bind to
    // DIFFERENT ctx keys than deploy()'s hard-coded targets (e.g. an alias from
    // processDefinitionKey → processDefinitionIdVar). deploy() has no knowledge
    // of these aliases, so they must still be emitted here.
    const effectiveExtracts = isDeploymentStep
      ? (step.extract ?? []).filter((ex) => ex.note === 'placeholderAlias')
      : (step.extract ?? []);
    if (effectiveExtracts.length) {
      body.push(`    const json = await ${varName}.json();`);
      for (const ex of effectiveExtracts) {
        const optAcc = toOptionalAccessor(ex.fieldPath);
        body.push(`    extractInto(ctx, '${ex.bind}', json${optAcc});`);
      }
    }
    body.push('  });');
    // #159 PR B: render planner-annotated eventual-state waits AFTER the
    // producer step's block. Emitted as a sibling block (not nested inside
    // the producer's `{ ... }`) so its locals (`witnessUrl`, etc.) don't
    // collide with the producer's, and so the wait is visible at the same
    // indentation depth as the request steps it sits between in the source.
    // The index is forwarded so the per-wait response variable
    // (`witnessRespN`) stays unique when a single producer step has
    // multiple eventual waits.
    (step.eventualWaitsAfter ?? []).forEach((wait, waitIdx) => {
      body.push(...renderEventualWait(wait, waitIdx));
    });
  });
  body.push('});');
  return body.join('\n');
}

function buildUrlExpression(pathTemplate: string): string {
  // Replace {param} with string interpolation referencing ctx binding paramVar if exists
  return (
    '`' +
    pathTemplate.replace(/\{([^}]+)\}/g, (_, p) => `\${ctx.${camelCase(p)}Var || '\${${p}}'}`) +
    '`'
  );
}

function escapeQuotes(s: string): string {
  return s.replace(/'/g, "'");
}
function camelCase(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Render a planner-annotated eventual-state wait as a sibling block to a
 * producer step (#159 PR B). The emitted code:
 *
 *   - resolves the witness URL with the same ctx-binding rewrite the
 *     request steps use (`buildUrlExpression`), so a witness referencing
 *     `{processInstanceKey}` picks up `ctx.processInstanceKeyVar` already
 *     extracted from the producer's response;
 *   - wraps the witness fetch in `awaitEventually(...)` with a structured
 *     predicate generated from the spec — no user-supplied predicate
 *     string is interpolated, so the on-disk config cannot smuggle
 *     arbitrary code into the emitted suite.
 *
 * Returns the source lines (no trailing newlines) for direct push onto
 * the scenario body buffer.
 *
 * Safety: the witness predicate's `path` is validated against
 * `/^[A-Za-z_$][A-Za-z0-9_$]*$/` by the domain-semantics validator
 * (`WitnessPredicateSchema`), so the bracket-access key emitted below
 * is identifier-safe. `equals` is constrained to string|number|boolean,
 * round-tripped through JSON.stringify, which produces a valid TS
 * literal for each of those scalar shapes.
 */
function renderEventualWait(wait: EventualWaitSpec, idx: number): string[] {
  const out: string[] = [];
  const w = wait.witness;
  const respVar = `witnessResp${idx + 1}`;
  out.push(`  // Wait for ${wait.state} (eventual; witness: ${w.operationId})`);
  out.push(`  {`);
  out.push(`    const witnessUrl = baseUrl + ${buildUrlExpression(w.pathTemplate)};`);
  const optionFields: string[] = [
    `method: '${w.method.toUpperCase()}'`,
    `operationId: '${w.operationId}'`,
  ];
  if (typeof w.waitUpToMs === 'number') optionFields.push(`waitUpToMs: ${w.waitUpToMs}`);
  if (typeof w.pollIntervalMs === 'number')
    optionFields.push(`pollIntervalMs: ${w.pollIntervalMs}`);
  // Predicate body: narrow `unknown` to a record, read the configured
  // top-level field, compare with the configured scalar. Indentation
  // matches the surrounding `await awaitEventually(...)` call so the
  // emitted file passes biome's formatter without a separate pass.
  optionFields.push(`predicate: (body) => {
        if (body === null || typeof body !== 'object') return false;
        const v = (body as Record<string, unknown>)['${w.predicate.path}'];
        return v === ${JSON.stringify(w.predicate.equals)};
      }`);
  const method = w.method.toLowerCase();
  // Capture awaitEventually's return value and assert on the status the
  // same way request-step blocks do. awaitEventually returns early
  // (without throwing) on hard-fail statuses (400/401/403/409/422/5xx)
  // so the caller can produce a useful diff via expect(...).toBe(200);
  // ignoring the response (the pre-review shape) would let the scenario
  // proceed to the consumer step and attribute the eventual failure to
  // the wrong place. The 200 assertion below tags the failure to the
  // witness wait. (#159 PR B review.)
  out.push(`    const ${respVar} = await awaitEventually(`);
  out.push(`      async () => request.${method}(witnessUrl, { headers: await authHeaders() }),`);
  out.push(`      {`);
  for (let i = 0; i < optionFields.length; i++) {
    const sep = i === optionFields.length - 1 ? '' : ',';
    out.push(`        ${optionFields[i]}${sep}`);
  }
  out.push(`      },`);
  out.push(`    );`);
  out.push(`    if (${respVar}.status() !== 200) {`);
  out.push(
    `      try { console.error('Witness response body:', await ${respVar}.text()); } catch {}`,
  );
  out.push(`    }`);
  out.push(`    expect(${respVar}.status()).toBe(200);`);
  out.push(`  }`);
  return out;
}

/**
 * Decide which request steps in a scenario should be wrapped with
 * `awaitEventually(...)`. A step is wrapped iff:
 *
 *   1. its `operationId` is listed in `scenario.eventualConsistencyOps`
 *      (the planner marks ops whose authoritative outputs land in
 *      Operate/Tasklist secondary storage with indexing lag); AND
 *   2. it is a *read* step — `GET` or `POST .../search` — because the
 *      poller's retry semantics (404-on-GET, items.length predicate)
 *      apply to reads, not to writes. A write that is itself flagged
 *      EC returns 200 quickly; the lag manifests on the *next* read; AND
 *   3. it expects a `200` (we never poll an error scenario).
 *
 * Returns the set of step indices the emitter should wrap. Exposed
 * (un-exported, file-local) so the import-needed check at the top of
 * `buildSuiteSource` and the per-step wrap decision share one
 * predicate — they cannot drift.
 */
function stepNeedsAwait(s: EndpointScenario): number[] {
  if (!s.requestPlan) return [];
  // Source of truth: each `s.operations[].eventuallyConsistent` (a flag the
  // extractor stamps from the `x-eventually-consistent` vendor extension).
  // The `s.eventualConsistencyOps`/`s.hasEventuallyConsistent` fields are
  // *summaries* the planner computes for some scenario kinds (multi-step
  // chains, trivial scenarios) but not all (featureCoverage scenarios
  // leave them undefined). Reading the per-op flag directly avoids that
  // gap.
  const ecOps = new Set<string>();
  for (const op of s.operations) {
    if (op.eventuallyConsistent) ecOps.add(op.operationId);
  }
  if (ecOps.size === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < s.requestPlan.length; i++) {
    const step = s.requestPlan[i];
    if (!ecOps.has(step.operationId)) continue;
    if (step.expect.status !== 200) continue;
    const method = step.method.toUpperCase();
    const isReadShape =
      method === 'GET' || (method === 'POST' && /\/search\/?$/.test(step.pathTemplate));
    if (!isReadShape) continue;
    out.push(i);
  }
  return out;
}

// Build an accessor using optional chaining for nested/array paths, e.g. a.b[0].c -> ?.a?.b?.[0]?.c
function toOptionalAccessor(fieldPath: string): string {
  // Similar to toPathAccessor but with optional chaining and safe array index segments
  const parts = fieldPath.split('.');
  return parts
    .map((p, i) => {
      const m = p.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\[[0-9]+\])?$/);
      if (m) {
        const base = `${i === 0 ? '?.' : '?.'}${m[1]}`; // always prefix with ?.
        const idx = m[2] ? `?.${m[2]}` : '';
        return base + idx;
      }
      // fallback for unusual keys
      return `?.['${p.replace(/'/g, "\\'")}']`;
    })
    .join('');
}

// Produce a seeded value expression for a binding variable name (string generation focus).
// buildSeedExpression removed in favor of centralized seeding (seedBinding)
