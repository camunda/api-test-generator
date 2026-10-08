import { describe, expect, it } from 'vitest';
import {
  generateAllOfConflicts,
  generateAllOfMissingRequired,
} from '../../request-validation/src/analysis/allOf.js';
import {
  eligibleAllOfKinds,
  eligibleOneOfKinds,
  isMissingBodyEligible,
} from '../../request-validation/src/analysis/bodyKindEligibility.js';
import { generateMissingBody } from '../../request-validation/src/analysis/bodyTopLevel.js';
import {
  generateOneOfCrossBleed,
  generateOneOfMultiAmbiguous,
} from '../../request-validation/src/analysis/oneOfAdvanced.js';
import { generateOneOfAmbiguous } from '../../request-validation/src/analysis/oneOfAmbiguous.js';
import { generateOneOfNoneMatch } from '../../request-validation/src/analysis/oneOfNoneMatch.js';
import { generateUnionViolations } from '../../request-validation/src/analysis/unionViolations.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';

/**
 * The weekly coverage report counts a body kind as "applicable" and reports it missing when no scenario of that kind
 * exists. `generate.ts` used to mark the oneOf and allOf kinds applicable for a oneOf or allOf found anywhere in the
 * body, and `missing-body` for every object body, while the generators build them only from the root of the body
 * (and `missing-body` only for a required body). Every search endpoint then showed about eleven kinds as missing
 * that nothing could generate.
 *
 * `bodyKindEligibility.ts` repeats each generator's guard. This test runs the real generators over a set of body
 * shapes and checks that a kind is eligible exactly when its generator builds a scenario, so the two cannot drift.
 */
const KINDS = [
  'missing-body',
  'union',
  'oneof-ambiguous',
  'oneof-none-match',
  'oneof-multi-ambiguous',
  'oneof-cross-bleed',
  'allof-missing-required',
  'allof-conflict',
];

function op(body: SchemaFragment | undefined, over: Partial<OperationModel> = {}): OperationModel {
  const rootOneOf = body && Array.isArray(body.oneOf) ? body.oneOf : undefined;
  return {
    operationId: 'op',
    method: 'POST',
    path: '/things',
    tags: [],
    requestBodySchema: body,
    parameters: [],
    ...(rootOneOf ? { rootOneOf } : {}),
    ...over,
  };
}

const obj = (props: Record<string, SchemaFragment>, required?: string[]): SchemaFragment => ({
  type: 'object',
  properties: props,
  ...(required ? { required } : {}),
});

function produced(o: OperationModel): Set<string> {
  const ops = [o];
  return new Set(
    [
      ...generateMissingBody(ops, {}),
      ...generateUnionViolations(ops, {}),
      ...generateOneOfAmbiguous(ops, {}),
      ...generateOneOfNoneMatch(ops, {}),
      ...generateOneOfMultiAmbiguous(ops, {}),
      ...generateOneOfCrossBleed(ops, {}),
      ...generateAllOfMissingRequired(ops, {}),
      ...generateAllOfConflicts(ops, {}),
    ]
      .map((s) => s.type)
      .filter((t) => KINDS.includes(t)),
  );
}

function eligible(o: OperationModel): Set<string> {
  const out = new Set([...eligibleOneOfKinds(o), ...eligibleAllOfKinds(o)]);
  if (isMissingBodyEligible(o)) out.add('missing-body');
  return out;
}

const a = obj({ kind: { type: 'string' }, x: { type: 'string' } }, ['kind', 'x']);
const b = obj({ kind: { type: 'string' }, y: { type: 'string' } }, ['kind', 'y']);
const c = obj({ kind: { type: 'string' }, z: { type: 'string' } }, ['kind', 'z']);
const noRequired = obj({ p: { type: 'string' } });

// A search body: the oneOf and allOf sit inside the `filter` property, not at the root.
const searchBody: SchemaFragment = obj({
  filter: {
    allOf: [
      obj({ name: { oneOf: [{ type: 'string' }, obj({ $eq: { type: 'string' } })] } }),
      obj({ $or: { type: 'array', items: obj({ name: { type: 'string' } }) } }),
    ],
  },
  page: obj({ limit: { type: 'integer' } }),
});

const CASES: [string, OperationModel][] = [
  ['a search body with oneOf and allOf nested in filter', op(searchBody)],
  ['a required search body', op(searchBody, { bodyRequired: true })],
  ['a plain object body, optional', op(obj({ name: { type: 'string' } }))],
  ['a plain object body, required', op(obj({ name: { type: 'string' } }), { bodyRequired: true })],
  [
    'an object body whose properties are all required',
    op(obj({ name: { type: 'string' } }, ['name']), { requiredProps: ['name'] }),
  ],
  ['no body', op(undefined)],
  ['a root oneOf of two object variants with required', op({ oneOf: [a, b] })],
  ['a root oneOf of three object variants with required', op({ oneOf: [a, b, c] })],
  [
    'a root oneOf of two variants without required',
    op({ oneOf: [noRequired, obj({ q: { type: 'string' } })] }),
  ],
  ['a root oneOf with one variant', op({ oneOf: [a] })],
  ['a root oneOf with a primitive variant', op({ oneOf: [{ type: 'string' }, a] })],
  ['a root oneOf whose variants share all properties', op({ oneOf: [a, { ...a }] })],
  [
    'a root allOf with a property of two types',
    op(
      {
        allOf: [
          obj({ id: { type: 'string' }, n: { type: 'string' } }, ['id']),
          obj({ id: { type: 'integer' } }, ['id']),
        ],
      },
      {},
    ),
  ],
  [
    'a root allOf with matching types',
    op({
      allOf: [obj({ id: { type: 'string' } }, ['id']), obj({ n: { type: 'string' } }, ['n'])],
    }),
  ],
  ['a root allOf with one constituent', op({ allOf: [obj({ id: { type: 'string' } }, ['id'])] })],
];

describe('body kind eligibility matches what the generators build', () => {
  it.each(CASES)('%s', (_name, o) => {
    expect([...eligible(o)].sort()).toEqual([...produced(o)].sort());
  });

  it('finds none of the oneOf and allOf kinds for a search body, where they used to read as missing', () => {
    expect([...eligible(op(searchBody))]).toEqual([]);
    expect([...produced(op(searchBody))]).toEqual([]);
  });

  it('keeps the kinds that are generated: a root oneOf and a root allOf stay eligible', () => {
    expect(eligibleOneOfKinds(op({ oneOf: [a, b, c] }))).toEqual(
      new Set([
        'union',
        'oneof-ambiguous',
        'oneof-none-match',
        'oneof-multi-ambiguous',
        'oneof-cross-bleed',
      ]),
    );
    expect(
      isMissingBodyEligible(op(obj({ name: { type: 'string' } }), { bodyRequired: true })),
    ).toBe(true);
  });
});
