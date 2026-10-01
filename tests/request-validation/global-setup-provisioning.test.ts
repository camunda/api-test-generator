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
 *      and cancels both process instances created before the timeout;
 *   4. instances are created from the deployment response's exact
 *      processDefinitionKey, not from a hardcoded process id — creating by
 *      id would resolve to whatever the LATEST deployed version of that id
 *      is at that moment, which could be a DIFFERENT (concurrent) run's
 *      deployment on a shared broker, decoupling the instance from the
 *      unique job type THIS run just patched into its own BPMN (#614's
 *      review discussion);
 *   5. a failure to persist the cleanup-state file is fatal, not best-effort
 *      — on an otherwise-successful run that file is the only thing
 *      global-teardown.ts has to act on, so a silent write failure would
 *      leak both instances with nothing left to retry against (#614's
 *      review discussion);
 *   6. a prior run's retained (still-outstanding) keys are merged into,
 *      not overwritten by, this run's own cleanup-state write (#614's
 *      review discussion).
 */

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn(),
      rm: vi.fn(),
    },
  };
});

const ENV_KEYS = [
  'RV_FIXTURE_PROCESS_INSTANCE_KEY',
  'RV_FIXTURE_USER_TASK_KEY',
  'RV_FIXTURE_JOB_KEY',
  'RV_FIXTURE_ELEMENT_INSTANCE_KEY',
] as const;

// `vi.restoreAllMocks()` does NOT undo a `.mockImplementation()` set during
// a test's body for a plain `vi.fn()` (confirmed directly: it leaks into
// later tests) — only `.mockReset()` does. Named references reset and
// re-seeded with their default behavior in `beforeEach`, rather than relying
// on `afterEach`'s restore, are what actually isolates tests that need a
// custom fs mock (e.g. the cleanup-state merge test below) from every other
// test in this file.
let readFileMock: ReturnType<typeof vi.fn>;
let writeFileMock: ReturnType<typeof vi.fn>;
let renameMock: ReturnType<typeof vi.fn>;
let rmMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  for (const k of ENV_KEYS) delete process.env[k];
  delete process.env.RV_FIXTURE_ENV_FILE;

  const fs = await import('node:fs');
  readFileMock = vi.mocked(fs.promises.readFile);
  writeFileMock = vi.mocked(fs.promises.writeFile);
  renameMock = vi.mocked(fs.promises.rename);
  rmMock = vi.mocked(fs.promises.rm);
  // BPMN fixture reads succeed by default; the cleanup-state merge-read
  // defaults to ENOENT (no state file yet — the realistic starting point
  // for almost every test here) rather than a blanket resolved value, since
  // recordCreatedInstancesForCleanup now rethrows any non-ENOENT read
  // failure instead of swallowing it (#614's review discussion) — a flat
  // `<bpmn/>` buffer for that path would fail its JSON.parse and incorrectly
  // trip that path in every test that doesn't care about this behavior.
  readFileMock.mockReset().mockImplementation(async (path) => {
    if (String(path).endsWith('.bpmn')) return Buffer.from('<bpmn/>');
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  writeFileMock.mockReset().mockResolvedValue(undefined);
  renameMock.mockReset().mockResolvedValue(undefined);
  rmMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
  delete process.env.RV_FIXTURE_ENV_FILE;
});

async function loadProvisionRuntimeKeyFixtures() {
  const mod = await import('../../request-validation/templates/support/global-setup.js');
  return mod.provisionRuntimeKeyFixtures;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A `POST /v2/deployments` response shape matching what deployFixtureProcesses
 *  actually reads: `deployments[].processDefinition.{resourceName,
 *  processDefinitionKey}`. Instances are created from these exact keys, not
 *  from the process id, so the mock must supply them. */
function deploymentResponse(): Response {
  return jsonResponse({
    deployments: [
      {
        processDefinition: { resourceName: 'user-task.bpmn', processDefinitionKey: 'PDK-USERTASK' },
      },
      {
        processDefinition: {
          resourceName: 'service-task.bpmn',
          processDefinitionKey: 'PDK-SERVICE',
        },
      },
    ],
  });
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
      if (url.endsWith('/v2/deployments')) return deploymentResponse();
      if (url.endsWith('/v2/process-instances')) {
        const body = parseRequestBody(init);
        const key = body.processDefinitionKey === 'PDK-USERTASK' ? 'PI-USERTASK' : 'PI-SERVICE';
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

  it('shell-quotes discovered values before writing them to RV_FIXTURE_ENV_FILE, rather than JSON-quoting them', async () => {
    // run-oca.sh later `source`s this file into bash. JSON.stringify only
    // escapes quotes/backslashes/control chars — it does nothing to `$`,
    // backticks, or `;`, so a broker-returned value containing a command
    // substitution would execute when sourced. Single-quoting it is immune
    // to shell expansion entirely (#614's review discussion). Includes an
    // embedded single quote too, to exercise the escape path, not just the
    // wrap.
    const maliciousJobKey = "it's $(touch /tmp/rv-fixture-test-pwned) `also-this`";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v2/deployments')) return deploymentResponse();
      if (url.endsWith('/v2/process-instances')) {
        const body = parseRequestBody(init);
        const key = body.processDefinitionKey === 'PDK-USERTASK' ? 'PI-USERTASK' : 'PI-SERVICE';
        return jsonResponse({ processInstanceKey: key });
      }
      if (url.endsWith('/v2/user-tasks/search')) {
        return jsonResponse({
          items: [{ userTaskKey: 'UT-1', elementInstanceKey: 'EI-USERTASK' }],
        });
      }
      if (url.endsWith('/v2/jobs/activation')) {
        return jsonResponse({ jobs: [{ jobKey: maliciousJobKey, elementInstanceKey: 'EI-JOB' }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env.RV_FIXTURE_ENV_FILE = '/fake/rv-fixtures.env';
    const fs = await import('node:fs');
    const writeFileMock = vi.mocked(fs.promises.writeFile);

    const provisionRuntimeKeyFixtures = await loadProvisionRuntimeKeyFixtures();
    await provisionRuntimeKeyFixtures();

    const envFileCall = writeFileMock.mock.calls.find(
      (call) => call[0] === '/fake/rv-fixtures.env',
    );
    expect(envFileCall).toBeDefined();
    const written = String(envFileCall?.[1]);
    expect(written).toContain(
      "export RV_FIXTURE_JOB_KEY='it'\\''s $(touch /tmp/rv-fixture-test-pwned) `also-this`'\n",
    );

    // Prove it end-to-end: actually source the generated line in a real
    // shell and confirm the command inside it never ran, and the variable
    // comes back out exactly as the literal string that went in.
    const { execFileSync } = await import('node:child_process');
    const roundTripped = execFileSync(
      'bash',
      ['-c', `${written}\nprintf '%s' "$RV_FIXTURE_JOB_KEY"`],
      { encoding: 'utf8' },
    );
    expect(roundTripped).toBe(maliciousJobKey);
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
      if (url.endsWith('/v2/deployments')) return deploymentResponse();
      if (url.endsWith('/v2/process-instances')) {
        const body = parseRequestBody(init);
        const key = body.processDefinitionKey === 'PDK-USERTASK' ? 'PI-USERTASK' : 'PI-SERVICE';
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

  it('creates instances from the exact deployed processDefinitionKey, not a hardcoded process id', async () => {
    const processInstanceBodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/v2/deployments')) return deploymentResponse();
        if (url.endsWith('/v2/process-instances')) {
          const body = parseRequestBody(init);
          processInstanceBodies.push(body);
          const key = body.processDefinitionKey === 'PDK-USERTASK' ? 'PI-USERTASK' : 'PI-SERVICE';
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
      }),
    );

    const provisionRuntimeKeyFixtures = await loadProvisionRuntimeKeyFixtures();
    await provisionRuntimeKeyFixtures();

    // Neither call should reference the process id at all — only the exact
    // key this run's own deployment response returned.
    for (const body of processInstanceBodies) {
      expect(body.processDefinitionId).toBeUndefined();
      expect(['PDK-USERTASK', 'PDK-SERVICE']).toContain(body.processDefinitionKey);
    }
    expect(processInstanceBodies.map((b) => b.processDefinitionKey).sort()).toEqual([
      'PDK-SERVICE',
      'PDK-USERTASK',
    ]);
  });

  it("merges a prior run's retained (still-outstanding) keys into the new cleanup-state write, rather than overwriting them", async () => {
    // Simulates teardown having retained 'PI-LEAKED-FROM-PRIOR-RUN' in the
    // state file after a cancellation that didn't succeed last run. This
    // run's own recordCreatedInstancesForCleanup write must not blow that
    // away the moment it records its own, unrelated keys (#614's review
    // discussion) — the two sets of keys have nothing to do with each
    // other, and only the merge preserves teardown's one remaining chance
    // to retry the leaked one.
    readFileMock.mockImplementation(async (path) => {
      if (String(path).endsWith('.bpmn')) return Buffer.from('<bpmn/>');
      if (String(path).endsWith('runtime-key-fixtures-cleanup.json')) {
        return JSON.stringify(['PI-LEAKED-FROM-PRIOR-RUN']);
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/v2/deployments')) return deploymentResponse();
        if (url.endsWith('/v2/process-instances')) {
          const body = parseRequestBody(init);
          const key = body.processDefinitionKey === 'PDK-USERTASK' ? 'PI-USERTASK' : 'PI-SERVICE';
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
      }),
    );

    const provisionRuntimeKeyFixtures = await loadProvisionRuntimeKeyFixtures();
    await provisionRuntimeKeyFixtures();

    const tmpCall = writeFileMock.mock.calls.find((call) =>
      String(call[0]).includes('runtime-key-fixtures-cleanup.json'),
    );
    expect(tmpCall).toBeDefined();
    const writtenKeys: unknown = JSON.parse(String(tmpCall?.[1]));
    expect(writtenKeys).toEqual(
      expect.arrayContaining(['PI-LEAKED-FROM-PRIOR-RUN', 'PI-USERTASK', 'PI-SERVICE']),
    );
  });

  it('throws and cancels both instances when the existing cleanup record exists but fails to read for a reason other than ENOENT, rather than silently overwriting it', async () => {
    // A non-ENOENT merge-read failure (EACCES, a transient I/O error, a
    // corrupted file) must NOT be treated as "nothing to merge" — doing so
    // would let the write below permanently overwrite whatever a prior
    // run's failed teardown had retained there (#614's review discussion).
    readFileMock.mockImplementation(async (path) => {
      if (String(path).endsWith('.bpmn')) return Buffer.from('<bpmn/>');
      if (String(path).endsWith('runtime-key-fixtures-cleanup.json')) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const cancelledInstanceKeys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/v2/deployments')) return deploymentResponse();
        if (url.endsWith('/v2/process-instances')) {
          const body = parseRequestBody(init);
          const key = body.processDefinitionKey === 'PDK-USERTASK' ? 'PI-USERTASK' : 'PI-SERVICE';
          return jsonResponse({ processInstanceKey: key });
        }
        const cancellationMatch = /\/v2\/process-instances\/([^/]+)\/cancellation$/.exec(url);
        if (cancellationMatch) {
          cancelledInstanceKeys.push(cancellationMatch[1]);
          return jsonResponse({});
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const provisionRuntimeKeyFixtures = await loadProvisionRuntimeKeyFixtures();
    await expect(provisionRuntimeKeyFixtures()).rejects.toThrow(/EACCES/);

    expect(cancelledInstanceKeys.sort()).toEqual(['PI-SERVICE', 'PI-USERTASK']);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('throws and cancels both instances when persisting the cleanup state fails, rather than continuing silently', async () => {
    const cancelledInstanceKeys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/v2/deployments')) return deploymentResponse();
        if (url.endsWith('/v2/process-instances')) {
          const body = parseRequestBody(init);
          const key = body.processDefinitionKey === 'PDK-USERTASK' ? 'PI-USERTASK' : 'PI-SERVICE';
          return jsonResponse({ processInstanceKey: key });
        }
        const cancellationMatch = /\/v2\/process-instances\/([^/]+)\/cancellation$/.exec(url);
        if (cancellationMatch) {
          cancelledInstanceKeys.push(cancellationMatch[1]);
          return jsonResponse({});
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const fs = await import('node:fs');
    vi.mocked(fs.promises.writeFile).mockRejectedValue(new Error('ENOSPC'));

    const provisionRuntimeKeyFixtures = await loadProvisionRuntimeKeyFixtures();
    await expect(provisionRuntimeKeyFixtures()).rejects.toThrow(/failed to persist cleanup state/);

    // A silently-swallowed write failure here would leave global-teardown.ts
    // with no state file to act on for an otherwise-successful run — the
    // only safety net left is cancelling immediately, in-process.
    expect(cancelledInstanceKeys.sort()).toEqual(['PI-SERVICE', 'PI-USERTASK']);
    expect(process.env.RV_FIXTURE_PROCESS_INSTANCE_KEY).toBeUndefined();
  });

  it('returns quietly without any broker calls when the BPMN fixtures are genuinely missing (ENOENT)', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provisionRuntimeKeyFixtures = await loadProvisionRuntimeKeyFixtures();
    await expect(provisionRuntimeKeyFixtures()).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.env.RV_FIXTURE_PROCESS_INSTANCE_KEY).toBeUndefined();
  });

  it('throws when the vendored BPMN fixture exists but fails to read for a reason other than ENOENT', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provisionRuntimeKeyFixtures = await loadProvisionRuntimeKeyFixtures();
    // Not swallowed like ENOENT: generate.ts already confirmed this config is
    // opted in, so a non-ENOENT read failure here means something is broken,
    // not "feature not applicable" — falling back to fillers would silently
    // regress to the 404-masking bug this PR fixes (#614's review discussion).
    await expect(provisionRuntimeKeyFixtures()).rejects.toThrow(/EACCES/);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.env.RV_FIXTURE_PROCESS_INSTANCE_KEY).toBeUndefined();
  });
});
