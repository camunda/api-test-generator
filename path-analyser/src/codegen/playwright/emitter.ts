import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assertSafeGlobalContextSeeds } from '../../domainSemanticsValidator.js';
import type {
  EndpointScenario,
  EndpointScenarioCollection,
  GlobalContextSeed,
  RequestStep,
} from '../../types.js';
import type { EmitContext, EmittedFile, Emitter } from '../emitter.js';
import { materializeSupport } from './materialize-support.js';

interface EmitOptions {
  outDir: string;
  suiteName?: string;
  mode?: 'feature' | 'integration';
  /**
   * See {@link EmitContext.globalContextSeeds}. Forwarded verbatim from the
   * orchestrator so this entry point and {@link PlaywrightEmitter.emit}
   * produce identical output for the same inputs.
   */
  globalContextSeeds?: readonly GlobalContextSeed[];
}

/**
 * Build the file name a scenario collection lowers to. Exposed for the
 * Emitter wrapper so it can return a relative path without re-deriving it.
 */
export function playwrightSuiteFileName(
  collection: EndpointScenarioCollection,
  mode: 'feature' | 'integration',
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
    mode?: 'feature' | 'integration';
    globalContextSeeds?: readonly GlobalContextSeed[];
  },
): string {
  return buildSuiteSource(collection, {
    outDir: '',
    suiteName: opts.suiteName,
    mode: opts.mode,
    globalContextSeeds: opts.globalContextSeeds,
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
  await materializeSupport(opts.outDir);
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
  if (opts.globalContextSeeds && opts.globalContextSeeds.length > 0) {
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

  // Import only test & expect; request fixture is provided per-test via parameters
  lines.push("import { test, expect } from '@playwright/test';");
  if (needsValidation) {
    lines.push("import { validateResponse } from 'assert-json-body';");
  }
  // Import vendored helpers from the suite-local ./support/ directory.
  // materializeSupport() copies these files alongside the emitted specs so
  // the generated suite has no dependency on this generator project.
  lines.push("import { buildBaseUrl, authHeaders } from './support/env';");
  lines.push("import { recordResponse, sanitizeBody } from './support/recorder';");
  lines.push("import { extractInto, seedBinding } from './support/seeding';");
  lines.push('');
  if (needsValidation) {
    // Resolve responses.json relative to this spec file so the suite is
    // portable regardless of the working directory the test runner uses.
    lines.push(
      "const __responsesFile = import.meta.dirname + '/json-body-assertions/responses.json';",
    );
    lines.push('');
  }
  lines.push(`test.describe('${suiteName}', () => {`);
  const seeds = opts.globalContextSeeds ?? [];
  for (const scenario of collection.scenarios) {
    lines.push(renderScenarioTest(scenario, seeds));
  }
  lines.push('});');
  return lines.join('\n');
}

function renderScenarioTest(
  s: EndpointScenario,
  globalContextSeeds: readonly GlobalContextSeed[],
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
  body.push(`  const ctx: Record<string, any> = {};`);
  // Collect extraction target variable names across all steps
  const extractionVars = new Set<string>();
  if (s.requestPlan) {
    for (const step of s.requestPlan) {
      if (step.extract) {
        for (const ex of step.extract) extractionVars.add(ex.bind);
      }
    }
  }
  if (s.bindings && Object.keys(s.bindings).length) {
    body.push('  // Seed scenario bindings');
    // Collect vars referenced in body/multipart templates so we can auto-seed PENDING ones actually used.
    const templateVars = new Set<string>();
    function collectVarsFromTemplate(obj: unknown) {
      if (!obj || typeof obj !== 'object') return;
      for (const val of Object.values(obj)) {
        if (typeof val === 'string') {
          const m = val.match(/^\$\{([^}]+)\}$/); // "${varName}"
          if (m) templateVars.add(m[1]);
        } else if (typeof val === 'object') collectVarsFromTemplate(val);
      }
    }
    if (s.requestPlan) {
      for (const step of s.requestPlan) {
        if (step.bodyTemplate) collectVarsFromTemplate(step.bodyTemplate);
        if (step.multipartTemplate) collectVarsFromTemplate(step.multipartTemplate);
      }
    }
    for (const [k, v] of Object.entries(s.bindings)) {
      if (v === '__PENDING__') {
        if (!templateVars.has(k)) continue; // Not referenced in a template
        if (extractionVars.has(k)) continue; // Will be provided by extraction
        // Use centralized seeding util at runtime (generate inside test execution for deterministic mode support)
        body.push(`  if (ctx['${k}'] === undefined) { ctx['${k}'] = seedBinding('${k}'); }`);
        continue;
      }
      if (extractionVars.has(k)) continue;
      body.push(`  ctx['${k}'] = ${JSON.stringify(v)};`);
    }
  }
  // Universal-seed prologue derived from domain-semantics.json#globalContextSeeds.
  // Each entry emits an idempotent `=== undefined` guard so the bindings loop
  // above (which may already have populated the binding from a literal value
  // or from seedBinding for __PENDING__) is never overwritten. Entries that
  // declare a defaultSentinel + stripFromMultipartWhenDefault also emit a
  // `__<fieldName>IsDefault` local that drives the multipart skip branch
  // below — this is the only place the emitter knows about the sentinel.
  //
  // Safety: `binding`, `fieldName`, `seedRule` are all required by the
  // domain-semantics validator (#87) to match `/^[A-Za-z_$][A-Za-z0-9_$]*$/`,
  // and `defaultSentinel` is required to contain no single quotes,
  // backslashes, or line terminators. That lets us interpolate them
  // directly into emitted single-quoted TS string literals without an
  // escape pass and preserves byte identity with the pre-#87 hand-written
  // strings.
  const sentinelLocals = new Map<string, string>(); // fieldName -> local var name
  for (const seed of globalContextSeeds) {
    body.push(
      `  if (ctx['${seed.binding}'] === undefined) { ctx['${seed.binding}'] = seedBinding('${seed.seedRule}'); }`,
    );
    if (seed.stripFromMultipartWhenDefault && seed.defaultSentinel !== undefined) {
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
    // Basic body handling placeholder
    body.push(`  // Step ${idx + 1}: ${step.operationId}`);
    body.push(`  {`);
    body.push(`    const url = baseUrl + ${urlExpr};`);
    const bodyVar = `body${idx + 1}`;
    if (step.bodyKind === 'json' && step.bodyTemplate) {
      const json = JSON.stringify(step.bodyTemplate, null, 4).replace(
        /"\\?\$\{([^}]+)\}"/g,
        (_, v) => `ctx["${v}"]`,
      );
      body.push(`    const ${bodyVar} = ${json};`);
    } else if (step.bodyKind === 'multipart' && step.multipartTemplate) {
      // multipart template format: { fields: Record<string,string>, files: Record<string,string> }
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
      // Convert template to Playwright's expected multipart shape: a keyed object map
      // Files are passed as { name, mimeType, buffer }
      body.push(`    const multipart: Record<string, any> = {};`);
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
          let p = v.slice('@@FILE:'.length);
          // Resolve relative paths against likely fixture locations
          const fsMod = await import('fs');
          const pathMod = await import('path');
          const candidates = [
            p,
            pathMod.resolve(process.cwd(), p),
    // When running from path-analyser dir
    pathMod.resolve(process.cwd(), 'fixtures', p),
    // When running from repo root
    pathMod.resolve(process.cwd(), 'path-analyser/fixtures', p),
            // when running compiled tests from dist/generated-tests
            typeof __dirname !== 'undefined' ? pathMod.resolve(__dirname, '../../fixtures', p) : undefined,
            typeof __dirname !== 'undefined' ? pathMod.resolve(__dirname, '../fixtures', p) : undefined
          ].filter(Boolean) as string[];
          let buf: Buffer | undefined;
          for (const cand of candidates) {
            try { buf = await fsMod.promises.readFile(cand); break; } catch {}
          }
          if (!buf) { throw new Error('Fixture not found: ' + p); }
          const name = p.split('/').pop() || 'file';
          multipart[k] = { name, mimeType: 'application/octet-stream', buffer: buf };
        } else {
          multipart[k] = v;
        }
      }`);
      opts.push('multipart: multipart');
    }
    body.push(`    const ${varName} = await request.${method}(url, { ${opts.join(', ')} });`);
    body.push(`    if (${varName}.status() !== ${step.expect.status}) {`);
    body.push(`      try { console.error('Response body:', await ${varName}.text()); } catch {}`);
    body.push(`    }`);
    body.push(`    expect(${varName}.status()).toBe(${step.expect.status});`);
    // Record observation for this step (best-effort). Only capture response shapes for 200 responses.
    body.push(`    try {`);
    body.push(`      const __status = ${varName}.status();`);
    body.push(`      let bodyJson: any = undefined;`);
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
    // Extraction. `extractInto` is the vendored helper from
    // support/seeding.ts; it skips the assignment when the value is
    // `undefined` so seeded bindings (e.g. globalContextSeeds entries)
    // and earlier extracts in the same scenario aren't clobbered by a
    // later step whose response shape omits the field. See its JSDoc
    // for the full preserve-on-undefined rationale.
    if (step.extract?.length) {
      body.push(`    const json = await ${varName}.json();`);
      for (const ex of step.extract) {
        const optAcc = toOptionalAccessor(ex.fieldPath);
        body.push(`    extractInto(ctx, '${ex.bind}', json${optAcc});`);
      }
    }
    body.push('  }');
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
