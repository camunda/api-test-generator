import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  EventualWaitSpec,
  ObserveStep,
  RequestStep,
  TemplateScenarioFile,
} from 'path-analyser/types';

/**
 * Per-suite globals used by the universal-seed prologue (Lift 22 / #270).
 * Mirrors the subset of {@link GlobalContextSeed} the existing per-endpoint
 * emitter consumes — kept narrow so the template emitter does not depend on
 * any planner-side type that may grow new fields.
 */
export interface TemplateGlobalContextSeed {
  binding: string;
  seedRule: string;
}

export interface EmitTemplateSuitesOptions {
  /**
   * Absolute path to the EdgeLifecycle scenarios directory, i.e.
   * `generated/<config>/scenarios/templates/EdgeLifecycle/`.
   * Each `.json` underneath is read and rendered to one
   * `<EdgeName>.lifecycle.spec.ts`.
   */
  scenariosDir: string;
  /**
   * Absolute path to the destination directory, i.e.
   * `generated/<config>/playwright/edges/`. Wiped and recreated by the
   * caller (the materializer's `run()`).
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
 * Read every EdgeLifecycle template scenario JSON from `scenariosDir` and
 * write one Playwright suite per edge to `outDir`. The emitted suite shape
 * is:
 *
 *   1. universal-seed prologue (one `ctx.<binding> ??= seedBinding(...)` per
 *      configured GlobalContextSeed),
 *   2. one `seedBinding('<name>')` per `PrereqChainStep.seedBindings` entry
 *      not already covered by (1),
 *   3. inline render of each `PrereqChainStep.requestPlan` step,
 *   4. inline render of the `InvokeStep.requestPlan` (the establisher),
 *   5. inline render of the present-`ObserveStep` plus its membership
 *      assertion (`.toContain`),
 *   6. inline render of the revoke `InvokeStep.requestPlan`,
 *   7. inline render of the absent-`ObserveStep` plus its membership
 *      assertion (`.not.toContain`).
 *
 * Returns the absolute paths of files written, in emit order.
 */
export async function emitTemplateSuites(opts: EmitTemplateSuitesOptions): Promise<string[]> {
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
  if (steps.length !== 5) {
    throw new Error(
      `EdgeLifecycle template ${file.subjectName} must have exactly 5 steps; got ${steps.length}.`,
    );
  }
  const [prereq, establish, observePresent, revoke, observeAbsent] = steps;
  if (prereq.kind !== 'prereqChain') {
    throw new Error(`Step 0 of ${file.subjectName} must be a prereqChain step.`);
  }
  if (establish.kind !== 'invoke') {
    throw new Error(`Step 1 of ${file.subjectName} must be an invoke step.`);
  }
  if (observePresent.kind !== 'observe' || observePresent.assertion.expect !== 'present') {
    throw new Error(`Step 2 of ${file.subjectName} must be a present-observe step.`);
  }
  if (revoke.kind !== 'invoke') {
    throw new Error(`Step 3 of ${file.subjectName} must be an invoke step.`);
  }
  if (observeAbsent.kind !== 'observe' || observeAbsent.assertion.expect !== 'absent') {
    throw new Error(`Step 4 of ${file.subjectName} must be an absent-observe step.`);
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
  const needsExtractInto = allRequestSteps.some((rp) => (rp.extract?.length ?? 0) > 0);
  const needsAwaitEventually = allRequestSteps.some(
    (rp) => (rp.eventualWaitsAfter?.length ?? 0) > 0,
  );

  const lines: string[] = [];
  lines.push("import { expect, test } from '@playwright/test';");
  lines.push("import { authHeaders, buildBaseUrl } from '../support/env';");
  const seedingImports = ['initSpecSalt', 'seedBinding'];
  if (needsExtractInto) seedingImports.push('extractInto');
  lines.push(`import { ${seedingImports.join(', ')} } from '../support/seeding';`);
  if (needsAwaitEventually) {
    lines.push("import { awaitEventually } from '../support/await-eventually';");
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

  // (1) universal-seed prologue
  const globalSeedNames = new Set(globalContextSeeds.map((s) => s.binding));
  for (const seed of globalContextSeeds) {
    lines.push(
      `    ctx['${seed.binding}'] = ctx['${seed.binding}'] ?? seedBinding('${seed.seedRule}');`,
    );
  }

  // (2) per-scenario seedBindings (filtered to avoid double-seeding globals)
  const seedNames = (prereq.seedBindings ?? []).filter((n) => !globalSeedNames.has(n));
  for (const name of seedNames) {
    lines.push(`    if (ctx['${name}'] === undefined) {`);
    lines.push(`      ctx['${name}'] = seedBinding('${name}');`);
    lines.push('    }');
  }
  // Literal bindings from the BFS scenario (non-PENDING) flow into ctx so a
  // later step can read the planner-minted value before any extract overwrites
  // it. PENDING entries are covered by the seedBindings loop above. Iterates
  // `prereq.bindings` (binding-name-keyed, same shape as
  // `EndpointScenario.bindings`) — NOT `scenario.bindings`, which is
  // semantic-type-keyed and would resolve to meaningless ctx keys.
  for (const [k, v] of Object.entries(prereq.bindings)) {
    if (v === '__PENDING__') continue;
    if (globalSeedNames.has(k)) continue; // already covered by prologue
    lines.push(`    ctx['${k}'] = ${JSON.stringify(v)};`);
  }

  // (3) prereqChain inline
  let stepIdx = 0;
  for (const rp of prereq.requestPlan) {
    lines.push('');
    appendInlineRequestStep(lines, rp, stepIdx, `prereq: ${rp.operationId}`);
    stepIdx++;
  }

  // (4) establish invoke
  lines.push('');
  appendInlineRequestStep(
    lines,
    establish.requestPlan,
    stepIdx,
    `invoke (establish): ${establish.operationId}`,
  );
  stepIdx++;

  // (5) observe present
  lines.push('');
  appendObserveStep(lines, observePresent, scenario.bindings, stepIdx, 'observe (present)');
  stepIdx++;

  // (6) revoke invoke
  lines.push('');
  appendInlineRequestStep(
    lines,
    revoke.requestPlan,
    stepIdx,
    `invoke (revoke): ${revoke.operationId}`,
  );
  stepIdx++;

  // (7) observe absent
  lines.push('');
  appendObserveStep(lines, observeAbsent, scenario.bindings, stepIdx, 'observe (absent)');

  lines.push('  });');
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

function appendInlineRequestStep(
  lines: string[],
  step: RequestStep,
  idx: number,
  label: string,
): void {
  const respVar = `resp${idx + 1}`;
  const bodyVar = `body${idx + 1}`;
  const urlExpr = buildUrlExpression(step.pathTemplate);
  const method = step.method.toLowerCase();
  lines.push(`    await test.step('${escapeQuotes(label)}', async () => {`);
  lines.push(`      const url = baseUrl + ${urlExpr};`);
  const opts: string[] = ['headers: await authHeaders()'];
  if (step.bodyKind === 'json' && step.bodyTemplate !== undefined) {
    const json = JSON.stringify(step.bodyTemplate, null, 2).replace(
      /"\$\{([^}]+)\}"/g,
      (_, v) => `ctx['${v}']`,
    );
    // Indent the JSON literal so it lines up with the surrounding two-level
    // (8-space) body — pretty-printing without this leaves the inner lines
    // at column 0 and trips the suite's strict tsconfig include via Biome.
    const indented = json.replace(/\n/g, '\n      ');
    lines.push(`      const ${bodyVar} = ${indented};`);
    opts.push(`data: ${bodyVar}`);
  }
  lines.push(`      const ${respVar} = await request.${method}(url, { ${opts.join(', ')} });`);
  lines.push(`      if (${respVar}.status() !== ${step.expect.status}) {`);
  lines.push(`        try { console.error('Response body:', await ${respVar}.text()); } catch {}`);
  lines.push('      }');
  lines.push(`      expect(${respVar}.status()).toBe(${step.expect.status});`);
  // Response extraction. Mirrors the per-endpoint emitter's per-step
  // extract loop so a planner-annotated extract (e.g. server-assigned
  // RoleId echoed in the createRole response) flows back into ctx and
  // is visible to later prereq / invoke / observe steps. Without this,
  // a future template whose establisher consumes a server-generated
  // identifier (rather than the client-seeded one OCA edges happen to
  // use) would silently send `undefined` and the suite would 4xx at
  // runtime with no diagnostic at emit time.
  const extracts = step.extract ?? [];
  if (extracts.length > 0) {
    // Parse the response body ONCE per step. A previous shape declared
    // `const jsonN = await ${respVar}.json()` inside the per-extract
    // loop, which redeclared the same identifier when a step had more
    // than one extract and broke the strict-mode generated-suites
    // typecheck. The per-endpoint emitter does the same single-parse
    // pattern (materializer/src/playwright/emitter.ts).
    lines.push(`      const json${idx + 1} = await ${respVar}.json();`);
    for (const ex of extracts) {
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(ex.bind)) {
        throw new Error(
          `Refusing to emit extract for non-identifier bind name '${ex.bind}' (operationId=${step.operationId}).`,
        );
      }
      lines.push(
        `      extractInto(ctx, '${ex.bind}', ${buildOptionalAccessChain(`json${idx + 1}`, ex.fieldPath.split('.'))});`,
      );
    }
  }
  lines.push('    });');
  // Planner-annotated eventual-state waits (#159 PR B) — emitted as a
  // sibling block at the same indentation as the test step so the
  // wait's locals stay isolated. None of the current OCA edges
  // populate `eventualWaitsAfter`, but future Edge-scoped templates
  // whose establishers transition through an eventual state will,
  // and silently dropping the planner's annotation here would race
  // the subsequent observe step.
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
): void {
  const respVar = `resp${idx + 1}`;
  const urlExpr = buildUrlExpression(step.requestPlan.pathTemplate);
  const method = step.requestPlan.method.toLowerCase();
  lines.push(`    await test.step('${escapeQuotes(label)}', async () => {`);
  lines.push(`      const url = baseUrl + ${urlExpr};`);
  const opts: string[] = ['headers: await authHeaders()'];
  if (step.requestPlan.bodyKind === 'json' && step.requestPlan.bodyTemplate !== undefined) {
    const json = JSON.stringify(step.requestPlan.bodyTemplate, null, 2).replace(
      /"\$\{([^}]+)\}"/g,
      (_, v) => `ctx['${v}']`,
    );
    const indented = json.replace(/\n/g, '\n      ');
    lines.push(`      const body${idx + 1} = ${indented};`);
    opts.push(`data: body${idx + 1}`);
  }
  lines.push(`      const ${respVar} = await request.${method}(url, { ${opts.join(', ')} });`);
  lines.push(`      expect(${respVar}.status()).toBe(${step.requestPlan.expect.status});`);
  // Body extraction + membership assertion. The array lives at `arrayPath`
  // under the parsed JSON. `unknown` is preserved through the access chain;
  // the per-step `.map(...)` callback type-asserts via a runtime guard so
  // the emitted suite typechecks under `strict: true`.
  lines.push(`      const __body = await ${respVar}.json();`);
  const accessChain = buildOptionalAccessChain('__body', step.assertion.arrayPath);
  lines.push(`      const __raw = ${accessChain};`);
  lines.push('      const __arr = Array.isArray(__raw) ? __raw : [];');
  // `elementField` can be a dotted path (e.g. `member.username` for
  // `data.items[].member.username`) — see findMembershipArrayPath's
  // field-path parsing doc. A literal `['member.username']` lookup
  // would always miss; resolve via an optional-access chain per
  // element instead.
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
  // Planner-annotated extracts on the observe step's request plan
  // (mirrors the per-endpoint emitter's per-step extract loop). None
  // of the current OCA edge observers populate `extract`, but the
  // loader contract permits it and silently dropping the annotation
  // would surface as a stale ctx for any consumer-of-observer
  // template authored after Phase 2.
  for (const ex of step.requestPlan.extract ?? []) {
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(ex.bind)) {
      throw new Error(
        `Refusing to emit extract for non-identifier bind name '${ex.bind}' (observe operationId=${step.operationId}).`,
      );
    }
    lines.push(
      `      extractInto(ctx, '${ex.bind}', ${buildOptionalAccessChain('__body', ex.fieldPath.split('.'))});`,
    );
  }
  lines.push('    });');
  // Symmetrical eventual-wait emission for the observe step's request
  // plan; see `appendInlineRequestStep` for rationale.
  for (const wait of step.requestPlan.eventualWaitsAfter ?? []) {
    appendEventualWait(lines, wait, idx);
  }
}

function appendEventualWait(lines: string[], wait: EventualWaitSpec, stepIdx: number): void {
  // #159 PR B-equivalent wait block, emitted at the same indentation as
  // the sibling `test.step(...)` call so the wait's locals (`witnessUrl`,
  // `witnessRespN`) stay out of the step's closure. The predicate body
  // narrows `unknown` to a record before the top-level field read so the
  // emitted suite typechecks under strict mode.
  const respVar = `witnessResp${stepIdx + 1}`;
  const w = wait.witness;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(w.predicate.path)) {
    throw new Error(
      `Refusing to emit witness predicate with non-identifier path '${w.predicate.path}'.`,
    );
  }
  lines.push(`    // Wait for ${wait.state} (eventual; witness: ${w.operationId})`);
  lines.push('    {');
  lines.push(`      const witnessUrl = baseUrl + ${buildUrlExpression(w.pathTemplate)};`);
  const optionLines: string[] = [];
  optionLines.push(`        method: '${w.method.toUpperCase()}',`);
  optionLines.push(`        operationId: '${w.operationId}',`);
  if (typeof w.waitUpToMs === 'number') {
    optionLines.push(`        waitUpToMs: ${w.waitUpToMs},`);
  }
  if (typeof w.pollIntervalMs === 'number') {
    optionLines.push(`        pollIntervalMs: ${w.pollIntervalMs},`);
  }
  optionLines.push('        predicate: (body) => {');
  optionLines.push('          if (body === null || typeof body !== "object") return false;');
  optionLines.push(`          const v = (body as Record<string, unknown>)['${w.predicate.path}'];`);
  optionLines.push(`          return v === ${JSON.stringify(w.predicate.equals)};`);
  optionLines.push('        },');
  const method = w.method.toLowerCase();
  lines.push(`      const ${respVar} = await awaitEventually(`);
  lines.push(
    `        async () => request.${method}(witnessUrl, { headers: await authHeaders() }),`,
  );
  lines.push('        {');
  for (const ol of optionLines) lines.push(ol);
  lines.push('        },');
  lines.push('      );');
  lines.push(`      if (${respVar}.status() !== 200) {`);
  lines.push(
    `        try { console.error('Witness response body:', await ${respVar}.text()); } catch {}`,
  );
  lines.push('      }');
  lines.push(`      expect(${respVar}.status()).toBe(200);`);
  lines.push('    }');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUrlExpression(pathTemplate: string): string {
  // `{paramName}` → `${ctx[paramNameVar] ?? '{paramName}'}`. The fallback to
  // the literal placeholder is defensive: when a path-param binding is
  // missing the broker will 4xx with a recognisable URL rather than the
  // ambiguous string "undefined".
  return (
    '`' +
    pathTemplate.replace(/\{([^}]+)\}/g, (_, p) => `\${ctx['${camelCase(p)}Var'] ?? '{${p}}'}`) +
    '`'
  );
}

function buildOptionalAccessChain(rootExpr: string, segments: readonly string[]): string {
  // Optional chain over a `unknown` root: cast each level to an indexable
  // record. Keeps the emitted suite strict-mode clean because the array
  // path may be deeply nested (`['data', 'rows']` etc.) and an intermediate
  // `null` / `undefined` would otherwise throw at runtime.
  let acc = rootExpr;
  for (const seg of segments) {
    acc = `(${acc} as Record<string, unknown> | null | undefined)?.['${seg}']`;
  }
  return acc;
}

function resolveBindingNameForSemantic(
  semanticType: string,
  bindings: Record<string, string>,
): string {
  // `TemplateScenario.bindings` is semantic-type-keyed (e.g. `'Username' →
  // '__PENDING__'`) while the runtime ctx is binding-name-keyed
  // (`ctx['usernameVar']`). Convention (#270): the BFS planner names
  // bindings `<camelSemantic>Var`. Verify the *semantic type* exists in
  // the scenario binding table to catch instantiator drift early —
  // without this, a missing entry would silently emit `ctx[undefined]`.
  if (!(semanticType in bindings)) {
    throw new Error(
      `Membership assertion for semantic type '${semanticType}' is not present ` +
        `in the scenario binding table. Known semantic types: ` +
        `${Object.keys(bindings).join(', ')}.`,
    );
  }
  return `${semanticType.charAt(0).toLowerCase()}${semanticType.slice(1)}Var`;
}

function escapeQuotes(s: string): string {
  return s.replace(/'/g, "\\'");
}

function camelCase(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
