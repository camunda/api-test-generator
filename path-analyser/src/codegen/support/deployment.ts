// Runtime helper for createDeployment multipart calls.
//
// Encapsulates the full deployment lifecycle in a single call:
//   - resolve @@FILE: paths via resolveFixture()
//   - build the multipart body, stripping tenantId when the default sentinel is active
//   - POST /deployments with auth headers
//   - throw a descriptive Error on any non-200 response
//   - extract all known deployment response fields into ctx
//   - return the APIResponse so callers can optionally call validateResponse()
//
// This file is vendored verbatim into every generated Playwright suite under
// <outDir>/support/deployment.ts by materializeSupport(). Keep it free of npm
// package imports — only the co-vendored ./env, ./fixtures, and ./seeding
// helpers are permitted.

import { authHeaders } from './env.js';
import { resolveFixture } from './fixtures.js';
import { extractInto } from './seeding.js';

/**
 * Structural mirror of Playwright's APIResponse — avoids a Playwright import while
 * remaining assignable to assert-json-body's PlaywrightAPIResponse parameter.
 */
interface ApiResponseLike {
  body(): Promise<Buffer>;
  dispose(): Promise<void>;
  headers(): Record<string, string>;
  headersArray(): Array<{ name: string; value: string }>;
  // biome-ignore lint/suspicious/noExplicitAny: mirrors Playwright's actual json() return type
  json(): Promise<any>;
  ok(): boolean;
  status(): number;
  statusText(): string;
  text(): Promise<string>;
  url(): string;
  [Symbol.asyncDispose](): Promise<void>;
}

/** Structural subset of Playwright's APIRequestContext — avoids a Playwright import. */
interface ApiRequestContextLike {
  post(
    url: string,
    options?: {
      headers?: Record<string, string>;
      multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
    },
  ): Promise<ApiResponseLike>;
}

/** Multipart body template accepted by deploy(). */
export interface DeployBody {
  fields?: Record<string, unknown>;
  files?: Record<string, string>;
}

/**
 * Perform a createDeployment call and extract all known response fields into ctx.
 *
 * - Resolves `@@FILE:<path>` entries in `body.files` via resolveFixture().
 * - Strips the `tenantId` field when `ctx['tenantIdVar'] === '<default>'` so
 *   single-tenant deployments work without an explicit tenantId param.
 * - Throws a descriptive Error on any non-200 response (includes the response body
 *   for diagnosis).
 * - Extracts all known deployment response fields into ctx; extractInto() is a
 *   no-op for fields absent from the response, so pre-seeded ctx bindings are
 *   preserved.
 * - Returns the APIResponse so callers can optionally call validateResponse().
 */
export async function deploy(
  ctx: Record<string, unknown>,
  request: ApiRequestContextLike,
  body: DeployBody,
  baseUrl: string,
): Promise<ApiResponseLike> {
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {};

  for (const [k, v] of Object.entries(body.fields ?? {})) {
    if (k === 'tenantId' && ctx.tenantIdVar === '<default>') continue;
    if (v !== undefined && v !== null) multipart[k] = String(v);
  }

  for (const [k, v] of Object.entries(body.files ?? {})) {
    if (typeof v === 'string' && v.startsWith('@@FILE:')) {
      const p = v.slice('@@FILE:'.length);
      const buf = await resolveFixture(p);
      const name = p.split('/').pop() ?? 'file';
      multipart[k] = { name, mimeType: 'application/octet-stream', buffer: buf };
    } else {
      multipart[k] = String(v);
    }
  }

  const resp = await request.post(`${baseUrl}/deployments`, {
    headers: await authHeaders(),
    multipart,
  });

  if (resp.status() !== 200) {
    const text = await resp.text().catch(() => '(unreadable)');
    throw new Error(`[createDeployment] expected HTTP 200, got ${resp.status()}: ${text}`);
  }

  const json = await resp.json();

  // Extract all known deployment response fields. extractInto() skips
  // undefined values, so fields absent from this response shape leave any
  // pre-seeded ctx binding untouched.
  extractInto(
    ctx,
    'processDefinitionIdVar',
    json?.deployments?.[0]?.processDefinition?.processDefinitionId,
  );
  extractInto(
    ctx,
    'processDefinitionKeyVar',
    json?.deployments?.[0]?.processDefinition?.processDefinitionKey,
  );
  extractInto(ctx, 'formKeyVar', json?.deployments?.[0]?.form?.formKey);
  extractInto(ctx, 'deploymentKeyVar', json?.deploymentKey);
  extractInto(ctx, 'tenantIdVar', json?.tenantId);
  extractInto(
    ctx,
    'decisionDefinitionIdVar',
    json?.deployments?.[0]?.decisionDefinition?.decisionDefinitionId,
  );
  extractInto(
    ctx,
    'decisionDefinitionKeyVar',
    json?.deployments?.[0]?.decisionDefinition?.decisionDefinitionKey,
  );
  extractInto(
    ctx,
    'decisionRequirementsIdVar',
    json?.deployments?.[0]?.decisionDefinition?.decisionRequirementsId,
  );
  extractInto(
    ctx,
    'decisionRequirementsKeyVar',
    json?.deployments?.[0]?.decisionDefinition?.decisionRequirementsKey,
  );
  extractInto(ctx, 'formIdVar', json?.deployments?.[0]?.form?.formId);

  return resp;
}
