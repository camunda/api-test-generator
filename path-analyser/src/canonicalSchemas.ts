import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface CanonicalNodeMeta {
  path: string; // dot + [] notation
  pointer: string; // JSON Pointer form
  type: string;
  required: boolean;
  semanticProvider?: string; // semantic type if x-semantic-provider: true
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
  const specPath =
    process.env.OPENAPI_SPEC_PATH || path.resolve(specRootDir, 'spec/bundled/rest-api.bundle.json');
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
) {
  if (!schema || depth > 25) return;
  if (schema.$ref) {
    const resolved = resolveSchema(schema, components);
    if (seen.has(resolved)) return; // prevent cycles
    seen.add(resolved);
    return walkSchema(resolved, pointer, pathSoFar, acc, seen, components, required, depth + 1);
  }
  const type =
    schema.type ||
    (schema.oneOf ? 'oneOf' : schema.anyOf ? 'anyOf' : schema.allOf ? 'allOf' : 'unknown');
  // Resolve allOf/anyOf/oneOf compositions before checking for object/array
  if (!schema.type && (schema.allOf || schema.anyOf || schema.oneOf)) {
    const resolved = resolveSchema(schema, components);
    if (resolved && resolved !== schema && !seen.has(resolved)) {
      seen.add(resolved);
      return walkSchema(resolved, pointer, pathSoFar, acc, seen, components, required, depth + 1);
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
      walkSchema(v, childPointer, childPath, acc, seen, components, reqSet.has(k), depth + 1);
    }
    return;
  }
  if (type === 'array' && schema.items) {
    const childPath = `${pathSoFar}[]`;
    const childPointer = `${pointer}/items`;
    acc.push({
      path: `${pathSoFar}[]`,
      pointer: childPointer,
      type: 'array',
      required,
      semanticProvider: schema['x-semantic-provider']
        ? inferSemanticTypeFromPath(pathSoFar)
        : undefined,
    });
    walkSchema(schema.items, childPointer, childPath, acc, seen, components, false, depth + 1);
    return;
  }
  if (pathSoFar) {
    const semantic = schema['x-semantic-provider']
      ? inferSemanticTypeFromPath(pathSoFar)
      : undefined;
    acc.push({ path: pathSoFar, pointer, type, required, semanticProvider: semantic });
  }
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
    return schema.allOf.reduce<SchemaObject>(
      (acc, part) => Object.assign(acc, resolveSchema(part, components, depth + 1)),
      {},
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
