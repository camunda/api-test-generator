/**
 * `useRoot: true` builds against the bare API root (`API_ROOT_URL`, no
 * version segment) instead of the default `/v2` base — for operations whose
 * OpenAPI path item overrides `servers` (see `RequestStep.serverOverride`),
 * e.g. the Orchestration Cluster REST API's cluster-admin operations,
 * served at `{host}:{port}/cluster/v2/...` outside the document's `/v2`
 * base.
 *
 * When `API_ROOT_URL` isn't set, fall back to `API_BASE_URL` with a
 * trailing `/v2` stripped rather than a hardcoded default — a setup that
 * only sets `API_BASE_URL` against a non-default host (the pre-existing
 * contract) would otherwise silently route cluster-admin requests to
 * `localhost` instead.
 */
export function buildBaseUrl(useRoot = false): string {
  if (useRoot) {
    return (
      process.env.API_ROOT_URL ||
      process.env.API_BASE_URL?.replace(/\/v2\/?$/, '') ||
      'http://localhost:8080'
    );
  }
  return process.env.API_BASE_URL || 'http://localhost:8080/v2';
}

export async function authHeaders(): Promise<Record<string, string>> {
  // Do not set Content-Type here; request options (data vs multipart) will determine it.
  const bearer = process.env.BEARER_TOKEN;
  if (bearer) return { Authorization: `Bearer ${bearer}` };
  return {};
}
