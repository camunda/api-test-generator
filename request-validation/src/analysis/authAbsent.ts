import type { OperationModel, ValidationScenario } from '../model/types.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
}

/**
 * Generate auth-absent (HTTP 401) scenarios for the secured-server profile.
 *
 * For every operation that is conditionally secured on the `auth` axis
 * (`OperationModel.conditionalAuth`, derived from `x-enforcement: conditional`
 * security schemes + the operation's `security` block — camunda/camunda#53708),
 * emit a single scenario that issues the request WITHOUT any credentials
 * (`headersAuth: false`) and expects the server — when started in secured mode —
 * to reject it with 401 before any body/parameter validation runs.
 *
 * Operations that are unconditionally public (`security: []`) or not secured at
 * all yield no scenario, so against an unsecured server this generator's output
 * is empty and the two emitted profiles coincide.
 */
export function generateAuthAbsent(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    if (!op.conditionalAuth) continue;
    out.push({
      id: makeId([op.operationId, 'auth-absent']),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'auth-absent',
      params: buildDummyParams(op.path),
      expectedStatus: 401,
      description: 'Request without authentication is rejected with 401 (secured mode)',
      headersAuth: false,
    });
  }
  return out;
}

function buildDummyParams(path: string): Record<string, string> | undefined {
  const m = path.match(/\{([^}]+)}/g);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const token of m) {
    const name = token.slice(1, -1);
    params[name] = 'x';
  }
  return params;
}
