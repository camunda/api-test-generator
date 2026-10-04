import { describe, expect, test } from 'vitest';
import { renderPythonSuite } from '../../materializer/src/python-sdk/emitter.js';
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
