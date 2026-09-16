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
import { camelCase } from '../playwright/stepRenderer.js';
import { type OperationMapSource, toPythonLiteral } from './sdk-mapping.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  return `f'${result}'`;
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

/**
 * Render a string that may contain one or more embedded `${var}` bindings
 * mixed with literal text (e.g. `proc-${processInstanceKeyVar}-${tenantIdVar}`)
 * as a concatenation of Python string-literal and ctx-lookup expressions, so
 * no binding is silently dropped by only matching a whole-string placeholder
 * (Copilot PR #574 review).
 */
function renderPythonTemplateString(value: string): string {
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
    return `ctx.get('${whole[1]}')`;
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
function renderPythonValue(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    return renderPythonTemplateString(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => renderPythonValue(v)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `'${k}': ${renderPythonValue(v)}`);
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
): string {
  if (!bodyTemplate) return '{}';
  return renderPythonValue(bodyTemplate);
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
  const inlineEntries: string[] = [];
  const deferred: { fieldName: string; binding: string }[] = [];
  for (const [fieldName, fieldValue] of Object.entries(record)) {
    const whole = typeof fieldValue === 'string' ? /^\$\{([^}]+)\}$/.exec(fieldValue) : null;
    if (whole && omitWhenUnboundFieldNames.has(fieldName)) {
      deferred.push({ fieldName, binding: whole[1] });
      continue;
    }
    inlineEntries.push(`'${fieldName}': ${renderPythonValue(fieldValue)}`);
  }
  const lines = [`    ${varName} = {${inlineEntries.join(', ')}}`];
  for (const { fieldName, binding } of deferred) {
    const local = `__${toSnakeCase(fieldName)}_val`;
    lines.push(`    ${local} = ctx.get('${binding}')`);
    lines.push(`    if ${local} is not None:`);
    lines.push(`        ${varName}['${fieldName}'] = ${local}`);
  }
  return lines;
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
      (step) => step.bodyKind === 'multipart' && step.multipartTemplate !== undefined,
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
  if (hasMultipartStep) {
    lines.push('from support.fixtures import resolve_fixture');
  }
  if (hasSeedBindings) {
    lines.push('from support.seeding import init_spec_salt, seed_binding');
  }
  lines.push('from typing import Any, Dict');
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
  lines.push(
    '    """Safely navigate dotted/indexed field paths (e.g. \'a.b[0].c\') on dict/list payloads."""',
  );
  lines.push('    current = value');
  lines.push("    for part in re.findall(r'[^.\\[\\]]+|\\[[0-9]+\\]', field_path):");
  lines.push('        if current is None:');
  lines.push('            return None');
  lines.push("        if part.startswith('[') and part.endswith(']'):");
  lines.push('            if not isinstance(current, list):');
  lines.push('                return None');
  lines.push('            index = int(part[1:-1])');
  lines.push('            if index >= len(current):');
  lines.push('                return None');
  lines.push('            current = current[index]');
  lines.push('            continue');
  lines.push('        if isinstance(current, dict):');
  lines.push('            current = current.get(part)');
  lines.push('            continue');
  lines.push('        return None');
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
    for (let i = 0; i < requestPlan.length; i++) {
      const isFinal = i === requestPlan.length - 1;
      renderPythonRequestStep(
        lines,
        requestPlan[i],
        i,
        omitWhenUnboundFieldNames,
        isFinal && !isErrorScenario ? scenario.responseShapeFields : undefined,
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
): void {
  const stepNum = index + 1;
  const responseVar = `response_${stepNum}`;
  const methodName = step.method.toLowerCase();
  const responseDataVar = `response_data_${stepNum}`;
  const payloadTemplate =
    step.bodyKind === 'multipart'
      ? (step.multipartTemplate ?? step.bodyTemplate)
      : step.bodyTemplate;
  const requestArgs: string[] = [];

  lines.push(`    # Step ${stepNum}: ${step.operationId}`);

  if (step.pathTemplate) {
    const urlExpr = buildPythonUrlExpression(step.pathTemplate, step.pathParams);
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
      if (filesTemplate !== undefined) {
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
      const bodyExpr = renderPythonBody(payloadTemplate, {});
      lines.push(`    body_${stepNum} = ${bodyExpr}`);
      requestArgs.push(`json=body_${stepNum}`);
    }
  }

  lines.push(`    ${responseVar} = await client.${methodName}(`);
  for (const arg of requestArgs) {
    lines.push(`        ${arg},`);
  }
  lines.push('    )');
  lines.push(`    assert ${responseVar}.status_code == ${step.expect.status}`);

  const needsResponseData =
    (step.extract && step.extract.length > 0) || (responseShapeFields?.length ?? 0) > 0;
  if (needsResponseData) {
    lines.push(`    ${responseDataVar}: Any = None`);
    lines.push('    try:');
    lines.push(`        ${responseDataVar} = ${responseVar}.json()`);
    lines.push('    except ValueError:');
    lines.push('        pass');
    if (step.extract) {
      for (const extract of step.extract) {
        lines.push(
          `    ctx.set('${extract.bind}', get_nested_value(${responseDataVar}, '${extract.fieldPath}'))`,
        );
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
  lines.push(`        elif ${respVar}.status_code not in (404,):`);
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
