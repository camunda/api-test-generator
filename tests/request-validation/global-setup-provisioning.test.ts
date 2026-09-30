import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for `provisionRuntimeKeyFixtures` (#614's review) — the
 * runtime-key provisioning (deploy → create process instances → discover
 * userTaskKey/jobKey/elementInstanceKey) that fixes the request-validation
 * 404-masking bug for userTaskKey/jobKey/elementInstanceKey/processInstanceKey
 * path params. Mocks `fetch` and all of `node:fs`'s `promises` used by
 * global-setup.ts — `readFile` (since `readFixture` now only tries the
 * vendored `<suite>/fixtures/` sibling directory, which doesn't exist for a
 * plain import of the template file), plus `writeFile`/`rm` (the cleanup-state
 * bookkeeping) so a test never touches the real filesystem. That last part
 * also sidesteps a real hang: with `vi.useFakeTimers()` active, a genuine
 * disk write's completion signal can depend on a macrotask
 * (`setImmediate`-like) fake timers intercept, so real fs I/O under fake
 * timers isn't just undesirable here, it can stall a test for its full
 * `testTimeout` instead of resolving.
 *
 * Guards locked in here:
 *   1. the happy path sets all four RV_FIXTURE_* env vars from the mocked
 *      responses, preferring the user task's elementInstanceKey;
 *   2. a deployment failure throws (fails loudly, per #614's review — see
 *      global-setup.ts's doc comment on provisionRuntimeKeyFixtures);
 *   3. a discovery timeout (user task never appears) throws, not swallowed,
 *      and cancels both process instances created before the timeout.
 */

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(async () => Buffer.from('<bpmn/>')),
      writeFile: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
    },
  };
});

const ENV_KEYS = [
  'RV_FIXTURE_PROCESS_INSTANCE_KEY',
  'RV_FIXTURE_USER_TASK_KEY',
  'RV_FIXTURE_JOB_KEY',
  'RV_FIXTURE_ELEMENT_INSTANCE_KEY',
] as const;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

async function loadProvisionRuntimeKeyFixtures() {
  const mod = await import('../../request-validation/templates/support/global-setup.js');
  return mod.provisionRuntimeKeyFixtures;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Extracts the JSON-parsed request body from a fetch RequestInit, however
 *  the request body arrives (a plain string is what global-setup.ts sends). */
function parseRequestBody(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  const parsed: unknown = JSON.parse(typeof body === 'string' ? body : '{}');
  return isPlainObject(parsed) ? parsed : {};
}

describe('provisionRuntimeKeyFixtures', () => {
  it('sets all four RV_FIXTURE_* env vars on the happy path', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v2/deployments')) return jsonResponse({});
      if (url.endsWith('/v2/process-instances')) {
        const body = parseRequestBody(init);
        const key = body.processDefinitionId === 'Process_user_task' ? 'PI-USERTASK' : 'PI-SERVICE';
        return jsonResponse({ processInstanceKey: key });
      }
      if (url.endsWith('/v2/user-tasks/search')) {
        return jsonResponse({
          items: [{ userTaskKey: 'UT-1', elementInstanceKey: 'EI-USERTASK' }],
        });
      }
      if (url.endsWith('/v2/jobs/activation')) {
        return jsonResponse({ jobs: [{ jobKey: 'JOB-1', elementInstanceKey: 'EI-JOB' }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provisionRuntimeKeyFixtures = await loadProvisionRuntimeKeyFixtures();
    await provisionRuntimeKeyFixtures();

    expect(process.env.RV_FIXTURE_PROCESS_INSTANCE_KEY).toBe('PI-USERTASK');
    expect(process.env.RV_FIXTURE_USER_TASK_KEY).toBe('UT-1');
    expect(process.env.RV_FIXTURE_JOB_KEY).toBe('JOB-1');
    // Prefers the user task's elementInstanceKey over the job's.
    expect(process.env.RV_FIXTURE_ELEMENT_INSTANCE_KEY).toBe('EI-USERTASK');
  });

  it('throws when the BPMN deployment fails, rather than falling back to fillers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/v2/deployments'))
          return new Response('broker unavailable', { status: 500 });
        throw new Error(`unexpected fetch beyond deployment: ${url}`);
      }),
    );

    const provisionRuntimeKeyFixtures = await loadProvisionRuntimeKeyFixtures();
    await expect(provisionRuntimeKeyFixtures()).rejects.toThrow(/deployment failed/);
    expect(process.env.RV_FIXTURE_PROCESS_INSTANCE_KEY).toBeUndefined();
  });

  it('throws when no user task appears within the discovery deadline, rather than falling back to fillers, and cancels both created instances', async () => {
    const cancelledInstanceKeys: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v2/deployments')) return jsonResponse({});
      if (url.endsWith('/v2/process-instances')) {
        const body = parseRequestBody(init);
        const key = body.processDefinitionId === 'Process_user_task' ? 'PI-USERTASK' : 'PI-SERVICE';
        return jsonResponse({ processInstanceKey: key });
      }
      // The user task never appears — this is the timeout case under test.
      if (url.endsWith('/v2/user-tasks/search')) return jsonResponse({ items: [] });
      if (url.endsWith('/v2/jobs/activation')) {
        return jsonResponse({ jobs: [{ jobKey: 'JOB-1', elementInstanceKey: 'EI-JOB' }] });
      }
      const cancellationMatch = /\/v2\/process-instances\/([^/]+)\/cancellation$/.exec(url);
      if (cancellationMatch) {
        cancelledInstanceKeys.push(cancellationMatch[1]);
        return jsonResponse({});
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provisionRuntimeKeyFixtures = await loadProvisionRuntimeKeyFixtures();
    const result = provisionRuntimeKeyFixtures();
    const assertion = expect(result).rejects.toThrow(/user task did not appear/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(process.env.RV_FIXTURE_USER_TASK_KEY).toBeUndefined();
    // Both process instances created before the discovery failure must be
    // cancelled — a failed setup shouldn't leak them into the broker for
    // later runs to trip over (#614's review discussion).
    expect(cancelledInstanceKeys.sort()).toEqual(['PI-SERVICE', 'PI-USERTASK']);
  });
});
