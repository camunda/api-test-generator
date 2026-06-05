import type { OperationModel, ValidationScenario } from '../model/types.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
}

/**
 * Generate auth-deny (HTTP 403) scenarios for the `rbac` profile.
 *
 * Read-side RBAC deny-tests (#359): for a get-by-key read endpoint, issue the
 * request AS A FRESHLY-PROVISIONED NON-ADMIN USER WITH ZERO GRANTS (rendered as
 * `denyProbeHeaders()` by the emitter, NOT the admin `authHeaders()`), and expect
 * an authorizations-enabled server to deny it. The probe user and the target
 * resources are created by the suite global-setup; the key references a
 * KNOWN-EXISTING resource so the response is a genuine authorization deny (admin
 * would see it at 200) rather than a 404-not-found that any caller would get.
 *
 * "Generic" = we assert the endpoint is permission-gated without naming the
 * exact permission. Precise per-permission deny/allow pairs are a follow-up
 * (#374); search/list endpoints use a different (200 + empty items) oracle and
 * are out of scope (#375).
 */

// Allowlist of get-by-key reads to deny-test (#373: the client-minted tier).
// Each maps the operation's path token to a fixed id that global-setup
// provisions (as admin) so the resource exists — making the probe's failure an
// authorization decision, not a 404-not-found. The ids here MUST match the
// fixtures created in templates/support/global-setup.ts.
//
// Server-minted-key resources (Authorization, Document) and deploy/runtime
// resources (process/decision definitions, instances, …) are deliberately
// excluded here — they need, respectively, a setup→test key handoff and the
// positive suite's deploy/execution machinery (tracked as follow-ups).
const SLICE: Record<string, Record<string, string>> = {
  // GET /users/{username} — the always-present admin user (no fixture needed).
  getUser: { username: 'demo' },
  getTenant: { tenantId: 'rbac-probe-tenant' },
  getGroup: { groupId: 'rbac-probe-group' },
  getRole: { roleId: 'rbac-probe-role' },
  getMappingRule: { mappingRuleId: 'rbac-probe-mapping' },
  getGlobalClusterVariable: { name: 'rbac-probe-clustervar' },
  // getGlobalTaskListener deferred: its create body (`type`, `eventTypes`) isn't
  // confirmed; add once the fixture create is verified.
};

// An unauthorized get-by-key on an existing resource is forbidden with 403 — the
// observed behaviour across the current OCA resources (admin sees the resource
// at 200; the zero-grant probe gets 403). We assert 403 strictly. (Camunda could
// also "hide" a resource with 404, but that hasn't been observed here and a 404
// would be ambiguous with a missing endpoint on an older server — see #380.)
const DENY_STATUS = 403;

export function generateAuthDeny(ops: OperationModel[], opts: Opts): ValidationScenario[] {
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
