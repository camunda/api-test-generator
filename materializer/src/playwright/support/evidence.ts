import type { TestInfo } from '@playwright/test';

/**
 * Structural subset of Playwright's `TestInfo` — only `attach()` is used
 * here, so that's all this accepts. Matches the same minimal-surface
 * principle as `ApiResponseLike` below: a test fake only needs to implement
 * `attach()`, not TestInfo's other ~30 members, and it can do so without an
 * `as unknown as TestInfo` cast.
 */
interface AttachableTestInfo {
  attach: TestInfo['attach'];
}

/**
 * Structural subset of Playwright's `APIResponse` — deliberately not
 * imported from '@playwright/test'. Role helpers (e.g.
 * support/deploymentGateway.ts's `deploy()`) return their own
 * independently-declared `ApiResponseLike` mirror rather than the real
 * `APIResponse` (to avoid a Playwright import there), and TypeScript would
 * reject passing that into a parameter nominally typed as the real
 * `APIResponse` — it's missing unrelated members (`securityDetails`,
 * `serverAddr`, `timing`) this helper never uses anyway. A real
 * `APIResponse` satisfies this structurally, so both call sites work.
 */
interface ApiResponseLike {
  status(): number;
  statusText(): string;
  text(): Promise<string>;
  headers(): Record<string, string>;
}

/**
 * Context captured for a failing assertion so the attached evidence is
 * self-explanatory. `headers` are the actual request headers sent (e.g.
 * `authHeaders()`'s `Authorization: Bearer <token>`) — never attached by
 * value (see `attachEvidenceOnFailure`'s redaction), only by name, so a
 * real credential can never end up in a Playwright report/artifact.
 */
export interface EvidenceContext {
  operationId: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus: number;
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

// Returns a `parsed` flag alongside the value — a bare `unknown | undefined`
// return couldn't distinguish "successfully parsed to the literal JSON value
// `null`" from "failed to parse", so a caller using `?? fallback` would wrongly
// discard a genuine `null` body and substitute the fallback instead.
function parseJsonBody(s: string): { parsed: boolean; value: unknown } {
  if (!s) return { parsed: false, value: undefined };
  try {
    return { parsed: true, value: JSON.parse(s) };
  } catch {
    return { parsed: false, value: undefined };
  }
}

/**
 * Attaches `request.json`/`response.json` to the Playwright report, but only
 * when the response contradicts what the test expected — a status mismatch,
 * or (via `shapeError`) a response-shape validation failure at the correct
 * status. Mirrors the artifact shape written by
 * request-validation/templates/support/http.ts's `assertResponseStatus` (so
 * a consumer can parse either suite's evidence the same way), trimmed to
 * what the positive suite actually has: no ProblemDetail shape checks here,
 * since those only apply to error responses, not this suite's 2xx-expecting
 * assertions.
 */
export async function attachEvidenceOnFailure(
  testInfo: AttachableTestInfo,
  res: ApiResponseLike,
  ctx: EvidenceContext,
  shapeError?: string,
): Promise<void> {
  const actual = res.status();
  const statusMismatch = actual !== ctx.expectedStatus;
  if (!statusMismatch && !shapeError) return;

  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    // Response body may already be consumed; attach whatever was captured.
  }

  // Attach header NAMES only, never values — `ctx.headers` carries the real
  // Authorization bearer token sent to the server, and this artifact is
  // embedded (base64) in the JSON reporter / HTML report, which can end up
  // in uploaded CI artifacts. The negative suite's own request.json omits
  // headers entirely for the same reason; naming (not valuing) them keeps
  // the "was auth even sent" debugging signal without the leak.
  const requestArtifact = JSON.stringify(
    {
      operationId: ctx.operationId,
      method: ctx.method,
      url: ctx.url,
      expectedStatus: ctx.expectedStatus,
      headerNames: ctx.headers ? Object.keys(ctx.headers) : undefined,
      body: ctx.body,
    },
    null,
    2,
  );
  // Cap attached body so that a single oversized error payload cannot bloat
  // test-results.json / the HTML report. The JSON reporter base64-encodes
  // attachments, so each KB here costs ~1.33 KB on disk.
  const cappedBodyText = capString(bodyText, MAX_ATTACHMENT_BODY_BYTES);
  const parsedBody = parseJsonBody(cappedBodyText.value);
  // Same redaction as the request side, and for the same reason: a gateway
  // response can carry a credential-bearing header (e.g. Set-Cookie), which
  // would otherwise be embedded by value in this artifact.
  const responseArtifact = JSON.stringify(
    {
      status: actual,
      statusText: res.statusText(),
      headerNames: Object.keys(res.headers()),
      body: parsedBody.parsed ? parsedBody.value : cappedBodyText.value,
      bodyTruncated: cappedBodyText.truncated || undefined,
      bodyOriginalBytes: cappedBodyText.truncated ? cappedBodyText.originalBytes : undefined,
      shapeError,
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
}
