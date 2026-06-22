import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getSpecBundleDir } from './configResolver.js';

export interface CanonicalNodeMeta {
  path: string; // dot + [] notation
  pointer: string; // JSON Pointer form
  type: string;
  required: boolean;
  semanticProvider?: string; // semantic type if x-semantic-provider: true
  /**
   * Enum values declared on this field's schema (after $ref + allOf
   * resolution). Present for scalar leaf nodes whose schema constrains
   * the value to a fixed set. Used by `buildRequestBodyFromCanonical`
   * to emit an enum literal instead of seeding a `${var}` placeholder
   * (#338).
   */
  enum?: unknown[];
  /**
   * Enum values declared on this array node's item schema. Present for
   * top-level array fields whose items are scalar enums (e.g.
   * `permissionTypes: { type: 'array', items: { enum: […] } }`). Used
   * by the array synthesiser to emit `[enum[0]]` instead of the generic
   * `['placeholder']` element (#338).
   */
  itemEnum?: unknown[];
  /**
   * The OpenAPI `format` keyword for this scalar leaf node (e.g. `'email'`,
   * `'uuid'`, `'date-time'`, `'uri'`). Captured so `buildRequestBodyFromCanonical`
   * can emit a format-valid value — an inline literal for most formats, or
   * runtime seeding for `email` — instead of a generic variable seed that
   * fails server-side format validation (#397).
   */
  format?: string;
}

export interface OperationCanonicalShapes {
  operationId: string;
  response?: CanonicalNodeMeta[];
  request?: CanonicalNodeMeta[]; // deprecated: kept for backward compat (application/json)
  requestByMediaType?: Record<string, CanonicalNodeMeta[]>; // e.g., application/json, multipart/form-data
}

// Permissive subset of an OpenAPI schema fragment (only the fields this walker uses).
interface SchemaObject {
  type?: string;
  $ref?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  allOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  'x-semantic-provider'?: boolean;
  enum?: unknown[];
  // Permissive escape hatch so the allOf merger can copy over arbitrary
  // OpenAPI keywords (description, example, format, …) without per-key
  // typing or unsafe casts.
  [key: string]: unknown;
}

interface MediaObject {
  schema?: SchemaObject;
}

interface ResponseObject {
  content?: Record<string, MediaObject>;
}

interface OperationObject {
  operationId?: string;
  responses?: Record<string, ResponseObject>;
  requestBody?: { content?: Record<string, MediaObject> };
}

interface OpenAPIDocument {
  paths?: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Record<string, SchemaObject> };
}

export async function buildCanonicalShapes(
  specRootDir: string,
): Promise<Record<string, OperationCanonicalShapes>> {
  // specRootDir = repo root. Bundled spec lives under the active config's
  // spec/<config>/bundled/ directory (#128 PR 2). Resolved lazily so the
  // CONFIG env var takes effect even after this module is cached.
  const specPath =
    process.env.OPENAPI_SPEC_PATH ||
    path.join(getSpecBundleDir(specRootDir), 'rest-api.bundle.json');
  const raw = await fs.readFile(specPath, 'utf8');
  // biome-ignore lint/plugin: YAML.parse returns `unknown`; the OpenAPI bundle is the runtime contract.
  const doc = YAML.parse(raw) as OpenAPIDocument;
  const out: Record<string, OperationCanonicalShapes> = {};
  const components = doc.components?.schemas ?? {};
  const paths = doc.paths ?? {};
  for (const [_p, methods] of Object.entries(paths)) {
    for (const [_method, op] of Object.entries(methods ?? {})) {
      if (!op?.operationId) continue;
      const opId = op.operationId;
      const entry: OperationCanonicalShapes = { operationId: opId };
      // Success response schema
      const responses = op.responses ?? {};
      const successCode = Object.keys(responses).find((c) => ['200', '201'].includes(c));
      if (successCode) {
        const success = responses[successCode];
        const media = success?.content
          ? Object.entries(success.content).find(([ct]) => /json/.test(ct))
          : undefined;
        const successSchema = media?.[1]?.schema;
        if (successSchema) {
          const nodes: CanonicalNodeMeta[] = [];
          walkSchema(
            resolveSchema(successSchema, components),
            '#',
            '',
            nodes,
            new Set(),
            components,
            false,
            0,
            true, // descend oneOf/anyOf variants in the response shape
          );
          entry.response = nodes;
        }
      }
      // Request schemas by media type (json + multipart supported)
      const reqContent = op.requestBody?.content;
      if (reqContent && typeof reqContent === 'object') {
        for (const [ct, media] of Object.entries(reqContent)) {
          if (!media?.schema) continue;
          if (!/json|multipart\/form-data/i.test(ct)) continue; // limit to supported kinds
          const nodes: CanonicalNodeMeta[] = [];
          walkSchema(
            resolveSchema(media.schema, components),
            '#',
            '',
            nodes,
            new Set(),
            components,
          );
          const byMedia = entry.requestByMediaType ?? {};
          byMedia[ct] = nodes;
          entry.requestByMediaType = byMedia;
          if (/application\/json/i.test(ct)) {
            // maintain legacy field for callers expecting request under JSON
            entry.request = nodes;
          }
        }
      }
      out[opId] = entry;
    }
  }
  return out;
}

function walkSchema(
  schema: SchemaObject | undefined,
  pointer: string,
  pathSoFar: string,
  acc: CanonicalNodeMeta[],
  seen: Set<SchemaObject>,
  components: Record<string, SchemaObject>,
  required = false,
  depth = 0,
  descendUnions = false,
) {
  if (!schema || depth > 25) return;
  if (schema.$ref) {
    const resolved = resolveSchema(schema, components);
    if (seen.has(resolved)) return; // prevent cycles
    seen.add(resolved);
    return walkSchema(
      resolved,
      pointer,
      pathSoFar,
      acc,
      seen,
      components,
      required,
      depth + 1,
      descendUnions,
    );
  }
  // Descend discriminated/union variants for the RESPONSE shape so semantic
  // provider leaves nested inside a oneOf/anyOf branch (e.g. the DOCUMENT
  // variant's `content[].documentReference.documentId` on
  // AgentInstanceMessageContent) appear in the canonical response shape — the
  // extractor lifts those leaves by walking every branch, so the shape must
  // enumerate them too or the canonical-path validator reports a false
  // extractor↔bundler divergence. NOT done for request shapes: merging
  // mutually-exclusive variants would synthesise invalid request bodies.
  //
  // Done regardless of whether `type` is also declared: OpenAPI permits
  // `type` alongside `oneOf`/`anyOf` (e.g. a `type: 'object'` base whose
  // variants add fields), so gating on `!schema.type` would skip variant-
  // nested provider leaves on such schemas. When a co-declared `type` is
  // present we fall through after descending so the object/array branch
  // below still walks the schema's own `properties`/`items`; for a pure
  // union (no `type`) the variants ARE the whole shape, so we return.
  if (descendUnions && (schema.oneOf || schema.anyOf)) {
    const variants = [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])];
    for (const variant of variants) {
      // Each variant is a sibling branch: give it an independent copy of the
      // ancestry-visited set so a schema shared across variants (e.g. two
      // variants both nesting the same DocumentReference) is walked in each,
      // not skipped after the first. `seen` tracks cycles along one path, not
      // a global "visited anywhere" set. See #389 review.
      walkSchema(
        variant,
        pointer,
        pathSoFar,
        acc,
        new Set(seen),
        components,
        required,
        depth + 1,
        true,
      );
    }
    if (!schema.type) return;
  }
  const type =
    schema.type ||
    (schema.oneOf ? 'oneOf' : schema.anyOf ? 'anyOf' : schema.allOf ? 'allOf' : 'unknown');
  // Resolve allOf/anyOf/oneOf compositions before checking for object/array
  if (!schema.type && (schema.allOf || schema.anyOf || schema.oneOf)) {
    const resolved = resolveSchema(schema, components);
    if (resolved && resolved !== schema && !seen.has(resolved)) {
      seen.add(resolved);
      return walkSchema(
        resolved,
        pointer,
        pathSoFar,
        acc,
        seen,
        components,
        required,
        depth + 1,
        descendUnions,
      );
    }
  }
  if (type === 'object' && schema.properties) {
    const reqSet = new Set(schema.required || []);
    // record object node itself
    if (pathSoFar) {
      acc.push({
        path: pathSoFar,
        pointer,
        type: 'object',
        required,
        semanticProvider: schema['x-semantic-provider']
          ? inferSemanticTypeFromPath(pathSoFar)
          : undefined,
      });
    }
    for (const [k, v] of Object.entries(schema.properties)) {
      const childPath = pathSoFar ? `${pathSoFar}.${k}` : k;
      const childPointer = `${pointer}/properties/${escapeJsonPointer(k)}`;
      // Each property is a sibling branch: give it an independent copy of the
      // ancestry-visited set. `seen` is for cycle detection along one path, not
      // a global "visited anywhere" set — two properties referencing the same
      // component schema must both be walked, else the second's paths go
      // missing from the canonical shape (#389 review).
      walkSchema(
        v,
        childPointer,
        childPath,
        acc,
        new Set(seen),
        components,
        reqSet.has(k),
        depth + 1,
        descendUnions,
      );
    }
    return;
  }
  if (type === 'array' && schema.items) {
    const childPath = `${pathSoFar}[]`;
    const childPointer = `${pointer}/items`;
    // Capture an item-level enum (e.g. `permissionTypes: { type: 'array',
    // items: { enum: […] } }`) so the array synthesiser can emit
    // `[enum[0]]` instead of the generic `['placeholder']` element
    // (#338). `schema.items` may itself be a $ref / allOf, so resolve
    // it before reading `.enum`.
    const resolvedItems = resolveSchema(schema.items, components);
    const itemEnum = Array.isArray(resolvedItems.enum) ? resolvedItems.enum : undefined;
    acc.push({
      path: `${pathSoFar}[]`,
      pointer: childPointer,
      type: 'array',
      required,
      semanticProvider: schema['x-semantic-provider']
        ? inferSemanticTypeFromPath(pathSoFar)
        : undefined,
      itemEnum,
    });
    walkSchema(
      schema.items,
      childPointer,
      childPath,
      acc,
      seen,
      components,
      false,
      depth + 1,
      descendUnions,
    );
    return;
  }
  if (pathSoFar) {
    const semantic = schema['x-semantic-provider']
      ? inferSemanticTypeFromPath(pathSoFar)
      : undefined;
    // Capture leaf enum (e.g. `ownerType: { enum: ['USER', …] }`) so
    // `buildRequestBodyFromCanonical` can emit an enum literal instead
    // of seeding a `${var}` placeholder (#338). `schema` at this point
    // is already $ref/allOf-resolved by the recursive descent above.
    const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
    // Capture format (e.g. `email`, `uuid`, `date-time`) so the body
    // builder can emit a format-valid literal instead of a generic seed
    // that fails server-side format validation (#397).
    const format = typeof schema.format === 'string' ? schema.format : undefined;
    acc.push({
      path: pathSoFar,
      pointer,
      type,
      required,
      semanticProvider: semantic,
      enum: enumValues,
      format,
    });
  }
}

function mergeSchemaInto(acc: SchemaObject, part: SchemaObject): SchemaObject {
  // Property-wise merge so two allOf branches both contributing
  // `properties` don't lose each other's keys, and `required` is the
  // union across branches. Other fields take last-write-wins, which
  // matches the semantics we want when a branch overrides e.g. `type`.
  if (part.properties) {
    acc.properties = { ...(acc.properties ?? {}), ...part.properties };
  }
  if (part.required) {
    const merged = new Set<string>([...(acc.required ?? []), ...part.required]);
    acc.required = [...merged];
  }
  for (const k of Object.keys(part)) {
    if (k === 'properties' || k === 'required') continue;
    acc[k] = part[k];
  }
  return acc;
}

function resolveSchema(
  schema: SchemaObject,
  components: Record<string, SchemaObject>,
  depth = 0,
): SchemaObject {
  if (!schema || depth > 30) return schema;
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    const target = name ? components[name] : undefined;
    if (target) return resolveSchema(target, components, depth + 1);
  }
  if (schema.allOf && Array.isArray(schema.allOf)) {
    // #152: the wrapping schema may declare its own `properties` /
    // `required` alongside `allOf` (e.g. `MappingRuleCreateRequest`,
    // `GlobalTaskListenerCreateRequest`). Seed the merge with the
    // wrapping schema (minus `allOf` / `$ref` so we don't recurse) so
    // those fields survive into the canonical shape.
    const { allOf: _allOf, $ref: _ref, ...rest } = schema;
    const seed: SchemaObject = {};
    mergeSchemaInto(seed, rest);
    return schema.allOf.reduce<SchemaObject>(
      (acc, part) => mergeSchemaInto(acc, resolveSchema(part, components, depth + 1)),
      seed,
    );
  }
  return schema;
}

function escapeJsonPointer(s: string) {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

function inferSemanticTypeFromPath(p: string): string {
  const last =
    p
      .split(/\.|\[]/)
      .filter(Boolean)
      .pop() || p;
  return last.charAt(0).toUpperCase() + last.slice(1);
}
