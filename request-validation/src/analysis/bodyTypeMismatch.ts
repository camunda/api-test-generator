import type { OperationModel, ValidationScenario } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';
import { buildWalk, type WalkNode } from '../schema/walker.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
  maxPerField?: number;
  /**
   * #427 — leaf names of body fields the server's authorization layer
   * resolves *before* body type-validation (the resource-key fields, i.e.
   * the keys of `resourceFixtures`: projectKey, folderKey, parentFolderKey,
   * workspaceKey, …). A wrong-type value on one of these never reaches
   * body validation: the @PreAuthorize gate resolves the malformed key
   * first, so a scalar wrong-type (`123`, `true`) short-circuits to 403
   * and a structural one (`{}`, `[]`) currently 500s (a Hub bug —
   * unhandled non-scalar key). Neither is the expected 400, so emitting a
   * body-type-mismatch on an authz-resolved key field is a guaranteed
   * false-positive. Verified live 2026-07-03: a non-key string field with
   * the same mutations correctly returns 400, confirming the bypass is
   * specific to authz-resolved keys. Skipped here rather than
   * re-expected-as-403 so the suite keeps asserting strict body-validation
   * (400) everywhere it actually runs. Analogous to `unenforcedStringFormats`.
   */
  resourceKeyFields?: ReadonlySet<string>;
}

const TYPE_MISMATCH_TABLE: Record<string, unknown[]> = {
  string: [123, true, {}, []],
  integer: ['not-a-number', true, {}, []],
  number: ['not-a-number', true, {}, []],
  boolean: ['TRUE', 1, {}, []],
  object: ['x', 1],
  array: ['x', {}],
};

export function generateBodyTypeMismatch(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const walk = buildWalk(op);
    if (!walk?.root) continue;
    const baseline = buildBaselineBody(op);
    if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) continue;
    let produced = 0;
    const fields = collectFields(walk.root, []);
    for (const f of fields) {
      const t = Array.isArray(f.type) ? f.type[0] : f.type;
      if (!t || !TYPE_MISMATCH_TABLE[t]) continue;
      // #427 — skip authz-resolved resource-key fields: the server resolves
      // them before body validation, so a wrong-type value yields 403/500,
      // never the expected 400.
      if (opts.resourceKeyFields?.has(f.path[f.path.length - 1])) continue;
      let perField = 0;
      for (const wrong of TYPE_MISMATCH_TABLE[t]) {
        if (opts.capPerOperation && produced >= opts.capPerOperation) break;
        if (opts.maxPerField && perField >= opts.maxPerField) break;
        const mutated = structuredClone(baseline);
        if (!applyMutation(mutated, f.path, wrong)) continue;
        const id = makeId([op.operationId, 'bodyType', f.path.join('_'), String(perField)]);
        out.push({
          id,
          operationId: op.operationId,
          method: op.method,
          path: op.path,
          type: 'type-mismatch',
          target: f.path.join('.'),
          requestBody: mutated,
          params: buildParams(op.path),
          expectedStatus: 400,
          description: `Body field '${f.path.join('.')}' wrong type from '${t}'`,
          headersAuth: true,
        });
        produced++;
        perField++;
      }
      if (opts.capPerOperation && produced >= opts.capPerOperation) break;
    }
  }
  return out;
}

function collectFields(
  node: WalkNode,
  prefix: string[],
): { path: string[]; type?: string | string[] }[] {
  const out: { path: string[]; type?: string | string[] }[] = [];
  const t = Array.isArray(node.type) ? node.type[0] : node.type;
  if (t && t !== 'object' && t !== 'array') {
    out.push({ path: prefix.slice(), type: t });
  }
  if (t === 'object' && node.properties) {
    for (const [k, c] of Object.entries(node.properties)) {
      out.push(...collectFields(c, [...prefix, k]));
    }
  } else if (t === 'array' && node.items) {
    out.push(...collectFields(node.items, [...prefix, '0']));
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function applyMutation(obj: Record<string, unknown>, path: string[], value: unknown): boolean {
  let target: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (!(seg in target)) return false;
    const next = target[seg];
    if (!isRecord(next)) return false;
    target = next;
  }
  const last = path[path.length - 1];
  if (!(last in target)) return false;
  target[last] = value;
  return true;
}

function buildParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const token of m) params[token.slice(1, -1)] = 'x';
  return params;
}
