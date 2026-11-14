import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EndpointScenario, RequestStep } from 'path-analyser/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkLoweringContract } from './lowering-contract.ts';

// Unit-level regression for the lowering-contract check itself (#812 review):
// witness path reads (`waitsAfter[].pathParams`) must be validated against the
// bindings available when the poll runs — seeds, earlier extracts, AND the
// current step's own extracts — but never a later step's extract.

function step(over: Partial<RequestStep> & Pick<RequestStep, 'operationId'>): RequestStep {
  return { method: 'GET', pathTemplate: '/x', expect: { status: 200 }, ...over };
}

function scenario(requestPlan: RequestStep[]): EndpointScenario {
  return {
    id: 's1',
    operations: [],
    producedSemanticTypes: [],
    satisfiedSemanticTypes: [],
    requestPlan,
  };
}

describe('lowering contract: witness path bindings', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lowering-contract-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function check(scenarios: EndpointScenario[]) {
    writeFileSync(join(dir, 'scenarios.json'), JSON.stringify({ scenarios }));
    return checkLoweringContract([dir], []);
  }

  it('reports a witness path binding nothing sets', () => {
    const result = check([
      scenario([
        step({
          operationId: 'createWidget',
          method: 'POST',
          pathTemplate: '/widgets',
          eventualWaitsAfter: [
            {
              state: 'available',
              witness: {
                operationId: 'getWidget',
                method: 'GET',
                pathTemplate: '/widgets/{id}',
                predicate: { path: 'state', equals: 'ok' },
              },
            },
          ],
        }),
      ]),
    ]);
    expect(result.unboundReads).toEqual([
      'scenarios.json s1 step0 createWidget witness getWidget reads idVar',
    ]);
  });

  it('accepts a witness path binding supplied by the current step’s own extract', () => {
    const result = check([
      scenario([
        step({
          operationId: 'createWidget',
          method: 'POST',
          pathTemplate: '/widgets',
          extract: [{ fieldPath: 'widgetKey', bind: 'idVar' }],
          eventualWaitsAfter: [
            {
              state: 'available',
              witness: {
                operationId: 'getWidget',
                method: 'GET',
                pathTemplate: '/widgets/{id}',
                predicate: { path: 'state', equals: 'ok' },
              },
            },
          ],
        }),
      ]),
    ]);
    expect(result.unboundReads).toEqual([]);
  });

  it('rejects a witness path binding first extracted by a later step', () => {
    const result = check([
      scenario([
        step({
          operationId: 'createWidget',
          method: 'POST',
          pathTemplate: '/widgets',
          eventualWaitsAfter: [
            {
              state: 'available',
              witness: {
                operationId: 'getWidget',
                method: 'GET',
                pathTemplate: '/widgets/{id}',
                predicate: { path: 'state', equals: 'ok' },
              },
            },
          ],
        }),
        step({
          operationId: 'getOther',
          pathTemplate: '/other',
          extract: [{ fieldPath: 'id', bind: 'idVar' }],
        }),
      ]),
    ]);
    expect(result.unboundReads).toEqual([
      'scenarios.json s1 step0 createWidget witness getWidget reads idVar',
    ]);
  });
});
