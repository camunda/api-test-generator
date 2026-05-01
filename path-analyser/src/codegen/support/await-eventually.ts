// Eventual-consistency polling helper for emitted Playwright suites.
//
// Wraps a `() => Promise<APIResponse>` with retry semantics ported from the
// JS SDK's `eventualPoll` (orchestration-cluster-api-js/src/runtime/eventual.ts):
//
//   * retry on 404 within budget (GET reads racing indexer lag)
//   * retry on 429 with `Retry-After` honoured + jittered backoff (cap 2s)
//   * fail fast on 4xx (400, 401, 403, 409, 422) and 5xx
//   * for non-GET reads (POST /search), default predicate is
//     `body.items.length > 0` so an empty result page keeps polling
//   * on budget exhaustion, throw `EventualConsistencyTimeoutError`
//     carrying attempts, elapsedMs, lastStatus and (truncated) lastBody
//
// This file is vendored verbatim into every generated Playwright suite
// under `<outDir>/support/await-eventually.ts`. Keep it dependency-free
// (no SDK imports, no npm packages) — the only types it touches are
// Playwright's `APIResponse` (a structural subset is declared locally).

export interface AwaitEventuallyOptions {
  /** Total wait budget in ms. 0 disables polling (single attempt). */
  waitUpToMs?: number;
  /** Poll interval in ms (default 500, floor 10). */
  pollIntervalMs?: number;
  /**
   * Predicate over the parsed JSON body. Return `true` when the response
   * is observably consistent. If omitted, the default for non-GET reads
   * is `Array.isArray(body.items) && body.items.length > 0`; for GET the
   * default is `() => true` (any 200 is acceptable). The body type is
   * `unknown` — narrow it inside your predicate.
   */
  predicate?: (body: unknown) => boolean | Promise<boolean>;
  /** HTTP method of the operation. Drives the 404-retry-on-GET branch. */
  method: string;
  /** Operation id for error messages and tracing. */
  operationId: string;
}

export interface EventualConsistencyTimeoutInfo {
  operationId: string;
  attempts: number;
  elapsedMs: number;
  lastStatus?: number;
  /** Truncated to 1000 chars to keep test output readable. */
  lastBody?: string;
}

export class EventualConsistencyTimeoutError extends Error {
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly lastStatus?: number;
  readonly lastBody?: string;
  readonly operationId: string;

  constructor(info: EventualConsistencyTimeoutInfo) {
    super(
      `Eventual consistency timeout for operation '${info.operationId}' after ${info.attempts} attempt(s) in ${info.elapsedMs}ms (lastStatus=${info.lastStatus ?? 'n/a'})`,
    );
    this.name = 'EventualConsistencyTimeoutError';
    this.operationId = info.operationId;
    this.attempts = info.attempts;
    this.elapsedMs = info.elapsedMs;
    this.lastStatus = info.lastStatus;
    this.lastBody = info.lastBody;
  }
}

/** Structural subset of Playwright's `APIResponse` — avoids a Playwright import. */
interface ApiResponseLike {
  status(): number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  headers(): Record<string, string>;
}

const ABORT_IMMEDIATE_STATUSES = new Set([400, 401, 403, 409, 422]);
const DEFAULT_WAIT_MS = 10_000;
const DEFAULT_POLL_MS = 500;
const MAX_RETRY_AFTER_MS = 2_000;
const POLL_FLOOR_MS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(s: string, max = 1000): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function parseRetryAfterMs(headerValue: string | undefined): number | undefined {
  if (!headerValue) return undefined;
  const n = Number.parseInt(headerValue, 10);
  if (Number.isNaN(n)) return undefined;
  // RFC 7231: integer = seconds. Treat values >=1000 as already in ms
  // (mirrors JS SDK's eventual.ts heuristic for service-emitted ms hints).
  return n < 1000 ? n * 1000 : n;
}

/**
 * Default consistency predicate for POST .../search operations: a non-null
 * object with a non-empty `items` array. An empty page is the canonical
 * "indexer hasn't caught up yet" signal in the Camunda REST API.
 */
function isNonEmptyItemsPage(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const items: unknown = Reflect.get(body, 'items');
  return Array.isArray(items) && items.length > 0;
}

/**
 * Invoke `fetch` repeatedly until the response is observably consistent or
 * the budget is exhausted. Returns the final `APIResponse` so callers can
 * still call `.status()`, `.text()`, `.json()` on it (Playwright responses
 * are buffered, so re-reading the body is safe).
 *
 * On budget exhaustion this throws `EventualConsistencyTimeoutError`.
 * On a hard-fail status (400/401/403/409/422/5xx) it returns the response
 * immediately so the caller's existing `expect(resp.status()).toBe(...)`
 * assertion produces a useful diff rather than a cryptic thrown error.
 */
export async function awaitEventually<R extends ApiResponseLike>(
  fetch: () => Promise<R>,
  options: AwaitEventuallyOptions,
): Promise<R> {
  const waitUpToMs = options.waitUpToMs ?? DEFAULT_WAIT_MS;
  const pollIntervalMs = Math.max(POLL_FLOOR_MS, options.pollIntervalMs ?? DEFAULT_POLL_MS);
  const isGet = options.method.toUpperCase() === 'GET';
  const predicate = options.predicate;

  if (waitUpToMs <= 0) return fetch();

  const started = Date.now();
  let attempts = 0;
  let lastBody: string | undefined;

  while (true) {
    attempts++;
    const resp = await fetch();
    const status = resp.status();
    const elapsed = Date.now() - started;
    const remaining = waitUpToMs - elapsed;

    // Hard-fail statuses: return immediately so the caller's status
    // assertion produces a clean diff.
    if (ABORT_IMMEDIATE_STATUSES.has(status) || status >= 500) {
      return resp;
    }

    // 404 on GET — the typical "indexer hasn't caught up yet" signal.
    if (status === 404 && isGet) {
      if (remaining <= 0) {
        try {
          lastBody = truncate(await resp.text());
        } catch {
          /* body already consumed or unavailable */
        }
        throw new EventualConsistencyTimeoutError({
          operationId: options.operationId,
          attempts,
          elapsedMs: elapsed,
          lastStatus: status,
          lastBody,
        });
      }
      await sleep(Math.min(pollIntervalMs, remaining));
      continue;
    }

    // 429 — honour Retry-After (jittered) within budget.
    if (status === 429) {
      if (remaining <= 0) {
        try {
          lastBody = truncate(await resp.text());
        } catch {
          /* ignore */
        }
        throw new EventualConsistencyTimeoutError({
          operationId: options.operationId,
          attempts,
          elapsedMs: elapsed,
          lastStatus: status,
          lastBody,
        });
      }
      const headers = resp.headers();
      const ra = parseRetryAfterMs(headers['retry-after'] ?? headers['Retry-After']);
      let delay = ra ?? pollIntervalMs * 2;
      delay = Math.min(delay, MAX_RETRY_AFTER_MS, remaining);
      const jitter = 0.9 + Math.random() * 0.2;
      delay = Math.floor(delay * jitter);
      await sleep(Math.max(POLL_FLOOR_MS, delay));
      continue;
    }

    // 200 (or any 2xx/3xx) — evaluate predicate.
    if (status >= 200 && status < 400) {
      let body: unknown;
      try {
        body = await resp.json();
      } catch {
        // Non-JSON 200 — accept (e.g. text/xml endpoints like /process-definitions/{key}/xml).
        return resp;
      }
      let ok: boolean;
      if (predicate) {
        ok = await predicate(body);
      } else if (!isGet) {
        // POST /search default: empty page == not yet consistent.
        ok = isNonEmptyItemsPage(body);
      } else {
        ok = true;
      }
      if (ok) return resp;
      try {
        lastBody = truncate(JSON.stringify(body));
      } catch {
        /* unserialisable body */
      }
      if (remaining <= 0) {
        throw new EventualConsistencyTimeoutError({
          operationId: options.operationId,
          attempts,
          elapsedMs: elapsed,
          lastStatus: status,
          lastBody,
        });
      }
      await sleep(Math.min(pollIntervalMs, remaining));
      continue;
    }

    // Any other status (e.g. unexpected 3xx not redirected by the client)
    // — return so the caller's status assertion handles it.
    return resp;
  }
}
