import type { OperationModel } from '../model/types.js';

// Permissive subset of an OpenAPI schema fragment used by the walker.
// Index signature lets us read constraint keys generically without `any`.
export interface SchemaFragment {
  type?: string | string[];
  required?: string[];
  enum?: unknown[];
  properties?: Record<string, SchemaFragment>;
  items?: SchemaFragment;
  allOf?: SchemaFragment[];
  discriminator?: unknown;
  [key: string]: unknown;
}

export interface WalkNode {
  pointer: string; // JSON pointer within request body schema
  key?: string; // property key at this level
  type?: string | string[];
  required?: string[];
  enum?: unknown[];
  properties?: Record<string, WalkNode>;
  items?: WalkNode;
  constraints?: Record<string, unknown>;
  raw?: SchemaFragment; // original raw schema node for advanced constraints
}

export interface SchemaWalkResult {
  root?: WalkNode;
  byPointer: Map<string, WalkNode>;
}

function isSchemaFragment(v: unknown): v is SchemaFragment {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

interface MergedObject extends SchemaFragment {
  type: 'object';
  properties: Record<string, SchemaFragment>;
  required: string[];
}

export function buildWalk(op: OperationModel): SchemaWalkResult | undefined {
  if (!op.requestBodySchema) return undefined;
  const reqBody: SchemaFragment | undefined = isSchemaFragment(op.requestBodySchema)
    ? op.requestBodySchema
    : undefined;
  if (!reqBody) return undefined;
  // Permit roots that either are object or have allOf (flattenable into object)
  if (reqBody.type !== 'object' && !Array.isArray(reqBody.allOf)) return undefined;
  const byPointer = new Map<string, WalkNode>();
  function mergeAllOf(schema: SchemaFragment): SchemaFragment {
    if (!schema || !Array.isArray(schema.allOf)) return schema;
    // Shallow merge of object constituents
    const parts = schema.allOf;
    const merged: MergedObject = {
      type: 'object',
      properties: {},
      required: [],
    };
    let hasObject = false;
    for (const part of parts) {
      const m = mergeAllOf(part); // recursive flatten
      if (m && m.type === 'object') {
        hasObject = true;
        if (m.properties) {
          for (const [k, v] of Object.entries(m.properties)) {
            if (!(k in merged.properties)) merged.properties[k] = v;
          }
        }
        if (Array.isArray(m.required)) {
          for (const r of m.required) if (!merged.required.includes(r)) merged.required.push(r);
        }
      }
    }
    if (!hasObject) {
      // Leaf-primitive allOf case: when every typed branch resolves to the
      // same primitive type (e.g. `allOf: [{$ref: TenantId}, {description}]`
      // dereferences to `allOf: [{type: 'string', minLength: 22, ...}, {description}]`),
      // flatten into a synthetic schema so per-field mutation analysers
      // (`bodyTypeMismatch`, `constraintViolations`, `enumViolations`) can
      // see the resolved type and constraints. Without this, the wrapped
      // field looks typeless and silently drops out of negative coverage —
      // see camunda/api-test-generator#110.
      return mergePrimitiveAllOf(schema);
    }
    // Merge host schema's own direct properties/required (outside allOf) so we don't lose them
    if (schema.properties) {
      for (const [k, v] of Object.entries(schema.properties)) {
        if (!(k in merged.properties)) merged.properties[k] = v;
      }
    }
    if (Array.isArray(schema.required)) {
      for (const r of schema.required) if (!merged.required.includes(r)) merged.required.push(r);
    }
    // Preserve discriminator or other root-level keys if present
    if (schema.discriminator) merged.discriminator = schema.discriminator;
    // Preserve enums if the composite root itself had one (edge case)
    if (Array.isArray(schema.enum)) merged.enum = schema.enum.slice();
    return merged;
  }
  function visit(schema: SchemaFragment, pointer: string, key?: string): WalkNode {
    const effective = mergeAllOf(schema);
    // For allOf-wrapped primitives we expose the *merged* fragment via `raw`
    // so downstream code that reads `node.raw.{format,multipleOf,enum,…}`
    // sees the resolved primitive metadata instead of the unmerged wrapper.
    // For object/array nodes we keep `raw: schema` because consumers of
    // composite raw (discriminator detection, oneOf walkers, etc.) rely on
    // observing the original wrapper. See camunda/api-test-generator#113.
    const isComposite = effective.type === 'object' || effective.type === 'array';
    const raw = isComposite ? schema : effective;
    const node: WalkNode = {
      pointer,
      key,
      type: effective.type,
      required: Array.isArray(effective.required) ? effective.required.slice() : undefined,
      enum: Array.isArray(effective.enum) ? effective.enum.slice() : undefined,
      constraints: extractConstraints(effective),
      raw,
    };
    byPointer.set(pointer, node);
    if (effective.type === 'object' && effective.properties) {
      node.properties = {};
      for (const [k, v] of Object.entries(effective.properties)) {
        const childPtr = `${pointer}/properties/${escapeJsonPointer(k)}`;
        node.properties[k] = visit(v, childPtr, k);
      }
    }
    if (effective.type === 'array' && effective.items) {
      node.items = visit(effective.items, `${pointer}/items`);
    }
    return node;
  }
  const root = visit(reqBody, '');
  return { root, byPointer };
}

function escapeJsonPointer(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

function extractConstraints(schema: SchemaFragment): Record<string, unknown> {
  const keys = [
    'minLength',
    'maxLength',
    'pattern',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minItems',
    'maxItems',
    'uniqueItems',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (schema[k] !== undefined) out[k] = schema[k];
  }
  return out;
}

const PRIMITIVE_TYPES = new Set(['string', 'integer', 'number', 'boolean']);
const PRIMITIVE_CONSTRAINT_KEYS = [
  'format',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
];

/**
 * Flatten an `allOf` whose branches resolve to a single primitive type into
 * a synthetic schema fragment carrying the resolved `type`, format, enum,
 * and primitive constraints. Branches without a `type` (e.g. description-only
 * partials) are tolerated and merged in for their constraint keys. Mixed
 * primitive types (e.g. `[{type: 'string'}, {type: 'integer'}]`) are not
 * flattened — they fall back to the original schema so downstream consumers
 * are not misled.
 *
 * The host schema's own primitive constraints (declared alongside `allOf`)
 * win on conflict so authors can override at the use site.
 */
function mergePrimitiveAllOf(schema: SchemaFragment): SchemaFragment {
  if (!Array.isArray(schema.allOf)) return schema;
  let resolvedType: string | undefined;
  for (const part of schema.allOf) {
    if (!part || typeof part !== 'object') continue;
    const t = Array.isArray(part.type) ? part.type[0] : part.type;
    if (typeof t !== 'string') continue;
    if (!PRIMITIVE_TYPES.has(t)) return schema; // not a primitive-leaf allOf
    if (resolvedType && resolvedType !== t) return schema; // mixed primitives — bail
    resolvedType = t;
  }
  if (!resolvedType) return schema;
  const merged: SchemaFragment = { type: resolvedType };
  // Branch contributions first, then host overrides.
  for (const part of schema.allOf) {
    if (!part || typeof part !== 'object') continue;
    for (const k of PRIMITIVE_CONSTRAINT_KEYS) {
      if (part[k] !== undefined && merged[k] === undefined) merged[k] = part[k];
    }
    if (Array.isArray(part.enum) && !Array.isArray(merged.enum)) {
      merged.enum = part.enum.slice();
    }
  }
  for (const k of PRIMITIVE_CONSTRAINT_KEYS) {
    if (schema[k] !== undefined) merged[k] = schema[k];
  }
  if (Array.isArray(schema.enum)) merged.enum = schema.enum.slice();
  return merged;
}
