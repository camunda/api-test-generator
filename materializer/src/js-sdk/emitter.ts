import type { EmitContext, EmittedFile, EmitterStrategy } from '@camunda8/emitter-sdk';
import { assertSafeGlobalContextSeeds } from 'path-analyser/ontology/loader';
import type {
  EndpointScenario,
  EndpointScenarioCollection,
  GlobalContextSeed,
  RequestStep,
} from 'path-analyser/types';
import { FallbackMappingSource, type SdkMappingSource } from './sdk-mapping.js';

/**
 * Returns the file name a JS SDK scenario collection lowers to.
 * Uses `.test.ts` suffix (Vitest convention) instead of `.spec.ts` (Playwright).
 */
export function jsSdkSuiteFileName(
  collection: EndpointScenarioCollection,
  mode: 'feature' | 'integration' | 'variant',
): string {
  return `${collection.endpoint.operationId}.${mode}.test.ts`;
}

/**
 * Pure rendering entry point — returns the Vitest suite source as a string.
 * Used by `JsSdkEmitter` and by callers that want the source without writing.
 */
export function renderJsSdkSuite(
  collection: EndpointScenarioCollection,
  mapping: SdkMappingSource,
  opts: {
    suiteName?: string;
    mode?: 'feature' | 'integration' | 'variant';
    globalContextSeeds?: readonly GlobalContextSeed[];
  },
): string {
  return buildSuiteSource(collection, mapping, opts);
}

/**
 * Factory: create a `JsSdkEmitter` backed by the given `SdkMappingSource`.
 *
 * When no source is supplied, `FallbackMappingSource` is used, which returns
 * the operationId unchanged (already camelCase in the Camunda REST API).
 */
export function createJsSdkEmitter(mapping?: SdkMappingSource): EmitterStrategy {
  const source = mapping ?? new FallbackMappingSource();
  return {
    id: 'js-sdk',
    name: 'JavaScript SDK (@camunda8/orchestration-cluster-api)',
    supportedConfigs: ['*'],
    async emit(collection: EndpointScenarioCollection, ctx: EmitContext): Promise<EmittedFile[]> {
      const content = renderJsSdkSuite(collection, source, {
        suiteName: ctx.suiteName,
        mode: ctx.mode,
        globalContextSeeds: ctx.globalContextSeeds,
      });
      return [
        {
          relativePath: jsSdkSuiteFileName(collection, ctx.mode),
          content,
        },
      ];
    },
  };
}

// ---------------------------------------------------------------------------
// Internal rendering
// ---------------------------------------------------------------------------

function buildSuiteSource(
  collection: EndpointScenarioCollection,
  mapping: SdkMappingSource,
  opts: {
    suiteName?: string;
    mode?: 'feature' | 'integration' | 'variant';
    globalContextSeeds?: readonly GlobalContextSeed[];
  },
): string {
  // Boundary safety re-check: same defence-in-depth as PlaywrightEmitter.
  if (opts.globalContextSeeds !== undefined) {
    assertSafeGlobalContextSeeds(opts.globalContextSeeds);
  }

  const lines: string[] = [];
  const suiteName = opts.suiteName || collection.endpoint.operationId;

  lines.push("import { describe, test } from 'vitest';");
  lines.push("import createCamundaClient from '@camunda8/orchestration-cluster-api';");
  lines.push("import { extractInto, seedBinding } from './support/seeding';");
  lines.push('');
  // Single shared client for all tests in this suite (zero-config → reads
  // CAMUNDA_* from process.env; defaults to http://localhost:8080 when absent).
  lines.push('const client = createCamundaClient();');
  lines.push('');
  lines.push(`describe('${suiteName}', () => {`);

  const seeds = opts.globalContextSeeds ?? [];
  for (const scenario of collection.scenarios) {
    lines.push(renderScenarioTest(scenario, mapping, seeds));
  }

  lines.push('});');
  return lines.join('\n');
}

function renderScenarioTest(
  s: EndpointScenario,
  mapping: SdkMappingSource,
  globalContextSeeds: readonly GlobalContextSeed[],
): string {
  const title = `${s.id} - ${escapeQuotes(s.name || 'scenario')}`;
  const body: string[] = [];
  body.push(`  test('${title}', async () => {`);

  if (s.description) {
    const desc = String(s.description).trim();
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
    for (const l of wrapped) body.push(`    // ${l}`);
  }

  body.push(`    const ctx: Record<string, unknown> = {};`);

  // Collect extraction target variable names across all steps
  const extractionVars = new Set<string>();
  if (s.requestPlan) {
    for (const step of s.requestPlan) {
      if (step.extract) {
        for (const ex of step.extract) extractionVars.add(ex.bind);
      }
    }
  }

  // Seed scenario bindings
  if (s.bindings && Object.keys(s.bindings).length) {
    body.push('    // Seed scenario bindings');
    const templateVars = new Set<string>();
    function collectVarsFromTemplate(obj: unknown) {
      if (!obj || typeof obj !== 'object') return;
      for (const val of Object.values(obj)) {
        if (typeof val === 'string') {
          const m = val.match(/^\$\{([^}]+)\}$/);
          if (m) templateVars.add(m[1]);
        } else if (typeof val === 'object') collectVarsFromTemplate(val);
      }
    }
    if (s.requestPlan) {
      for (const step of s.requestPlan) {
        if (step.bodyTemplate) collectVarsFromTemplate(step.bodyTemplate);
        // Path params are consumed via ctx just like body template vars.
        if (step.pathParams) {
          for (const p of step.pathParams) templateVars.add(p.var);
        }
      }
    }
    for (const [k, v] of Object.entries(s.bindings)) {
      if (v === '__PENDING__') {
        if (!templateVars.has(k)) continue;
        if (extractionVars.has(k)) continue;
        body.push(`    if (ctx['${k}'] === undefined) { ctx['${k}'] = seedBinding('${k}'); }`);
        continue;
      }
      if (extractionVars.has(k)) continue;
      body.push(`    ctx['${k}'] = ${JSON.stringify(v)};`);
    }
  }

  // Universal-seed prologue (same logic as PlaywrightEmitter — see its
  // detailed comment for the nullish-coalescing rationale).
  for (const seed of globalContextSeeds) {
    body.push(
      `    ctx['${seed.binding}'] = ctx['${seed.binding}'] ?? seedBinding('${seed.seedRule}');`,
    );
  }

  if (!s.requestPlan) {
    body.push('    // No request plan available');
    body.push('  });');
    return body.join('\n');
  }

  const requestPlan = s.requestPlan;
  requestPlan.forEach((step: RequestStep, idx: number) => {
    const method = mapping.resolveMethod(step.operationId);
    const varName = `result${idx + 1}`;

    // Hard-fail on multipart: the SDK helper for file uploads uses a
    // different signature (e.g. deployResourcesFromFiles takes file paths,
    // not a generic multipart template). Surface the gap rather than
    // silently emitting wrong call shapes.
    if (step.bodyKind === 'multipart') {
      throw new Error(
        `JS SDK emitter: operationId '${step.operationId}' has a multipart body. ` +
          `The SDK helper '${method}' uses a different signature. ` +
          `This scenario cannot be lowered automatically; handle it manually or ` +
          `implement a dedicated multipart adapter for this operation.`,
      );
    }

    body.push(`    // Step ${idx + 1}: ${step.operationId}`);
    body.push(`    {`);

    // Build the call argument object by merging path params and body.
    const argParts: string[] = [];

    // Path parameters: contribute their values to the args object.
    if (step.pathParams?.length) {
      for (const p of step.pathParams) {
        argParts.push(`      ${p.name}: ctx['${p.var}'],`);
      }
    }

    // JSON body: inline the resolved template fields.
    if (step.bodyKind === 'json' && step.bodyTemplate) {
      const bodyJson = JSON.stringify(step.bodyTemplate, null, 6).replace(
        /"\\?\$\{([^}]+)\}"/g,
        (_, v) => `ctx["${v}"]`,
      );
      // Splice the inner fields of the body object into argParts (if it is
      // a plain object). If the body is not a plain object we fall back to
      // spreading it.
      if (
        typeof step.bodyTemplate === 'object' &&
        step.bodyTemplate !== null &&
        !Array.isArray(step.bodyTemplate)
      ) {
        // Strip the outer braces and indent one level.
        const inner = bodyJson.replace(/^\{/, '').replace(/\}$/, '').trimEnd();
        argParts.push(inner);
      } else {
        // Non-object body (array, primitive) — spread via Object.assign downstream.
        argParts.push(`      ...${bodyJson},`);
      }
    }

    if (argParts.length > 0) {
      body.push(`      const args${idx + 1} = {`);
      body.push(argParts.join('\n'));
      body.push(`      };`);
      body.push(`      const ${varName} = await client.${method}(args${idx + 1});`);
    } else {
      // No args: operation takes no parameters (e.g. getTopology).
      body.push(`      const ${varName} = await client.${method}();`);
    }

    // The SDK throws on non-2xx so there is no explicit status assertion.
    // For the final step we add a basic defined-check as a smoke test.
    const isFinal = idx === requestPlan.length - 1;
    if (isFinal) {
      body.push(`      // SDK throws on non-${step.expect.status}; reaching here means success`);
    }

    // Extraction: pull fields from the typed SDK response into ctx.
    // Unlike PlaywrightEmitter, there is no .json() call — the response is
    // already a typed object.
    if (step.extract?.length) {
      for (const ex of step.extract) {
        const optAcc = toOptionalAccessor(ex.fieldPath);
        body.push(`      extractInto(ctx, '${ex.bind}', ${varName}${optAcc});`);
      }
    }

    body.push('    }');
  });

  body.push('  });');
  return body.join('\n');
}

// ---------------------------------------------------------------------------
// Utilities (mirrors of PlaywrightEmitter utilities)
// ---------------------------------------------------------------------------

function escapeQuotes(s: string): string {
  return s.replace(/'/g, "\\'");
}

/**
 * Converts a dotted field path (possibly with array notation) into a
 * TypeScript optional-chaining accessor expression.
 *
 * Examples:
 *   "key"                      → ".key"
 *   "metadata.processInstanceKey" → "?.metadata?.processInstanceKey"
 *   "items[0].key"             → "?.items?.[0]?.key"
 */
function toOptionalAccessor(fieldPath: string): string {
  if (!fieldPath.includes('.') && !fieldPath.includes('[')) {
    return `.${fieldPath}`;
  }
  const parts = fieldPath.split(/(?=\[)|[.]/).filter(Boolean);
  return parts
    .map((p) => {
      if (p.startsWith('[')) return `?.[${p.slice(1, -1)}]`;
      return `?.${p}`;
    })
    .join('');
}
