// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the planner's body templates use literal `${binding}` placeholder strings; these tests feed them in.
import type { EndpointScenario, RequestStep } from 'path-analyser/types';
import { describe, expect, it } from 'vitest';
import {
  fieldPathSegments,
  lowerPathParams,
  lowerScenario,
  lowerValue,
  planCtxSeeding,
} from '../../emitter-sdk/src/lowering.ts';

// The language-neutral lowering every emitter renders (#812). These pin the
// decisions SDK adapters rely on instead of re-deriving them.

function step(over: Partial<RequestStep> & Pick<RequestStep, 'operationId'>): RequestStep {
  return { method: 'GET', pathTemplate: '/x', expect: { status: 200 }, ...over };
}

function scenario(over: Partial<EndpointScenario>): EndpointScenario {
  return {
    id: 's1',
    operations: [],
    producedSemanticTypes: [],
    satisfiedSemanticTypes: [],
    ...over,
  };
}

const TENANT = { binding: 'tenantIdVar', seedRule: 'tenantId', omitWhenUnbound: true };
const CLUSTER = { binding: 'clusterVar', seedRule: 'cluster' };

describe('lowering: path parameters', () => {
  it('names the binding for each placeholder `<camelCase(name)>Var`, in template order', () => {
    expect(lowerPathParams('/a/{ProcessKey}/b/{userId}')).toEqual([
      { name: 'ProcessKey', binding: 'processKeyVar' },
      { name: 'userId', binding: 'userIdVar' },
    ]);
  });

  it('prefers an explicit step.pathParams entry over the naming rule', () => {
    expect(lowerPathParams('/a/{id}', [{ name: 'id', var: 'otherVar' }])).toEqual([
      { name: 'id', binding: 'otherVar' },
    ]);
  });
});

describe('lowering: values', () => {
  const none = new Set<string>();

  it('turns whole-string "${b}" and "\\${b}" placeholders into refs', () => {
    expect(lowerValue('${aVar}', none)).toEqual({
      kind: 'ref',
      binding: 'aVar',
      omitWhenUnbound: false,
    });
    expect(lowerValue('\\${aVar}', none)).toEqual({
      kind: 'ref',
      binding: 'aVar',
      omitWhenUnbound: false,
    });
  });

  it('turns "@@FILE:path" into a file value', () => {
    expect(lowerValue('@@FILE:bpmn/a.bpmn', none)).toEqual({ kind: 'file', path: 'bpmn/a.bpmn' });
  });

  it('keeps other scalars as literals and preserves object key order', () => {
    expect(lowerValue({ b: 1, a: [true, null, 'x'] }, none)).toEqual({
      kind: 'object',
      entries: [
        { key: 'b', value: { kind: 'literal', value: 1 } },
        {
          key: 'a',
          value: {
            kind: 'array',
            items: [
              { kind: 'literal', value: true },
              { kind: 'literal', value: null },
              { kind: 'literal', value: 'x' },
            ],
          },
        },
      ],
    });
  });

  it('rejects a placeholder embedded in a longer string, which no adapter could render', () => {
    expect(() => lowerValue('pre-${aVar}', none)).toThrow(/Embedded placeholder/);
  });

  it('marks a ref omitWhenUnbound only for the given bindings', () => {
    expect(lowerValue('${tenantIdVar}', new Set(['tenantIdVar']))).toMatchObject({
      omitWhenUnbound: true,
    });
  });
});

describe('lowering: extract paths', () => {
  it('splits keys and array indices', () => {
    expect(fieldPathSegments('items[0].processInstanceKey')).toEqual([
      'items',
      0,
      'processInstanceKey',
    ]);
    expect(fieldPathSegments('a-b.c')).toEqual(['a-b', 'c']);
  });
});

describe('lowering: seeding plan', () => {
  it('orders scenario literals, scenario seeds, then universal seeds; skips pending literals', () => {
    const ops = planCtxSeeding({
      bindings: { lit: 'v', pend: '__PENDING__' },
      seedBindings: ['pend', 'clusterVar'],
      globalContextSeeds: [CLUSTER, TENANT],
      fixtureEnvByBinding: { lit: 'LIT_ENV' },
    });
    expect(ops).toEqual([
      { kind: 'literal', group: 'scenario', binding: 'lit', value: 'v', envOverride: 'LIT_ENV' },
      { kind: 'seed', group: 'scenario', binding: 'pend', rule: 'pend', unique: false },
      { kind: 'seed', group: 'global', binding: 'clusterVar', rule: 'cluster', unique: false },
    ]);
  });

  it('seeds an omitWhenUnbound binding only when it must be unique', () => {
    const base = { bindings: {}, seedBindings: ['tenantIdVar'], globalContextSeeds: [TENANT] };
    expect(planCtxSeeding(base)).toEqual([]);
    expect(planCtxSeeding({ ...base, uniqueBindings: new Set(['tenantIdVar']) })).toEqual([
      {
        kind: 'seed',
        group: 'scenario',
        binding: 'tenantIdVar',
        rule: 'tenantIdVar',
        unique: true,
      },
    ]);
  });

  it('replaces a literal that must be unique with a unique seed', () => {
    expect(
      planCtxSeeding({
        bindings: { nameVar: 'fixed' },
        seedBindings: [],
        globalContextSeeds: [],
        uniqueBindings: new Set(['nameVar']),
      }),
    ).toEqual([
      { kind: 'seed', group: 'scenario', binding: 'nameVar', rule: 'nameVar', unique: true },
    ]);
  });
});

describe('lowerScenario', () => {
  const plan: RequestStep[] = [
    step({
      operationId: 'createThing',
      method: 'post',
      pathTemplate: '/things',
      bodyTemplate: { name: '${nameVar}', tenantId: '${tenantIdVar}' },
      bodyKind: 'json',
      declares409: true,
      extract: [{ fieldPath: 'thingKey', bind: 'thingKeyVar' }],
    }),
    step({ operationId: 'getThing', pathTemplate: '/things/{thingKey}' }),
    step({
      operationId: 'searchThings',
      method: 'POST',
      pathTemplate: '/things/search',
      bodyKind: 'multipart',
      multipartTemplate: { fields: { a: '${thingKeyVar}' }, files: { f: '@@FILE:x.bin' } },
      expect: { status: 400 },
    }),
  ];
  const lowered = lowerScenario(
    scenario({
      requestPlan: plan,
      seedBindings: ['nameVar', 'tenantIdVar'],
      operations: [
        { operationId: 'createThing', method: 'POST', path: '/things' },
        {
          operationId: 'getThing',
          method: 'GET',
          path: '/things/{thingKey}',
          eventuallyConsistent: true,
        },
        {
          operationId: 'searchThings',
          method: 'POST',
          path: '/things/search',
          eventuallyConsistent: true,
        },
      ],
    }),
    { globalContextSeeds: [TENANT] },
  );

  it('polls only eventually-consistent reads that expect 200', () => {
    expect(lowered.steps.map((s) => s.awaitEventually)).toEqual([false, true, false]);
  });

  it('marks client-minted bindings consumed by a 409-declaring step unique', () => {
    expect(lowered.uniqueBindings.sort()).toEqual(['nameVar', 'tenantIdVar']);
  });

  it('does not let a unique binding be omitted', () => {
    const body = lowered.steps[0].body;
    expect(body?.kind === 'json' && body.value.kind === 'object' && body.value.entries[1]).toEqual({
      key: 'tenantId',
      value: { kind: 'ref', binding: 'tenantIdVar', omitWhenUnbound: false },
    });
  });

  it('lowers path params, extracts, multipart and upper-cases methods', () => {
    expect(lowered.steps[0].method).toBe('POST');
    expect(lowered.steps[0].extract).toEqual([
      { binding: 'thingKeyVar', fieldPath: 'thingKey', segments: ['thingKey'] },
    ]);
    expect(lowered.steps[1].pathParams).toEqual([{ name: 'thingKey', binding: 'thingKeyVar' }]);
    expect(lowered.steps[2].body).toEqual({
      kind: 'multipart',
      fields: [
        { key: 'a', value: { kind: 'ref', binding: 'thingKeyVar', omitWhenUnbound: false } },
      ],
      files: [{ key: 'f', value: { kind: 'file', path: 'x.bin' } }],
    });
  });

  it('marks only the binding the lowered request reads unique, not the overridden fallback', () => {
    // An explicit pathParams entry replaces the naming-rule binding: the
    // lowered request reads `otherVar` only, so `idVar` must stay a literal.
    const s = lowerScenario(
      scenario({
        bindings: { idVar: 'fixed-id' },
        requestPlan: [
          step({
            operationId: 'updateThing',
            method: 'PUT',
            pathTemplate: '/things/{id}',
            pathParams: [{ name: 'id', var: 'otherVar' }],
            declares409: true,
          }),
        ],
        operations: [{ operationId: 'updateThing', method: 'PUT', path: '/things/{id}' }],
      }),
      { globalContextSeeds: [] },
    );
    expect(s.uniqueBindings).toEqual(['otherVar']);
    expect(s.seeds).toEqual([
      { kind: 'literal', group: 'scenario', binding: 'idVar', value: 'fixed-id' },
    ]);
  });

  it('lowers echo checks into typed values and path segments', () => {
    const s = lowerScenario(
      scenario({
        requestPlan: [
          step({
            operationId: 'updateThing',
            method: 'PATCH',
            pathTemplate: '/things',
            echoChecks: {
              'folder.parentFolderKey': '${otherFolderKeyVar}',
              name: 'fixed',
              parent: null,
            },
          }),
        ],
        operations: [{ operationId: 'updateThing', method: 'PATCH', path: '/things' }],
      }),
      { globalContextSeeds: [] },
    );
    expect(s.steps[0].echoChecks).toEqual([
      {
        segments: ['folder', 'parentFolderKey'],
        value: { kind: 'ref', binding: 'otherFolderKeyVar', omitWhenUnbound: false },
      },
      { segments: ['name'], value: { kind: 'literal', value: 'fixed' } },
      { segments: ['parent'], value: { kind: 'literal', value: null } },
    ]);
  });
});
