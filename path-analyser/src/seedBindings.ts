/**
 * Computes the per-scenario seed list for issue #136.
 *
 * The planner is the authority on "which bindings does the scenario need
 * to seed before its first request" — emitters consume the list verbatim.
 * Without a planner-side answer, every emitter has to re-derive the seed
 * list from `bindings` + `requestPlan.extract`, and the Playwright
 * emitter's pre-#136 derivation got it wrong for an establisher's own
 * base scenario: it skipped any PENDING binding that appeared as an
 * extract target anywhere in the plan, even when the very same step
 * needed the binding as a body input. The server then received
 * `username: undefined` and rejected the request 400.
 *
 * Algorithm:
 *
 *   1. Walk every step's body / multipart template and pathTemplate to
 *      collect the var names each step *reads*.
 *   2. Walk every step's `extract` list to record which var names each
 *      step *produces*.
 *   3. A binding `X` needs seeding iff some step S reads `X` and no
 *      strictly-earlier step extracts `X`, AND `bindings[X]` is not a
 *      literal value (literals are emitted directly via
 *      `ctx.X = "literal";`).
 *
 * The returned list is ordered by first-read for stable output.
 */
import type { EndpointScenario, RequestStep } from './types.ts';

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;
const PATH_PLACEHOLDER_RE = /\{([^}]+)\}/g;

function camelCase(input: string): string {
  return input
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

function collectStringRefs(s: string, out: Set<string>): void {
  // Match every ${name} placeholder in the string, not just whole-string
  // matches — body fields can interpolate multiple vars or embed them
  // mid-string (e.g. URL fragments, composite identifiers).
  for (const m of s.matchAll(PLACEHOLDER_RE)) {
    out.add(m[1]);
  }
}

function walkTemplate(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    collectStringRefs(value, out);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walkTemplate(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) walkTemplate(v, out);
  }
}

function collectPathRefs(pathTemplate: string, out: Set<string>): void {
  // Mirrors emitter.ts:buildUrlExpression — each {placeholder} is read
  // as `ctx[camelCase(placeholder) + 'Var']` at runtime, so the binding
  // the scenario must seed is `<camelCase>Var`.
  for (const m of pathTemplate.matchAll(PATH_PLACEHOLDER_RE)) {
    out.add(`${camelCase(m[1])}Var`);
  }
}

function readsOfStep(step: RequestStep): Set<string> {
  const out = new Set<string>();
  walkTemplate(step.bodyTemplate, out);
  walkTemplate(step.multipartTemplate, out);
  collectPathRefs(step.pathTemplate, out);
  return out;
}

function extractsOfStep(step: RequestStep): Set<string> {
  const out = new Set<string>();
  for (const ex of step.extract ?? []) out.add(ex.bind);
  return out;
}

export function computeSeedBindings(scenario: EndpointScenario): string[] {
  const requestPlan = scenario.requestPlan;
  if (!requestPlan || requestPlan.length === 0) return [];

  const literalBindings = new Set<string>();
  for (const [k, v] of Object.entries(scenario.bindings ?? {})) {
    // `__PENDING__` is the body-builder's marker for "needs runtime
    // seeding" (path-analyser/src/index.ts:482, :879, :911). Anything
    // else is a literal value the emitter writes as
    // `ctx['k'] = "<literal>";`, so it is already satisfied at scenario
    // start without a seedBinding() call.
    if (v !== '__PENDING__') literalBindings.add(k);
  }

  const need = new Set<string>();
  const ordered: string[] = [];
  const extractedSoFar = new Set<string>();
  for (const step of requestPlan) {
    const reads = readsOfStep(step);
    for (const v of reads) {
      if (literalBindings.has(v)) continue;
      if (extractedSoFar.has(v)) continue;
      if (need.has(v)) continue;
      need.add(v);
      ordered.push(v);
    }
    for (const v of extractsOfStep(step)) extractedSoFar.add(v);
  }
  return ordered;
}
