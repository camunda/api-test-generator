import type { OperationModel, ValidationScenario } from '../model/types.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  /**
   * When `true` (config `authAbsentMode: 'all-secured'`), target every
   * operation whose effective `security` *mandates* authentication
   * (`OperationModel.secured` — every OR-alternative names a scheme; excludes
   * `security: []` and any anonymous `{}` alternative), not only the
   * conditionally-secured ones. For APIs uniformly authenticated via a single
   * global scheme (e.g. Hub) — which declare no `x-enforcement: conditional`
   * schemes — this is the only way the 401 surface is non-empty. Default
   * `false` preserves the OCA behaviour.
   */
  allSecured?: boolean;
}

/**
 * Is `op` part of the 401 surface under the active mode? Shared by the
 * auth-absent (no credentials) and auth-invalid (garbage token) generators so
 * they target an identical operation set.
 *
 * By default targets every operation conditionally secured on the `auth` axis
 * (`OperationModel.conditionalAuth`, derived from `x-enforcement: conditional`
 * security schemes + the operation's `security` block — camunda/camunda#53708).
 * Under `allSecured` (config `authAbsentMode: 'all-secured'`) it instead targets
 * every operation whose effective `security` mandates authentication
 * (`OperationModel.secured`: every OR-alternative names a scheme — not
 * `security: []` nor an anonymous `{}` alternative) — for APIs uniformly
 * authenticated via one global scheme (e.g. Hub's `security: [{ bearerAuth: [] }]`).
 */
function isAuthTargeted(op: OperationModel, opts: Opts): boolean {
  if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) return false;
  return opts.allSecured ? op.secured === true : op.conditionalAuth === true;
}

/**
 * Generate auth-absent (HTTP 401) scenarios for the secured-server profile.
 *
 * Targets the {@link isAuthTargeted} operation set. Each scenario issues the
 * request WITHOUT any credentials (`headersAuth: false`) and asserts 401 — the
 * contract that a secured server rejects an unauthenticated request before any
 * body/parameter validation runs.
 *
 * Emptiness is a property of the SPEC, not the runtime server: operations that
 * are explicitly public (`security: []` or an anonymous `{}` alternative) or
 * carry no effective security requirement yield no scenario. When the spec
 * secures no operation (in the active mode), this generator emits nothing and
 * the `secured` profile is byte-identical to `unsecured`.
 */
export function generateAuthAbsent(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (!isAuthTargeted(op, opts)) continue;
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

/**
 * Generate auth-invalid (HTTP 401) scenarios for the secured-server profile.
 *
 * Targets the same operation set as {@link generateAuthAbsent}, but instead of
 * omitting credentials it sends an `Authorization` header carrying an
 * invalid/unknown credential (rendered by the emitter as a well-formed
 * `Bearer <garbage-token>`; `headersAuth: false` — it is NOT the admin token).
 * Where auth-absent proves an endpoint is protected
 * at all, auth-invalid exercises the *invalid/unknown credential* path: the
 * server must reject a present-but-bad Authorization header, not just a missing
 * one. The generator is not scheme-aware, so for Bearer/JWT-secured APIs this
 * specifically demonstrates token validation (a resource server that required an
 * Authorization header but skipped signature/audience checks would pass
 * auth-absent yet wrongly accept the garbage token); for other schemes
 * (Basic/apiKey/…) it is simply the invalid-credential path. Empirically every
 * Camunda Hub v2 op (Bearer/JWT) returns 401 for an invalid/unknown token.
 */
export function generateAuthInvalid(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (!isAuthTargeted(op, opts)) continue;
    out.push({
      id: makeId([op.operationId, 'auth-invalid']),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'auth-invalid',
      params: buildDummyParams(op.path),
      expectedStatus: 401,
      description:
        'Request with an invalid/unknown Authorization credential is rejected with 401 (secured mode)',
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
