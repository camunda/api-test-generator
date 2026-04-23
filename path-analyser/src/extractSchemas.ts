import { promises as fs } from 'fs';
import path from 'path';
import YAML from 'yaml';
import type {
  ExtractedRequestVariantsIndex,
  RequestOneOfGroupSummary,
  RequestOneOfVariant,
  ResponseShapeSummary,
} from './types.js';

interface OpenAPISchemaObject {
  [key: string]: any;
}

export async function extractResponseAndRequestVariants(baseDir: string, semanticTypes: string[]) {
  // baseDir points to path-analyser; spec lives at repo root under spec/bundled/
  const specPath =
    process.env.OPENAPI_SPEC_PATH || path.resolve(baseDir, '../spec/bundled/rest-api.bundle.json');
  const raw = await fs.readFile(specPath, 'utf8');
  const doc = YAML.parse(raw) as OpenAPISchemaObject;
  const responses: ResponseShapeSummary[] = [];
  const requestGroups: RequestOneOfGroupSummary[] = [];

  const paths = doc.paths || doc; // fallback if structure different
  for (const [p, methods] of Object.entries<any>(paths)) {
    for (const [method, op] of Object.entries<any>(methods || {})) {
      if (!op || !op.operationId) continue;
      const operationId = op.operationId;
      // Response extraction: take first 200 json schema if present
      const successCode = Object.keys(op.responses || {}).find((c) =>
        ['200', '201', '204'].includes(c),
      );
      const success = successCode ? op.responses[successCode] : undefined;
      const ctSchemas: any[] = [];
      if (success?.content) {
        for (const [ct, media] of Object.entries<any>(success.content)) {
          if (/json/.test(ct) && media.schema) ctSchemas.push({ ct, schema: media.schema });
        }
      }
      if (ctSchemas.length) {
        const components = doc.components?.schemas || {};
        const rootSchema = resolveSchema(ctSchemas[0].schema, components);
        const fields = flattenTopLevelFields(rootSchema, components);
        // Extract nested item field shapes for top-level arrays (e.g., jobs[])
        const nestedItems: Record<string, any[]> = {};
        try {
          const req = new Set(rootSchema?.required || []);
          for (const [fname, fsch] of Object.entries<any>(rootSchema?.properties || {})) {
            const r = resolveSchema(fsch, components);
            if (r?.type === 'array' && r.items) {
              const it = resolveSchema(r.items, components);
              const itemObj = it.$ref ? resolveSchema(it, components) : it;
              if (itemObj && (itemObj.type === 'object' || itemObj.$ref)) {
                const o = resolveSchema(itemObj, components);
                const innerReq = new Set(o.required || []);
                const inner: { name: string; type: string; required?: boolean }[] = [];
                for (const [iname, isch] of Object.entries<any>(o.properties || {})) {
                  const ir = resolveSchema(isch, components);
                  const t = effectiveType(ir, components);
                  inner.push({ name: iname, type: t, required: innerReq.has(iname) });
                }
                if (inner.length) nestedItems[fname] = inner;
              }
            }
          }
        } catch {}
        // Extract nested slice field shapes for deployments[].{slice}
        const nestedSlices: Record<string, any[]> = {};
        try {
          const deploymentsProp = rootSchema?.properties?.deployments;
          const deployments = deploymentsProp
            ? resolveSchema(deploymentsProp, components)
            : undefined;
          const items =
            deployments?.type === 'array'
              ? resolveSchema(deployments.items, components)
              : undefined;
          const itemObj = items && items.$ref ? resolveSchema(items, components) : items;
          const sliceNames = [
            'processDefinition',
            'decisionDefinition',
            'decisionRequirements',
            'form',
          ];
          if (itemObj && itemObj.properties) {
            for (const slice of sliceNames) {
              const sProp = itemObj.properties[slice];
              if (!sProp) continue;
              const sResolved = resolveSchema(sProp, components);
              if (sResolved?.type === 'object' || sResolved?.$ref) {
                const sObj = resolveSchema(sResolved, components);
                const req = new Set(sObj.required || []);
                const inner: { name: string; type: string; required?: boolean }[] = [];
                for (const [fname, fsch] of Object.entries<any>(sObj.properties || {})) {
                  const r = resolveSchema(fsch, components);
                  const type = effectiveType(r, components);
                  inner.push({ name: fname, type, required: req.has(fname) });
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
            (f as any).semantic = pascal;
            producedSet.add(pascal);
          }
        }
        const resp: ResponseShapeSummary = {
          operationId,
          contentTypes: ctSchemas.map((c) => c.ct),
          fields,
          producedSemantics: [...producedSet],
          successStatus: successCode ? Number(successCode) : undefined,
        } as any;
        if (Object.keys(nestedSlices).length) (resp as any).nestedSlices = nestedSlices;
        if (Object.keys(nestedItems).length) (resp as any).nestedItems = nestedItems;
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
    (requestIndex.byOperation[g.operationId] ||= []).push(g);
  }
  return { responses, requestIndex };
}

function flattenTopLevelFields(schemaRef: any, components: Record<string, any>) {
  const resolved = resolveSchema(schemaRef, components);
  const out: { name: string; type: string; required?: boolean; objectRef?: string }[] = [];
  if (resolved?.type === 'object' && resolved.properties) {
    const req = new Set(resolved.required || []);
    for (const [fname, fsch] of Object.entries<any>(resolved.properties)) {
      const r = resolveSchema(fsch, components);
      const type = effectiveType(r, components);
      if (type === 'array' && r.items) {
        const it = resolveSchema(r.items, components);
        out.push({
          name: fname,
          type: 'array',
          required: req.has(fname),
          objectRef: it.$ref ? refName(it.$ref) : undefined,
        });
      } else {
        out.push({
          name: fname,
          type,
          required: req.has(fname),
          objectRef: r.$ref ? refName(r.$ref) : undefined,
        });
      }
    }
  }
  return out;
}

function findOneOfGroups(
  operationId: string,
  root: any,
  components: Record<string, any>,
  acc: RequestOneOfGroupSummary[],
  path: string[] = [],
  depth = 0,
) {
  const resolved = resolveSchema(root, components);
  // Top-level oneOf
  if (resolved.oneOf && Array.isArray(resolved.oneOf)) {
    // vendor extension flag for genuine polymorphic unions
    const isPolymorphic = resolved['x-polymorphic-schema'] === true;
    const variants: RequestOneOfVariant[] = resolved.oneOf.map((v: any, idx: number) => {
      const vs = resolveSchema(v, components);
      const props = vs.properties || {};
      const required = vs.required || [];
      const optional = Object.keys(props).filter((k) => !required.includes(k));
      let discriminator;
      if (resolved.discriminator && resolved.discriminator.propertyName) {
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
    for (const [fname, fsch] of Object.entries<any>(resolved.properties)) {
      const rs = resolveSchema(fsch, components);
      findOneOfGroups(operationId, rs, components, acc, [...path, fname], depth + 1);
    }
  }
}

function resolveSchema(schema: any, components: Record<string, any>, depth = 0): any {
  if (!schema || depth > 10) return schema;
  let s = schema;
  // Resolve $ref by merging referenced content (schema properties override refs)
  if (s.$ref) {
    const name = refName(s.$ref);
    const target = components[name];
    if (target) {
      const merged = { ...resolveSchema(target, components, depth + 1), ...s };
      delete (merged as any).$ref;
      s = merged;
    }
  }
  // Resolve allOf by merging members
  if (Array.isArray(s.allOf)) {
    const merged: any = {};
    for (const part of s.allOf) {
      const r = resolveSchema(part, components, depth + 1) || {};
      if (r.type && !merged.type) merged.type = r.type;
      if (r.properties) merged.properties = { ...(merged.properties || {}), ...r.properties };
      if (Array.isArray(r.required))
        merged.required = Array.from(new Set([...(merged.required || []), ...r.required]));
      if (r.items && !merged.items) merged.items = r.items;
      if (r.format && !merged.format) merged.format = r.format;
    }
    const withoutAllOf = { ...s };
    delete (withoutAllOf as any).allOf;
    s = { ...merged, ...withoutAllOf };
  }
  return s;
}

function effectiveType(schema: any, components: Record<string, any>): string {
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
