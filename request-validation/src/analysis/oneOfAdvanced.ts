import type { OperationModel, SchemaFragment, ValidationScenario } from '../model/types.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
}

function isVariantSchema(v: unknown): v is SchemaFragment {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The first three object variants (with `required`) of a ROOT oneOf, or undefined when there are fewer than three.
 * generate.ts reuses `isOneOfMultiAmbiguousEligible` for the coverage report's applicability.
 */
export function multiAmbiguousVariants(
  op: OperationModel,
): { a: SchemaFragment; b: SchemaFragment; c: SchemaFragment } | undefined {
  if (!op.rootOneOf || op.rootOneOf.length < 3) return undefined;
  const variants = op.rootOneOf
    .filter(isVariantSchema)
    .filter((v) => v.type === 'object' && Array.isArray(v.required));
  const [a, b, c] = variants;
  return a && b && c ? { a, b, c } : undefined;
}

export function isOneOfMultiAmbiguousEligible(op: OperationModel): boolean {
  return multiAmbiguousVariants(op) !== undefined;
}

/**
 * The first two object variants (with properties) of a ROOT oneOf and a property of the second that the first
 * lacks, or undefined. generate.ts reuses `isOneOfCrossBleedEligible` for the coverage report's applicability.
 */
export function crossBleedPlan(
  op: OperationModel,
): { a: SchemaFragment; b: SchemaFragment; uniqueB: string } | undefined {
  if (!op.rootOneOf || op.rootOneOf.length < 2) return undefined;
  const variants = op.rootOneOf
    .filter(isVariantSchema)
    .filter((v) => v.type === 'object' && v.properties);
  const [a, b] = variants;
  if (!a || !b) return undefined;
  const aProps = a.properties ?? {};
  const bProps = b.properties ?? {};
  const uniqueB = Object.keys(bProps).find((k) => !(k in aProps));
  return uniqueB ? { a, b, uniqueB } : undefined;
}

export function isOneOfCrossBleedEligible(op: OperationModel): boolean {
  return crossBleedPlan(op) !== undefined;
}

export function generateOneOfMultiAmbiguous(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const variants = multiAmbiguousVariants(op);
    if (!variants) continue;
    const { a, b, c } = variants;
    const merged: Record<string, unknown> = {};
    for (const r of a.required ?? []) merged[r] = placeholder(a.properties?.[r]);
    for (const r of b.required ?? []) merged[r] = placeholder(b.properties?.[r]);
    for (const r of c.required ?? []) merged[r] = placeholder(c.properties?.[r]);
    out.push({
      id: makeId([op.operationId, 'oneofMultiAmbiguous']),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'oneof-multi-ambiguous',
      target: 'oneOf',
      requestBody: merged,
      params: buildParams(op.path),
      expectedStatus: 400,
      description: 'Body satisfies 3 oneOf variants',
      headersAuth: true,
      source: 'body',
    });
  }
  return out;
}

export function generateOneOfCrossBleed(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const plan = crossBleedPlan(op);
    if (!plan) continue;
    const { a, b, uniqueB } = plan;
    // Build body for variant A then inject a property unique to B
    const body: Record<string, unknown> = {};
    const reqA = Array.isArray(a.required) ? a.required : [];
    for (const r of reqA) body[r] = placeholder(a.properties?.[r]);
    const bProps = b.properties ?? {};
    body[uniqueB] = placeholder(bProps[uniqueB]);
    out.push({
      id: makeId([op.operationId, 'oneofCrossBleed', uniqueB]),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'oneof-cross-bleed',
      target: uniqueB,
      requestBody: body,
      params: buildParams(op.path),
      expectedStatus: 400,
      description: 'Body of one variant with stray field from another',
      headersAuth: true,
      source: 'body',
    });
  }
  return out;
}

export function generateDiscriminatorStructureMismatch(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const d = op.discriminator;
    if (!d) continue;
    const root = isVariantSchema(op.requestBodySchema) ? op.requestBodySchema : undefined;
    if (!root || !Array.isArray(root.oneOf)) continue;
    const variants = root.oneOf
      .filter(isVariantSchema)
      .filter((v) => v.type === 'object' && v.properties);
    if (variants.length < 2) continue;
    const a = variants[0];
    const b = variants[1];
    // Choose discriminator value for A but shape of B
    const body: Record<string, unknown> = {};
    // Attempt to reuse discriminated mapping enum value if exists
    const discVal = guessDiscriminatorValue(a, d.propertyName) || 'VariantA';
    body[d.propertyName] = discVal;
    if (Array.isArray(b.required)) {
      for (const r of b.required) body[r] = placeholder(b.properties?.[r]);
    }
    out.push({
      id: makeId([op.operationId, 'discriminatorStructureMismatch']),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'discriminator-structure-mismatch',
      target: d.propertyName,
      requestBody: body,
      params: buildParams(op.path),
      expectedStatus: 400,
      description: 'Mismatch between discriminator value and provided shape',
      headersAuth: true,
      source: 'body',
    });
  }
  return out;
}

function guessDiscriminatorValue(variant: SchemaFragment, disc: string): string | undefined {
  const p = variant.properties?.[disc];
  if (p?.enum?.length) {
    const v = p.enum[0];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function placeholder(schema: SchemaFragment | undefined): unknown {
  if (!schema) return 'x';
  if (schema.enum?.length) return schema.enum[0];
  switch (schema.type) {
    case 'string':
      return 'x';
    case 'integer':
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {}; // shallow
    default:
      return 'x';
  }
}
function buildParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const token of m) params[token.slice(1, -1)] = 'x';
  return params;
}
