#!/usr/bin/env tsx
import SwaggerParser from '@apidevtools/swagger-parser';
import { resolveSpecSource } from '../src/spec/source.js';

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

async function main() {
  const { specPath, source } = resolveSpecSource();
  console.log(`[analyze-spec] Using spec from ${source}: ${specPath}`);
  const api: unknown = await SwaggerParser.dereference(specPath);
  const counters = {
    operations: 0,
    bodyWithObject: 0,
    enums: 0,
    formats: new Map<string, number>(),
    multipleOf: 0,
    uniqueItems: 0,
    additionalPropsFalse: 0,
    discriminators: 0,
    anyOf: 0,
    allOf: 0,
    oneOf: 0,
  };

  function scanSchema(s: unknown) {
    if (!isObject(s)) return;
    if (Array.isArray(s.enum) && s.enum.length) counters.enums++;
    if (typeof s.format === 'string')
      counters.formats.set(s.format, (counters.formats.get(s.format) || 0) + 1);
    if (typeof s.multipleOf === 'number') counters.multipleOf++;
    if (s.uniqueItems) counters.uniqueItems++;
    if (s.additionalProperties === false) counters.additionalPropsFalse++;
    if (isObject(s.discriminator) && s.discriminator.propertyName) counters.discriminators++;
    if (Array.isArray(s.anyOf)) counters.anyOf++;
    if (Array.isArray(s.allOf)) counters.allOf++;
    if (Array.isArray(s.oneOf)) counters.oneOf++;
    if (isObject(s.properties)) for (const v of Object.values(s.properties)) scanSchema(v);
    if (s.items) scanSchema(s.items);
    if (Array.isArray(s.allOf)) s.allOf.forEach(scanSchema);
    if (Array.isArray(s.anyOf)) s.anyOf.forEach(scanSchema);
    if (Array.isArray(s.oneOf)) s.oneOf.forEach(scanSchema);
  }

  const paths = isObject(api) && isObject(api.paths) ? api.paths : {};
  for (const methods of Object.values(paths)) {
    if (!isObject(methods)) continue;
    for (const op of Object.values(methods)) {
      if (!isObject(op) || typeof op.operationId !== 'string') continue;
      counters.operations++;
      const requestBody = isObject(op.requestBody) ? op.requestBody : undefined;
      const content =
        requestBody && isObject(requestBody.content) ? requestBody.content : undefined;
      const json =
        content && isObject(content['application/json']) ? content['application/json'] : undefined;
      const schema = json && isObject(json.schema) ? json.schema : undefined;
      if (schema && schema.type === 'object') counters.bodyWithObject++;
      scanSchema(schema);
    }
  }

  const result = {
    operations: counters.operations,
    bodyObjectOperations: counters.bodyWithObject,
    enums: counters.enums,
    formats: Object.fromEntries(counters.formats.entries()),
    multipleOf: counters.multipleOf,
    uniqueItems: counters.uniqueItems,
    additionalPropertiesFalse: counters.additionalPropsFalse,
    discriminators: counters.discriminators,
    anyOf: counters.anyOf,
    allOf: counters.allOf,
    oneOf: counters.oneOf,
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
