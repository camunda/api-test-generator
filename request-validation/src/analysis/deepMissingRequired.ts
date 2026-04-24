import type { OperationModel, ValidationScenario } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';
import { buildWalk, type WalkNode } from '../schema/walker.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
  includeNested?: boolean;
}

export function generateDeepMissingRequired(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const walk = buildWalk(op);
    if (!walk?.root) continue;
    const baseline = buildBaselineBody(op);
    if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) continue;
    let produced = 0;
    // Queue of object nodes
    const queue: WalkNode[] = [walk.root];
    while (queue.length) {
      const node = queue.shift();
      if (!node) break;
      if (node.properties && node.required?.length) {
        for (const req of node.required) {
          if (opts.capPerOperation && produced >= opts.capPerOperation) break;
          const scBody = structuredClone(baseline);
          const targetPath = findPathForRequired(walk.root, node, req);
          if (!targetPath) continue;
          if (!deleteAtPath(scBody, targetPath)) continue;
          const id = makeId([op.operationId, 'deepMissing', targetPath.join('.')]);
          out.push({
            id,
            operationId: op.operationId,
            method: op.method,
            path: op.path,
            type: 'missing-required',
            target: targetPath.join('.'),
            requestBody: scBody,
            params: buildParams(op.path),
            expectedStatus: 400,
            description: `Omit required field '${targetPath.join('.')}' (deep)`,
            headersAuth: true,
          });
          produced++;
        }
      }
      if (opts.includeNested && node.properties) {
        for (const c of Object.values(node.properties)) {
          if (c.type === 'object' || c.type === 'array') queue.push(c);
        }
      }
      if (opts.capPerOperation && produced >= opts.capPerOperation) break;
    }
  }
  return out;
}

function buildParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const token of m) params[token.slice(1, -1)] = 'x';
  return params;
}

function findPathForRequired(root: WalkNode, node: WalkNode, req: string): string[] | undefined {
  // naive search: traverse to find node pointer match then append required key
  const path: string[] = [];
  let found: string[] | undefined;
  function dfs(current: WalkNode, currentPath: string[]) {
    if (current === node) {
      found = [...currentPath, req];
      return;
    }
    if (current.properties) {
      for (const [k, v] of Object.entries(current.properties)) {
        dfs(v, [...currentPath, k]);
        if (found) return;
      }
    }
    if (current.items) {
      dfs(current.items, [...currentPath, '0']);
    }
  }
  dfs(root, path);
  return found;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deleteAtPath(obj: Record<string, unknown>, path: string[]): boolean {
  if (!path.length) return false;
  let parent: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (!(seg in parent)) return false;
    const next = parent[seg];
    if (!isRecord(next)) return false;
    parent = next;
  }
  const last = path[path.length - 1];
  if (Object.hasOwn(parent, last)) {
    delete parent[last];
    return true;
  }
  return false;
}
