/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH under
 * one or more contributor license agreements. See the NOTICE file distributed
 * with this work for additional information regarding copyright ownership.
 * Licensed under the Camunda License 1.0. You may not use this file
 * except in compliance with the Camunda License 1.0.
 */

// Vendored support file. Trimmed subset of the Camunda QA suite's utils/http
// module — exposes the symbols the generated specs import: `buildUrl`,
// `assertResponseStatus`, and the header/credential helpers re-exported from
// `./env` (`jsonHeaders`, `authHeaders`, `basicAuthHeaders`, `denyProbeHeaders`,
// `denyProbeCredentials`). Auth/base-URL handling lives in `./env`.

import { type APIResponse, expect, type TestInfo } from '@playwright/test';
import { credentials } from './env';

export {
  jsonHeaders,
  authHeaders,
  basicAuthHeaders,
  denyProbeHeaders,
  denyProbeCredentials,
  credentials,
} from './env';

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
 * Every error response in this API (every 4xx/5xx, both configs) is DECLARED
 * in the OpenAPI spec as a `ProblemDetail` per RFC 9457, served as
 * `application/problem+json` — a single, uniform shape reused across all
 * operations, so there is nothing per-endpoint to look up. Required fields
 * per the spec's shared `ProblemDetail` schema. (Real runtime behavior can
 * still deviate from this contract — that deviation is exactly what this
 * check is for.)
 */
const PROBLEM_DETAIL_STRING_FIELDS = ['type', 'title', 'detail', 'instance'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Check `body` against the `ProblemDetail` shape. Returns an empty array when
 * valid, otherwise one human-readable message per violation.
 */
function validateProblemDetailShape(
  body: unknown,
  expectedStatus: number,
  parseError: string | undefined,
): string[] {
  if (parseError) return [`response body is not valid JSON: ${parseError}`];
  if (body === undefined) return ['response body is empty; expected a ProblemDetail object'];
  if (!isRecord(body)) {
    return [`response body is not a JSON object (got ${Array.isArray(body) ? 'array' : typeof body})`];
  }
  const errors: string[] = [];
  for (const field of PROBLEM_DETAIL_STRING_FIELDS) {
    if (typeof body[field] !== 'string') {
      errors.push(`ProblemDetail.${field} missing or not a string (got ${JSON.stringify(body[field])})`);
    }
  }
  if (typeof body.status !== 'number') {
    errors.push(`ProblemDetail.status missing or not a number (got ${JSON.stringify(body.status)})`);
  } else if (body.status !== expectedStatus) {
    errors.push(`ProblemDetail.status (${body.status}) does not match the HTTP status (${expectedStatus})`);
  }
  return errors;
}

/**
 * Assert the server responded with the expected status AND, when it did, that
 * the error body conforms to the API's `ProblemDetail` shape (RFC 9457). On
 * either mismatch:
 *
 *   1. Attach `request.json` and `response.json` artifacts to the Playwright
 *      report so `npx playwright show-report` (and the JSON reporter) carry
 *      the full request/response payloads.
 *   2. Throw an `expect` failure whose message includes the method, URL,
 *      expected vs. actual status (and any shape violations), plus a
 *      truncated response body — so the `list` reporter inline output is
 *      immediately diagnostic.
 *
 * Pass tests do not produce attachments, keeping the report size bounded.
 */
export async function assertResponseStatus(
  testInfo: TestInfo,
  res: APIResponse,
  expected: number,
  ctx: RequestContext,
  opts?: {
    /**
     * Skip the ProblemDetail shape check for this call, keeping the status
     * assertion. Set only for scenario kinds with a known, systemic,
     * upstream-tracked shape gap (see `knownProblemDetailShapeGaps` in the
     * request-validation config) — never to silence a one-off failure.
     */
    skipProblemDetailShape?: boolean;
  },
): Promise<void> {
  const actual = res.status();

  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    // Response body may already be consumed; the checks below still run
    // against whatever was captured (an empty body fails shape validation).
  }

  const statusMismatch = actual !== expected;
  // Only judge the body's shape when: the status itself is right (a wrong
  // status already fails the test on its own, and its body may not even be
  // an error response — e.g. a 200 body when a 4xx was expected), the caller
  // hasn't opted this scenario out (see `opts.skipProblemDetailShape`), and
  // `expected` is itself an error status — `ProblemDetail` is only the
  // declared shape for 4xx/5xx, so a 2xx-expecting caller (none exist today,
  // but nothing statically prevents one) must never be shape-checked against
  // it. Parsing is deferred into this branch so a status-mismatch or an
  // opted-out scenario never pays for a JSON.parse whose result would be
  // discarded anyway.
  const shouldCheckShape = !statusMismatch && expected >= 400 && !opts?.skipProblemDetailShape;
  let shapeErrors: string[] = [];
  if (shouldCheckShape) {
    let bodyJson: unknown;
    let parseError: string | undefined;
    if (bodyText) {
      try {
        bodyJson = JSON.parse(bodyText);
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e);
      }
    }
    shapeErrors = validateProblemDetailShape(bodyJson, expected, parseError);
  }

  if (!statusMismatch && shapeErrors.length === 0) return;

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
  // Cap attached body so that a single oversized error payload (e.g. an HTML
  // error page) cannot bloat `test-results.json` / the HTML report. The JSON
  // reporter base64-encodes attachments, so each KB here costs ~1.33 KB on
  // disk.
  const cappedBodyText = capString(bodyText, MAX_ATTACHMENT_BODY_BYTES);
  const responseArtifact = JSON.stringify(
    {
      status: actual,
      statusText: res.statusText(),
      headers: res.headers(),
      body: tryParseJson(cappedBodyText.value) ?? cappedBodyText.value,
      bodyTruncated: cappedBodyText.truncated || undefined,
      bodyOriginalBytes: cappedBodyText.truncated ? cappedBodyText.originalBytes : undefined,
      problemDetailShapeErrors: shapeErrors.length > 0 ? shapeErrors : undefined,
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
    (shapeErrors.length > 0
      ? `  ProblemDetail shape violations:\n${shapeErrors.map((e) => `    - ${e}`).join('\n')}\n`
      : '') +
    `  request body:    ${formatRequestPayload(ctx)}\n` +
    `  response body:   ${truncate(bodyText, 500)}`;

  if (statusMismatch) {
    expect(actual, summary).toBe(expected);
  } else {
    expect(shapeErrors, summary).toEqual([]);
  }
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

/**
 * Maximum number of bytes (UTF-8) of response body to embed in attachments.
 * Keeps `test-results.json` and `playwright-report/` bounded even when the
 * server returns large payloads (e.g. HTML error pages, verbose stack traces).
 */
const MAX_ATTACHMENT_BODY_BYTES = 64 * 1024;

function capString(
  s: string,
  maxBytes: number,
): { value: string; truncated: boolean; originalBytes: number } {
  if (!s) return { value: s, truncated: false, originalBytes: 0 };
  const originalBytes = Buffer.byteLength(s, 'utf8');
  if (originalBytes <= maxBytes) return { value: s, truncated: false, originalBytes };
  // Slice on byte boundary, then trim any partial UTF-8 sequence.
  const buf = Buffer.from(s, 'utf8').subarray(0, maxBytes);
  return { value: buf.toString('utf8'), truncated: true, originalBytes };
}
