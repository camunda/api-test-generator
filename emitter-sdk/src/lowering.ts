/**
 * Language-neutral lowering of a planned scenario (#812).
 *
 * The planner emits scenarios (`EndpointScenario.requestPlan`) whose steps
 * still carry decisions every emitter used to re-derive on its own: path
 * bindings from `{param}` placeholders, which reads to poll, which bindings
 * need a unique seed, which fields to omit when unbound, and `"${binding}"`
 * / `"@@FILE:path"` strings inside body templates. Each SDK emitter re-did
 * that work, and they drifted (uneven feature support, conflicting beliefs
 * about `pathParams`).
 *
 * `lowerScenario()` makes every one of those decisions once and returns a
 * plan an emitter only has to *render*: no placeholder parsing, no
 * eventual-consistency rules, no seeding rules. An SDK adapter for a new
 * language (Rust, D, PHP, …) renders a `LoweredScenario`; it never reads
 * the raw scenario.
 *
 * Everything here is pure and deterministic. The Playwright emitter renders
 * the same decisions (it imports these helpers), so all emitters agree by
 * construction.
 */

import type {
  EndpointScenario,
  EventualWaitSpec,
  GlobalContextSeed,
  RequestStep,
  SearchPagingChecks,
} from 'path-analyser/types';
import { PENDING_BINDING } from 'path-analyser/types';

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** Lower-case the first character (`ProcessInstanceKey` → `processInstanceKey`). */
export function camelCase(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * The ctx binding a `{param}` path placeholder reads. The planner guarantees
 * this binding exists for every placeholder of a step it emits (it adds a
 * `placeholderAlias` extract when the producing step binds it under a
 * different name), so this naming rule is part of the plan contract.
 */
export function pathParamBinding(param: string): string {
  return `${camelCase(param)}Var`;
}

const PATH_PARAM_RE = /\{([^}]+)\}/g;

/** One path placeholder and the ctx binding that fills it. */
export interface LoweredPathParam {
  /** Placeholder name as written in the path template (`processInstanceKey`). */
  name: string;
  /** ctx binding holding the value. */
  binding: string;
}

/**
 * The path parameters of a step, in template order. An explicit
 * `step.pathParams` entry wins over the naming rule (the planner does not
 * populate it today, but the field is part of the `RequestStep` contract).
 */
export function lowerPathParams(
  pathTemplate: string,
  explicit?: readonly { name: string; var: string }[],
): LoweredPathParam[] {
  const byName = new Map((explicit ?? []).map((p) => [p.name, p.var]));
  return [...pathTemplate.matchAll(PATH_PARAM_RE)].map((m) => ({
    name: m[1],
    binding: byName.get(m[1]) ?? pathParamBinding(m[1]),
  }));
}

// ---------------------------------------------------------------------------
// Eventual consistency and servers
// ---------------------------------------------------------------------------

/**
 * Whether a step must be polled until it succeeds, because its operation is
 * eventually consistent. True iff:
 *   1. its `operationId` is in `ecOps` (operations marked
 *      `x-eventually-consistent`, from `scenario.operations[]`);
 *   2. it is a read: `GET` or `POST …/search` (writes return at once; the
 *      lag shows on the next read);
 *   3. it expects `200` (an error scenario is never polled).
 */
export function stepNeedsAwaitForOp(step: RequestStep, ecOps: ReadonlySet<string>): boolean {
  if (!ecOps.has(step.operationId)) return false;
  if (step.expect.status !== 200) return false;
  const method = step.method.toUpperCase();
  return method === 'GET' || (method === 'POST' && /\/search\/?$/.test(step.pathTemplate));
}

/** Operation ids the scenario marks eventually consistent. */
export function eventuallyConsistentOps(
  operations: readonly { operationId: string; eventuallyConsistent?: boolean }[],
): Set<string> {
  const ecOps = new Set<string>();
  for (const op of operations) if (op.eventuallyConsistent) ecOps.add(op.operationId);
  return ecOps;
}

/**
 * The one server override every request in a scenario shares, or
 * `undefined` for the default base. Throws if a scenario mixes bases:
 * emitted tests hoist a single base URL, so a mix would send some requests
 * to the wrong host.
 */
export function resolveScenarioServerOverride(
  operations: readonly { serverOverride?: string }[],
): string | undefined {
  // `!== undefined`, not truthiness: an empty `servers[].url` is a real
  // (relative) override.
  const withOverride = operations.filter((o) => o.serverOverride !== undefined);
  const withoutOverride = operations.filter((o) => o.serverOverride === undefined);
  const overrides = new Set(withOverride.map((o) => o.serverOverride));
  if (overrides.size > 1 || (overrides.size === 1 && withoutOverride.length > 0)) {
    const labels = [...overrides];
    if (withoutOverride.length > 0) labels.push('<default>');
    throw new Error(
      `Scenario mixes operations with different server overrides (${labels.join(', ')}) — ` +
        'per-step base-URL resolution is not implemented; every request in one emitted test ' +
        'currently shares a single baseUrl.',
    );
  }
  return overrides.size === 1 ? [...overrides][0] : undefined;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\\?\$\{([^}]+)\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walkForPlaceholders(node: unknown, out: Set<string>): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    for (const m of node.matchAll(PLACEHOLDER_RE)) out.add(m[1]);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) walkForPlaceholders(v, out);
    return;
  }
  if (isRecord(node)) for (const v of Object.values(node)) walkForPlaceholders(v, out);
}

function collectBindingRefs(step: RequestStep): Set<string> {
  const refs = new Set<string>();
  for (const p of step.pathParams ?? []) refs.add(p.var);
  for (const m of step.pathTemplate?.matchAll(PATH_PARAM_RE) ?? []) {
    refs.add(pathParamBinding(m[1]));
  }
  walkForPlaceholders(step.bodyTemplate, refs);
  walkForPlaceholders(step.multipartTemplate, refs);
  return refs;
}

/**
 * Bindings that must be seeded with a value unique to this run, so a re-run
 * does not collide with the previous run's identifiers (#304). A binding
 * qualifies iff it is client-minted (referenced by a step and not extracted
 * from an earlier response) and the consuming step declares a 409.
 * `excluded` names (model-derived literals, #172) never qualify.
 */
export function computeUniqueBindings(
  requestPlan: readonly RequestStep[] | undefined,
  excluded?: readonly string[] | ReadonlySet<string>,
): Set<string> {
  const unique = new Set<string>();
  if (!requestPlan || requestPlan.length === 0) return unique;
  const extracted = new Set<string>();
  for (const step of requestPlan) {
    if (step.declares409) {
      for (const ref of collectBindingRefs(step)) {
        if (!extracted.has(ref)) unique.add(ref);
      }
    }
    for (const e of step.extract ?? []) extracted.add(e.bind);
  }
  if (excluded) for (const name of excluded) unique.delete(name);
  return unique;
}

/** A universal seed as the seeding rules need it (a subset of `GlobalContextSeed`). */
export interface SeedingGlobal {
  readonly binding: string;
  readonly seedRule: string;
  /** Seed only when a scenario asks for it; otherwise leave unset so the field is omitted (#342). */
  readonly omitWhenUnbound?: boolean;
}

/**
 * One ctx write at the start of a test, in order. Render each as:
 *   - `literal`: `ctx[binding] = env[envOverride] || value` (unconditional)
 *   - `seed`:    `ctx[binding] = ctx[binding] ?? (env[envOverride] || seedBinding(rule, {unique}))`
 */
export type SeedOp =
  | {
      kind: 'literal';
      /** `scenario` for the scenario's own bindings, `global` for the universal prologue. */
      group: 'scenario';
      binding: string;
      value: unknown;
      envOverride?: string;
    }
  | {
      kind: 'seed';
      group: 'scenario' | 'global';
      binding: string;
      /** Name passed to the runtime `seedBinding()` (equals `binding` except for global seeds). */
      rule: string;
      unique: boolean;
      envOverride?: string;
    };

export interface PlanSeedingOptions {
  /** The scenario's literal bindings; `PENDING_BINDING` values are seeded instead. */
  bindings: Readonly<Record<string, unknown>> | undefined;
  /** Planner-requested seeds. */
  seedBindings: readonly string[] | undefined;
  /** Universal seeds from the config (`graph.domain.globalContextSeeds`). */
  globalContextSeeds: readonly SeedingGlobal[];
  /** From {@link computeUniqueBindings}. */
  uniqueBindings?: ReadonlySet<string>;
  /** Binding → env var that overrides its value at runtime (e2e fixtures). Not applied to global seeds. */
  fixtureEnvByBinding?: Readonly<Record<string, string>>;
}

/**
 * Decide the ctx writes at the start of a test, in order (#286):
 *   1. the scenario's literal bindings, except `PENDING_BINDING` and names
 *      that need a unique seed (#320) — those move to step 2;
 *   2. the planner's `seedBindings` plus those moved names, skipping names
 *      the universal prologue seeds and `omitWhenUnbound` names that are not
 *      unique (they must stay unset so the request omits the field, #342);
 *   3. the universal prologue, except `omitWhenUnbound` seeds.
 * Every seed writes only when the binding is still unset, so a literal from
 * step 1 survives.
 */
export function planCtxSeeding(opts: PlanSeedingOptions): SeedOp[] {
  const { bindings, seedBindings, globalContextSeeds, fixtureEnvByBinding } = opts;
  const unique = opts.uniqueBindings ?? new Set<string>();
  const globalSeedNames = new Set(
    globalContextSeeds.filter((s) => !s.omitWhenUnbound).map((s) => s.binding),
  );
  const entries = Object.entries(bindings ?? {}).filter(([, v]) => v !== PENDING_BINDING);
  const literalEntries = entries.filter(([k]) => !unique.has(k));
  const strippedForUnique = entries.filter(([k]) => unique.has(k)).map(([k]) => k);
  const omitWhenUnboundNames = new Set(
    globalContextSeeds.filter((s) => s.omitWhenUnbound).map((s) => s.binding),
  );
  const seedNames = Array.from(new Set([...(seedBindings ?? []), ...strippedForUnique])).filter(
    (n) => !globalSeedNames.has(n) && (!omitWhenUnboundNames.has(n) || unique.has(n)),
  );

  const ops: SeedOp[] = [];
  for (const [binding, value] of literalEntries) {
    ops.push({
      kind: 'literal',
      group: 'scenario',
      binding,
      value,
      ...envOverrideOf(fixtureEnvByBinding, binding),
    });
  }
  for (const binding of seedNames) {
    ops.push({
      kind: 'seed',
      group: 'scenario',
      binding,
      rule: binding,
      unique: unique.has(binding),
      ...envOverrideOf(fixtureEnvByBinding, binding),
    });
  }
  for (const seed of globalContextSeeds) {
    if (seed.omitWhenUnbound) continue;
    ops.push({
      kind: 'seed',
      group: 'global',
      binding: seed.binding,
      rule: seed.seedRule,
      unique: unique.has(seed.binding),
    });
  }
  return ops;
}

function envOverrideOf(
  map: Readonly<Record<string, string>> | undefined,
  binding: string,
): { envOverride?: string } {
  const env = map?.[binding];
  return env === undefined ? {} : { envOverride: env };
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * A request value with its placeholders resolved. Adapters render this tree;
 * they never see `"${binding}"` or `"@@FILE:"` strings.
 */
export type LoweredValue =
  | { kind: 'literal'; value: string | number | boolean | null }
  | {
      kind: 'ref';
      binding: string;
      /** When the binding is unset at runtime, omit the enclosing field instead of sending null (#342). */
      omitWhenUnbound: boolean;
    }
  | { kind: 'file'; path: string }
  | { kind: 'object'; entries: { key: string; value: LoweredValue }[] }
  | { kind: 'array'; items: LoweredValue[] };

const WHOLE_REF_RE = /^\\?\$\{([^}]+)\}$/;
const FILE_PREFIX = '@@FILE:';

/** Lower a body/multipart template node. `omitWhenUnbound` lists bindings that may stay unset. */
export function lowerValue(node: unknown, omitWhenUnbound: ReadonlySet<string>): LoweredValue {
  if (typeof node === 'string') {
    const ref = node.match(WHOLE_REF_RE);
    if (ref) {
      return { kind: 'ref', binding: ref[1], omitWhenUnbound: omitWhenUnbound.has(ref[1]) };
    }
    if (node.startsWith(FILE_PREFIX)) return { kind: 'file', path: node.slice(FILE_PREFIX.length) };
    if (PLACEHOLDER_RE.test(node)) {
      PLACEHOLDER_RE.lastIndex = 0;
      throw new Error(
        `Embedded placeholder in "${node}": only whole-string "\${binding}" values are supported.`,
      );
    }
    return { kind: 'literal', value: node };
  }
  if (node === null || typeof node === 'number' || typeof node === 'boolean') {
    return { kind: 'literal', value: node };
  }
  if (Array.isArray(node)) {
    return { kind: 'array', items: node.map((n) => lowerValue(n, omitWhenUnbound)) };
  }
  if (isRecord(node)) {
    return {
      kind: 'object',
      entries: Object.entries(node).map(([key, value]) => ({
        key,
        value: lowerValue(value, omitWhenUnbound),
      })),
    };
  }
  throw new Error(`Unsupported template value: ${String(node)}`);
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

/** A response field to store, as a path of keys and array indices. */
export interface LoweredExtract {
  binding: string;
  /** The planner's dotted path (`items[0].key`), for messages. */
  fieldPath: string;
  /** `['items', 0, 'key']`. */
  segments: (string | number)[];
}

/** Split a planner field path (`a.b[0].c`) into keys and indices. */
export function fieldPathSegments(fieldPath: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const part of fieldPath.split('.')) {
    const m = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[([0-9]+)\]$/);
    if (m) out.push(m[1], Number(m[2]));
    else out.push(part);
  }
  return out;
}

export type LoweredBody =
  | { kind: 'json'; value: LoweredValue }
  | {
      kind: 'multipart';
      fields: { key: string; value: LoweredValue }[];
      files: { key: string; value: LoweredValue }[];
    };

export interface LoweredWait {
  /** Eventual state waited for (for comments). */
  state: string;
  operationId: string;
  method: string;
  pathTemplate: string;
  pathParams: LoweredPathParam[];
  predicate: EventualWaitSpec['witness']['predicate'];
  waitUpToMs?: number;
  pollIntervalMs?: number;
}

export interface LoweredStep {
  index: number;
  operationId: string;
  method: string;
  pathTemplate: string;
  pathParams: LoweredPathParam[];
  body?: LoweredBody;
  /** Poll this read until it succeeds (eventually consistent). */
  awaitEventually: boolean;
  expect: { status: number; detailContains?: string };
  extract: LoweredExtract[];
  /** Waits to render after this step, before the next one. */
  waitsAfter: LoweredWait[];
  searchChecks?: SearchPagingChecks;
  echoChecks?: Record<string, unknown>;
  validateResponse: boolean;
  /** The planner's step, for planner features not lowered yet. Prefer the lowered fields. */
  source: RequestStep;
}

export interface LoweredScenario {
  id: string;
  name?: string;
  description?: string;
  /** Server override shared by every step, if any. */
  serverOverride?: string;
  /** ctx writes before the first step, in order. */
  seeds: SeedOp[];
  uniqueBindings: string[];
  steps: LoweredStep[];
  /** Response fields the final response must carry (shape check). */
  responseShapeFields: EndpointScenario['responseShapeFields'];
  source: EndpointScenario;
}

export interface LowerScenarioOptions {
  globalContextSeeds: readonly Pick<
    GlobalContextSeed,
    'binding' | 'seedRule' | 'omitWhenUnbound'
  >[];
  fixtureEnvByBinding?: Readonly<Record<string, string>>;
}

/** Make every render-independent decision for one scenario. */
export function lowerScenario(
  scenario: EndpointScenario,
  opts: LowerScenarioOptions,
): LoweredScenario {
  const plan = scenario.requestPlan ?? [];
  const unique = computeUniqueBindings(plan, scenario.modelDerivedLiteralBindings);
  const omitWhenUnbound = new Set(
    opts.globalContextSeeds
      .filter((s) => s.omitWhenUnbound && !unique.has(s.binding))
      .map((s) => s.binding),
  );
  const ecOps = eventuallyConsistentOps(scenario.operations ?? []);
  return {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    serverOverride: resolveScenarioServerOverride(scenario.operations ?? []),
    seeds: planCtxSeeding({
      bindings: scenario.bindings,
      seedBindings: scenario.seedBindings,
      globalContextSeeds: opts.globalContextSeeds,
      uniqueBindings: unique,
      fixtureEnvByBinding: opts.fixtureEnvByBinding,
    }),
    uniqueBindings: [...unique],
    steps: plan.map((step, index) => lowerStep(step, index, ecOps, omitWhenUnbound)),
    responseShapeFields: scenario.responseShapeFields,
    source: scenario,
  };
}

function lowerStep(
  step: RequestStep,
  index: number,
  ecOps: ReadonlySet<string>,
  omitWhenUnbound: ReadonlySet<string>,
): LoweredStep {
  return {
    index,
    operationId: step.operationId,
    method: step.method.toUpperCase(),
    pathTemplate: step.pathTemplate,
    pathParams: lowerPathParams(step.pathTemplate, step.pathParams),
    body: lowerBody(step, omitWhenUnbound),
    awaitEventually: stepNeedsAwaitForOp(step, ecOps),
    expect: { ...step.expect },
    extract: (step.extract ?? []).map((e) => ({
      binding: e.bind,
      fieldPath: e.fieldPath,
      segments: fieldPathSegments(e.fieldPath),
    })),
    waitsAfter: (step.eventualWaitsAfter ?? []).map((w) => ({
      state: w.state,
      operationId: w.witness.operationId,
      method: w.witness.method.toUpperCase(),
      pathTemplate: w.witness.pathTemplate,
      pathParams: lowerPathParams(w.witness.pathTemplate),
      predicate: w.witness.predicate,
      waitUpToMs: w.witness.waitUpToMs,
      pollIntervalMs: w.witness.pollIntervalMs,
    })),
    searchChecks: step.searchChecks,
    echoChecks: step.echoChecks,
    validateResponse: step.validateResponse === true,
    source: step,
  };
}

function lowerBody(
  step: RequestStep,
  omitWhenUnbound: ReadonlySet<string>,
): LoweredBody | undefined {
  if (step.bodyKind === 'multipart') {
    const template = step.multipartTemplate ?? step.bodyTemplate;
    if (!isRecord(template)) return undefined;
    return {
      kind: 'multipart',
      fields: lowerEntries(template.fields, omitWhenUnbound),
      files: lowerEntries(template.files, omitWhenUnbound),
    };
  }
  if (step.bodyTemplate === undefined || step.bodyTemplate === null) return undefined;
  return { kind: 'json', value: lowerValue(step.bodyTemplate, omitWhenUnbound) };
}

function lowerEntries(
  node: unknown,
  omitWhenUnbound: ReadonlySet<string>,
): { key: string; value: LoweredValue }[] {
  if (!isRecord(node)) return [];
  return Object.entries(node).map(([key, value]) => ({
    key,
    value: lowerValue(value, omitWhenUnbound),
  }));
}
