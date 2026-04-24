import type { OperationModel, ValidationScenario } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';
import { buildWalk, type WalkNode } from '../schema/walker.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
}

// Permissive subset of an OpenAPI schema fragment used by the oneOf fallback walker.
interface SchemaFragment {
  type?: string;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, SchemaFragment>;
  oneOf?: SchemaFragment[];
}

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isSchemaFragment(v: unknown): v is SchemaFragment {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function generateEnumViolations(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const walk = buildWalk(op);
    const root = walk?.root;
    let produced = 0;
    if (root) {
      const baseline = buildBaselineBody(op);
      let enumNodes = 0;
      if (baseline) {
        for (const node of walk.byPointer.values()) {
          if (!node.enum?.length) continue;
          enumNodes++;
          const path = findPath(root, node);
          if (!path) continue;
          if (opts.capPerOperation && produced >= opts.capPerOperation) break;
          const invalids = buildInvalidVariants(node.enum[0]);
          for (const inv of invalids) {
            if (opts.capPerOperation && produced >= opts.capPerOperation) break;
            const body = structuredClone(baseline);
            const marker = { __invalidEnum: true, value: inv };
            if (!applyOrCreatePath(body, path, marker)) continue;
            out.push(makeScenario(op, path.join('.'), body, produced));
            produced++;
          }
          if (opts.capPerOperation && produced >= opts.capPerOperation) break;
        }
      }
      if (enumNodes && process.env.DEBUG_ENUMS) {
        console.log('[enum] op', op.operationId, 'enumNodes', enumNodes);
      }
    }
    // Fallback: pure oneOf root (walker skipped) – scan variants
    const reqBodySchema: SchemaFragment | undefined = isSchemaFragment(op.requestBodySchema)
      ? op.requestBodySchema
      : undefined;
    if (!root && reqBodySchema && Array.isArray(reqBodySchema.oneOf)) {
      const variants = reqBodySchema.oneOf;
      for (let vi = 0; vi < variants.length; vi++) {
        const v = variants[vi];
        if (!v || v.type !== 'object' || !v.properties) continue;
        // Build variant baseline from its required
        const base: Record<string, unknown> = {};
        if (Array.isArray(v.required)) {
          for (const r of v.required) base[r] = placeholder(v.properties[r]);
        }
        for (const [prop, schema] of Object.entries(v.properties)) {
          if (!schema || !Array.isArray(schema.enum) || !schema.enum.length) continue;
          if (opts.capPerOperation && produced >= (opts.capPerOperation ?? Infinity)) break;
          const invalids = buildInvalidVariants(schema.enum[0]);
          for (const inv of invalids) {
            if (opts.capPerOperation && produced >= (opts.capPerOperation ?? Infinity)) break;
            const body = structuredClone(base);
            body[prop] = { __invalidEnum: true, value: inv };
            out.push({
              id: makeId([op.operationId, 'enumOneOf', String(vi), prop, String(produced)]),
              operationId: op.operationId,
              method: op.method,
              path: op.path,
              type: 'enum-violation',
              target: `v${vi}.${prop}`,
              requestBody: body,
              params: buildParams(op.path),
              expectedStatus: 400,
              description: `Enum violation (oneOf variant ${vi}) on ${prop}`,
              headersAuth: true,
            });
            produced++;
          }
        }
      }
    }
  }
  return out;
}
function buildInvalidVariants(first: unknown): unknown[] {
  const invalids: unknown[] = [];
  if (typeof first === 'string') {
    invalids.push(`${first}_INVALID`);
    if (first.toUpperCase() !== first) invalids.push(first.toUpperCase());
    if (first.toLowerCase() !== first) invalids.push(first.toLowerCase());
  } else {
    invalids.push('__INVALID_ENUM__');
  }
  return invalids.slice(0, 3);
}

function makeScenario(
  op: OperationModel,
  targetPath: string,
  body: unknown,
  idx: number,
): ValidationScenario {
  return {
    id: makeId([op.operationId, 'enum', targetPath.replace(/\./g, '_'), String(idx)]),
    operationId: op.operationId,
    method: op.method,
    path: op.path,
    type: 'enum-violation',
    target: targetPath,
    requestBody: body,
    params: buildParams(op.path),
    expectedStatus: 400,
    description: `Enum violation on ${targetPath}`,
    headersAuth: true,
  };
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
      return {};
    default:
      return 'x';
  }
}

function findPath(root: WalkNode, node: WalkNode): string[] | undefined {
  let found: string[] | undefined;
  function dfs(cur: WalkNode, path: string[]) {
    if (cur === node) {
      found = path;
      return;
    }
    if (cur.properties)
      for (const [k, v] of Object.entries(cur.properties)) {
        dfs(v, [...path, k]);
        if (found) return;
      }
    if (cur.items) dfs(cur.items, [...path, '0']);
  }
  dfs(root, []);
  return found;
}

function applyOrCreatePath(obj: unknown, path: string[], value: unknown): boolean {
  let t: unknown = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!isObject(t)) return false;
    const s = path[i];
    if (!(s in t)) {
      t[s] = {};
    }
    t = t[s];
  }
  if (!isObject(t)) return false;
  t[path[path.length - 1]] = value;
  return true;
}
function buildParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const token of m) params[token.slice(1, -1)] = 'x';
  return params;
}
