import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { renderPythonSuite } from '../../materializer/src/python-sdk/emitter.js';
import { loadPythonProjectScaffoldingFiles } from '../../materializer/src/python-sdk/materialize-support.js';
import type { EndpointScenarioCollection, RequestStep } from '../../path-analyser/src/types.ts';

function collectionOf(
  steps: RequestStep[],
  eventuallyConsistent: string[] = [],
): EndpointScenarioCollection {
  const last = steps[steps.length - 1];
  const ref = { operationId: last.operationId, method: last.method, path: last.pathTemplate };
  return {
    endpoint: ref,
    requiredSemanticTypes: [],
    optionalSemanticTypes: [],
    scenarios: [
      {
        id: 'feature-1',
        name: 'live broker fixes',
        operations: steps.map((s) => ({
          operationId: s.operationId,
          method: s.method,
          path: s.pathTemplate,
          eventuallyConsistent: eventuallyConsistent.includes(s.operationId),
        })),
        producedSemanticTypes: [],
        satisfiedSemanticTypes: [],
        requestPlan: steps,
      },
    ],
  };
}

describe('python-sdk emitter: live-broker fixes', () => {
  test('status assertions carry the response body so broker errors are visible', () => {
    const out = renderPythonSuite(
      collectionOf([
        {
          operationId: 'getTopology',
          method: 'GET',
          pathTemplate: '/topology',
          expect: { status: 200 },
        },
      ]),
    );
    expect(out).toContain('assert response_1.status_code == 200, response_1.text');
  });

  test('document uploads with no planned files send a placeholder file (empty files -> 415)', () => {
    for (const [operationId, field] of [
      ['createDocument', 'file'],
      ['createDocuments', 'files'],
    ] as const) {
      const out = renderPythonSuite(
        collectionOf([
          {
            operationId,
            method: 'POST',
            pathTemplate: '/documents',
            bodyKind: 'multipart',
            multipartTemplate: { fields: {}, files: {} },
            expect: { status: 201 },
          },
        ]),
      );
      expect(out).toContain(`files_1 = {'${field}': ('hello.txt', b'Hello, world!')}`);
    }
  });

  test('eventually-consistent search steps poll; only extracting steps require items', () => {
    const out = renderPythonSuite(
      collectionOf(
        [
          {
            operationId: 'searchIncidents',
            method: 'POST',
            pathTemplate: '/incidents/search',
            bodyKind: 'json',
            bodyTemplate: {},
            extract: [{ fieldPath: 'items[0].incidentKey', bind: 'incidentKeyVar' }],
            expect: { status: 200 },
          },
          {
            operationId: 'searchJobs',
            method: 'POST',
            pathTemplate: '/jobs/search',
            bodyKind: 'json',
            bodyTemplate: {},
            expect: { status: 200 },
          },
        ],
        ['searchIncidents', 'searchJobs'],
      ),
    );
    expect(out).toContain('from support.await_eventually import await_eventually');
    expect(out).toContain('response_1 = await await_eventually(');
    expect(out).toContain("operation_id='searchIncidents',");
    const step2 = out.slice(out.indexOf('# Step 2'));
    expect(step2).toContain('require_items=False,');
    expect(out.slice(0, out.indexOf('# Step 2'))).not.toContain('require_items=False');
  });
});

describe('python await_eventually: 429 backoff', () => {
  test('honours Retry-After (capped at 2s) and falls back to 2x poll interval', () => {
    const helper = loadPythonProjectScaffoldingFiles().find(
      (f) => f.relativePath === 'support/await_eventually.py',
    );
    if (helper === undefined) throw new Error('support/await_eventually.py is not emitted');
    const dir = mkdtempSync(join(tmpdir(), 'await-eval-'));
    try {
      mkdirSync(join(dir, 'support'));
      writeFileSync(join(dir, 'support', '__init__.py'), '');
      writeFileSync(join(dir, 'support', 'await_eventually.py'), helper.content, 'utf8');
      const script = `
import asyncio, json, sys, types
sys.modules['httpx'] = types.ModuleType('httpx')
import support.await_eventually as m
class Resp:
    def __init__(self, status_code, headers=None):
        self.status_code = status_code
        self.headers = headers or {}
        self.text = ''
    def json(self): return {}
sleeps = []
async def fake_sleep(s): sleeps.append(round(s, 3))
m.asyncio.sleep = fake_sleep
async def run(headers):
    sleeps.clear()
    seq = [Resp(429, headers), Resp(200)]
    async def fetch(): return seq.pop(0)
    await m.await_eventually(fetch, operation_id='x', method='GET', poll_interval_ms=500)
    return list(sleeps)
out = [asyncio.run(run(h)) for h in ({'retry-after': '1'}, {'retry-after': '99'}, {}, {'retry-after': 'bad'}, {'retry-after': '1000'})]
print(json.dumps(out))
`;
      const out = execFileSync('python3', ['-B', '-c', script], { encoding: 'utf8', cwd: dir });
      expect(JSON.parse(out.trim())).toEqual([[1], [2], [1], [1], [1]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('python await_eventually: retry, abort and timeout branches', () => {
  test('retries GET 404 and empty search pages; returns hard failures; times out', () => {
    const helper = loadPythonProjectScaffoldingFiles().find(
      (f) => f.relativePath === 'support/await_eventually.py',
    );
    if (helper === undefined) throw new Error('support/await_eventually.py is not emitted');
    const dir = mkdtempSync(join(tmpdir(), 'await-eval-'));
    try {
      mkdirSync(join(dir, 'support'));
      writeFileSync(join(dir, 'support', '__init__.py'), '');
      writeFileSync(join(dir, 'support', 'await_eventually.py'), helper.content, 'utf8');
      const script = `
import asyncio, json, sys, types
sys.modules['httpx'] = types.ModuleType('httpx')
import support.await_eventually as m
class Resp:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self.headers = {}
        self.text = ''
        self._body = body if body is not None else {}
    def json(self): return self._body
async def fake_sleep(s): pass
m.asyncio.sleep = fake_sleep
async def run(method, seq, **kw):
    calls = []
    async def fetch():
        calls.append(1)
        return seq.pop(0) if len(seq) > 1 else seq[0]
    try:
        r = await m.await_eventually(fetch, operation_id='x', method=method, **kw)
        return [r.status_code, len(calls)]
    except AssertionError:
        return ['timeout', len(calls)]
empty = {'items': []}
full = {'items': [1]}
async def main():
    return [
        await run('GET', [Resp(404), Resp(404), Resp(200)]),
        await run('POST', [Resp(200, empty), Resp(200, empty), Resp(200, full)]),
        await run('POST', [Resp(200, empty), Resp(200, empty)], require_items=False),
        await run('POST', [Resp(404), Resp(200)]),
        await run('GET', [Resp(400), Resp(200)]),
        await run('GET', [Resp(503), Resp(200)]),
        await run('GET', [Resp(404)], wait_up_to_ms=0),
        await run('POST', [Resp(200, empty)], wait_up_to_ms=0),
    ]
print(json.dumps(asyncio.run(main())))
`;
      const out = execFileSync('python3', ['-B', '-c', script], { encoding: 'utf8', cwd: dir });
      expect(JSON.parse(out.trim())).toEqual([
        [200, 3],
        [200, 3],
        [200, 1],
        [404, 1],
        [400, 1],
        [503, 1],
        ['timeout', 1],
        ['timeout', 1],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
