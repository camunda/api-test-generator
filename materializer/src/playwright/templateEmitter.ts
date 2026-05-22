import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  EventualWaitSpec,
  ObserveStep,
  RequestStep,
  TemplateScenarioFile,
} from 'path-analyser/types';
import { computeUniqueBindings, emitCtxSeeding } from './ctxSeeding.js';
import {
  buildUrlExpression,
  escapeQuotes,
  reindent,
  renderEventualWait,
  renderInlineStepLines,
  stepNeedsAwaitForOp,
  toOptionalAccessor,
} from './stepRenderer.js';

/**
 * Per-suite globals used by the universal-seed prologue (Lift 22 / #270).
 * Mirrors the subset of {@link GlobalContextSeed} the existing per-endpoint
 * emitter consumes — kept narrow so the template emitter does not depend on
 * any planner-side type that may grow new fields.
 */
export interface TemplateGlobalContextSeed {
  binding: string;
  seedRule: string;
  /**
   * Mirrors `GlobalContextSeed.omitWhenUnbound` (#342). When `true`,
   * the universal-seed prologue (`emitCtxSeeding` in `ctxSeeding.ts`)
   * skips this entry — the binding is seeded only when a per-scenario
   * step produces or consumes it via `seedBindings`. Without this
   * field threaded through to `emitCtxSeeding`, template suites would
   * keep auto-seeding `tenantIdVar` and reintroduce the on-wire
   * `<default>`-shaped behavior #342 retired.
   */
  omitWhenUnbound?: boolean;
}

export interface EmitTemplateSuitesOptions {
  /**
   * Absolute path to a template's scenarios directory, i.e.
   * `generated/<config>/scenarios/templates/<TemplateName>/`
   * (e.g. `EdgeLifecycle`, `EntityLifecycle`). Each `.json` underneath
   * is read and rendered to one `<Subject>.lifecycle.spec.ts`.
   */
  scenariosDir: string;
  /**
   * Absolute path to the destination directory, i.e.
   * `generated/<config>/playwright/templates/<TemplateName>/`. Wiped
   * and recreated by the caller (the materializer's `run()`).
   */
  outDir: string;
  /**
   * Forwarded verbatim from the materializer's per-endpoint emit path —
   * keeps the universal-seed prologue identical across both code paths so
   * a future schema change cannot leave the template suites silently
   * referencing an obsolete binding name.
   */
  globalContextSeeds: readonly TemplateGlobalContextSeed[];
}

/**
 * Read every lifecycle template scenario JSON from `scenariosDir` and
 * write one Playwright suite per subject to `outDir`. Handles both
 * EdgeLifecycle (membership-search observe) and EntityLifecycle
 * (#280 — get-by-id status observe); dispatch is by
 * `TemplateScenarioFile.subjectKind` ('Edge' vs 'Entity').
 *
 * Suite shape (both templates share steps 1–4, differ on 5/7):
 *   1. universal-seed prologue (one `ctx.<binding> ??= seedBinding(...)`
 *      per configured GlobalContextSeed),
 *   2. one `seedBinding('<name>')` per `PrereqChainStep.seedBindings`
 *      entry not already covered by (1),
 *   3. inline render of each `PrereqChainStep.requestPlan` step,
 *   4. inline render of the `InvokeStep.requestPlan` (the establisher),
 *   5. inline render of the present-`ObserveStep` (membership assertion
 *      for Edge / get-by-id status 200 assertion for Entity),
 *   6. inline render of the revoke `InvokeStep.requestPlan`,
 *   7. inline render of the absent-`ObserveStep` (membership assertion
 *      for Edge / get-by-id status 404 assertion with expect404-mode
 *      awaitEventually for Entity).
 *
 * Returns the absolute paths of files written, in emit order.
 */
export async function emitTemplateSuites(opts: EmitTemplateSuitesOptions): Promise<string[]> {
  // Validate the two seed fields this emitter interpolates directly into
  // single-quoted TS string literals (binding + seedRule) so a malformed
  // or hostile seed value cannot produce invalid (or unsafe) generated
  // code. The per-endpoint emitter's `assertSafeGlobalContextSeeds`
  // helper expects the full GlobalContextSeed schema (fieldName,
  // omitWhenUnbound, …) which this entry point does not see — callers
  // project to the narrow {binding, seedRule} shape on the way in. The
  // local check below covers the same risk surface (string-literal
  // injection) for that narrower payload. (#274 review.)
  assertSafeTemplateSeeds(opts.globalContextSeeds);
  let entries: string[];
  try {
    entries = await fs.readdir(opts.scenariosDir);
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'code' in e && Reflect.get(e, 'code') === 'ENOENT') {
      return [];
    }
    throw e;
  }
  const jsonFiles = entries.filter((f) => f.endsWith('.json')).sort();
  await fs.mkdir(opts.outDir, { recursive: true });
  const written: string[] = [];
  for (const f of jsonFiles) {
    const raw = await fs.readFile(path.join(opts.scenariosDir, f), 'utf8');
    const parsed = parseTemplateScenarioFile(raw, f);
    const source = renderLifecycleSuite(parsed, opts.globalContextSeeds);
    const outPath = path.join(opts.outDir, `${parsed.subjectName}.lifecycle.spec.ts`);
    await fs.writeFile(outPath, source, 'utf8');
    written.push(outPath);
  }
  return written;
}

// ---------------------------------------------------------------------------
// Parsing (runtime contract boundary)
// ---------------------------------------------------------------------------

function parseTemplateScenarioFile(raw: string, fileName: string): TemplateScenarioFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Template scenario file ${fileName} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // The on-disk shape is owned by the planner-side TemplateScenarioFile type.
  // The scenario instantiator wrote it, the L3 invariants assert its shape,
  // and the runtime call paths below access only fields the invariants
  // already guard. Suppression is the documented escape hatch for parsed
  // JSON at a contract boundary.
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
  return json as TemplateScenarioFile;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderLifecycleSuite(
  file: TemplateScenarioFile,
  globalContextSeeds: readonly TemplateGlobalContextSeed[],
): string {
  const scenario = file.scenario;
  const steps = scenario.steps;
  // Validate template shape before emit. The L3 invariants already
  // guarantee this on `npm test`, but the emitter is its own entry point
  // (materializer CLI, future per-suite invocations) and must not produce
  // a syntactically valid spec that secretly elides a step.
  const subjectKind = file.subjectKind;
  if (subjectKind === 'RuntimeEntity') {
    // RuntimeEntity templates share the 3-step shape but differ on the
    // observe step's assertion kind: `fieldEquals` (#305 Phase 4,
    // UpdatedFieldVisibleOnReadBack) vs `stateEquals` (#305 Phase 5d /
    // #189, StateTransitionVisibleAfterAction). Dispatch on the third
    // step's assertion kind so each render path is self-contained.
    if (steps.length !== 3) {
      throw new Error(
        `RuntimeEntity template ${file.subjectName} must have exactly 3 steps; got ${steps.length}.`,
      );
    }
    const observe = steps[2];
    if (observe.kind !== 'observe') {
      throw new Error(
        `RuntimeEntity template ${file.subjectName} step 2 must be an observe step (got '${observe.kind}').`,
      );
    }
    if (observe.assertion.kind === 'fieldEquals') {
      return renderReadBackSuite(file, globalContextSeeds);
    }
    if (observe.assertion.kind === 'stateEquals') {
      return renderStateTransitionSuite(file, globalContextSeeds);
    }
    throw new Error(
      `RuntimeEntity template ${file.subjectName} observe.assertion.kind must be 'fieldEquals' or 'stateEquals' (got '${observe.assertion.kind}').`,
    );
  }
  if (subjectKind !== 'Edge' && subjectKind !== 'Entity') {
    throw new Error(
      `Unknown subjectKind '${String(subjectKind)}' on template scenario for ${file.subjectName}.`,
    );
  }
  const templateLabel = subjectKind === 'Edge' ? 'EdgeLifecycle' : 'EntityLifecycle';
  if (steps.length !== 5) {
    throw new Error(
      `${templateLabel} template ${file.subjectName} must have exactly 5 steps; got ${steps.length}.`,
    );
  }
  const [prereq, establish, observePresent, revoke, observeAbsent] = steps;
  if (prereq.kind !== 'prereqChain') {
    throw new Error(`Step 0 of ${file.subjectName} must be a prereqChain step.`);
  }
  if (establish.kind !== 'invoke') {
    throw new Error(`Step 1 of ${file.subjectName} must be an invoke step.`);
  }
  if (
    observePresent.kind !== 'observe' ||
    observePresent.assertion.kind === 'fieldEquals' ||
    observePresent.assertion.kind === 'stateEquals' ||
    observePresent.assertion.expect !== 'present'
  ) {
    throw new Error(`Step 2 of ${file.subjectName} must be a present-observe step.`);
  }
  if (revoke.kind !== 'invoke') {
    throw new Error(`Step 3 of ${file.subjectName} must be an invoke step.`);
  }
  if (
    observeAbsent.kind !== 'observe' ||
    observeAbsent.assertion.kind === 'fieldEquals' ||
    observeAbsent.assertion.kind === 'stateEquals' ||
    observeAbsent.assertion.expect !== 'absent'
  ) {
    throw new Error(`Step 4 of ${file.subjectName} must be an absent-observe step.`);
  }
  // Per-subject assertion-kind consistency check. The instantiator
  // pairs Edge templates with `membership` assertions and Entity
  // templates with `statusOnly`; a divergence here means a bad
  // scenario file slipped past validation.
  const expectedAssertionKind = subjectKind === 'Edge' ? 'membership' : 'statusOnly';
  if (
    observePresent.assertion.kind !== expectedAssertionKind ||
    observeAbsent.assertion.kind !== expectedAssertionKind
  ) {
    throw new Error(
      `${templateLabel} ${file.subjectName}: expected observe assertion kind '${expectedAssertionKind}', got present='${observePresent.assertion.kind}' / absent='${observeAbsent.assertion.kind}'.`,
    );
  }

  // Collect every RequestStep the suite will render so the per-suite
  // import list reflects the actual code paths emitted below. The
  // emitter has three optional helpers (extractInto, awaitEventually)
  // whose imports must be omitted when unused — otherwise the
  // strict-mode generated-suites typecheck flags
  // `noUnusedImports` and CI fails.
  const allRequestSteps: RequestStep[] = [
    ...prereq.requestPlan,
    establish.requestPlan,
    observePresent.requestPlan,
    revoke.requestPlan,
    observeAbsent.requestPlan,
  ];
  const ecOps = new Set<string>(scenario.eventuallyConsistentOps ?? []);
  // `needsAwaitEventually` covers BOTH eventual-state waits (PR B style
  // annotated waits) AND read-shape steps whose operationId is in the
  // ABox EC set. The latter mirrors the per-endpoint emitter's wrap
  // decision (`stepNeedsAwaitForOp`) so the two emitters cannot drift
  // on which steps get awaitEventually() wrapping.
  //
  // For EntityLifecycle (#280), the absent-observe step's requestPlan
  // expects 200 (the per-endpoint scenario's planned shape), so the
  // standard `stepNeedsAwaitForOp` predicate evaluates against the
  // wrong target status. We separately consult `ecOps.has(observeOpId)`
  // for any Entity observe-by-id step so the import is included.
  const needsExtractInto = allRequestSteps.some((rp) => (rp.extract?.length ?? 0) > 0);
  const needsAwaitEventually =
    allRequestSteps.some((rp) => (rp.eventualWaitsAfter?.length ?? 0) > 0) ||
    allRequestSteps.some((rp) => stepNeedsAwaitForOp(rp, ecOps)) ||
    (subjectKind === 'Entity' &&
      (ecOps.has(observePresent.operationId) || ecOps.has(observeAbsent.operationId)));
  // Multipart steps (e.g. createDocument) inline a `resolveFixture(...)`
  // call on the @@FILE: branch. Without this import the generated suite
  // fails the strict-mode typecheck. Roles aren't in scope for template
  // suites today (no role bundles wired into emitTemplateSuites), so
  // every multipart step falls through to the inline path.
  const needsResolveFixture = allRequestSteps.some(
    (rp) => rp.bodyKind === 'multipart' && !!rp.multipartTemplate,
  );

  const lines: string[] = [];
  lines.push("import { expect, test } from '@playwright/test';");
  lines.push("import { authHeaders, buildBaseUrl } from '../../support/env';");
  const seedingImports = ['initSpecSalt', 'seedBinding'];
  if (needsExtractInto) seedingImports.push('extractInto');
  lines.push(`import { ${seedingImports.join(', ')} } from '../../support/seeding';`);
  if (needsAwaitEventually) {
    lines.push("import { awaitEventually } from '../../support/await-eventually';");
  }
  if (needsResolveFixture) {
    lines.push("import { resolveFixture } from '../../support/fixtures';");
  }
  lines.push('');
  lines.push(`initSpecSalt('${file.subjectName}.lifecycle');`);
  lines.push('');
  lines.push(`test.describe('${file.subjectName} lifecycle', () => {`);
  lines.push(
    `  test('establish ${file.subjectName}, observe present, revoke, observe absent', async ({ request }) => {`,
  );
  lines.push('    const baseUrl = buildBaseUrl();');
  lines.push('    const ctx: Record<string, unknown> = {};');

  // Canonical seeding: literals → planner seedBindings → universal
  // prologue. Shared with `emitter.ts` via `emitCtxSeeding` (#286) so
  // the two emitters can no longer drift on form or ordering.
  lines.push(
    ...emitCtxSeeding({
      indent: '    ',
      bindings: prereq.bindings,
      seedBindings: prereq.seedBindings,
      globalContextSeeds,
      uniqueBindings: computeUniqueBindings(allRequestSteps),
    }),
  );

  // (3) prereqChain inline
  let stepIdx = 0;
  for (const rp of prereq.requestPlan) {
    lines.push('');
    appendInlineRequestStep(lines, rp, stepIdx, `prereq: ${rp.operationId}`, ecOps);
    stepIdx++;
  }

  // (4) establish invoke
  lines.push('');
  appendInlineRequestStep(
    lines,
    establish.requestPlan,
    stepIdx,
    `invoke (establish): ${establish.operationId}`,
    ecOps,
  );
  stepIdx++;

  // (5) observe present
  lines.push('');
  appendObserveStep(lines, observePresent, scenario.bindings, stepIdx, 'observe (present)', ecOps);
  stepIdx++;

  // (6) revoke invoke
  lines.push('');
  appendInlineRequestStep(
    lines,
    revoke.requestPlan,
    stepIdx,
    `invoke (revoke): ${revoke.operationId}`,
    ecOps,
  );
  stepIdx++;

  // (7) observe absent
  lines.push('');
  appendObserveStep(lines, observeAbsent, scenario.bindings, stepIdx, 'observe (absent)', ecOps);

  lines.push('  });');
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Per-step rendering — delegates to the shared `stepRenderer` module so
// the template and per-endpoint emitters cannot drift on placeholder
// substitution, eventual-consistency wrapping, body emission, status
// assertion, or extract shape (#270 review: avoid the divergence class).
// ---------------------------------------------------------------------------

const EXTRA_INDENT = '  '; // +2 spaces vs the shared renderer's 4-space baseline
// Shared `renderEventualWait` emits at 2-space outer indent. Template
// suite's `await test.step(...)` calls live at 4-space depth (inside
// `describe → test`), so waits become true siblings of the step at
// +2 spaces re-indent — NOT +4 (which would over-indent them past the
// step body). (#274 review.)
const WAIT_INDENT = '  ';

function appendInlineRequestStep(
  lines: string[],
  step: RequestStep,
  idx: number,
  label: string,
  ecOps: ReadonlySet<string>,
): void {
  const respVar = `resp${idx + 1}`;
  const urlExpr = buildUrlExpression(step.pathTemplate);
  const method = step.method.toLowerCase();
  lines.push(`    await test.step('${escapeQuotes(label)}', async () => {`);
  // The shared `renderInlineStepLines` returns lines at 4-space indent
  // (the per-endpoint emitter's baseline). Re-indent by +2 to fit the
  // template suite's deeper nesting (`describe → test → test.step`).
  const inline = renderInlineStepLines({
    step,
    idx,
    varName: respVar,
    urlExpr,
    method,
    shouldAwaitEventually: stepNeedsAwaitForOp(step, ecOps),
  });
  for (const line of reindent(inline, EXTRA_INDENT)) lines.push(line);
  appendExtracts(lines, step, respVar, idx, '      ');
  lines.push('    });');
  for (const wait of step.eventualWaitsAfter ?? []) {
    appendEventualWait(lines, wait, idx);
  }
}

function appendObserveStep(
  lines: string[],
  step: ObserveStep,
  scenarioBindings: Record<string, string>,
  idx: number,
  label: string,
  ecOps: ReadonlySet<string>,
): void {
  if (step.assertion.kind === 'statusOnly') {
    appendObserveByIdStatusStep(lines, step, idx, label, ecOps);
    return;
  }
  appendObserveMembershipStep(lines, step, scenarioBindings, idx, label, ecOps);
}

/**
 * #280 — EntityLifecycle observe rendering: GET-by-id with a
 * status-only assertion (no body inspection, no membership search).
 *
 * For eventually-consistent observation ops, the absent case
 * (`expectedStatus === 404`) wraps the fetch in
 * `awaitEventually({ expect404: true })` so 404 becomes the success
 * terminator and 200 keeps polling. The present case wraps in default
 * awaitEventually (404 = retry, 200 = success). For non-EC ops both
 * cases emit a plain `request.get(...)` call.
 */
function appendObserveByIdStatusStep(
  lines: string[],
  step: ObserveStep,
  idx: number,
  label: string,
  ecOps: ReadonlySet<string>,
): void {
  if (step.assertion.kind !== 'statusOnly') {
    throw new Error(
      `appendObserveByIdStatusStep called with assertion.kind='${step.assertion.kind}'`,
    );
  }
  const respVar = `resp${idx + 1}`;
  const urlExpr = buildUrlExpression(step.requestPlan.pathTemplate);
  const method = step.requestPlan.method.toLowerCase();
  const expectedStatus = step.assertion.expectedStatus;
  const isEC = ecOps.has(step.operationId);
  // Only retry on a status mismatch when the op is EC. For the
  // present case we use default awaitEventually behaviour (404 →
  // retry, 200 → success). For the absent case we flip polarity with
  // `expect404: true` (200 → keep polling, 404 → success).
  const wrap = isEC;
  const useExpect404 = isEC && expectedStatus === 404;

  lines.push(`    await test.step('${escapeQuotes(label)}', async () => {`);
  lines.push(`      const url = baseUrl + ${urlExpr};`);
  if (wrap) {
    lines.push(`      const ${respVar} = await awaitEventually(`);
    lines.push(`        async () => request.${method}(url, { headers: await authHeaders() }),`);
    lines.push(`        {`);
    lines.push(`          method: '${step.requestPlan.method.toUpperCase()}',`);
    lines.push(`          operationId: '${step.operationId}',`);
    if (useExpect404) lines.push(`          expect404: true,`);
    lines.push(`        },`);
    lines.push(`      );`);
  } else {
    lines.push(
      `      const ${respVar} = await request.${method}(url, { headers: await authHeaders() });`,
    );
  }
  lines.push(`      if (${respVar}.status() !== ${expectedStatus}) {`);
  lines.push(`        try { console.error('Response body:', await ${respVar}.text()); } catch {}`);
  lines.push('      }');
  lines.push(`      expect(${respVar}.status()).toBe(${expectedStatus});`);
  lines.push('    });');
}

function appendObserveMembershipStep(
  lines: string[],
  step: ObserveStep,
  scenarioBindings: Record<string, string>,
  idx: number,
  label: string,
  ecOps: ReadonlySet<string>,
): void {
  if (step.assertion.kind !== 'membership') {
    throw new Error(
      `appendObserveMembershipStep called with assertion.kind='${step.assertion.kind}'`,
    );
  }
  const respVar = `resp${idx + 1}`;
  const urlExpr = buildUrlExpression(step.requestPlan.pathTemplate);
  const method = step.requestPlan.method.toLowerCase();
  lines.push(`    await test.step('${escapeQuotes(label)}', async () => {`);
  const inline = renderInlineStepLines({
    step: step.requestPlan,
    idx,
    varName: respVar,
    urlExpr,
    method,
    shouldAwaitEventually: stepNeedsAwaitForOp(step.requestPlan, ecOps),
  });
  for (const line of reindent(inline, EXTRA_INDENT)) lines.push(line);
  // Membership assertion (template-unique). Walks the planner-declared
  // arrayPath into the parsed body, projects each element via the
  // `elementField` chain (dotted paths supported), and asserts
  // presence/absence of the scenario-bound value.
  lines.push(`      const __body = await ${respVar}.json();`);
  const accessChain = buildOptionalAccessChain('__body', step.assertion.arrayPath);
  lines.push(`      const __raw = ${accessChain};`);
  // Fail loudly when the planner-declared arrayPath does not resolve to
  // an array — the previous silent `Array.isArray(__raw) ? __raw : []`
  // fallback would let an absent-observe assertion pass against a
  // malformed response (e.g. server returned 200 with an unexpected
  // shape), masking real defects. (#274 review.)
  lines.push('      if (!Array.isArray(__raw)) {');
  lines.push(
    `        throw new Error('Observe assertion at arrayPath ${JSON.stringify(step.assertion.arrayPath).replace(/'/g, "\\'")} expected an array but got: ' + JSON.stringify(__raw));`,
  );
  lines.push('      }');
  lines.push('      const __arr: unknown[] = __raw;');
  const elementSegments = step.assertion.elementField.split('.').filter((s) => s.length > 0);
  if (elementSegments.length === 0) {
    throw new Error(`Empty elementField on observe assertion for operationId=${step.operationId}.`);
  }
  const elementAccess = buildOptionalAccessChain('r', elementSegments);
  lines.push(`      const __values = __arr.map((r) => ${elementAccess});`);
  const bindingName = resolveBindingNameForSemantic(
    step.assertion.membershipSemanticType,
    scenarioBindings,
  );
  const verb = step.assertion.expect === 'present' ? 'toContain' : 'not.toContain';
  lines.push(`      expect(__values).${verb}(ctx['${bindingName}']);`);
  // Note: the shared `renderInlineStepLines` does not emit extracts —
  // those live here at the appender layer so the membership assertion
  // sits between the inline call and any planner-declared extracts.
  // The observe step parses the body once for the membership read above;
  // any extracts re-use `__body` rather than re-parsing.
  for (const ex of step.requestPlan.extract ?? []) {
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(ex.bind)) {
      throw new Error(
        `Refusing to emit extract for non-identifier bind name '${ex.bind}' (observe operationId=${step.operationId}).`,
      );
    }
    lines.push(`      extractInto(ctx, '${ex.bind}', __body${toOptionalAccessor(ex.fieldPath)});`);
  }
  lines.push('    });');
  for (const wait of step.requestPlan.eventualWaitsAfter ?? []) {
    appendEventualWait(lines, wait, idx);
  }
}

function appendExtracts(
  lines: string[],
  step: RequestStep,
  respVar: string,
  idx: number,
  indent: string,
): void {
  const extracts = step.extract ?? [];
  if (extracts.length === 0) return;
  // Single-parse pattern: `await respVar.json()` once, then reuse.
  // Matches the per-endpoint emitter (emitter.ts) so a multi-extract
  // step cannot redeclare `jsonN` and break the strict-mode generated-
  // suites typecheck.
  const jsonVar = `json${idx + 1}`;
  lines.push(`${indent}const ${jsonVar} = await ${respVar}.json();`);
  for (const ex of extracts) {
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(ex.bind)) {
      throw new Error(
        `Refusing to emit extract for non-identifier bind name '${ex.bind}' (operationId=${step.operationId}).`,
      );
    }
    lines.push(
      `${indent}extractInto(ctx, '${ex.bind}', ${jsonVar}${toOptionalAccessor(ex.fieldPath)});`,
    );
  }
}

function appendEventualWait(lines: string[], wait: EventualWaitSpec, stepIdx: number): void {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(wait.witness.predicate.path)) {
    throw new Error(
      `Refusing to emit witness predicate with non-identifier path '${wait.witness.predicate.path}'.`,
    );
  }
  // Shared `renderEventualWait` emits at 2-space indent (sibling to the
  // per-endpoint emitter's `test.step` at top-level). Template needs
  // +4 spaces to sit as a sibling to its inner `await test.step(...)`.
  for (const line of reindent(renderEventualWait(wait, stepIdx), WAIT_INDENT)) {
    lines.push(line);
  }
}

// ---------------------------------------------------------------------------
// Template-local helpers (not part of the shared step-renderer contract)
// ---------------------------------------------------------------------------

function buildOptionalAccessChain(rootExpr: string, segments: readonly string[]): string {
  // Optional chain over a `unknown` root: cast each level to an indexable
  // record. Used by the observe-step membership assertion's array-path
  // walk and per-element field projection. Kept local because the
  // per-endpoint emitter's extract path uses `toOptionalAccessor`
  // (string-based dotted paths) instead; the membership assertion
  // operates on an already-segmented path so a different shape is
  // appropriate.
  let acc = rootExpr;
  for (const seg of segments) {
    acc = `(${acc} as Record<string, unknown> | null | undefined)?.['${seg}']`;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// #305 Phase 4 — UpdatedFieldVisibleOnReadBack render path
// ---------------------------------------------------------------------------

/**
 * Render a 3-step `UpdatedFieldVisibleOnReadBack` template scenario:
 *   1. prereqChain inline (establish the runtime entity + bind its id)
 *   2. invoke (mutator)
 *   3. observe (fetcher; assert each `fieldEquals` tuple)
 *
 * Parallel to {@link renderLifecycleSuite}'s 5-step shape but no
 * revoke / absent-observe pair (runtime-emitted entities don't have a
 * client-facing teardown).
 */
function renderReadBackSuite(
  file: TemplateScenarioFile,
  globalContextSeeds: readonly TemplateGlobalContextSeed[],
): string {
  const scenario = file.scenario;
  const steps = scenario.steps;
  if (steps.length !== 3) {
    throw new Error(
      `UpdatedFieldVisibleOnReadBack template ${file.subjectName} must have exactly 3 steps; got ${steps.length}.`,
    );
  }
  const [prereq, mutate, observe] = steps;
  if (prereq.kind !== 'prereqChain') {
    throw new Error(`Step 0 of ${file.subjectName} must be a prereqChain step.`);
  }
  if (mutate.kind !== 'invoke') {
    throw new Error(`Step 1 of ${file.subjectName} must be an invoke step.`);
  }
  if (observe.kind !== 'observe' || observe.assertion.kind !== 'fieldEquals') {
    throw new Error(
      `Step 2 of ${file.subjectName} must be an observe step with assertion.kind='fieldEquals'.`,
    );
  }
  const allRequestSteps: RequestStep[] = [
    ...prereq.requestPlan,
    mutate.requestPlan,
    observe.requestPlan,
  ];
  const ecOps = new Set<string>(scenario.eventuallyConsistentOps ?? []);
  const needsExtractInto = allRequestSteps.some((rp) => (rp.extract?.length ?? 0) > 0);
  const needsAwaitEventually =
    allRequestSteps.some((rp) => (rp.eventualWaitsAfter?.length ?? 0) > 0) ||
    allRequestSteps.some((rp) => stepNeedsAwaitForOp(rp, ecOps)) ||
    ecOps.has(observe.operationId);
  const needsResolveFixture = allRequestSteps.some(
    (rp) => rp.bodyKind === 'multipart' && !!rp.multipartTemplate,
  );

  const lines: string[] = [];
  lines.push("import { expect, test } from '@playwright/test';");
  lines.push("import { authHeaders, buildBaseUrl } from '../../support/env';");
  const seedingImports = ['initSpecSalt', 'seedBinding'];
  if (needsExtractInto) seedingImports.push('extractInto');
  lines.push(`import { ${seedingImports.join(', ')} } from '../../support/seeding';`);
  if (needsAwaitEventually) {
    lines.push("import { awaitEventually } from '../../support/await-eventually';");
  }
  if (needsResolveFixture) {
    lines.push("import { resolveFixture } from '../../support/fixtures';");
  }
  lines.push('');
  lines.push(`initSpecSalt('${file.subjectName}.lifecycle');`);
  lines.push('');
  lines.push(`test.describe('${file.subjectName} read-back', () => {`);
  lines.push(
    `  test('mutate ${file.subjectName}, observe field on read-back', async ({ request }) => {`,
  );
  lines.push('    const baseUrl = buildBaseUrl();');
  lines.push('    const ctx: Record<string, unknown> = {};');

  lines.push(
    ...emitCtxSeeding({
      indent: '    ',
      bindings: prereq.bindings,
      seedBindings: prereq.seedBindings,
      globalContextSeeds,
      uniqueBindings: computeUniqueBindings(allRequestSteps),
    }),
  );

  let stepIdx = 0;
  for (const rp of prereq.requestPlan) {
    lines.push('');
    appendInlineRequestStep(lines, rp, stepIdx, `prereq: ${rp.operationId}`, ecOps);
    stepIdx++;
  }

  lines.push('');
  appendInlineRequestStep(
    lines,
    mutate.requestPlan,
    stepIdx,
    `invoke (mutate): ${mutate.operationId}`,
    ecOps,
  );
  stepIdx++;

  lines.push('');
  appendObserveFieldEqualsStep(
    lines,
    observe,
    mutate.requestPlan,
    stepIdx,
    `observe (read-back): ${observe.operationId}`,
    ecOps,
  );

  lines.push('  });');
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/**
 * Render an observe step whose assertion is `fieldEquals`. The
 * expected value for each tuple is sourced directly from the mutator
 * request body literal at `requestBodyPath` (because the planner emits
 * concrete values at body materialisation time, not symbolic
 * placeholders). The actual value is read from the fetcher 2xx
 * response body at `responseBodyPath`.
 */
function appendObserveFieldEqualsStep(
  lines: string[],
  step: ObserveStep,
  mutatorStep: RequestStep,
  idx: number,
  label: string,
  ecOps: ReadonlySet<string>,
): void {
  if (step.assertion.kind !== 'fieldEquals') {
    throw new Error(
      `appendObserveFieldEqualsStep called with assertion.kind='${step.assertion.kind}'`,
    );
  }
  const respVar = `resp${idx + 1}`;
  const urlExpr = buildUrlExpression(step.requestPlan.pathTemplate);
  const method = step.requestPlan.method.toLowerCase();
  const isEC = ecOps.has(step.operationId);
  lines.push(`    await test.step('${escapeQuotes(label)}', async () => {`);
  if (isEC) {
    lines.push(`      const url = baseUrl + ${urlExpr};`);
    lines.push(`      const ${respVar} = await awaitEventually(`);
    lines.push(`        async () => request.${method}(url, { headers: await authHeaders() }),`);
    lines.push(`        {`);
    lines.push(`          method: '${step.requestPlan.method.toUpperCase()}',`);
    lines.push(`          operationId: '${step.operationId}',`);
    lines.push(`        },`);
    lines.push(`      );`);
  } else {
    const inline = renderInlineStepLines({
      step: step.requestPlan,
      idx,
      varName: respVar,
      urlExpr,
      method,
      shouldAwaitEventually: false,
    });
    for (const line of reindent(inline, EXTRA_INDENT)) lines.push(line);
  }
  lines.push(`      if (${respVar}.status() !== 200) {`);
  lines.push(`        try { console.error('Response body:', await ${respVar}.text()); } catch {}`);
  lines.push('      }');
  lines.push(`      expect(${respVar}.status()).toBe(200);`);
  lines.push(`      const __body = await ${respVar}.json();`);
  for (const f of step.assertion.fields) {
    const expectedValue = pluckByPath(mutatorStep.bodyTemplate, f.requestBodyPath);
    if (expectedValue === undefined) {
      throw new Error(
        `fieldEquals: mutator body has no value at path ${JSON.stringify(f.requestBodyPath)} for observe operationId=${step.operationId}.`,
      );
    }
    const accessExpr = buildOptionalAccessChain('__body', stripArrayMarkers(f.responseBodyPath));
    const literal = JSON.stringify(expectedValue);
    lines.push(`      expect(${accessExpr}).toEqual(${literal});`);
  }
  lines.push('    });');
  for (const wait of step.requestPlan.eventualWaitsAfter ?? []) {
    appendEventualWait(lines, wait, idx);
  }
}

// ---------------------------------------------------------------------------
// #305 Phase 5d / #189 — StateTransitionVisibleAfterAction render path
// ---------------------------------------------------------------------------

/**
 * Render a 3-step `StateTransitionVisibleAfterAction` template
 * scenario (per Incident.resolveIncident, etc.):
 *   1. prereqChain inline (establish the runtime entity + bind its id,
 *      typically deploy → createProcessInstance → searchIncidents)
 *   2. invoke (transition op, e.g. resolveIncident)
 *   3. observe (fetcher; assert body.<stateField> === expectedState)
 *
 * Parallel to {@link renderReadBackSuite}; differs only in the
 * observe step's assertion shape — `stateEquals` reads the expected
 * value from the assertion itself rather than the mutator body.
 */
function renderStateTransitionSuite(
  file: TemplateScenarioFile,
  globalContextSeeds: readonly TemplateGlobalContextSeed[],
): string {
  const scenario = file.scenario;
  const steps = scenario.steps;
  if (steps.length !== 3) {
    throw new Error(
      `StateTransitionVisibleAfterAction template ${file.subjectName} must have exactly 3 steps; got ${steps.length}.`,
    );
  }
  const [prereq, transition, observe] = steps;
  if (prereq.kind !== 'prereqChain') {
    throw new Error(`Step 0 of ${file.subjectName} must be a prereqChain step.`);
  }
  if (transition.kind !== 'invoke') {
    throw new Error(`Step 1 of ${file.subjectName} must be an invoke step.`);
  }
  if (observe.kind !== 'observe' || observe.assertion.kind !== 'stateEquals') {
    throw new Error(
      `Step 2 of ${file.subjectName} must be an observe step with assertion.kind='stateEquals'.`,
    );
  }
  const allRequestSteps: RequestStep[] = [
    ...prereq.requestPlan,
    transition.requestPlan,
    observe.requestPlan,
  ];
  const ecOps = new Set<string>(scenario.eventuallyConsistentOps ?? []);
  const needsExtractInto = allRequestSteps.some((rp) => (rp.extract?.length ?? 0) > 0);
  const needsAwaitEventually =
    allRequestSteps.some((rp) => (rp.eventualWaitsAfter?.length ?? 0) > 0) ||
    allRequestSteps.some((rp) => stepNeedsAwaitForOp(rp, ecOps)) ||
    ecOps.has(observe.operationId);
  const needsResolveFixture = allRequestSteps.some(
    (rp) => rp.bodyKind === 'multipart' && !!rp.multipartTemplate,
  );

  const lines: string[] = [];
  lines.push("import { expect, test } from '@playwright/test';");
  lines.push("import { authHeaders, buildBaseUrl } from '../../support/env';");
  const seedingImports = ['initSpecSalt', 'seedBinding'];
  if (needsExtractInto) seedingImports.push('extractInto');
  lines.push(`import { ${seedingImports.join(', ')} } from '../../support/seeding';`);
  if (needsAwaitEventually) {
    lines.push("import { awaitEventually } from '../../support/await-eventually';");
  }
  if (needsResolveFixture) {
    lines.push("import { resolveFixture } from '../../support/fixtures';");
  }
  lines.push('');
  lines.push(`initSpecSalt('${file.subjectName}.state-transition');`);
  lines.push('');
  const fromTo = `${observe.assertion.fromState} → ${observe.assertion.expectedState}`;
  lines.push(`test.describe('${file.subjectName} state transition (${fromTo})', () => {`);
  lines.push(
    `  test('invoke ${transition.operationId}, observe state=${observe.assertion.expectedState} on read-back', async ({ request }) => {`,
  );
  lines.push('    const baseUrl = buildBaseUrl();');
  lines.push('    const ctx: Record<string, unknown> = {};');

  lines.push(
    ...emitCtxSeeding({
      indent: '    ',
      bindings: prereq.bindings,
      seedBindings: prereq.seedBindings,
      globalContextSeeds,
      uniqueBindings: computeUniqueBindings(allRequestSteps),
    }),
  );

  let stepIdx = 0;
  for (const rp of prereq.requestPlan) {
    lines.push('');
    appendInlineRequestStep(lines, rp, stepIdx, `prereq: ${rp.operationId}`, ecOps);
    stepIdx++;
  }

  lines.push('');
  appendInlineRequestStep(
    lines,
    transition.requestPlan,
    stepIdx,
    `invoke (transition): ${transition.operationId}`,
    ecOps,
  );
  stepIdx++;

  lines.push('');
  appendObserveStateEqualsStep(
    lines,
    observe,
    stepIdx,
    `observe (read-back): ${observe.operationId}`,
    ecOps,
  );

  lines.push('  });');
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/**
 * Render an observe step whose assertion is `stateEquals`. Reads the
 * fetcher's 200 response and asserts a single equality on the named
 * state field against the literal `expectedState` from the assertion.
 */
function appendObserveStateEqualsStep(
  lines: string[],
  step: ObserveStep,
  idx: number,
  label: string,
  ecOps: ReadonlySet<string>,
): void {
  if (step.assertion.kind !== 'stateEquals') {
    throw new Error(
      `appendObserveStateEqualsStep called with assertion.kind='${step.assertion.kind}'`,
    );
  }
  const respVar = `resp${idx + 1}`;
  const urlExpr = buildUrlExpression(step.requestPlan.pathTemplate);
  const method = step.requestPlan.method.toLowerCase();
  const isEC = ecOps.has(step.operationId);
  lines.push(`    await test.step('${escapeQuotes(label)}', async () => {`);
  if (isEC) {
    lines.push(`      const url = baseUrl + ${urlExpr};`);
    lines.push(`      const ${respVar} = await awaitEventually(`);
    lines.push(`        async () => request.${method}(url, { headers: await authHeaders() }),`);
    lines.push(`        {`);
    lines.push(`          method: '${step.requestPlan.method.toUpperCase()}',`);
    lines.push(`          operationId: '${step.operationId}',`);
    lines.push(`        },`);
    lines.push(`      );`);
  } else {
    const inline = renderInlineStepLines({
      step: step.requestPlan,
      idx,
      varName: respVar,
      urlExpr,
      method,
      shouldAwaitEventually: false,
    });
    for (const line of reindent(inline, EXTRA_INDENT)) lines.push(line);
  }
  lines.push(`      if (${respVar}.status() !== 200) {`);
  lines.push(`        try { console.error('Response body:', await ${respVar}.text()); } catch {}`);
  lines.push('      }');
  lines.push(`      expect(${respVar}.status()).toBe(200);`);
  lines.push(`      const __body = await ${respVar}.json();`);
  const accessExpr = buildOptionalAccessChain(
    '__body',
    stripArrayMarkers(step.assertion.responseBodyPath),
  );
  const literal = JSON.stringify(step.assertion.expectedState);
  lines.push(`      expect(${accessExpr}).toEqual(${literal});`);
  lines.push('    });');
  for (const wait of step.requestPlan.eventualWaitsAfter ?? []) {
    appendEventualWait(lines, wait, idx);
  }
}
/**
 * Walk `body` along `path` (object property names) and return the
 * primitive/array value at that leaf, or `undefined` if any segment
 * misses. Used to extract the literal value the planner emitted for a
 * given request-body leaf so the read-back assertion can match exactly.
 */
function pluckByPath(body: unknown, path: readonly string[]): unknown {
  let node: unknown = body;
  for (const seg of path) {
    if (node === null || typeof node !== 'object') return undefined;
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON body template
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

/**
 * Strip array `[]` markers from response-leaf path segments — the
 * planner records `candidateGroups[]` to indicate an array property,
 * but the runtime read accesses the array via the bare property name.
 */
function stripArrayMarkers(path: readonly string[]): string[] {
  return path.map((s) => s.replace(/\[\]$/, ''));
}

function resolveBindingNameForSemantic(
  semanticType: string,
  bindings: Record<string, string>,
): string {
  // `TemplateScenario.bindings` is semantic-type-keyed: each value is the
  // binding name the planner minted for that semantic (e.g.
  // `{ 'Username': 'usernameVar' }`). Read the map directly rather than
  // re-deriving the binding name from the semantic-type identifier — the
  // map is the authoritative source, and recomputing here would emit the
  // wrong ctx key if the planner's naming convention ever diverged from
  // the `<camelSemantic>Var` rule (e.g. for a semantic whose canonical
  // binding name had a suffix the convention doesn't cover).
  const bindingName = bindings[semanticType];
  if (bindingName === undefined) {
    throw new Error(
      `Membership assertion for semantic type '${semanticType}' is not present ` +
        `in the scenario binding table. Known semantic types: ` +
        `${Object.keys(bindings).join(', ')}.`,
    );
  }
  return bindingName;
}

// ---------------------------------------------------------------------------
// Seed validation (string-literal-injection defence)
// ---------------------------------------------------------------------------

// Identifier-like: lowercase/uppercase letters, digits, underscore, dash,
// dollar; must start with a letter, underscore, or dollar. Covers every
// binding name and seedRule the planner emits today (Lift-22 universal
// seeds, per-edge generated seeds) without permitting characters that
// could break out of a single-quoted TS string literal (quote, backslash,
// newline, template-literal markers).
const SAFE_SEED_TOKEN = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

function assertSafeTemplateSeeds(seeds: readonly TemplateGlobalContextSeed[] | undefined): void {
  if (seeds === undefined) return;
  if (!Array.isArray(seeds)) {
    throw new Error(
      `globalContextSeeds must be an array when provided (received ${
        seeds === null ? 'null' : typeof seeds
      }).`,
    );
  }
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    if (s === null || typeof s !== 'object') {
      throw new Error(`globalContextSeeds[${i}] must be an object.`);
    }
    if (typeof s.binding !== 'string' || !SAFE_SEED_TOKEN.test(s.binding)) {
      throw new Error(
        `globalContextSeeds[${i}].binding must match ${SAFE_SEED_TOKEN.source} (got ${JSON.stringify(s.binding)}).`,
      );
    }
    if (typeof s.seedRule !== 'string' || !SAFE_SEED_TOKEN.test(s.seedRule)) {
      throw new Error(
        `globalContextSeeds[${i}].seedRule must match ${SAFE_SEED_TOKEN.source} (got ${JSON.stringify(s.seedRule)}).`,
      );
    }
  }
}
