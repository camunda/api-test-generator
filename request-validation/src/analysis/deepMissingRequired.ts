import type { OperationModel, ValidationScenario } from '../model/types.js';
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
    let produced = 0;
    // Walk every object node; for each, emit one scenario per required
    // property, including properties at the root (see block comment below
    // for why the root is included).
    const queue: WalkNode[] = [walk.root];
    const visited = new Set<WalkNode>();
    while (queue.length) {
      const node = queue.shift();
      if (!node || visited.has(node)) continue;
      visited.add(node);
      // Emit one scenario per required property of every object node in the
      // schema, including the root. We must walk the root because some
      // schemas (e.g. `MappingRuleUpdateRequest`) wrap their required list in
      // an `allOf`, leaving `op.requiredProps` empty and causing
      // `missingRequired` to skip the op entirely. Any duplicates between
      // this generator and `missingRequired` are collapsed by the body-hash
      // dedup in `request-validation/scripts/generate.ts`.
      if (node.properties && node.required?.length) {
        for (const req of node.required) {
          if (opts.capPerOperation && produced >= opts.capPerOperation) break;
          const targetPath = findPathForRequired(walk.root, node, req);
          if (!targetPath) continue;
          // Build a fresh body that materialises every parent on the path
          // (with its required children populated), then omit the leaf.
          const body = synthBody(walk.root, targetPath);
          if (!isRecord(body)) continue;
          if (!deleteAtPath(body, targetPath)) continue;
          const id = makeId([op.operationId, 'deepMissing', targetPath.join('.')]);
          out.push({
            id,
            operationId: op.operationId,
            method: op.method,
            path: op.path,
            type: 'missing-required',
            target: targetPath.join('.'),
            requestBody: body,
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
      if (node.items) queue.push(node.items);
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
  dfs(root, []);
  return found;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Delete the value at `path` from `root`. Path segments may address either
 * object keys or array indexes (numeric strings). Returns true on success.
 */
function deleteAtPath(root: Record<string, unknown>, path: string[]): boolean {
  if (!path.length) return false;
  let parent: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (Array.isArray(parent)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) return false;
      parent = parent[idx];
    } else if (isRecord(parent)) {
      if (!(seg in parent)) return false;
      parent = parent[seg];
    } else {
      return false;
    }
  }
  const last = path[path.length - 1];
  if (Array.isArray(parent)) {
    const idx = Number(last);
    if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) return false;
    parent.splice(idx, 1);
    return true;
  }
  if (isRecord(parent) && Object.hasOwn(parent, last)) {
    delete parent[last];
    return true;
  }
  return false;
}

/**
 * Build a JSON body for the request schema rooted at `root`, ensuring that
 * every ancestor on `targetPath` is materialised (objects with their required
 * children populated). The leaf at the end of `targetPath` will be present
 * here too — `deleteAtPath` is then responsible for removing it.
 */
function synthBody(root: WalkNode, targetPath: string[]): unknown {
  function synth(node: WalkNode, depth: number): unknown {
    const t = Array.isArray(node.type) ? node.type[0] : node.type;
    switch (t) {
      case 'object': {
        const obj: Record<string, unknown> = {};
        if (node.required && node.properties) {
          for (const r of node.required) {
            const child = node.properties[r];
            if (child) obj[r] = synth(child, depth + 1);
          }
        }
        // If the next segment of the target path is an optional property of
        // this node, materialise it so the path remains traversable.
        const next = targetPath[depth];
        if (next && node.properties && !(next in obj)) {
          const child = node.properties[next];
          if (child) obj[next] = synth(child, depth + 1);
        }
        return obj;
      }
      case 'array':
        return node.items ? [synth(node.items, depth + 1)] : [];
      case 'integer':
      case 'number':
        return 1;
      case 'boolean':
        return true;
      case 'string': {
        const first = node.enum?.[0];
        return typeof first === 'string' ? first : 'x';
      }
      default:
        return null;
    }
  }
  return synth(root, 0);
}
