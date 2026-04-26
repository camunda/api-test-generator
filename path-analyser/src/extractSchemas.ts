import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type {
  ExtractedRequestVariantsIndex,
  RequestOneOfGroupSummary,
  RequestOneOfVariant,
  ResponseShapeField,
  ResponseShapeSummary,
} from './types.js';

// Loose JSON Schema shape: a structurally-typed view of OpenAPI Schema Objects
// after $ref/allOf merging. Every field is optional because we read schemas at
// many depths in the bundled spec.
interface JsonSchema {
  $ref?: string;
  type?: string;
  format?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  title?: string;
  // OpenAPI 3.0 `nullable: true` marker. Propagated through the codegen
  // pipeline so the emitter can guard runtime type assertions against
  // legitimate `null` values.
  nullable?: boolean;
  discriminator?: { propertyName?: string; mapping?: Record<string, string> };
  'x-polymorphic-schema'?: boolean;
  [key: string]: unknown;
}

type Components = Record<string, JsonSchema>;

interface OpenAPISchemaObject {
  paths?: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Components };
  [key: string]: unknown;
}

interface OperationObject {
  operationId?: string;
  responses?: Record<string, ResponseObject>;
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
  [key: string]: unknown;
}

interface ResponseObject {
  content?: Record<string, { schema?: JsonSchema }>;
  [key: string]: unknown;
}

export async function extractResponseAndRequestVariants(baseDir: string, semanticTypes: string[]) {
  // baseDir points to path-analyser; spec lives at repo root under spec/bundled/
  const specPath =
    process.env.OPENAPI_SPEC_PATH || path.resolve(baseDir, '../spec/bundled/rest-api.bundle.json');
  const raw = await fs.readFile(specPath, 'utf8');
  // biome-ignore lint/plugin: YAML.parse returns unknown; this is the single boundary where the parsed spec is narrowed to its known top-level shape.
  const doc = YAML.parse(raw) as OpenAPISchemaObject;
  const responses: ResponseShapeSummary[] = [];
  const requestGroups: RequestOneOfGroupSummary[] = [];

  const paths = doc.paths || {};
  for (const [, methods] of Object.entries(paths)) {
    for (const [, op] of Object.entries(methods || {})) {
      if (!op?.operationId) continue;
      const operationId = op.operationId;
      // Response extraction: take first 200 json schema if present
      const successCode = Object.keys(op.responses || {}).find((c) =>
        ['200', '201', '204'].includes(c),
      );
      const success = successCode ? op.responses?.[successCode] : undefined;
      const ctSchemas: { ct: string; schema: JsonSchema }[] = [];
      if (success?.content) {
        for (const [ct, media] of Object.entries(success.content)) {
          if (/json/.test(ct) && media.schema) ctSchemas.push({ ct, schema: media.schema });
        }
      }
      if (ctSchemas.length) {
        const components: Components = doc.components?.schemas || {};
        const rootSchema = resolveSchema(ctSchemas[0].schema, components);
        const fields = flattenTopLevelFields(rootSchema, components);
        // Extract nested item field shapes for top-level arrays (e.g., jobs[])
        const nestedItems: Record<string, ResponseShapeField[]> = {};
        try {
          const req = new Set(rootSchema?.required || []);
          for (const [fname, fsch] of Object.entries(rootSchema?.properties || {})) {
            const r = resolveSchema(fsch, components);
            if (r?.type === 'array' && r.items) {
              const it = resolveSchema(r.items, components);
              const itemObj = it.$ref ? resolveSchema(it, components) : it;
              if (itemObj && (itemObj.type === 'object' || itemObj.$ref)) {
                const o = resolveSchema(itemObj, components);
                const innerReq = new Set(o.required || []);
                const inner: ResponseShapeField[] = [];
                for (const [iname, isch] of Object.entries(o.properties || {})) {
                  const ir = resolveSchema(isch, components);
                  const t = effectiveType(ir, components);
                  inner.push({
                    name: iname,
                    type: t,
                    required: innerReq.has(iname),
                    nullable: isNullable(ir, isch),
                  });
                }
                if (inner.length) nestedItems[fname] = inner;
              }
            }
            // Mark req as referenced so the noUnusedVariables rule is satisfied
            void req;
          }
        } catch {}
        // Extract nested slice field shapes for deployments[].{slice}
        const nestedSlices: Record<string, ResponseShapeField[]> = {};
        try {
          const deploymentsProp = rootSchema?.properties?.deployments;
          const deployments = deploymentsProp
            ? resolveSchema(deploymentsProp, components)
            : undefined;
          const items =
            deployments?.type === 'array' && deployments.items
              ? resolveSchema(deployments.items, components)
              : undefined;
          const itemObj = items?.$ref ? resolveSchema(items, components) : items;
          const sliceNames = [
            'processDefinition',
            'decisionDefinition',
            'decisionRequirements',
            'form',
          ];
          if (itemObj?.properties) {
            for (const slice of sliceNames) {
              const sProp = itemObj.properties[slice];
              if (!sProp) continue;
              const sResolved = resolveSchema(sProp, components);
              if (sResolved?.type === 'object' || sResolved?.$ref) {
                const sObj = resolveSchema(sResolved, components);
                const req = new Set(sObj.required || []);
                const inner: ResponseShapeField[] = [];
                for (const [fname, fsch] of Object.entries(sObj.properties || {})) {
                  const r = resolveSchema(fsch, components);
                  const type = effectiveType(r, components);
                  inner.push({
                    name: fname,
                    type,
                    required: req.has(fname),
                    nullable: isNullable(r, fsch),
                  });
                }
                if (inner.length) nestedSlices[slice] = inner;
              }
            }
          }
        } catch {}
        // Map to semantic types if field (PascalCase) matches
        const producedSet = new Set<string>();
        for (const f of fields) {
          const pascal = toPascalCase(f.name);
          if (semanticTypes.includes(pascal)) {
            f.semantic = pascal;
            producedSet.add(pascal);
          }
        }
        const resp: ResponseShapeSummary = {
          operationId,
          contentTypes: ctSchemas.map((c) => c.ct),
          fields,
          producedSemantics: [...producedSet],
          successStatus: successCode ? Number(successCode) : undefined,
        };
        if (Object.keys(nestedSlices).length) resp.nestedSlices = nestedSlices;
        if (Object.keys(nestedItems).length) resp.nestedItems = nestedItems;
        responses.push(resp);
      }

      // Request oneOf extraction
      const reqSchema = op.requestBody?.content?.['application/json']?.schema;
      if (reqSchema) {
        findOneOfGroups(operationId, reqSchema, doc.components?.schemas || {}, requestGroups);
      }
    }
  }

  const requestIndex: ExtractedRequestVariantsIndex = { byOperation: {} };
  for (const g of requestGroups) {
    requestIndex.byOperation[g.operationId] ||= [];
    requestIndex.byOperation[g.operationId].push(g);
  }
  return { responses, requestIndex };
}

function flattenTopLevelFields(
  schemaRef: JsonSchema | undefined,
  components: Components,
): ResponseShapeField[] {
  const resolved = resolveSchema(schemaRef, components);
  const out: ResponseShapeField[] = [];
  if (resolved?.type === 'object' && resolved.properties) {
    const req = new Set(resolved.required || []);
    for (const [fname, fsch] of Object.entries(resolved.properties)) {
      const r = resolveSchema(fsch, components);
      const type = effectiveType(r, components);
      const nullable = isNullable(r, fsch);
      if (type === 'array' && r.items) {
        const it = resolveSchema(r.items, components);
        out.push({
          name: fname,
          type: 'array',
          required: req.has(fname),
          nullable,
          objectRef: it.$ref ? refName(it.$ref) : undefined,
        });
      } else {
        out.push({
          name: fname,
          type,
          required: req.has(fname),
          nullable,
          objectRef: r.$ref ? refName(r.$ref) : undefined,
        });
      }
    }
  }
  return out;
}

function findOneOfGroups(
  operationId: string,
  root: JsonSchema,
  components: Components,
  acc: RequestOneOfGroupSummary[],
  path: string[] = [],
  depth = 0,
) {
  const resolved = resolveSchema(root, components);
  // Top-level oneOf
  if (resolved.oneOf && Array.isArray(resolved.oneOf)) {
    // vendor extension flag for genuine polymorphic unions
    const isPolymorphic = resolved['x-polymorphic-schema'] === true;
    const variants: RequestOneOfVariant[] = resolved.oneOf.map((v: JsonSchema, idx: number) => {
      const vs = resolveSchema(v, components);
      const props = vs.properties || {};
      const required = vs.required || [];
      const optional = Object.keys(props).filter((k) => !required.includes(k));
      let discriminator: { field: string; value: string } | undefined;
      if (resolved.discriminator?.propertyName) {
        const discField = resolved.discriminator.propertyName;
        const mapping = resolved.discriminator.mapping || {};
        const entry = Object.entries(mapping).find(
          ([, ref]) => typeof ref === 'string' && ref.endsWith(refName(vs.$ref || v.$ref || '')),
        );
        if (entry) discriminator = { field: discField, value: entry[0] };
      }
      const groupId = path.length ? path.join('.') : 'group0';
      return {
        groupId,
        variantName: vs.title || `variant${idx + 1}`,
        required,
        optional,
        discriminator,
      };
    });
    const groupId = path.length ? path.join('.') : 'group0';
    acc.push({
      operationId,
      groupId,
      variants,
      unionFields: [...new Set(variants.flatMap((v) => [...v.required, ...v.optional]))],
      isPolymorphic,
    });
  }
  // Nested: scan properties one level deep for oneOf (shallow)
  if (depth < 3 && resolved.type === 'object' && resolved.properties) {
    for (const [fname, fsch] of Object.entries(resolved.properties)) {
      const rs = resolveSchema(fsch, components);
      findOneOfGroups(operationId, rs, components, acc, [...path, fname], depth + 1);
    }
  }
}

function resolveSchema(
  schema: JsonSchema | undefined,
  components: Components,
  depth = 0,
): JsonSchema {
  if (!schema || depth > 10) return schema || {};
  let s: JsonSchema = schema;
  // Resolve $ref by merging referenced content (schema properties override refs)
  if (s.$ref) {
    const name = refName(s.$ref);
    const target = components[name];
    if (target) {
      const merged: JsonSchema = { ...resolveSchema(target, components, depth + 1), ...s };
      delete merged.$ref;
      s = merged;
    }
  }
  // Resolve allOf by merging members
  if (Array.isArray(s.allOf)) {
    const merged: JsonSchema = {};
    for (const part of s.allOf) {
      const r = resolveSchema(part, components, depth + 1) || {};
      if (r.type && !merged.type) merged.type = r.type;
      if (r.properties) merged.properties = { ...(merged.properties || {}), ...r.properties };
      if (Array.isArray(r.required))
        merged.required = Array.from(new Set([...(merged.required || []), ...r.required]));
      if (r.items && !merged.items) merged.items = r.items;
      if (r.format && !merged.format) merged.format = r.format;
    }
    const withoutAllOf: JsonSchema = { ...s };
    delete withoutAllOf.allOf;
    s = { ...merged, ...withoutAllOf };
  }
  return s;
}

// True iff either the resolved schema or the original (pre-$ref) schema has
// `nullable: true`. Inspecting both forms catches the common case where a
// component schema carries `nullable` and the field references it via $ref,
// as well as inline schemas that override.
function isNullable(resolved: JsonSchema | undefined, original: JsonSchema | undefined): boolean {
  return resolved?.nullable === true || original?.nullable === true;
}

function effectiveType(schema: JsonSchema, components: Components): string {
  const s = resolveSchema(schema, components);
  if (s.type) return s.type;
  if (Array.isArray(s.allOf)) {
    for (const part of s.allOf) {
      const t = effectiveType(part, components);
      if (t && t !== 'unknown') return t;
    }
  }
  if (s.oneOf) return 'union';
  if (s.anyOf) return 'union';
  // If it references a known key format, default to string
  if (typeof s.format === 'string' && /Key$/.test(s.format)) return 'string';
  return 'unknown';
}

function refName(ref: string): string {
  return ref.split('/').pop() || ref;
}

export async function writeExtractionOutputs(baseDir: string, semanticTypes: string[]) {
  const { responses, requestIndex } = await extractResponseAndRequestVariants(
    baseDir,
    semanticTypes,
  );
  const outDir = path.resolve(baseDir, 'dist', 'extraction');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, 'response-shapes.json'),
    JSON.stringify(responses, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(outDir, 'request-variants.json'),
    JSON.stringify(requestIndex, null, 2),
    'utf8',
  );
  return { responses, requestIndex };
}

function toPascalCase(name: string): string {
  return name ? name[0].toUpperCase() + name.slice(1) : name;
}
