# JavaScript SDK Integration Gap Analysis

## Summary

The generated Playwright integration tests in `path-analyser/dist/generated-tests/` currently
make **raw HTTP calls** via Playwright's `APIRequestContext` (`request.get/post/put/delete`).
They do **not** use the official `@camunda8/sdk` JavaScript/TypeScript SDK. This document
identifies the concrete integration gap and the work needed to close it.

---

## Current State

### How tests are generated

The emitter at `path-analyser/src/codegen/playwright/emitter.ts` produces `.spec.ts` files
that:

- Import `@playwright/test` only (no `@camunda8/sdk`).
- Call `request.post(url, { headers: await authHeaders(), data: body })` directly.
- Store response context in `ctx: Record<string, unknown>` (untyped).
- Extract values from responses with `extractInto(ctx, 'someKeyVar', response, 'path.to.field')`.

### Authentication

`path-analyser/src/codegen/support/env.ts`:

```ts
export async function authHeaders(): Promise<Record<string, string>> {
  // Local server requires empty headers (no Authorization)
  return {};
}
```

This stub works only when Camunda runs with authentication disabled — as configured in
`docker/docker-compose.yml`:

```yaml
CAMUNDA_SECURITY_AUTHENTICATION_UNPROTECTEDAPI: 'true'
CAMUNDA_SECURITY_AUTHORIZATIONS_ENABLED: 'false'
```

For any **real** (cloud or authenticated on-prem) Camunda deployment, this returns `401`.

### Generated test package

`path-analyser/templates/package.json` — the suite's standalone package — has no
`@camunda8/sdk` dependency:

```json
"dependencies": { "assert-json-body": "^1.7.1" },
"devDependencies": { "@playwright/test": "^1.54.2", "typescript": "^5.5.4" }
```

---

## The SDK Gap

### What `@camunda8/sdk` provides

The official Camunda 8 Node.js/TypeScript SDK (`@camunda8/sdk`) already exposes:

1. **`getOrchestrationClusterApiClient()`** — strongly-typed client derived from the same
   OpenAPI spec, using branded types (`ProcessInstanceKey`, `ProcessDefinitionId`, etc.)
   matching the `x-semantic-type` annotations the generator already understands.
2. **`getOrchestrationClusterApiClientLoose()`** — same API surface but accepts plain strings
   (progressive adoption mode).
3. **Built-in OAuth2 / client-credentials auth** — configurable via environment variables
   (`ZEEBE_CLIENT_ID`, `ZEEBE_CLIENT_SECRET`, `CAMUNDA_OAUTH_URL`, etc.).

### What the gap is

| Concern | Current | With SDK |
|---|---|---|
| Auth | Empty headers, unauthenticated Camunda only | OAuth2/Client-credentials built-in |
| Type safety | `ctx: Record<string, unknown>` | Branded types (`ProcessInstanceKey`, etc.) |
| API call style | Raw `request.post(url, body)` | `client.createProcessInstance({ ... })` |
| Env config | Just `API_BASE_URL` | Standard SDK env vars |
| Portability | Local unauth only | Cloud + SaaS + self-managed |

---

## Integration Points (Files to Change)

### 1. `path-analyser/src/codegen/support/env.ts`

The primary integration point. Currently returns `{}` for auth headers. Options:

**Option A — OAuth2 token via SDK credentials (minimal, backward-compatible):**

```ts
import { OAuthProvider } from '@camunda8/sdk/oauth';

let cachedToken: string | undefined;

export async function authHeaders(): Promise<Record<string, string>> {
  if (process.env.CAMUNDA_CLIENT_ID && process.env.CAMUNDA_CLIENT_SECRET) {
    if (!cachedToken) {
      const oauth = new OAuthProvider({
        audience: process.env.CAMUNDA_TOKEN_AUDIENCE ?? 'zeebe.camunda.io',
        clientId: process.env.CAMUNDA_CLIENT_ID,
        clientSecret: process.env.CAMUNDA_CLIENT_SECRET,
        authServerUrl: process.env.CAMUNDA_OAUTH_URL ?? 'https://login.cloud.camunda.io/oauth/token',
      });
      cachedToken = (await oauth.getToken()).access_token;
    }
    return { Authorization: `Bearer ${cachedToken}` };
  }
  return {}; // unauthenticated local mode — backward-compatible
}
```

This keeps the current empty-headers path for local unauth testing (matching `docker-compose.yml`)
while enabling cloud/SaaS when env vars are set. No generated test code changes needed.

**Option B — Use SDK typed client instead of raw HTTP (larger scope):**

Replace `request.post(url, body)` calls with SDK client calls. Requires emitter changes to
generate SDK calls instead of raw HTTP. Gains full type safety but is a larger refactor.

### 2. `path-analyser/templates/package.json`

Add `@camunda8/sdk` as a dependency when Option A or B is implemented:

```json
"dependencies": {
  "@camunda8/sdk": "^8.9.0",
  "assert-json-body": "^1.7.1"
}
```

### 3. `docker/docker-compose.yml`

No change needed for Option A local mode. For CI against an authenticated instance, add
env vars for `CAMUNDA_CLIENT_ID`, `CAMUNDA_CLIENT_SECRET`, `CAMUNDA_OAUTH_URL`.

---

## Recommended Approach (Phased)

### Phase 1 — Auth bridge (Option A, low risk)

Scope: `env.ts` only. Adds conditional OAuth2 auth via SDK credential env vars.
- Tests continue to pass locally (auth disabled) without any change.
- Tests can now run against authenticated SaaS/self-managed when env vars are set.
- No changes to emitter, generated test files, or planner.

**Acceptance criteria:**
- `npm test` passes unchanged.
- Running with `CAMUNDA_CLIENT_ID=x CAMUNDA_CLIENT_SECRET=y` env vars obtains a token and sets `Authorization: Bearer <token>` header.
- Local docker-compose mode (no env vars) continues to work with empty headers.

### Phase 2 — Typed context extraction

Scope: `seeding.ts` + emitter. Replace `ctx: Record<string, unknown>` with typed extractors
using the `x-semantic-type` branded type information already present in the dependency graph.

### Phase 3 — SDK-typed API calls (Option B)

Scope: emitter generates SDK client calls (`client.activateJobs(...)`) instead of raw HTTP.
Requires emitter and registry changes. Unlocks compile-time validation of request shapes.

---

## Current Test Run Status

As of this analysis:

- **Regression/unit tests:** 178/178 pass (`npm test`) ✓
- **Request-validation suite:** 36 spec files, 1008 scenarios generated ✓  
- **Playwright integration tests:** Verified passing against Camunda 8.9.1 local (unauthenticated)
  - `activateJobs.feature.spec.ts` — 3/3 pass ✓
  - Full 241-spec run — in progress

---

## Environment Setup for Running Tests

### Local (unauthenticated)

```bash
# Start Camunda 8.9
c8ctl cluster start

# Run tests (API_BASE_URL defaults to http://localhost:8080/v2)
cd path-analyser/dist/generated-tests
npm install
npx playwright test
```

### Cloud/SaaS (OAuth2 — requires Phase 1 auth bridge)

```bash
export CAMUNDA_CLIENT_ID=<your-client-id>
export CAMUNDA_CLIENT_SECRET=<your-client-secret>
export CAMUNDA_OAUTH_URL=https://login.cloud.camunda.io/oauth/token
export API_BASE_URL=https://<cluster>.zeebe.camunda.io/v2

cd path-analyser/dist/generated-tests
npm install
npx playwright test
```
