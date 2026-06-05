import type { OperationModel, ValidationScenario } from '../model/types.js';
import { makeId } from './common.js';

interface Opts {
  onlyOperations?: Set<string>;
}

/**
 * Generate auth-deny (HTTP 403) scenarios for the `rbac` profile.
 *
 * Read-side RBAC deny-tests (#359, generic vertical slice): for a get-by-key
 * read endpoint, issue the request AS A FRESHLY-PROVISIONED NON-ADMIN USER WITH
 * ZERO GRANTS (rendered as `denyProbeHeaders()` by the emitter, NOT the admin
 * `authHeaders()`), and expect an authorizations-enabled server to deny it. The
 * probe user is created by the suite global-setup; the target key references a
 * known-existing resource so the response is a genuine authorization deny rather
 * than a 404-not-found.
 *
 * "Generic" = we assert the endpoint is permission-gated without naming the
 * exact permission. Precise per-permission deny/allow pairs are a follow-up
 * (#374); broadening beyond the slice allowlist is #373; search/list endpoints
 * use a different (200 + empty items) oracle and are out of scope here (#375).
 */

// Vertical-slice allowlist (#359). Maps each get-by-key operation's path token(s)
// to a known-existing resource key, so the deny is an authorization decision and
// not a 404-not-found. Broadening to all get-by-key reads is tracked in #373.
const SLICE: Record<string, Record<string, string>> = {
  // GET /users/{username} — fetch the always-present admin user as the probe.
  getUser: { username: 'demo' },
};

// An unauthorized get-by-key may be answered with 403 (forbidden) or, if the
// resource is filtered to "not visible", 404. Both are legitimate deny signals;
// the exact value is pinned by live verification. Default 403.
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
