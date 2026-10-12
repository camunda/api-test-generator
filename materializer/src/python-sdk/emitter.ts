/**
 * Python SDK test suite emitter.
 * Lowers scenario collections into executable Python test code using the Camunda Python SDK.
 */

import type { EmitContext, EmittedFile, EmitterStrategy } from '@camunda8/emitter-sdk';
import { assertSafeGlobalContextSeeds } from 'path-analyser/ontology/loader';
import type {
  EndpointScenario,
  EndpointScenarioCollection,
  EventualWaitSpec,
  GlobalContextSeed,
  RequestStep,
} from 'path-analyser/types';
// Reused rather than re-implemented: the Playwright emitter already owns the
// canonical logic for deciding which client-minted bindings need a
// `unique=True` seed (#304 -- client-minted, not extracted from an earlier
// step, and the consuming step declares HTTP 409). See #342 for the
// omitWhenUnbound half of the same contract.
import { computeUniqueBindings } from '../playwright/ctxSeeding.js';
import { camelCase, stepNeedsAwaitForOp } from '../playwright/stepRenderer.js';
import { type OperationMapSource, toPythonLiteral } from './sdk-mapping.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsFixtureMarker(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('@@FILE:');
  if (Array.isArray(value)) return value.some(containsFixtureMarker);
  if (isRecord(value)) return Object.values(value).some(containsFixtureMarker);
  return false;
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Build a valid, collision-free Python test-function-name suffix from a
 * scenario. `scenario.name` may contain characters that aren't legal in a
 * Python identifier (spaces, `-`, `#`, ...), so every non `[a-z0-9_]`
 * character is folded to `_`. The scenario's own `id` (unique within a
 * collection, see scenarioGenerator.ts) is always prefixed so scenarios that
 * share a display name still get distinct test functions instead of silently
 * overwriting each other.
 */
function toPythonTestName(scenario: EndpointScenario): string {
  const base = `${scenario.id}_${scenario.name || 'scenario'}`;
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : `scenario_${scenario.id}`;
}

/**
 * Build the file name a scenario collection lowers to.
 * Python test convention: `test_<operation_id>.py`
 */
export function pythonSuiteFileName(
  collection: EndpointScenarioCollection,
  mode: 'feature' | 'integration' | 'variant' = 'feature',
): string {
  const operationId = collection.endpoint.operationId;
  const snakeCase = toSnakeCase(operationId);
  // The mode suffix is omitted for the default `feature` mode to preserve
  // existing file names. Without it, a `variant` collection for the same
  // operationId (see materializer/src/index.ts's feature + variant
  // emission passes) silently overwrote the feature suite -- both resolved
  // to the identical `test_<op>.py` path in the same output directory.
  // Mirrors the JS/C# emitters' mode-suffix handling.
  const modeSuffix = mode !== 'feature' ? `_${toSnakeCase(mode)}` : '';
  return `test_${snakeCase}${modeSuffix}.py`;
}

/**
 * Commit b19de2e — ctx['var'] for path parameters
 *
 * Build the URL expression for a path template, substituting {paramName}
 * with ctx['param_name_var'] (Python bracket notation).
 *
 * Example: '/widgets/{id}' → f'widgets/{ctx.get("idVar") if ctx.get("idVar") is not None else "id"}'
 * The fallback gives the broker a recognizable URL (and a 4xx) when a
 * path-param binding is missing. The leading '/' is stripped so the result
 * resolves as a relative reference against the client's base_url path
 * segment (e.g. '/v2') instead of replacing it -- see the strip below.
 *
 * `pathParams` is accepted for backward compatibility but intentionally
 * ignored: `RequestStep.pathParams` is never populated by path-analyser
 * (see js-sdk's `derivePathParamNames` comment and repo memory item 7), so
 * trusting it here always fell through to the raw, un-suffixed OpenAPI
 * param name — which never matches a real `ctx` key. Every ctx binding for
 * a path param is guaranteed to exist under `${camelCase(paramName)}Var`
 * instead (path-analyser's own `aliasProducerExtractsToPlaceholders`
 * enforces this), matching js-sdk's `derivePathParamNames` + `camelCase`
 * workaround for the same gap.
 */
export function buildPythonUrlExpression(
  pathTemplate: string,
  _pathParams?: { name: string; var: string }[],
  serverOverride?: string,
): string {
  // Strip the leading '/': httpx.AsyncClient.base_url carries its own path
  // segment (e.g. 'http://localhost:8080/v2/'), and per RFC 3986 relative
  // resolution, a request path starting with '/' is treated as root-relative
  // and replaces the base_url's path entirely instead of extending it --
  // silently dropping '/v2'. A relative (non-leading-slash) path resolves
  // against base_url's own path as intended. See conftest.py's client
  // fixture, which normalizes base_url to always end with '/' to match.
  let result = pathTemplate.startsWith('/') ? pathTemplate.slice(1) : pathTemplate;
  result = result.replace(/\{([^}]+)\}/g, (_, paramName: string) => {
    const varName = `${camelCase(paramName)}Var`;
    // Double-quote the inner literals: this whole expression is embedded in
    // a single-quoted f-string below, so a single-quoted literal here would
    // close the f-string early and produce a Python SyntaxError. Use an
    // explicit `is not None` check (not `or`): a falsy-but-bound value like
    // 0 or False must not be treated as missing and replaced by the raw
    // param-name placeholder text (Copilot PR #574 review).
    return `{ctx.get("${varName}") if ctx.get("${varName}") is not None else "${paramName}"}`;
  });
  // Item 5A: an operation whose path item declares its own OpenAPI `servers`
  // override is NOT served under the client's `/v2` base — the cluster-admin
  // API lives at `{host}:{port}/cluster/v2/...`. Resolving such a path
  // relatively against `base_url` yields `/v2/cluster/v2/...` → 404 "No
  // endpoint". Prefix it with the API root instead, which makes the URL
  // ABSOLUTE; httpx passes an absolute url through `_merge_url` untouched, so
  // no second client fixture is needed. `root_base_url()` mirrors playwright's
  // `buildBaseUrl(true)` precedence.
  //
  // `!== undefined`, never a truthiness check: an OpenAPI `servers[].url` can
  // legitimately be the empty string (relative to the current host), which is
  // a real override and must not be conflated with "no override" — the same
  // distinction playwright's `resolveScenarioServerOverride` makes.
  //
  // Resolution is per STEP (the caller passes `step.serverOverride`), not per
  // test. Python emits one `url_N` per step, so a scenario mixing override and
  // non-override steps routes each request to its own base correctly — the
  // hazard that forces playwright's scenario-level resolver to throw does not
  // apply here.
  const prefix = serverOverride !== undefined ? '{root_base_url()}' : '';
  return `f'${prefix}${result}'`;
}

/**
 * Render a Python string literal with proper escaping.
 * Handles quotes, backslashes, and special characters for Python.
 */
export function renderPythonStringLiteral(value: string): string {
  const escaped = toPythonLiteral(value);
  return `'${escaped}'`;
}

const EMBEDDED_PLACEHOLDER_RE = /\$\{([^}]+)\}/g;
// Non-global twin of EMBEDDED_PLACEHOLDER_RE for a stateless presence check
// — reusing a `g`-flagged RegExp's own `.test()` mutates its `lastIndex`,
// corrupting later calls against a different string.
const HAS_PLACEHOLDER_RE = /\$\{[^}]+\}/;
// A WHOLE-STRING placeholder: the entire value is `${var}`, so it renders as a
// bare `ctx.get('var')` and is therefore `None` when the binding was never
// produced. The concatenated form ('proc-${a}-x') renders as a '+' chain whose
// parts degrade to '' and can never be None, so it is deliberately NOT matched
// here — wrapping those bodies would be pure churn.
const WHOLE_STRING_PLACEHOLDER_RE = /^\$\{([^}]+)\}$/;

/**
 * True when `value` contains at least one whole-string `${var}` binding (at any
 * nesting depth, including inside arrays) that could resolve to None at
 * runtime. `${RANDOM}` is excluded: it is a planner-minted literal seed token,
 * not a ctx binding, and always renders as the literal string.
 *
 * Used to decide whether a rendered body literal needs `prune_nulls(...)`
 * around it (Item 6a).
 */
function hasNullCapablePlaceholder(value: unknown): boolean {
  if (typeof value === 'string') {
    const whole = WHOLE_STRING_PLACEHOLDER_RE.exec(value);
    return whole !== null && whole[1] !== 'RANDOM';
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasNullCapablePlaceholder(item));
  }
  if (isRecord(value)) {
    return Object.values(value).some((item) => hasNullCapablePlaceholder(item));
  }
  return false;
}

/**
 * Render a string that may contain one or more embedded `${var}` bindings
 * mixed with literal text (e.g. `proc-${processInstanceKeyVar}-${tenantIdVar}`)
 * as a concatenation of Python string-literal and ctx-lookup expressions, so
 * no binding is silently dropped by only matching a whole-string placeholder
 * (Copilot PR #574 review).
 */
function renderPythonTemplateString(value: string, pruneAware = false): string {
  const whole = /^\$\{([^}]+)\}$/.exec(value);
  if (whole) {
    if (whole[1] === 'RANDOM') {
      // Planner-minted literal runtime seed token (e.g. 'proc_${RANDOM}'),
      // not a ctx binding -- mirrors the JS/Playwright emitters, which never
      // resolve it either (Copilot PR #574 review).
      return renderPythonStringLiteral(value);
    }
    // ctx keys are the planner's original binding variable names (e.g.
    // tenantIdVar) — must match the ctx.set(...) calls emitted for
    // scenario.bindings verbatim, so no casing transform here (#354).
    // Under prune_nulls, mark an unbound placeholder with a sentinel so a literal
    // JSON null in the template is preserved rather than pruned with it.
    return pruneAware ? `unbound(ctx.get('${whole[1]}'))` : `ctx.get('${whole[1]}')`;
  }
  if (!HAS_PLACEHOLDER_RE.test(value)) {
    return renderPythonStringLiteral(value);
  }
  // Concatenation, not an f-string: a literal runtime seed token like
  // '${RANDOM}' (path-analyser/src/scenarioGenerator.ts) must survive
  // verbatim in the emitted source -- regression-invariants.test.ts asserts
  // the exact '${RANDOM}' substring -- which an f-string's brace-doubling
  // escaping would corrupt into '${{RANDOM}}'. Non-RANDOM ctx lookups are
  // `str(...)`-wrapped since '+' concatenation, unlike an f-string, requires
  // an explicit string.
  const parts: string[] = [];
  let literalBuffer = '';
  let lastIndex = 0;
  for (const match of value.matchAll(EMBEDDED_PLACEHOLDER_RE)) {
    literalBuffer += value.slice(lastIndex, match.index);
    if (match[1] === 'RANDOM') {
      // Fold the literal token into the surrounding literal text instead of
      // a ctx lookup -- it is a planner-minted literal, not a real binding.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal '${RANDOM}' runtime seed token, not JS interpolation.
      literalBuffer += '${RANDOM}';
    } else {
      if (literalBuffer.length > 0) {
        parts.push(renderPythonStringLiteral(literalBuffer));
        literalBuffer = '';
      }
      const varName = match[1];
      // `is not None`, not `or`: a falsy-but-bound value like 0 or False must
      // not collapse to '' (Copilot PR #574 review, same class as the
      // path-param fix in buildPythonUrlExpression above).
      parts.push(`(str(ctx.get('${varName}')) if ctx.get('${varName}') is not None else '')`);
    }
    lastIndex = match.index + match[0].length;
  }
  literalBuffer += value.slice(lastIndex);
  if (literalBuffer.length > 0) {
    parts.push(renderPythonStringLiteral(literalBuffer));
  }
  return parts.join(' + ');
}

/**
 * Render an arbitrary JSON-like value as a valid Python literal.
 * Booleans/None map to Python spelling; whole-string `${var}` placeholders
 * become `ctx.get('snake_var')` lookups; everything else is escaped.
 */
function renderPythonValue(value: unknown, pruneAware = false): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    return renderPythonTemplateString(value, pruneAware);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => renderPythonValue(v, pruneAware)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([k, v]) => `'${k}': ${renderPythonValue(v, pruneAware)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  return 'None';
}

/**
 * Render request body as a Python dictionary.
 * Substitutes placeholders like "${varName}" with ctx.get('var_name').
 */
export function renderPythonBody(
  bodyTemplate: unknown,
  _bindings: Record<string, string | undefined>,
  pruneAware = false,
): string {
  if (!bodyTemplate) return '{}';
  return renderPythonValue(bodyTemplate, pruneAware);
}

/**
 * Render a top-level request-body / multipart-fields dict as statements
 * rather than a single literal expression, deferring any field flagged
 * `omitWhenUnbound` (per the config's global-context-seeds ABox, e.g.
 * `tenantId`) to a runtime-conditional assignment. Without this, a whole-
 * string `${tenantIdVar}` placeholder always renders inline as
 * `ctx.get('tenantIdVar')`, which is `None` when the scenario legitimately
 * never seeded it — sending an explicit JSON/multipart `null` instead of
 * omitting the field and letting the broker apply its own default (#342;
 * mirrors the C#/Playwright emitters' `omitWhenUnboundFields` handling).
 */
function renderPythonDictAssignment(
  varName: string,
  record: Record<string, unknown>,
  omitWhenUnboundFieldNames: ReadonlySet<string>,
): string[] {
  const { inline, deferred } = splitInlineAndDeferred(record, omitWhenUnboundFieldNames);
  const needsPrune = hasNullCapablePlaceholder(inline.map(([, v]) => v));
  const inlineEntries = inline.map(
    ([fieldName, fieldValue]) => `'${fieldName}': ${renderPythonValue(fieldValue, needsPrune)}`,
  );
  // Item 6a: a whole-string `${var}` binding renders inline as `ctx.get('var')`,
  // which is None when the producer never bound it — and an explicit JSON null
  // in a body is a *present but unusable* value the broker rejects (a null
  // cursor is 400 "At least one of [from, after, before, limit] is required").
  // `prune_nulls` drops those nulls and any container they thereby emptied.
  //
  // Only the INLINE values are considered: a field deferred to the
  // `omitWhenUnbound` block below is already null-guarded by its own
  // `if __x_val is not None`, so counting it would wrap a literal that can
  // never produce a null (e.g. a multipart `fields` template consisting solely
  // of `tenantId` renders `data_N = {}`). Wrapping only when the template can
  // actually produce a null keeps every other body byte-identical. The deferred
  // assignments still work: `prune_nulls` returns a dict to mutate.
  const literal = `{${inlineEntries.join(', ')}}`;
  const lines = [`    ${varName} = ${needsPrune ? `prune_nulls(${literal})` : literal}`];
  for (const { fieldName, binding } of deferred) {
    const local = `__${toSnakeCase(fieldName)}_val`;
    lines.push(`    ${local} = ctx.get('${binding}')`);
    lines.push(`    if ${local} is not None:`);
    lines.push(`        ${varName}['${fieldName}'] = ${local}`);
  }
  return lines;
}

/**
 * Split a record template's fields into those rendered INLINE in the literal
 * and those DEFERRED to a runtime-conditional `omitWhenUnbound` assignment.
 *
 * Single source of truth for both the emitted literal and the null-prune
 * decision, so the two can never disagree about which fields are inline.
 */
function splitInlineAndDeferred(
  record: Record<string, unknown>,
  omitWhenUnboundFieldNames: ReadonlySet<string>,
): {
  inline: [string, unknown][];
  deferred: { fieldName: string; binding: string }[];
} {
  const inline: [string, unknown][] = [];
  const deferred: { fieldName: string; binding: string }[] = [];
  for (const [fieldName, fieldValue] of Object.entries(record)) {
    const whole =
      typeof fieldValue === 'string' ? WHOLE_STRING_PLACEHOLDER_RE.exec(fieldValue) : null;
    if (whole !== null && omitWhenUnboundFieldNames.has(fieldName)) {
      deferred.push({ fieldName, binding: whole[1] });
      continue;
    }
    inline.push([fieldName, fieldValue]);
  }
  return { inline, deferred };
}

/**
 * Whether rendering `step`'s payload will wrap the literal in `prune_nulls`,
 * i.e. whether any value it emits INLINE can resolve to None at runtime.
 *
 * This is the single source of truth for both the per-step wrap decision and
 * the suite-level `from support.prune import prune_nulls` import, so the two
 * can never disagree (an import emitted for a suite that never wraps is dead
 * code; a wrap without the import is a runtime NameError that fails every test
 * in the file).
 *
 * Fields deferred to the `omitWhenUnbound` block are excluded — they are
 * already null-guarded by their own `if __x_val is not None`.
 */
function stepPayloadNeedsPrune(
  step: RequestStep,
  omitWhenUnboundFieldNames: ReadonlySet<string>,
): boolean {
  const payload =
    step.bodyKind === 'multipart'
      ? (step.multipartTemplate ?? step.bodyTemplate)
      : step.bodyTemplate;
  if (payload === undefined) return false;
  if (step.bodyKind === 'multipart' && isRecord(payload)) {
    // Only `fields` is considered. `files` is rendered by
    // `renderPythonMultipartFiles`, which never wraps its values in
    // `prune_nulls` (a file entry is a `(filename, bytes)` tuple or a
    // `resolve_fixture(...)` call, not a JSON value), so counting a placeholder
    // there would emit the import for a suite that never calls the helper —
    // dead code the Layer-3 invariant reports as an unused import.
    const fields = payload.fields;
    const inlineFields = isRecord(fields)
      ? splitInlineAndDeferred(fields, omitWhenUnboundFieldNames).inline.map(([, v]) => v)
      : fields;
    return hasNullCapablePlaceholder(inlineFields);
  }
  if (isRecord(payload)) {
    return hasNullCapablePlaceholder(
      splitInlineAndDeferred(payload, omitWhenUnboundFieldNames).inline.map(([, v]) => v),
    );
  }
  return hasNullCapablePlaceholder(payload);
}

/**
 * Main entry point for the Python SDK emitter.
 * Creates and returns the EmitterStrategy implementation.
 *
 * @param operationMap Optional operation map for validating SDK coverage
 */
export function createPythonSdkEmitter(
  operationMap: OperationMapSource | undefined,
): EmitterStrategy {
  return {
    id: 'python-sdk',
    name: 'Python SDK',
    supportedConfigs: ['*'],
    sdkMap: {
      repo: 'camunda/orchestration-cluster-api-python',
      path: 'examples/operation-map.json',
      refEnv: 'PYTHON_SDK_REF',
      out: 'spec/python-sdk/operation-map.json',
    },
    async emit(collection: EndpointScenarioCollection, ctx: EmitContext): Promise<EmittedFile[]> {
      const content = renderPythonSuite(collection, {
        operationMap,
        globalContextSeeds: ctx.globalContextSeeds,
      });
      return [
        {
          relativePath: pythonSuiteFileName(collection, ctx.mode),
          content,
        },
      ];
    },
  };
}

/**
 * Render a complete Python test suite for a scenario collection.
 */
export function renderPythonSuite(
  collection: EndpointScenarioCollection,
  opts: {
    operationMap?: OperationMapSource;
    globalContextSeeds?: readonly GlobalContextSeed[];
  } = {},
): string {
  if (opts.globalContextSeeds !== undefined) {
    assertSafeGlobalContextSeeds(opts.globalContextSeeds);
  }
  const omitWhenUnboundFieldNames = new Set(
    (opts.globalContextSeeds ?? [])
      .filter((seed) => seed.omitWhenUnbound)
      .map((seed) => seed.fieldName),
  );
  // Binding names (not field names) for the same omitWhenUnbound seeds --
  // without this, a scenario whose planner-computed seedBindings named e.g.
  // tenantIdVar would still unconditionally seed_binding() it here, sending
  // a fabricated value instead of leaving the field genuinely unset (#342).
  const omitWhenUnboundBindingNames = new Set(
    (opts.globalContextSeeds ?? [])
      .filter((seed) => seed.omitWhenUnbound)
      .map((seed) => seed.binding),
  );
  // Bindings already handled by the universal-seed prologue below -- a
  // per-scenario seed name that collides with one of these is skipped so
  // it isn't seeded twice (mirrors ctxSeeding.ts's `globalSeedNames`).
  const globalSeedNames = new Set(
    (opts.globalContextSeeds ?? [])
      .filter((seed) => !seed.omitWhenUnbound)
      .map((seed) => seed.binding),
  );
  const lines: string[] = [];

  // Header and imports
  lines.push('"""');
  lines.push(`Auto-generated tests for ${collection.endpoint.operationId}`);
  lines.push('Generated by api-test-generator');
  lines.push('"""');
  lines.push('');
  lines.push('import pytest');
  lines.push('import httpx');
  lines.push('import re');
  const hasEventualWaits = collection.scenarios.some((scenario) =>
    (scenario.requestPlan ?? []).some((step) => (step.eventualWaitsAfter ?? []).length > 0),
  );
  if (hasEventualWaits) {
    lines.push('import asyncio');
    lines.push('import time');
  }
  const hasMultipartStep = collection.scenarios.some((scenario) =>
    (scenario.requestPlan ?? []).some(
      (step) =>
        step.bodyKind === 'multipart' &&
        containsFixtureMarker(step.multipartTemplate ?? step.bodyTemplate),
    ),
  );
  // A scenario needs seed_binding() when it has planner-computed
  // seedBindings, OR when one of its own literal bindings is stripped out
  // for uniqueness (see the unique-binding handling below), OR when any
  // non-`omitWhenUnbound` global context seed exists (that prologue loop
  // runs for every scenario in the collection).
  const hasNonOmittingGlobalSeeds = (opts.globalContextSeeds ?? []).some(
    (seed) => !seed.omitWhenUnbound,
  );
  const hasSeedBindings =
    (hasNonOmittingGlobalSeeds && collection.scenarios.length > 0) ||
    collection.scenarios.some((scenario) => {
      if ((scenario.seedBindings ?? []).length > 0) return true;
      const unique = computeUniqueBindings(
        scenario.requestPlan,
        scenario.modelDerivedLiteralBindings,
      );
      const bindings = scenario.bindings ?? {};
      return Object.entries(bindings).some(([k, v]) => v !== '__PENDING__' && unique.has(k));
    });
  // Item 5A: a step whose operation declares a path-level OpenAPI `servers`
  // override is served outside the client's `/v2` base (cluster-admin), so its
  // URL is built absolute against the API root via `root_base_url()`. Import
  // the helper only when some step actually needs it, so every suite without
  // such a step stays byte-identical to before.
  const needsRootBaseUrl = collection.scenarios.some((scenario) =>
    (scenario.requestPlan ?? []).some((step) => step.serverOverride !== undefined),
  );
  if (needsRootBaseUrl) {
    lines.push('from support.base_url import root_base_url');
  }
  // Item 6a: a body whose template contains a whole-string `${var}` binding can
  // serialise an explicit JSON null when that binding was never produced (the
  // normal case for a cursor on a single-page response), which the broker
  // rejects. Such bodies are wrapped in `prune_nulls(...)`. Import the helper
  // only when some step actually needs it, so suites without a null-capable
  // placeholder stay byte-identical.
  const needsPruneNulls = collection.scenarios.some((scenario) =>
    (scenario.requestPlan ?? []).some((step) =>
      stepPayloadNeedsPrune(step, omitWhenUnboundFieldNames),
    ),
  );
  if (needsPruneNulls) {
    lines.push('from support.prune import prune_nulls, unbound');
  }
  if (hasMultipartStep) {
    lines.push('from support.fixtures import resolve_fixture');
  }
  if (hasSeedBindings) {
    lines.push('from support.seeding import init_spec_salt, seed_binding');
  }
  const needsAwaitEventually = collection.scenarios.some((scenario) => {
    const ecOps = new Set(
      scenario.operations.filter((o) => o.eventuallyConsistent).map((o) => o.operationId),
    );
    return (scenario.requestPlan ?? []).some((step) => stepNeedsAwaitForOp(step, ecOps));
  });
  if (needsAwaitEventually) {
    lines.push('from support.await_eventually import await_eventually');
  }
  lines.push('from typing import Any, Dict');
  lines.push('');
  lines.push('# Sentinel distinguishing "field absent" from an explicit JSON null');
  lines.push('# (Copilot PR #574 review).');
  lines.push('_MISSING = object()');
  lines.push('');

  // Test context setup
  lines.push('class TestContext:');
  lines.push('    """Shared test context for managing state across requests."""');
  lines.push('');
  lines.push('    def __init__(self):');
  lines.push('        self.ctx: Dict[str, Any] = {}');
  lines.push('        self.responses: Dict[str, Any] = {}');
  lines.push('');
  lines.push('    def get(self, key: str, default: Any = None) -> Any:');
  lines.push('        """Get a value from the context."""');
  lines.push('        return self.ctx.get(key, default)');
  lines.push('');
  lines.push('    def set(self, key: str, value: Any) -> None:');
  lines.push('        """Set a value in the context."""');
  lines.push('        self.ctx[key] = value');
  lines.push('');

  // Test fixtures
  lines.push('@pytest.fixture');
  lines.push('def ctx() -> TestContext:');
  lines.push('    """Provide a fresh test context for each test."""');
  lines.push('    return TestContext()');
  lines.push('');
  lines.push('def get_nested_value(value: Any, field_path: str) -> Any:');
  lines.push('    """Safely navigate dotted/indexed field paths (e.g. \'a.b[0].c\') on dict/list');
  lines.push('    payloads. Returns _MISSING (not None) when the path does not resolve, so');
  lines.push('    callers can distinguish an absent field from an explicit JSON null."""');
  lines.push('    current = value');
  lines.push("    for part in re.findall(r'[^.\\[\\]]+|\\[[0-9]+\\]', field_path):");
  lines.push('        if current is _MISSING:');
  lines.push('            return _MISSING');
  lines.push("        if part.startswith('[') and part.endswith(']'):");
  lines.push('            if not isinstance(current, list):');
  lines.push('                return _MISSING');
  lines.push('            index = int(part[1:-1])');
  lines.push('            if index >= len(current):');
  lines.push('                return _MISSING');
  lines.push('            current = current[index]');
  lines.push('            continue');
  lines.push('        if isinstance(current, dict):');
  lines.push('            if part not in current:');
  lines.push('                return _MISSING');
  lines.push('            current = current[part]');
  lines.push('            continue');
  lines.push('        return _MISSING');
  lines.push('    return current');
  lines.push('');
  lines.push('def assert_response_shape(data: Any, fields: list) -> None:');
  lines.push(
    '    """Validate top-level required/nullable fields on a successful response (mirrors the Playwright/C# emitters\' final-step shape check)."""',
  );
  lines.push("    assert isinstance(data, dict), 'Response is not a JSON object.'");
  lines.push('    for field in fields:');
  lines.push("        name = field['name']");
  lines.push("        required = field.get('required', False)");
  lines.push("        nullable = field.get('nullable', False)");
  lines.push('        if name not in data:');
  lines.push('            assert not required, f"Missing required field \'{name}\'."');
  lines.push('            continue');
  lines.push('        if required and not nullable:');
  lines.push('            assert data[name] is not None, f"Field \'{name}\' must not be null."');
  lines.push('');

  // Test scenarios
  for (const scenario of collection.scenarios) {
    const testName = toPythonTestName(scenario);
    lines.push(`@pytest.mark.asyncio`);
    lines.push(`async def test_${testName}(ctx: TestContext, client: httpx.AsyncClient) -> None:`);
    lines.push(`    """`);
    lines.push(`    ${scenario.name || scenario.id}`);
    if (scenario.description) {
      lines.push(`    ${scenario.description}`);
    }
    lines.push(`    """`);

    if (hasSeedBindings) {
      // Set immediately before this test's own seeding, not once at module
      // import time: pytest imports every generated operation module before
      // running any test, so a module-level call left the salt reflecting
      // whichever module was imported last, and every test's seed_binding()
      // calls (across every suite) collided on that one salt.
      lines.push(`    init_spec_salt('${collection.endpoint.operationId}')`);
    }

    const uniqueBindings = computeUniqueBindings(
      scenario.requestPlan,
      scenario.modelDerivedLiteralBindings,
    );

    const bindings = scenario.bindings ?? {};
    // Literal entries flagged unique must NOT be written verbatim: a
    // concrete client-minted value here would defeat the `unique=True`
    // seed the binding needs on a re-run (mirrors ctxSeeding.ts's
    // `emitCtxSeeding` -- see #320). Strip them from the literal loop and
    // re-route them into the seed loop below.
    for (const [key, value] of Object.entries(bindings)) {
      if (value === '__PENDING__' || uniqueBindings.has(key)) continue;
      lines.push(`    ctx.set('${key}', ${renderPythonValue(value)})`);
    }
    const strippedForUnique = Object.entries(bindings)
      .filter(([k, v]) => v !== '__PENDING__' && uniqueBindings.has(k))
      .map(([k]) => k);

    const seedNames = Array.from(
      new Set([...(scenario.seedBindings ?? []), ...strippedForUnique]),
    ).filter((n) => !globalSeedNames.has(n));
    for (const seedName of seedNames) {
      if (omitWhenUnboundBindingNames.has(seedName) && !uniqueBindings.has(seedName)) continue;
      const uniqueArg = uniqueBindings.has(seedName) ? ', unique=True' : '';
      lines.push(
        `    ctx.set('${seedName}', ctx.get('${seedName}') if ctx.get('${seedName}') is not None else seed_binding('${seedName}'${uniqueArg}))`,
      );
    }

    // Universal-seed prologue (the ABox-driven globalContextSeeds list),
    // mirroring the Playwright/JS/C# emitters' final seeding step. Without
    // this loop a normal (non-`omitWhenUnbound`) global seed was NEVER
    // emitted for Python, leaving its binding unset for every scenario.
    for (const seed of opts.globalContextSeeds ?? []) {
      if (seed.omitWhenUnbound) continue;
      const uniqueArg = uniqueBindings.has(seed.binding) ? ', unique=True' : '';
      lines.push(
        `    ctx.set('${seed.binding}', ctx.get('${seed.binding}') if ctx.get('${seed.binding}') is not None else seed_binding('${seed.seedRule}'${uniqueArg}))`,
      );
    }

    const requestPlan = scenario.requestPlan ?? [];
    if (requestPlan.length === 0) {
      // A silently-empty test body pytest reports as a pass — fail loudly
      // at generation time instead of shipping false endpoint coverage
      // (Copilot PR #574 review).
      throw new Error(
        `python-sdk emitter: scenario '${scenario.id}' for operation '${collection.endpoint.operationId}' has an empty requestPlan — refusing to emit a no-op test.`,
      );
    }
    const isErrorScenario = scenario.expectedResult?.kind === 'error';
    const ecOps = new Set(
      scenario.operations.filter((o) => o.eventuallyConsistent).map((o) => o.operationId),
    );
    for (let i = 0; i < requestPlan.length; i++) {
      const isFinal = i === requestPlan.length - 1;
      renderPythonRequestStep(
        lines,
        requestPlan[i],
        i,
        omitWhenUnboundFieldNames,
        isFinal && !isErrorScenario ? scenario.responseShapeFields : undefined,
        stepNeedsAwaitForOp(requestPlan[i], ecOps),
      );
      const waits = requestPlan[i].eventualWaitsAfter ?? [];
      for (let w = 0; w < waits.length; w++) {
        renderPythonEventualWait(lines, waits[w], i, w);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function renderPythonRequestStep(
  lines: string[],
  step: RequestStep,
  index: number,
  omitWhenUnboundFieldNames: ReadonlySet<string>,
  responseShapeFields?: EndpointScenario['responseShapeFields'],
  awaitEventually = false,
): void {
  const stepNum = index + 1;
  const responseVar = `response_${stepNum}`;
  const methodName = step.method.toLowerCase();
  const responseDataVar = `response_data_${stepNum}`;
  const detailVar = `detail_${stepNum}`;
  const payloadTemplate =
    step.bodyKind === 'multipart'
      ? (step.multipartTemplate ?? step.bodyTemplate)
      : step.bodyTemplate;
  const requestArgs: string[] = [];

  lines.push(`    # Step ${stepNum}: ${step.operationId}`);

  if (step.pathTemplate) {
    const urlExpr = buildPythonUrlExpression(
      step.pathTemplate,
      step.pathParams,
      step.serverOverride,
    );
    lines.push(`    url_${stepNum} = ${urlExpr}`);
    requestArgs.push(`url_${stepNum}`);
  }

  if (payloadTemplate !== undefined) {
    if (step.bodyKind === 'multipart' && isRecord(payloadTemplate)) {
      const fieldsTemplate = payloadTemplate.fields;
      const filesTemplate = payloadTemplate.files;
      if (fieldsTemplate !== undefined) {
        if (isRecord(fieldsTemplate)) {
          lines.push(
            ...renderPythonDictAssignment(
              `data_${stepNum}`,
              fieldsTemplate,
              omitWhenUnboundFieldNames,
            ),
          );
        } else {
          lines.push(`    data_${stepNum} = ${renderPythonValue(fieldsTemplate)}`);
        }
        requestArgs.push(`data=data_${stepNum}`);
      }
      const isDocumentUpload =
        step.operationId === 'createDocument' || step.operationId === 'createDocuments';
      const hasNoFiles = !isRecord(filesTemplate) || Object.keys(filesTemplate).length === 0;
      if (isDocumentUpload && hasNoFiles) {
        // An empty files dict makes httpx send form-urlencoded, which the broker rejects with 415.
        const field = step.operationId === 'createDocuments' ? 'files' : 'file';
        lines.push(`    files_${stepNum} = {'${field}': ('hello.txt', b'Hello, world!')}`);
        requestArgs.push(`files=files_${stepNum}`);
      } else if (filesTemplate !== undefined) {
        lines.push(`    files_${stepNum} = ${renderPythonMultipartFiles(filesTemplate)}`);
        requestArgs.push(`files=files_${stepNum}`);
      }
    } else if (isRecord(payloadTemplate)) {
      lines.push(
        ...renderPythonDictAssignment(
          `body_${stepNum}`,
          payloadTemplate,
          omitWhenUnboundFieldNames,
        ),
      );
      requestArgs.push(`json=body_${stepNum}`);
    } else {
      // Item 6a: same null-pruning rule as the dict path above, applied to a
      // non-record body (an array or scalar template). No bundled template
      // currently takes this shape with a placeholder, but the rule is about
      // the class "a body that can serialise an explicit null", not about the
      // dict case, so it is enforced here too rather than left to drift.
      const prune = hasNullCapablePlaceholder(payloadTemplate);
      const bodyExpr = renderPythonBody(payloadTemplate, {}, prune);
      const wrapped = prune ? `prune_nulls(${bodyExpr})` : bodyExpr;
      lines.push(`    body_${stepNum} = ${wrapped}`);
      requestArgs.push(`json=body_${stepNum}`);
    }
  }

  // httpx.AsyncClient.get()/delete()/options()/head() don't accept the
  // json=/data=/files= body kwargs (only request()/post()/put()/patch() do),
  // so a body-bearing step on one of those verbs must go through the generic
  // request() method to avoid a TypeError at test-run time (Copilot PR #574 review).
  const bodylessConvenienceVerbs = new Set(['get', 'delete', 'options', 'head']);
  const hasBodyArg = requestArgs.some((arg) => /^(json|data|files)=/.test(arg));
  const callLines: string[] = [];
  if (hasBodyArg && bodylessConvenienceVerbs.has(methodName)) {
    callLines.push('client.request(');
    callLines.push(`    '${step.method.toUpperCase()}',`);
  } else {
    callLines.push(`client.${methodName}(`);
  }
  for (const arg of requestArgs) callLines.push(`    ${arg},`);
  callLines.push(')');
  if (awaitEventually) {
    lines.push(`    ${responseVar} = await await_eventually(`);
    lines.push(`        lambda: ${callLines[0]}`);
    for (const l of callLines.slice(1, -1)) lines.push(`        ${l}`);
    lines.push('        ),');
    lines.push(`        operation_id='${step.operationId}',`);
    lines.push(`        method='${step.method.toUpperCase()}',`);
    if (!step.extract?.length) lines.push('        require_items=False,');
    lines.push('    )');
  } else {
    lines.push(`    ${responseVar} = await ${callLines[0]}`);
    for (const l of callLines.slice(1)) lines.push(`    ${l}`);
  }
  lines.push(`    assert ${responseVar}.status_code == ${step.expect.status}, ${responseVar}.text`);

  const needsResponseData =
    (step.extract && step.extract.length > 0) ||
    (responseShapeFields?.length ?? 0) > 0 ||
    !!step.expect.detailContains;
  if (needsResponseData) {
    lines.push(`    ${responseDataVar}: Any = None`);
    lines.push('    try:');
    lines.push(`        ${responseDataVar} = ${responseVar}.json()`);
    lines.push('    except ValueError:');
    lines.push('        pass');
    if (step.expect.detailContains) {
      // #404 — pin WHY the request was rejected, not just that it was.
      // `.get('detail', '')`'s default only applies when the key is ABSENT:
      // a present `"detail": null` still returns None, and `in None` raises
      // TypeError; a list-valued detail would do list membership instead of
      // substring matching. isinstance(..., str) first rules out both.
      lines.push(
        `    ${detailVar} = ${responseDataVar}.get('detail') if isinstance(${responseDataVar}, dict) else None`,
      );
      lines.push(
        `    assert isinstance(${detailVar}, str) and ${renderPythonValue(step.expect.detailContains)} in ${detailVar}, f"expected detail to contain {${renderPythonValue(step.expect.detailContains)}!r}, got: {${detailVar}!r}"`,
      );
    }
    if (step.extract) {
      for (const [extractIdx, extract] of step.extract.entries()) {
        // Use the _MISSING sentinel (not None) so an absent field doesn't
        // overwrite an existing seed/earlier extract; an explicit JSON null
        // is still a real value and is set as such (Copilot PR #574 review).
        const extractedVar = `extracted_${stepNum}_${extractIdx}`;
        lines.push(
          `    ${extractedVar} = get_nested_value(${responseDataVar}, '${extract.fieldPath}')`,
        );
        lines.push(`    if ${extractedVar} is not _MISSING:`);
        lines.push(`        ctx.set('${extract.bind}', ${extractedVar})`);
      }
    }
    if (responseShapeFields?.length) {
      const shapeLiteral = renderPythonValue(
        responseShapeFields.map((field) => ({
          name: field.name,
          required: field.required ?? false,
          nullable: field.nullable ?? false,
        })),
      );
      lines.push(`    assert_response_shape(${responseDataVar}, ${shapeLiteral})`);
    }
  }
}

/**
 * Render a planner-annotated eventual-state wait (#159) as a sibling block
 * immediately after its producer step. Polls the witness operation via a
 * raw GET (using the same httpx client the request steps use) until the
 * predicate field matches or the wait budget is exhausted, mirroring the
 * Playwright/JS reference emitters' `awaitEventually` semantics.
 */
function renderPythonEventualWait(
  lines: string[],
  wait: EventualWaitSpec,
  stepIndex: number,
  waitIndex: number,
): void {
  const w = wait.witness;
  const suffix = `${stepIndex + 1}_${waitIndex + 1}`;
  const waitUpToMs = w.waitUpToMs ?? 10_000;
  const pollIntervalMs = Math.max(10, w.pollIntervalMs ?? 500);
  const urlVar = `witness_url_${suffix}`;
  const startedVar = `witness_started_${suffix}`;
  const respVar = `witness_response_${suffix}`;
  const dataVar = `witness_data_${suffix}`;
  const methodName = w.method.toLowerCase();

  lines.push(`    # Wait for ${wait.state} (eventual; witness: ${w.operationId})`);
  lines.push(`    ${urlVar} = ${buildPythonUrlExpression(w.pathTemplate)}`);
  lines.push(`    ${startedVar} = time.monotonic()`);
  lines.push('    while True:');
  lines.push(`        ${respVar} = await client.${methodName}(${urlVar})`);
  lines.push(`        if ${respVar}.status_code == 200:`);
  lines.push(`            ${dataVar}: Any = None`);
  lines.push('            try:');
  lines.push(`                ${dataVar} = ${respVar}.json()`);
  lines.push('            except ValueError:');
  lines.push('                pass');
  lines.push(
    `            if isinstance(${dataVar}, dict) and ${dataVar}.get(${renderPythonStringLiteral(w.predicate.path)}) == ${renderPythonValue(w.predicate.equals)}:`,
  );
  lines.push('                break');
  // 429 (rate-limited) is retried like 404 (not-yet-materialized) rather
  // than treated as terminal, so a transient broker throttle doesn't fail
  // the wait before its budget is exhausted (Copilot PR #574 review).
  lines.push(`        elif ${respVar}.status_code not in (404, 429):`);
  lines.push('            break');
  lines.push(`        if (time.monotonic() - ${startedVar}) * 1000 >= ${waitUpToMs}:`);
  lines.push(
    `            raise AssertionError(f"Eventual consistency timeout for operation '${w.operationId}' after {(time.monotonic() - ${startedVar}) * 1000:.0f}ms")`,
  );
  lines.push(
    `        await asyncio.sleep(min(${pollIntervalMs / 1000}, (${waitUpToMs} - (time.monotonic() - ${startedVar}) * 1000) / 1000))`,
  );
  lines.push(`    assert ${respVar}.status_code == 200`);
}

function renderPythonMultipartFiles(filesTemplate: unknown): string {
  if (!isRecord(filesTemplate)) {
    return renderPythonValue(filesTemplate);
  }
  const entries = Object.entries(filesTemplate).map(([key, value]) => {
    if (typeof value === 'string' && value.startsWith('@@FILE:')) {
      const fixturePath = value.slice('@@FILE:'.length);
      const filename = fixturePath.split('/').pop() || key;
      return `'${key}': (${renderPythonStringLiteral(filename)}, resolve_fixture(${renderPythonStringLiteral(fixturePath)}))`;
    }
    return `'${key}': ${renderPythonValue(value)}`;
  });
  return `{${entries.join(', ')}}`;
}
