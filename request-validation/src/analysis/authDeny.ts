import type { OperationModel, ValidationScenario } from '../model/types.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
  /**
   * When `true` (config `authDenyMode: 'all-secured'`), target every operation
   * whose effective `security` mandates auth (`OperationModel.secured`) with
   * dummy path keys, instead of the hardcoded read-side {@link SLICE}. The deny
   * probe is a reduced-permission Bearer token (the emitter still renders
   * `denyProbeHeaders()`, which switches to Bearer when
   * `RBAC_DENY_PROBE_BEARER_TOKEN` is set — see the support `env.ts`), and no
   * fixtures are provisioned. For an API whose authority check short-circuits
   * before any resource lookup (e.g. Camunda Hub), a principal lacking the
   * operation's permission is denied with 403 regardless of the (dummy) key.
   * Default `false` preserves the OCA read-side slice behaviour.
   */
  allSecured?: boolean;
}

/**
 * Generate auth-deny (HTTP 403) scenarios for the `rbac` profile.
 *
 * Two modes, selected by {@link Opts.allSecured}:
 *
 * - **slice** (default, OCA) — read-side RBAC deny-tests: for a get-by-key read
 *   endpoint in {@link SLICE}, issue the request AS A FRESHLY-PROVISIONED
 *   NON-ADMIN USER WITH ZERO GRANTS (rendered as `denyProbeHeaders()`, NOT the
 *   admin `authHeaders()`), and expect an authorizations-enabled server to deny
 *   it. The probe user and the target resources are created by the suite
 *   global-setup; the key references a KNOWN-EXISTING resource so the response is
 *   a genuine authorization deny (admin would see it at 200) rather than a
 *   404-not-found that any caller would get.
 *
 * - **all-secured** (Hub) — one deny-test per `secured` operation with dummy path
 *   keys, authenticated as a reduced-permission Bearer probe token. Relies on the
 *   target authorizing before any resource lookup, so a dummy key still yields a
 *   clean 403 with no fixtures. See {@link generateAuthDenyAllSecured}.
 *
 * "Generic" = we assert the endpoint is permission-gated without naming the
 * exact permission. Precise per-permission deny/allow pairs, and search/list
 * endpoints (which use a 200 + empty-items oracle), are tracked as separate
 * follow-ups.
 */

// Allowlist of get-by-key reads to deny-test — the client-minted tier.
// Each maps the operation's path token to a fixed id that global-setup
// provisions (as admin) so the resource exists — making the probe's failure an
// authorization decision, not a 404-not-found. The ids here MUST match the
// fixtures created in templates/support/global-setup.ts.
//
// Server-minted-key resources (Authorization, Document) and deploy/runtime
// resources (process/decision definitions, instances, …) are deliberately
// excluded here — they need, respectively, a setup→test key handoff and the
// positive suite's deploy/execution machinery (tracked as separate follow-ups).
const SLICE: Record<string, Record<string, string>> = {
  // GET /users/{username} — the always-present admin user (no fixture needed).
  getUser: { username: 'demo' },
  getTenant: { tenantId: 'rbac-probe-tenant' },
  getGroup: { groupId: 'rbac-probe-group' },
  getRole: { roleId: 'rbac-probe-role' },
  getMappingRule: { mappingRuleId: 'rbac-probe-mapping' },
  getGlobalClusterVariable: { name: 'rbac-probe-clustervar' },
  getGlobalTaskListener: { id: 'rbac-probe-gtl' },
};

// An unauthorized get-by-key on an existing resource is forbidden with 403 — the
// observed behaviour across the current OCA resources (admin sees the resource
// at 200; the zero-grant probe gets 403). We assert 403 strictly. (Camunda could
// also "hide" a resource with 404, but that hasn't been observed here and a 404
// would be ambiguous with a missing endpoint on an older server.)
const DENY_STATUS = 403;

export function generateAuthDeny(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  if (opts.allSecured) return generateAuthDenyAllSecured(ops, opts);
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    const knownKeys = SLICE[op.operationId];
    if (!knownKeys) continue;
    out.push({
      id: makeId([op.operationId, 'auth-deny']),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'auth-deny',
      params: knownKeys,
      expectedStatus: DENY_STATUS,
      description: 'Request as a non-admin user with no grants is denied (authorizations enabled)',
      // Not admin auth — the emitter renders denyProbeHeaders() for auth-deny.
      headersAuth: false,
    });
  }
  return out;
}

/**
 * `all-secured` deny generator (Hub): one 403 scenario per keyless, no-required-body
 * `secured` operation. The reduced-permission Bearer probe lacks the operation's
 * required authority.
 *
 * Hub's check order is body-validation (400) → resource-existence (404) →
 * authority (@PreAuthorize, 403). Two op categories are therefore excluded to
 * guarantee a clean 403:
 *
 * - **By-key ops** (path contains `{param}`) — the resource lookup fires before
 *   `@PreAuthorize`, so a dummy key yields 404 even with a valid deny token.
 * - **Required-body ops** (`bodyRequired: true`) — `@RequestBody` deserialization
 *   and bean-validation run before `@PreAuthorize`, so an absent/empty body
 *   yields 400.
 *
 * The surviving surface is keyless + optional-or-no-body ops (search/list/info
 * endpoints). `security: []` / anonymous `{}` operations are excluded (they
 * carry no auth requirement and would not 403).
 */
function generateAuthDenyAllSecured(ops: OperationModel[], opts: Opts): ValidationScenario[] {
  const out: ValidationScenario[] = [];
  for (const op of ops) {
    if (opts.onlyOperations && !opts.onlyOperations.has(op.operationId)) continue;
    if (op.secured !== true) continue;
    if (op.path.includes('{')) continue; // by-key ops → 404 before authz
    if (op.bodyRequired === true) continue; // required body → 400 before authz
    out.push({
      id: makeId([op.operationId, 'auth-deny']),
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      type: 'auth-deny',
      params: undefined,
      expectedStatus: DENY_STATUS,
      description:
        'Request by a principal lacking the required permission is denied with 403 (rbac mode)',
      // Not admin auth — the emitter renders denyProbeHeaders(), which uses the
      // reduced-permission Bearer probe token in this mode.
      headersAuth: false,
    });
  }
  return out;
}
