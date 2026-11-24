import type { OperationModel, SchemaFragment, ValidationScenario } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';
import { buildWalk, type WalkNode } from '../schema/walker.js';
import { makeId } from './common.js';
import { isAmbiguousPair } from './oneOfAmbiguous.js';
import {
  findCursorFields,
  findLimitOnlyBranch,
  findOffsetBranch,
  findPaginationPage,
} from './paginationShape.js';

/**
 * `oneof-none-match` and `oneof-ambiguous` scenarios for a `oneOf` nested inside a property of the body, such as a
 * search filter property that is either an exact value or an advanced filter object (camunda/api-test-generator#708).
 * The root generators (`oneOfNoneMatch.ts`, `oneOfAmbiguous.ts`) only look at a body whose root is a `oneOf`.
 *
 * The rest of the body is the operation's valid baseline (`buildBaselineBody`), so the only thing wrong with the
 * request is the value at the nested position. Parent objects that the baseline leaves out are added as `{}`, which
 * is only valid when they have no required properties, so a position under a parent with required properties is
 * skipped. Positions inside arrays are not walked, and neither is the pagination property (`page`), which the
 * `pagination-*` kinds already cover.
 *
 * Opt-in per config (`nestedOneOf` in request-validation.json): whether a server enforces a nested `oneOf` with a 400
 * has to be checked against that server first. generate.ts uses the `is…Eligible` functions below for the coverage
 * report, and they read the same case sequence as the generators, so "applicable" stays equal to what is built.
 */

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
  /** Capability-gated field names (#404), passed through to the baseline body. */
  capabilityGates?: ReadonlyMap<string, unknown>;
}

/** A nested position whose schema is a `oneOf`, with its variants. */
export interface NestedOneOf {
  path: string[];
  variants: SchemaFragment[];
}

/**
 * The schema with single-member `allOf` wrappers removed. A property written as
 * `allOf: [{ $ref: StringFilterProperty }]` plus a description dereferences to
 * `{ allOf: [{ oneOf: [...] }], description }`, and its `oneOf` is the one to test.
 */
function unwrap(schema: SchemaFragment | undefined): SchemaFragment | undefined {
  let current = schema;
  for (let depth = 0; current && depth < 10; depth++) {
    const parts = current.allOf;
    if (!Array.isArray(parts) || parts.length !== 1 || current.type !== undefined) return current;
    current = parts[0];
  }
  return current;
}

function isSchemaFragment(v: unknown): v is SchemaFragment {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function nestedOneOfOf(node: WalkNode): SchemaFragment[] | undefined {
  const declared: unknown = node.source ?? node.raw;
  const schema = unwrap(isSchemaFragment(declared) ? declared : undefined);
  const variants = schema?.oneOf;
  return Array.isArray(variants) && variants.length >= 2 ? variants : undefined;
}

/**
 * The top-level property holding the pagination `oneOf`, if there is one. `findPaginationPage` returns the first
 * top-level `oneOf` of any kind, so its branches are checked for a pagination shape here.
 */
function paginationProp(op: OperationModel): string | undefined {
  const page = findPaginationPage(op);
  if (!page) return undefined;
  const { branches } = page;
  const isPagination =
    !!findLimitOnlyBranch(branches) ||
    !!findOffsetBranch(branches) ||
    findCursorFields(branches).length > 0;
  return isPagination ? page.pageProp : undefined;
}

/**
 * Every position below the root whose schema is a `oneOf`, depth first, in property order, leaving out the
 * pagination property. Objects are walked; arrays are not. A parent with required properties ends the walk on that
 * branch (see the module comment).
 */
export function nestedOneOfPositions(op: OperationModel): NestedOneOf[] {
  const walk = buildWalk(op);
  if (!walk?.root?.properties) return [];
  const pageProp = paginationProp(op);
  const out: NestedOneOf[] = [];
  function visit(node: WalkNode, path: string[]): void {
    if (!node.properties) return;
    for (const [key, child] of Object.entries(node.properties)) {
      if (!path.length && key === pageProp) continue;
      const childPath = [...path, key];
      const variants = nestedOneOfOf(child);
      if (variants) {
        out.push({ path: childPath, variants });
        continue;
      }
      const t = Array.isArray(child.type) ? child.type[0] : child.type;
      if (t === 'object' && !child.required?.length) visit(child, childPath);
    }
  }
  visit(walk.root, []);
  return out;
}

/** The JSON types a variant accepts, or undefined when the schema does not say. */
function variantTypes(variant: SchemaFragment): Set<string> | undefined {
  const v = unwrap(variant);
  if (!v) return undefined;
  const types = new Set<string>();
  const declared = Array.isArray(v.type) ? v.type : v.type ? [v.type] : [];
  for (const t of declared) types.add(t);
  if (!types.size) {
    if (v.properties) types.add('object');
    else if (v.items) types.add('array');
    else if (Array.isArray(v.enum) && v.enum.length) {
      for (const e of v.enum)
        types.add(e === null ? 'null' : Array.isArray(e) ? 'array' : typeof e);
    }
  }
  if (!types.size) return undefined;
  // An integer is a number too, and the reverse holds for whole numbers.
  if (types.has('number')) types.add('integer');
  if (types.has('integer')) types.add('number');
  return types;
}

/** Values of different JSON types, tried in order, with the type each has. */
const NONE_MATCH_CANDIDATES: { type: string; value: unknown }[] = [
  { type: 'integer', value: 123 },
  { type: 'boolean', value: true },
  { type: 'string', value: 'x' },
  { type: 'array', value: [] },
];

/** A value whose JSON type no variant accepts, or undefined when there is none or a variant's types are unknown. */
export function noneMatchValue(variants: SchemaFragment[]): unknown {
  const accepted = new Set<string>();
  for (const variant of variants) {
    const types = variantTypes(variant);
    if (!types) return undefined;
    for (const t of types) accepted.add(t);
  }
  const candidate = NONE_MATCH_CANDIDATES.find((c) => !accepted.has(c.type));
  return candidate ? structuredClone(candidate.value) : undefined;
}

/**
 * An object that has the required properties of two object variants at once, or undefined. A variant with
 * `additionalProperties: false` is skipped as a pair member, since the merged object would then match neither
 * variant rather than both.
 */
function ambiguousValue(
  variants: SchemaFragment[],
): { value: unknown; i: number; j: number } | undefined {
  const objects = variants.map((v) => unwrap(v));
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const a = objects[i];
      const b = objects[j];
      if (!a || !b || !isAmbiguousPair(a, b)) continue;
      if (a.additionalProperties === false || b.additionalProperties === false) continue;
      const merged: Record<string, unknown> = {};
      for (const r of a.required ?? []) merged[r] = placeholder(a.properties?.[r]);
      for (const r of b.required ?? []) merged[r] = placeholder(b.properties?.[r]);
      return { value: merged, i, j };
    }
  }
  return undefined;
}

function placeholder(schema: SchemaFragment | undefined): unknown {
  const s = unwrap(schema);
  if (!s) return 'x';
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  switch (t) {
    case 'integer':
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return 'x';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The baseline body with `value` at `path`, adding missing parent objects as `{}`. */
function bodyWith(
  op: OperationModel,
  path: string[],
  value: unknown,
  gates: ReadonlyMap<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const baseline = buildBaselineBody(op, { gates, keep: path });
  if (!isRecord(baseline)) return undefined;
  const body = structuredClone(baseline);
  let target: Record<string, unknown> = body;
  for (const seg of path.slice(0, -1)) {
    if (!(seg in target)) target[seg] = {};
    const next = target[seg];
    if (!isRecord(next)) return undefined;
    target = next;
  }
  target[path[path.length - 1]] = value;
  return body;
}

interface Case {
  path: string[];
  body: Record<string, unknown>;
  /** The variant pair of an ambiguous case. */
  pair?: { i: number; j: number };
}

/** The none-match cases of an operation, in the order the generator builds them. */
export function* nestedNoneMatchCases(
  op: OperationModel,
  gates?: ReadonlyMap<string, unknown>,
): Generator<Case> {
  for (const { path, variants } of nestedOneOfPositions(op)) {
    const value = noneMatchValue(variants);
    if (value === undefined) continue;
    const body = bodyWith(op, path, value, gates);
    if (body) yield { path, body };
  }
}

/** The ambiguous cases of an operation, in the order the generator builds them. */
export function* nestedAmbiguousCases(
  op: OperationModel,
  gates?: ReadonlyMap<string, unknown>,
): Generator<Case> {
  for (const { path, variants } of nestedOneOfPositions(op)) {
    const found = ambiguousValue(variants);
    if (!found) continue;
    const body = bodyWith(op, path, found.value, gates);
    if (body) yield { path, body, pair: { i: found.i, j: found.j } };
  }
}

export function isNestedOneOfNoneMatchEligible(
  op: OperationModel,
  gates?: ReadonlyMap<string, unknown>,
): boolean {
  return nestedNoneMatchCases(op, gates).next().done === false;
}

export function isNestedOneOfAmbiguousEligible(
  op: OperationModel,
  gates?: ReadonlyMap<string, unknown>,
): boolean {
  return nestedAmbiguousCases(op, gates).next().done === false;
}

export function generateNestedOneOfNoneMatch(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    let produced = 0;
    for (const { path, body } of nestedNoneMatchCases(op, opts.capabilityGates)) {
      if (opts.capPerOperation && produced >= opts.capPerOperation) break;
      const target = path.join('.');
      out.push({
        id: makeId([op.operationId, 'nestedOneofNoneMatch', ...path]),
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'oneof-none-match',
        target,
        requestBody: body,
        params: buildParams(op.path),
        expectedStatus: 400,
        description: `Body field '${target}' matches none of its oneOf variants`,
        headersAuth: true,
      });
      produced++;
    }
  }
  return out;
}

export function generateNestedOneOfAmbiguous(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    let produced = 0;
    for (const { path, body, pair } of nestedAmbiguousCases(op, opts.capabilityGates)) {
      if (opts.capPerOperation && produced >= opts.capPerOperation) break;
      const target = path.join('.');
      const variants = pair ? `${pair.i}+${pair.j}` : '';
      out.push({
        id: makeId([op.operationId, 'nestedOneofAmbiguous', ...path]),
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'oneof-ambiguous',
        target,
        requestBody: body,
        params: buildParams(op.path),
        expectedStatus: 400,
        description: `Body field '${target}' matches oneOf variants ${variants} at once`,
        headersAuth: true,
      });
      produced++;
    }
  }
  return out;
}

function buildParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const token of m) params[token.slice(1, -1)] = 'x';
  return params;
}
