import { describe, expect, it } from 'vitest';

/**
 * Regression coverage for assertResponseStatus's ProblemDetail shape check
 * (request-validation/templates/support/http.ts). This is the vendored
 * runtime helper every generated negative test calls — a break here silently
 * defeats shape validation across the whole suite, so behavior + error
 * messages are pinned here directly rather than only via a live-Hub run.
 */

async function loadAssertResponseStatus() {
  const mod = await import('../../request-validation/templates/support/http.js');
  return mod.assertResponseStatus;
}

// Minimal fakes — assertResponseStatus only calls status()/statusText()/
// text()/headers() on the response and attach() on testInfo. A full
// structural implementation of Playwright's APIResponse/TestInfo interfaces
// would be excessive for a test-only stand-in that only ever exercises these
// four/one methods.
function fakeResponse(status: number, bodyText: string) {
  // biome-ignore lint/plugin: minimal test fake for Playwright's APIResponse; only the methods assertResponseStatus actually calls are implemented.
  return {
    status: () => status,
    statusText: () => 'STATUS_TEXT',
    text: async () => bodyText,
    headers: () => ({}),
  } as unknown as import('@playwright/test').APIResponse;
}

function fakeTestInfo() {
  // biome-ignore lint/plugin: minimal test fake for Playwright's TestInfo; only attach() (which assertResponseStatus calls) is implemented.
  return { attach: async () => {} } as unknown as import('@playwright/test').TestInfo;
}

const ctx = { operationId: 'op', scenarioKind: 'kind', method: 'POST', url: 'http://x/y' };

const VALID_PROBLEM_DETAIL_400 = JSON.stringify({
  type: 'about:blank',
  title: 'Bad Request',
  status: 400,
  detail: 'name must not be blank',
  instance: '/api/v2/files',
});

describe('assertResponseStatus — ProblemDetail shape check', () => {
  it('passes silently on a well-formed ProblemDetail with a matching status', async () => {
    const assertResponseStatus = await loadAssertResponseStatus();
    await expect(
      assertResponseStatus(fakeTestInfo(), fakeResponse(400, VALID_PROBLEM_DETAIL_400), 400, ctx),
    ).resolves.toBeUndefined();
  });

  // Playwright's expect(value, message) custom message only renders inside a
  // live Playwright test() context (verified separately against the actual
  // generated suite on a real Hub run — the summary text does appear there);
  // called bare here, it falls back to the plain Jest-style diff. So these
  // two status-mismatch cases assert only that it still throws, not on
  // message content.
  it('still fails on a status mismatch, unaffected by shape validation', async () => {
    const assertResponseStatus = await loadAssertResponseStatus();
    await expect(
      assertResponseStatus(fakeTestInfo(), fakeResponse(500, VALID_PROBLEM_DETAIL_400), 400, ctx),
    ).rejects.toThrow();
  });

  it('fails when a required ProblemDetail field is missing', async () => {
    const assertResponseStatus = await loadAssertResponseStatus();
    const body = JSON.stringify({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      instance: '/x',
    });
    await expect(
      assertResponseStatus(fakeTestInfo(), fakeResponse(400, body), 400, ctx),
    ).rejects.toThrow(/ProblemDetail\.detail missing or not a string/);
  });

  it('fails when the body is not JSON at all', async () => {
    const assertResponseStatus = await loadAssertResponseStatus();
    await expect(
      assertResponseStatus(
        fakeTestInfo(),
        fakeResponse(400, '<html>Internal Server Error</html>'),
        400,
        ctx,
      ),
    ).rejects.toThrow(/response body is not valid JSON/);
  });

  it('fails when the body is empty', async () => {
    const assertResponseStatus = await loadAssertResponseStatus();
    await expect(
      assertResponseStatus(fakeTestInfo(), fakeResponse(400, ''), 400, ctx),
    ).rejects.toThrow(/response body is empty/);
  });

  it('fails when the body is a JSON array, not an object', async () => {
    const assertResponseStatus = await loadAssertResponseStatus();
    await expect(
      assertResponseStatus(fakeTestInfo(), fakeResponse(400, JSON.stringify([1, 2, 3])), 400, ctx),
    ).rejects.toThrow(/not a JSON object \(got array\)/);
  });

  it("fails when the body's embedded status disagrees with the actual HTTP status", async () => {
    const assertResponseStatus = await loadAssertResponseStatus();
    const body = JSON.stringify({
      type: 'about:blank',
      title: 'x',
      status: 404,
      detail: 'd',
      instance: '/x',
    });
    await expect(
      assertResponseStatus(fakeTestInfo(), fakeResponse(400, body), 400, ctx),
    ).rejects.toThrow(/ProblemDetail\.status \(404\) does not match the HTTP status \(400\)/);
  });

  it('skips the shape check when skipProblemDetailShape is set, keeping the status check', async () => {
    const assertResponseStatus = await loadAssertResponseStatus();
    // Empty body would normally fail shape validation — opting out must pass.
    await expect(
      assertResponseStatus(fakeTestInfo(), fakeResponse(400, ''), 400, ctx, {
        skipProblemDetailShape: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('still fails on a status mismatch even when skipProblemDetailShape is set', async () => {
    const assertResponseStatus = await loadAssertResponseStatus();
    await expect(
      assertResponseStatus(fakeTestInfo(), fakeResponse(500, ''), 400, ctx, {
        skipProblemDetailShape: true,
      }),
    ).rejects.toThrow();
  });

  it('never shape-checks a non-error expected status (e.g. 2xx)', async () => {
    const assertResponseStatus = await loadAssertResponseStatus();
    // No generated scenario expects a 2xx today, but the helper itself must
    // not apply the ProblemDetail contract outside 4xx/5xx even if one did.
    await expect(
      assertResponseStatus(fakeTestInfo(), fakeResponse(200, 'not json at all'), 200, ctx),
    ).resolves.toBeUndefined();
  });
});
