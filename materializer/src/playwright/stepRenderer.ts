import type { EventualWaitSpec, RequestStep } from 'path-analyser/types';

/**
 * Shared per-step rendering primitives consumed by both the per-endpoint
 * Playwright emitter (`emitter.ts`) and the template-scenario emitter
 * (`templateEmitter.ts`).
 *
 * Both emitters previously maintained their own copies of these
 * primitives. PR #274 reviews surfaced a recurring class of bugs caused
 * by divergence (placeholder-substitution regex, eventual-consistency
 * wrapping, single-parse-of-response-JSON, etc.). Centralising the
 * primitives here eliminates the entire class — the only way a future
 * change can drift one path from the other is if a caller reimplements
 * a primitive locally.
 */

/**
 * Regex matching body-template placeholders. Accepts both forms the
 * planner is known to emit:
 *
 *   - `"${var}"`   — bare (template scenarios)
 *   - `"\${var}"`  — backslash-escaped (per-endpoint scenarios; the
 *                     planner backslash-escapes inside multipart values)
 *
 * Centralising the regex prevents one emitter from accepting only one
 * form and silently passing the other through as a literal string.
 */
export const BODY_PLACEHOLDER_RE = /"\\?\$\{([^}]+)\}"/g;

/**
 * Build the `baseUrl + ${...}` URL expression for a path template.
 * Substitutes `{paramName}` with `${ctx.paramNameVar || '${paramName}'}`
 * — the literal-placeholder fallback gives the broker a recognisable
 * URL (and a 4xx) when a path-param binding is missing, rather than
 * the ambiguous string `"undefined"`.
 */
export function buildUrlExpression(pathTemplate: string): string {
  return (
    '`' +
    pathTemplate.replace(/\{([^}]+)\}/g, (_, p) => `\${ctx.${camelCase(p)}Var || '\${${p}}'}`) +
    '`'
  );
}

export function camelCase(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function escapeQuotes(s: string): string {
  return s.replace(/'/g, "'");
}

/**
 * Build an accessor using optional chaining for nested/array paths,
 * e.g. `a.b[0].c` → `?.a?.b?.[0]?.c`. Used by both emitters when
 * rendering `extractInto(ctx, '<bind>', json<...accessor>)`.
 */
export function toOptionalAccessor(fieldPath: string): string {
  const parts = fieldPath.split('.');
  return parts
    .map((p) => {
      const m = p.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\[[0-9]+\])?$/);
      if (m) {
        const base = `?.${m[1]}`;
        const idx = m[2] ? `?.${m[2]}` : '';
        return base + idx;
      }
      return `?.['${p.replace(/'/g, "\\'")}']`;
    })
    .join('');
}

/**
 * Predicate-only EC wrap decision. A step is wrappable iff:
 *   1. its `operationId` is in `ecOps` (the planner-derived set of
 *      operations marked `x-eventually-consistent`);
 *   2. it is a read shape — `GET` or `POST .../search` (writes return
 *      quickly even when EC; the lag manifests on the next read);
 *   3. it expects a `200` (we never poll an error scenario).
 *
 * Returning `boolean` (instead of a Set of step indices) makes the
 * predicate uniformly usable from both emitters, regardless of how they
 * carry the EC set on the scenario object.
 */
export function stepNeedsAwaitForOp(step: RequestStep, ecOps: ReadonlySet<string>): boolean {
  if (!ecOps.has(step.operationId)) return false;
  if (step.expect.status !== 200) return false;
  const method = step.method.toUpperCase();
  const isReadShape =
    method === 'GET' || (method === 'POST' && /\/search\/?$/.test(step.pathTemplate));
  return isReadShape;
}

/**
 * Inputs to {@link renderInlineStepLines}. Optional fields default to
 * the per-endpoint emitter's pre-refactor behaviour so existing
 * callers stay byte-identical without passing extra arguments.
 */
export interface InlineStepRenderInput {
  step: RequestStep;
  idx: number;
  varName: string;
  urlExpr: string;
  method: string;
  /**
   * Per-multipart-field sentinel locals declared in the test prologue.
   * Used to strip default-valued fields from emitted multipart bodies.
   * Empty for template-scenario callers (no multipart steps today).
   */
  sentinelLocals?: Map<string, string>;
  /** Whether this step should be wrapped with `awaitEventually(...)`. */
  shouldAwaitEventually?: boolean;
}

/**
 * Render the generic per-step inline body lines (URL + body + auth +
 * EC wrap + request call + status assertion + error logging). The
 * returned lines start at 4-space indent — the per-endpoint emitter
 * appends them directly inside a `test.step(...)` callback at 2-space
 * outer depth; the template emitter re-indents them by 2 extra spaces
 * to fit its `test.describe` → `test(...)` → `test.step(...)` nesting.
 *
 * Body-template placeholder substitution uses {@link BODY_PLACEHOLDER_RE}
 * which accepts both `"${var}"` and `"\${var}"` forms.
 */
export function renderInlineStepLines({
  step,
  idx,
  varName,
  urlExpr,
  method,
  sentinelLocals,
  shouldAwaitEventually,
}: InlineStepRenderInput): string[] {
  const lines: string[] = [];
  const bodyVar = `body${idx + 1}`;
  const sentinels = sentinelLocals ?? new Map<string, string>();
  lines.push(`    const url = baseUrl + ${urlExpr};`);
  if (step.bodyKind === 'json' && step.bodyTemplate) {
    const json = JSON.stringify(step.bodyTemplate, null, 4).replace(
      BODY_PLACEHOLDER_RE,
      (_, v) => `ctx["${v}"]`,
    );
    lines.push(`    const ${bodyVar} = ${json};`);
  } else if (step.bodyKind === 'multipart' && step.multipartTemplate) {
    const tpl = JSON.stringify(step.multipartTemplate, null, 4).replace(
      BODY_PLACEHOLDER_RE,
      (_, v) => `ctx["${v}"]`,
    );
    lines.push(`    const ${bodyVar} = ${tpl};`);
  }
  const opts: string[] = [];
  opts.push('headers: await authHeaders()');
  if (step.bodyKind === 'json' && step.bodyTemplate) opts.push(`data: ${bodyVar}`);
  if (step.bodyKind === 'multipart' && step.multipartTemplate) {
    lines.push(
      `    const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {};`,
    );
    lines.push(`    for (const [k,v] of Object.entries(${bodyVar}.fields||{})) {`);
    for (const [fieldName, local] of sentinels) {
      lines.push(`      if (k === '${fieldName}' && ${local}) continue;`);
    }
    lines.push(`      if (v !== undefined && v !== null) multipart[k] = String(v);`);
    lines.push(`    }`);
    lines.push(`    for (const [k,v] of Object.entries(${bodyVar}.files||{})) {
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
  if (shouldAwaitEventually) {
    lines.push(`    const ${varName} = await awaitEventually(`);
    lines.push(`      async () => request.${method}(url, { ${opts.join(', ')} }),`);
    lines.push(
      `      { method: '${step.method.toUpperCase()}', operationId: '${step.operationId}' },`,
    );
    lines.push(`    );`);
  } else {
    lines.push(`    const ${varName} = await request.${method}(url, { ${opts.join(', ')} });`);
  }
  lines.push(`    if (${varName}.status() !== ${step.expect.status}) {`);
  lines.push(`      try { console.error('Response body:', await ${varName}.text()); } catch {}`);
  lines.push(`    }`);
  lines.push(`    expect(${varName}.status()).toBe(${step.expect.status});`);
  return lines;
}

/**
 * Render a planner-annotated eventual-state wait as a sibling block to
 * a producer step (#159 PR B). Returned lines start at 2-space outer
 * indent (sibling to the producer's `await test.step(...)` call); the
 * template emitter re-indents by +2 spaces to fit its deeper nesting.
 *
 * The witness predicate's `path` is validated to a JS identifier by
 * the domain-semantics validator (`WitnessPredicateSchema`), so the
 * bracket-access key emitted below is identifier-safe.
 */
export function renderEventualWait(wait: EventualWaitSpec, idx: number): string[] {
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
  optionFields.push(`predicate: (body) => {
        if (body === null || typeof body !== 'object') return false;
        const v = (body as Record<string, unknown>)['${w.predicate.path}'];
        return v === ${JSON.stringify(w.predicate.equals)};
      }`);
  const method = w.method.toLowerCase();
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
 * Re-indent a block of pre-rendered lines by prepending `extra` to
 * every non-empty line. Used by callers (the template emitter) that
 * embed shared-rendered blocks inside a deeper outer scope than the
 * per-endpoint emitter assumes.
 */
export function reindent(lines: readonly string[], extra: string): string[] {
  return lines.map((l) => (l.length === 0 ? l : extra + l));
}
