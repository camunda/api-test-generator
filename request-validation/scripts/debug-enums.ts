#!/usr/bin/env ts-node
import path from 'node:path';
import { loadSpec } from '../src/spec/loader.js';

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

(async () => {
  const specPath = path.resolve(process.cwd(), '../../rest-api.generated.yaml');
  const model = await loadSpec(specPath);
  for (const op of model.operations) {
    const seen: string[] = [];
    function walk(node: unknown, trail: string[]) {
      if (!isObject(node)) return;
      if (Array.isArray(node.enum) && node.enum.length) {
        seen.push(`${trail.join('.')} enum[${node.enum.length}]`);
      }
      if (isObject(node.properties)) {
        for (const [k, v] of Object.entries(node.properties)) walk(v, trail.concat(k));
      }
      if (node.items) walk(node.items, trail.concat('[]'));
      if (Array.isArray(node.allOf)) for (const part of node.allOf) walk(part, trail);
    }
    if (op.requestBodySchema) walk(op.requestBodySchema, []);
    if (seen.length) {
      console.log(op.operationId, 'enums:', seen.slice(0, 5).join('; '), 'total', seen.length);
    }
  }
})();
