import type { OperationModel, ValidationScenario } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  capPerOperation?: number;
}

type BaselineObject = Record<string, unknown>;

/**
 * The required fields of a ROOT allOf's constituents that a body can omit, with the baseline body to omit them from,
 * or undefined when there are none. An allOf nested inside a property is not looked at. generate.ts reuses
 * `isAllOfMissingRequiredEligible` for the coverage report's applicability.
 */
export function allOfMissingRequiredPlan(
  op: OperationModel,
): { baseline: BaselineObject; targets: string[] } | undefined {
  const root = op.requestBodySchema;
  if (!root) return undefined;
  if (!Array.isArray(root.allOf)) return undefined;
  // Build baseline to anchor other requireds
  const baseline = buildBaselineBody(op);
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return undefined;
  // Collect required sets per constituent
  const constituents = root.allOf.filter(
    (c) => c && c.type === 'object' && Array.isArray(c.required),
  );
  if (constituents.length < 2) return undefined;
  const targets: string[] = [];
  for (const c of constituents) {
    for (const r of c.required ?? []) {
      if (r in baseline) targets.push(r);
    }
  }
  return targets.length ? { baseline, targets } : undefined;
}

export function isAllOfMissingRequiredEligible(op: OperationModel): boolean {
  return allOfMissingRequiredPlan(op) !== undefined;
}

/**
 * The properties of a ROOT allOf that its object constituents give different types, with the baseline body to
 * change them in, or undefined when there are none. generate.ts reuses `isAllOfConflictEligible`.
 */
export function allOfConflictPlan(
  op: OperationModel,
): { baseline: BaselineObject; conflicts: string[] } | undefined {
  const root = op.requestBodySchema;
  if (!root) return undefined;
  if (!Array.isArray(root.allOf)) return undefined;
  const objectConstituents = root.allOf.filter((c) => c && c.type === 'object' && c.properties);
  if (objectConstituents.length < 2) return undefined;
  // Look for same property name with different types across constituents
  const typeMap: Record<string, Set<string>> = {};
  for (const c of objectConstituents) {
    for (const [k, v] of Object.entries(c.properties ?? {})) {
      const t = v.type || 'any';
      const set = typeMap[k] ?? new Set<string>();
      set.add(Array.isArray(t) ? String(t[0]) : String(t));
      typeMap[k] = set;
    }
  }
  const conflicts = Object.entries(typeMap)
    .filter(([_, set]) => set.size > 1)
    .map(([k]) => k);
  if (!conflicts.length) return undefined;
  const baseline = buildBaselineBody(op);
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return undefined;
  return { baseline, conflicts };
}

export function isAllOfConflictEligible(op: OperationModel): boolean {
  return allOfConflictPlan(op) !== undefined;
}

export function generateAllOfMissingRequired(
  ops: OperationModel[],
  opts: Opts,
): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const plan = allOfMissingRequiredPlan(op);
    if (!plan) continue;
    for (const r of plan.targets) {
      // Create body missing this required but present others
      const body = structuredClone(plan.baseline);
      delete body[r];
      out.push({
        id: makeId([op.operationId, 'allofMissing', r]),
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'allof-missing-required',
        target: r,
        requestBody: body,
        params: buildParams(op.path),
        expectedStatus: 400,
        description: `Missing required field from allOf constituent: ${r}`,
        headersAuth: true,
        source: 'body',
      });
    }
  }
  return out;
}

export function generateAllOfConflicts(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const plan = allOfConflictPlan(op);
    if (!plan) continue;
    for (const prop of plan.conflicts) {
      const body = structuredClone(plan.baseline);
      body[prop] = 12345; // number
      out.push({
        id: makeId([op.operationId, 'allofConflict', prop]),
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        type: 'allof-conflict',
        target: prop,
        requestBody: body,
        params: buildParams(op.path),
        expectedStatus: 400,
        description: `Conflicting allOf definitions for property ${prop}`,
        headersAuth: true,
        source: 'body',
      });
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
