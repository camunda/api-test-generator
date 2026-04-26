/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH under
 * one or more contributor license agreements. See the NOTICE file distributed
 * with this work for additional information regarding copyright ownership.
 * Licensed under the Camunda License 1.0. You may not use this file
 * except in compliance with the Camunda License 1.0.
 */

// Vendored support file. Trimmed subset of the Camunda QA suite's utils/http
// module — exposes only the symbols the generated specs actually import:
// `jsonHeaders`, `buildUrl`, and `assertResponseStatus`. Auth/base-URL
// handling lives in `./env`.

import { type APIResponse, expect, type TestInfo } from '@playwright/test';
import { credentials } from './env';

export { jsonHeaders, authHeaders, credentials } from './env';

const API_VERSION = 'v2';

/**
 * Build a fully-qualified URL for an OpenAPI path template.
 *
 * - `pathTemplate` may include `{paramName}` placeholders.
 * - Missing path params are substituted with `__MISSING_PARAM__` so the
 *   server returns the expected validation error rather than a routing 404.
 */
export function buildUrl(
  pathTemplate: string,
  params?: Record<string, string | number | undefined>,
  query?: Record<string, string | number | undefined>,
): string {
  const base = credentials.baseUrl;
  let url = `${base}/${API_VERSION}${pathTemplate}`.replace(/\{(\w+)}/g, (_, k) => {
    const v = params?.[k];
    return v == null ? '__MISSING_PARAM__' : String(v);
  });
  if (query) {
    const q = Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (q) url += (url.includes('?') ? '&' : '?') + q;
  }
  return url;
}

/** Context captured for every assertion so failures are self-explanatory. */
export interface RequestContext {
  /** Operation identifier from the OpenAPI spec (e.g. `assignClientToTenant`). */
  operationId: string;
  /** Validation scenario kind (e.g. `param-constraint-violation`). */
  scenarioKind: string;
  /** HTTP method, upper-case. */
  method: string;
  /** Fully-qualified request URL after path/query substitution. */
  url: string;
  /** JSON body if any; for multipart, pass the field map under `multipart`. */
  body?: unknown;
  /** Multipart form fields if `bodyEncoding === 'multipart'`. */
  multipart?: Record<string, string>;
}

/**
 * Assert the server responded with the expected status. On mismatch:
 *
 *   1. Attach `request.json` and `response.json` artifacts to the Playwright
 *      report so `npx playwright show-report` (and the JSON reporter) carry
 *      the full request/response payloads.
 *   2. Throw an `expect` failure whose message includes the method, URL,
 *      expected vs. actual status, and a truncated response body — so the
 *      `list` reporter inline output is immediately diagnostic.
 *
 * Pass tests do not produce attachments, keeping the report size bounded.
 */
export async function assertResponseStatus(
  testInfo: TestInfo,
  res: APIResponse,
  expected: number,
  ctx: RequestContext,
): Promise<void> {
  const actual = res.status();
  if (actual === expected) return;

  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    // Response body may already be consumed; the status mismatch is still actionable.
  }

  const requestArtifact = JSON.stringify(
    {
      operationId: ctx.operationId,
      scenarioKind: ctx.scenarioKind,
      method: ctx.method,
      url: ctx.url,
      expectedStatus: expected,
      body: ctx.body,
      multipart: ctx.multipart,
    },
    null,
    2,
  );
  const responseArtifact = JSON.stringify(
    {
      status: actual,
      statusText: res.statusText(),
      headers: res.headers(),
      body: tryParseJson(bodyText) ?? bodyText,
    },
    null,
    2,
  );
  await testInfo.attach('request.json', {
    body: requestArtifact,
    contentType: 'application/json',
  });
  await testInfo.attach('response.json', {
    body: responseArtifact,
    contentType: 'application/json',
  });

  const summary =
    `${ctx.method} ${ctx.url}\n` +
    `  operationId:     ${ctx.operationId}\n` +
    `  scenarioKind:    ${ctx.scenarioKind}\n` +
    `  expected status: ${expected}\n` +
    `  actual status:   ${actual} ${res.statusText()}\n` +
    `  request body:    ${formatRequestPayload(ctx)}\n` +
    `  response body:   ${truncate(bodyText, 500)}`;
  expect(actual, summary).toBe(expected);
}

function formatRequestPayload(ctx: RequestContext): string {
  if (ctx.multipart) {
    const fields = Object.keys(ctx.multipart);
    if (fields.length === 0) return '(multipart, no fields)';
    return `(multipart) ${truncate(JSON.stringify(ctx.multipart), 500)}`;
  }
  if (ctx.body === undefined) return '(none)';
  // `null` is a legitimate JSON body and should be shown as-is.
  let serialized: string;
  try {
    serialized = JSON.stringify(ctx.body);
  } catch {
    serialized = String(ctx.body);
  }
  return truncate(serialized, 500);
}

function tryParseJson(s: string): unknown | undefined {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function truncate(s: string, n: number): string {
  if (!s) return '(empty)';
  return s.length > n ? `${s.slice(0, n)}… (${s.length - n} more bytes)` : s;
}
