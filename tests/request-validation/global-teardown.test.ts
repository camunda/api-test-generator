import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for `global-teardown.ts` (#614's review) — cancels the
 * process instances `global-setup.ts`'s runtime-key provisioning created for
 * a SUCCESSFUL run, which otherwise left them (and the job under the
 * service-task one) running on the broker forever.
 *
 * Guards locked in here:
 *   1. reads the recorded process instance keys, cancels each one, and
 *      removes the state file afterward;
 *   2. is a true no-op (no fetch calls at all) when the state file doesn't
 *      exist — the `rbac` profile, or a config without these BPMN fixtures,
 *      never created anything for global-setup.ts to record;
 *   3. is a no-op when the state file records an empty array.
 */

let readFileMock: ReturnType<typeof vi.fn>;
let rmMock: ReturnType<typeof vi.fn>;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      rm: vi.fn(async () => undefined),
    },
  };
});

beforeEach(async () => {
  vi.resetModules();
  const fs = await import('node:fs');
  readFileMock = vi.mocked(fs.promises.readFile);
  rmMock = vi.mocked(fs.promises.rm);
  readFileMock.mockReset();
  rmMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadGlobalTeardown() {
  const mod = await import('../../request-validation/templates/support/global-teardown.js');
  return mod.default;
}

describe('globalTeardown', () => {
  it('cancels every recorded process instance and removes the state file', async () => {
    readFileMock.mockResolvedValue(JSON.stringify(['PI-USERTASK', 'PI-SERVICE']));
    const cancelledKeys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const match = /\/v2\/process-instances\/([^/]+)\/cancellation$/.exec(String(input));
        if (match) {
          cancelledKeys.push(match[1]);
          return new Response('{}', { status: 200 });
        }
        throw new Error(`unexpected fetch: ${String(input)}`);
      }),
    );

    const globalTeardown = await loadGlobalTeardown();
    await globalTeardown();

    expect(cancelledKeys.sort()).toEqual(['PI-SERVICE', 'PI-USERTASK']);
    expect(rmMock).toHaveBeenCalledTimes(1);
  });

  it('makes no fetch calls when the state file is missing', async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const globalTeardown = await loadGlobalTeardown();
    await globalTeardown();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
  });

  it('makes no fetch calls when the state file records an empty array', async () => {
    readFileMock.mockResolvedValue('[]');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const globalTeardown = await loadGlobalTeardown();
    await globalTeardown();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
