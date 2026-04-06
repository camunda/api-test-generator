#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Utility: read YAML
function readYaml(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  return yaml.load(src);
}

// Resolve $ref within components/schemas
function resolveRef(doc, ref) {
  if (!ref || !ref.startsWith('#/')) return undefined;
  const parts = ref.slice(2).split('/');
  let cur = doc;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// Merge allOf recursively to an effective schema
function mergeAllOf(doc, schema) {
  if (!schema) return schema;
  if (schema.$ref) {
    const target = resolveRef(doc, schema.$ref);
    const rest = { ...schema };
    delete rest.$ref;
    return mergeAllOf(doc, { ...target, ...rest });
  }
  if (schema.allOf && Array.isArray(schema.allOf)) {
    const base = { ...schema };
    delete base.allOf;
    for (const part of schema.allOf) {
      const eff = mergeAllOf(doc, part);
      base.type = base.type || eff?.type;
      // propagate explicit nullable from parts
      if (eff && typeof eff.nullable !== 'undefined') {
        base.nullable = base.nullable || !!eff.nullable;
      }
      // merge properties
      if (eff?.properties) {
        base.properties = { ...(base.properties||{}), ...eff.properties };
      }
      // merge required (union)
      if (Array.isArray(eff?.required)) {
        const s = new Set([...(base.required||[]), ...eff.required]);
        base.required = [...s];
      }
      // merge items for arrays
      if (eff?.items && !base.items) base.items = eff.items;
    }
    return base;
  }
  return schema;
}

// Determine if schema (object) has optional fields
function isNullable(doc, schema) {
  if (!schema) return false;
  const m = mergeAllOf(doc, schema);
  return !!m?.nullable;
}

function getOptionalFields(doc, eff) {
  if (!eff || eff.type !== 'object' || !eff.properties) return [];
  const req = new Set(eff.required || []);
  const names = Object.keys(eff.properties);
  return names.filter(n => {
    if (req.has(n)) return false;
    const propSch = eff.properties[n];
    // Exclude explicitly nullable fields from analysis
    if (isNullable(doc, propSch)) return false;
    return true;
  });
}

function main() {
  const repoRoot = process.cwd().endsWith('optional-responses')
    ? path.resolve(process.cwd(), '..')
    : process.cwd();
  const specPath = process.env.OPENAPI_SPEC_PATH || path.resolve(repoRoot, 'spec/bundled/rest-api.bundle.json');
  const doc = readYaml(specPath);
  const paths = doc.paths || {};

  const lines = [];
  const seen = new Set();
  for (const [p, pathItem] of Object.entries(paths)) {
    for (const method of Object.keys(pathItem)) {
      const op = pathItem[method];
      if (!op || !op.responses) continue;
      for (const [code, resp] of Object.entries(op.responses)) {
        // Only consider 2xx success codes
        if (!/^2\d\d$/.test(String(code))) continue;
        let schema;
        const content = resp?.content || {};
        const mt = Object.keys(content)[0];
        const media = mt ? content[mt] : undefined;
        if (media?.schema) {
          schema = media.schema;
        }
        if (schema) {
          const eff = mergeAllOf(doc, schema);
          let opt = [];
          let schemaName = undefined;
          // Try named schema from top-level or item-level when array
          if (schema.$ref) schemaName = schema.$ref.split('/').pop();
          if (!schemaName && eff?.items?.$ref) schemaName = eff.items.$ref.split('/').pop();

          if (eff?.type === 'object' || (!eff?.type && eff?.properties)) {
            opt = getOptionalFields(doc, eff);
          } else if (eff?.type === 'array' || eff?.items) {
            const itemsEff = mergeAllOf(doc, eff.items || {});
            const itemsResolved = itemsEff?.$ref ? mergeAllOf(doc, resolveRef(doc, itemsEff.$ref)) : itemsEff;
            if (itemsResolved?.type === 'object' && itemsResolved?.properties) {
              opt = getOptionalFields(doc, itemsResolved);
            }
          } else if (eff?.$ref) {
            const target = resolveRef(doc, eff.$ref);
            const merged = mergeAllOf(doc, target);
            opt = getOptionalFields(doc, merged);
          }
          if (opt.length) {
            const id = p;
            const out = schemaName ? `${id} - ${schemaName}` : `${id} - [${opt.join(', ')}]`;
            if (!seen.has(out)) { lines.push(out); seen.add(out); }
          }
        } else {
          // Inline response without schema or different structure
          // Try to detect inline object with properties
          const mt2 = Object.keys(content)[0];
          const media2 = mt2 ? content[mt2] : undefined;
          const sch2 = media2?.schema;
          if (sch2) {
            const eff2 = mergeAllOf(doc, sch2);
            if (eff2?.type === 'object' && eff2.properties) {
              const opt2 = getOptionalFields(doc, eff2);
              if (opt2.length) { const id = p; const out = `${id} - [${opt2.join(', ')}]`; if (!seen.has(out)) { lines.push(out); seen.add(out); } }
            } else if (eff2?.type === 'array' || eff2?.items) {
              const itemsEff2 = mergeAllOf(doc, eff2.items || {});
              const res2 = itemsEff2?.$ref ? mergeAllOf(doc, resolveRef(doc, itemsEff2.$ref)) : itemsEff2;
              if (res2?.type === 'object' && res2.properties) {
                const opt3 = getOptionalFields(doc, res2);
                if (opt3.length) { const id = p; const out = `${id} - [${opt3.join(', ')}]`; if (!seen.has(out)) { lines.push(out); seen.add(out); } }
              }
            }
          }
        }
      }
    }
  }

  if (!lines.length) {
    console.log('No responses with optional fields found.');
  } else {
    for (const l of lines) console.log(l);
  }
}

main();
