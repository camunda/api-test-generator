import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';
import type { ValidationScenario } from '../model/types.js';
import { LICENSE_HEADER } from './licenseHeader.js';
import { materializeStandalone } from './materializeStandalone.js';

interface EmitOpts {
  outDir: string;
  qaImportDepth: number;
  /**
   * When true (default), emit a self-contained suite that imports its support
   * helpers from `./support/http` (relative to the spec file) and materialize
   * the support templates + project scaffolding into `outDir`. When false,
   * use the legacy QA-tree import path computed from `qaImportDepth`.
   */
  standalone?: boolean;
  specCommit?: string;
  generationTimestamp?: string;
}

export async function emitQaTests(scenarios: ValidationScenario[], opts: EmitOpts) {
  const byFile = new Map<string, ValidationScenario[]>();
  for (const s of scenarios) {
    const resource = deriveResource(s.path);
    const file = `${resource}-validation-api-tests.spec.ts`;
    const arr = byFile.get(file) || [];
    arr.push(s);
    byFile.set(file, arr);
  }
  await fs.promises.mkdir(opts.outDir, { recursive: true });
  if (opts.standalone !== false) {
    await materializeStandalone(opts.outDir);
  }
  // Resolve Prettier config once (fail fast if not found / cannot load)
  let resolvedConfig: prettier.Config | null = null;
  try {
    resolvedConfig = await prettier.resolveConfig(process.cwd());
  } catch (e) {
    throw new Error(
      `[emit] Failed to resolve Prettier config: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!resolvedConfig) {
    // Provide a deterministic fallback matching QA expectations
    const fallback: prettier.Config = {
      singleQuote: true,
      trailingComma: 'all',
      bracketSpacing: false,
    };
    resolvedConfig = fallback;
    console.warn(
      '[emit] No Prettier config found. Using built-in fallback config { singleQuote:true, trailingComma:"all", bracketSpacing:false }',
    );
  }
  for (const [file, list] of byFile.entries()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
    const raw = buildFile(
      list,
      opts.qaImportDepth,
      opts.specCommit,
      opts.generationTimestamp,
      opts.standalone !== false,
    );
    let formatted: string;
    try {
      formatted = await prettier.format(raw, {
        ...(resolvedConfig || {}),
        filepath: file,
      });
    } catch (e) {
      throw new Error(
        `[emit] Prettier formatting failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const target = path.join(opts.outDir, file);
    await fs.promises.writeFile(target, formatted, 'utf8');
    console.log('[emit] wrote', target);
  }
}

function buildFile(
  scenarios: ValidationScenario[],
  depth: number,
  specCommit?: string,
  ts?: string,
  standalone: boolean = true,
): string {
  const resource = deriveResource(scenarios[0].path);
  const describeTitle = `${capitalize(resource)} Validation API Tests`;
  const httpImport = standalone ? './support/http' : `${'../'.repeat(depth)}utils/http`;
  // #362 — multipart requests that need auth attach authHeaders() (Authorization
  // only, no JSON content-type that would break the multipart boundary). Import
  // it only when the file actually emits such a request, so JSON-only files
  // don't carry an unused import (the generated suite lints with noUnusedImports).
  // This condition must mirror the `headersExpr` selection below exactly —
  // `headersExpr` emits authHeaders() for any multipart+auth scenario (it does
  // not depend on multipartForm), so gating the import on multipartForm here
  // would risk referencing authHeaders() without importing it.
  const usesAuthHeaders = scenarios.some(
    (s) => s.headersAuth && s.bodyEncoding === 'multipart',
  );
  const authImport = usesAuthHeaders ? 'authHeaders, ' : '';
  const lines: string[] = [];
  lines.push(LICENSE_HEADER.trimEnd());
  const meta: string[] = [];
  meta.push(''); // ESLint requires a new line after the license header
  meta.push('/*');
  meta.push(' * GENERATED FILE - DO NOT EDIT MANUALLY');
  meta.push(` * Generated At: ${ts || new Date().toISOString()}`);
  if (specCommit) meta.push(` * Spec Commit: ${specCommit}`);
  meta.push(' */');
  lines.push(meta.join('\n'));
  if (standalone) {
    lines.push("import {test} from '@playwright/test'");
    lines.push(
      `import {${authImport}jsonHeaders, buildUrl, assertResponseStatus} from '${httpImport}'`,
    );
  } else {
    // Legacy QA-tree mode: the external `utils/http` module does not export
    // `assertResponseStatus`, so fall back to a bare `expect(...).toBe(...)`
    // assertion. Diagnostics-rich failure messages and report attachments are
    // a standalone-only feature.
    lines.push("import {expect, test} from '@playwright/test'");
    lines.push(`import {${authImport}jsonHeaders, buildUrl} from '${httpImport}'`);
  }
  lines.push('');
  lines.push(`test.describe('${describeTitle}', () => {`);
  // Pre-compute base titles and detect duplicates for uniqueness
  const baseTitles: string[] = scenarios.map((s) => buildBaseTitle(s));
  const counts = new Map<string, number>();
  for (const t of baseTitles) counts.set(t, (counts.get(t) || 0) + 1);
  const occurrence = new Map<string, number>();
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const base = baseTitles[i];
    let finalTitle = base;
    if ((counts.get(base) || 0) > 1) {
      // Append a stable sequence number for readability
      const n = (occurrence.get(base) || 0) + 1;
      occurrence.set(base, n);
      finalTitle = `${base} (#${n})`;
    }
    lines.push(renderScenario(s, finalTitle, standalone));
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/**
 * Test-only export of the per-scenario renderer. Used by Layer-2 fixtures
 * (e.g. tests/request-validation/query-param-buildurl-slot.test.ts for
 * issue #127) that need to assert on the emitted `buildUrl(...)` shape
 * without spinning up the full file-emission pipeline.
 */
export function renderScenarioForTest(s: ValidationScenario, title: string): string {
  return renderScenario(s, title, true);
}

function renderScenario(s: ValidationScenario, title: string, standalone: boolean): string {
  const lines: string[] = [];
  const fixtureArg = standalone ? '({request}, testInfo)' : '({request})';
  lines.push(`  test(${JSON.stringify(title)}, async ${fixtureArg} => {`);
  // Split params into path-tokens vs everything-else (query/header keys).
  // `buildUrl(path, pathParams, queryParams)` substitutes only entries whose
  // key matches a `{token}` in the template; non-token keys passed in slot 2
  // are silently dropped. Routing them to slot 3 makes them surface as a
  // query string. See issue #127.
  const pathLit = JSON.stringify(s.path.replace(/\{([^}]+)}/g, '{$1}'));
  const { pathParams, queryParams } = splitParamsBySlot(s.path, s.params);
  const pathArg = pathParams ? JSON.stringify(pathParams) : 'undefined';
  const queryArg = queryParams ? JSON.stringify(queryParams) : undefined;
  const urlCall =
    queryArg !== undefined
      ? `buildUrl(${pathLit}, ${pathArg}, ${queryArg})`
      : pathParams
        ? `buildUrl(${pathLit}, ${pathArg})`
        : `buildUrl(${pathLit})`;
  lines.push(`    const url = ${urlCall};`);
  if (s.bodyEncoding === 'multipart' && s.multipartForm) {
    const formLit = JSON.stringify(s.multipartForm, null, 2);
    lines.push(`    const formData = new FormData();`);
    lines.push(`    const multipartFields: Record<string,string> = ${formLit};`);
    lines.push(`    for (const [k,v] of Object.entries(multipartFields)) formData.append(k, v);`);
  } else if (s.requestBody) {
    const body = JSON.stringify(s.requestBody, null, 2);
    if (body === '[]') {
      lines.push(`    const requestBody: string[] = ${body};`);
    } else {
      lines.push(`    const requestBody = ${body};`);
    }
  }
  const headersExpr = s.headersAuth
    ? s.bodyEncoding === 'multipart'
      ? 'authHeaders()'
      : 'jsonHeaders()'
    : '{}';
  const dataPart =
    s.bodyEncoding === 'multipart' && s.multipartForm
      ? ',\n      multipart: formData'
      : s.requestBody
        ? ',\n      data: requestBody'
        : '';
  lines.push(`    const res = await request.${methodFn(s.method)}(`);
  lines.push(`      url, {`);
  lines.push(`        headers: ${headersExpr}${dataPart}`);
  lines.push('      }');
  lines.push('    );');
  if (standalone) {
    // Diagnostics: assertResponseStatus attaches request/response artifacts to
    // the Playwright report on failure and produces a multi-line failure message
    // including method, URL, expected vs. actual status, and the response body.
    const ctxParts: string[] = [
      `operationId: ${JSON.stringify(s.operationId)}`,
      `scenarioKind: ${JSON.stringify(s.type)}`,
      `method: ${JSON.stringify(s.method.toUpperCase())}`,
      `url`,
    ];
    if (s.bodyEncoding === 'multipart' && s.multipartForm) {
      ctxParts.push(`multipart: multipartFields`);
    } else if (s.requestBody) {
      ctxParts.push(`body: requestBody`);
    }
    lines.push(
      `    await assertResponseStatus(testInfo, res, ${s.expectedStatus}, { ${ctxParts.join(', ')} });`,
    );
  } else {
    // Legacy QA-tree mode: bare assertion, no attachments.
    lines.push(`    expect(res.status()).toBe(${s.expectedStatus});`);
  }
  lines.push('  });');
  return lines.join('\n');
}

/**
 * Split a flat `params` map into the two slots that `buildUrl` expects:
 * keys matching a `{token}` in the path template go to the path-params
 * slot, everything else goes to the query slot. Either side is `undefined`
 * when empty so the emitter can drop unused arguments. See issue #127.
 */
function splitParamsBySlot(
  path: string,
  params: Record<string, string> | undefined,
): {
  pathParams: Record<string, string> | undefined;
  queryParams: Record<string, string> | undefined;
} {
  if (!params) return { pathParams: undefined, queryParams: undefined };
  const pathTokens = new Set<string>();
  const tokenRe = /\{([^}]+)}/g;
  let m: RegExpExecArray | null = tokenRe.exec(path);
  while (m !== null) {
    pathTokens.add(m[1]);
    m = tokenRe.exec(path);
  }
  const pathParams: Record<string, string> = {};
  const queryParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (pathTokens.has(k)) pathParams[k] = v;
    else queryParams[k] = v;
  }
  return {
    pathParams: Object.keys(pathParams).length ? pathParams : undefined,
    queryParams: Object.keys(queryParams).length ? queryParams : undefined,
  };
}

function methodFn(m: string): string {
  switch (m.toUpperCase()) {
    case 'GET':
      return 'get';
    case 'POST':
      return 'post';
    case 'PUT':
      return 'put';
    case 'DELETE':
      return 'delete';
    case 'PATCH':
      return 'patch';
    default:
      return m.toLowerCase();
  }
}

function deriveResource(p: string): string {
  const cleaned = p.startsWith('/') ? p.slice(1) : p;
  const segs = cleaned.split('/');
  if (segs[0] === 'v1' || segs[0] === 'v2') return (segs[1] || 'root').replace(/[^a-zA-Z0-9]/g, '');
  return (segs[0] || 'root').replace(/[^a-zA-Z0-9]/g, '');
}

function buildBaseTitle(s: ValidationScenario): string {
  // Provide human friendly titles per scenario kind; keep concise so appended (#n) still fits nicely.
  // Specialization: param constraint violations (path/query) should surface the specific constraint kind.
  if (s.type === 'param-constraint-violation') {
    const constraint = s.constraintKind || 'constraint';
    const targetSegs = s.target ? s.target.split('.') : [];
    const location = targetSegs.length > 1 ? targetSegs[0] : 'param';
    const paramName = targetSegs.length ? targetSegs[targetSegs.length - 1] : 'param';
    const locLabel =
      location === 'path' ? 'Path param' : location === 'query' ? 'Query param' : 'Param';
    return `${s.operationId} - ${locLabel} ${paramName} ${constraint} violation`;
  }
  switch (s.type) {
    case 'missing-required':
      return `${s.operationId} - Missing ${s.target}`;
    case 'missing-required-combo':
      return `${s.operationId} - Missing combo ${s.target}`;
    case 'param-missing':
      return `${s.operationId} - Missing param ${s.target}`;
    case 'type-mismatch':
      return `${s.operationId} - Param ${s.target} wrong type`;
    case 'param-type-mismatch':
      return `${s.operationId} - Param ${s.target} wrong type`;
    case 'body-top-type-mismatch':
      return `${s.operationId} - Body wrong top-level type`;
    case 'missing-body':
      return `${s.operationId} - Missing body`;
    case 'union':
      return `${s.operationId} - oneOf violation`;
    case 'oneof-ambiguous':
      return `${s.operationId} - oneOf ambiguous`;
    case 'oneof-multi-ambiguous':
      return `${s.operationId} - oneOf multi ambiguous`;
    case 'oneof-cross-bleed':
      return `${s.operationId} - oneOf cross bleed`;
    case 'oneof-none-match':
      return `${s.operationId} - oneOf none match`;
    case 'constraint-violation':
      return `${s.operationId} - Constraint violation ${s.target}`;
    case 'enum-violation':
      return `${s.operationId} - Enum violation ${s.target}`;
    case 'additional-prop':
      return `${s.operationId} - Additional prop ${s.target}`;
    case 'additional-prop-general':
      return `${s.operationId} - Additional prop ${s.target}`;
    case 'nested-additional-prop':
      return `${s.operationId} - Nested additional prop ${s.target}`;
    case 'unique-items-violation':
      return `${s.operationId} - uniqueItems violation ${s.target}`;
    case 'multiple-of-violation':
      return `${s.operationId} - multipleOf violation ${s.target}`;
    case 'format-invalid':
      return `${s.operationId} - format invalid ${s.target}`;
    case 'discriminator-mismatch':
      return `${s.operationId} - discriminator mismatch`;
    case 'discriminator-structure-mismatch':
      return `${s.operationId} - discriminator structure mismatch`;
    case 'allof-missing-required':
      return `${s.operationId} - allOf missing required`;
    case 'allof-conflict':
      return `${s.operationId} - allOf conflict`;
    case 'auth-absent':
      return `${s.operationId} - Missing authentication`;
    default:
      return s.id; // Fallback is globally unique id
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
