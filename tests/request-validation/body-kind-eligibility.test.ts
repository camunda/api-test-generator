import { describe, expect, it } from 'vitest';
import { generateAdditionalPropsViolations } from '../../request-validation/src/analysis/additionalProps.js';
import {
  generateUniversalAdditionalProp,
  isUniversalAdditionalPropEligible,
} from '../../request-validation/src/analysis/additionalPropUniversal.js';
import {
  generateAllOfConflicts,
  generateAllOfMissingRequired,
  isAllOfConflictEligible,
  isAllOfMissingRequiredEligible,
} from '../../request-validation/src/analysis/allOf.js';
import {
  generateMissingBody,
  isMissingBodyEligible,
} from '../../request-validation/src/analysis/bodyTopLevel.js';
import {
  generateOneOfCrossBleed,
  generateOneOfMultiAmbiguous,
  isOneOfCrossBleedEligible,
  isOneOfMultiAmbiguousEligible,
} from '../../request-validation/src/analysis/oneOfAdvanced.js';
import {
  generateOneOfAmbiguous,
  isOneOfAmbiguousEligible,
} from '../../request-validation/src/analysis/oneOfAmbiguous.js';
import {
  generateOneOfNoneMatch,
  isOneOfNoneMatchEligible,
} from '../../request-validation/src/analysis/oneOfNoneMatch.js';
import {
  generateUnionViolations,
  isUnionEligible,
} from '../../request-validation/src/analysis/unionViolations.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';

/**
 * The weekly coverage report counts a body kind as "applicable" and reports it missing when no scenario of that kind
 * exists. `generate.ts` used to mark the oneOf and allOf kinds applicable for a oneOf or allOf found anywhere in the
 * body, and `missing-body` for every object body, while the generators build them only from the root of the body
 * (and `missing-body` only for a required body). Every search endpoint then showed about eleven kinds as missing
 * that nothing could generate.
 *
 * Each generator exports its exact eligibility and uses it itself; generate.ts calls the same functions. This test
 * runs the real generators over a set of body shapes and checks that a kind is eligible exactly when its generator
 * builds a scenario, a guard against a generator that stops using its own exported check.
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
  'additional-prop-general',
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
      ...generateUniversalAdditionalProp(ops, {}),
    ]
      .map((s) => s.type)
      .filter((t) => KINDS.includes(t)),
  );
}

/** What generate.ts asks, kind by kind: the generator's own exported eligibility. */
function eligible(o: OperationModel): Set<string> {
  const out = new Set<string>();
  if (isMissingBodyEligible(o)) out.add('missing-body');
  if (isUnionEligible(o)) out.add('union');
  if (isOneOfAmbiguousEligible(o)) out.add('oneof-ambiguous');
  if (isOneOfNoneMatchEligible(o)) out.add('oneof-none-match');
  if (isOneOfMultiAmbiguousEligible(o)) out.add('oneof-multi-ambiguous');
  if (isOneOfCrossBleedEligible(o)) out.add('oneof-cross-bleed');
  if (isAllOfMissingRequiredEligible(o)) out.add('allof-missing-required');
  if (isAllOfConflictEligible(o)) out.add('allof-conflict');
  if (isUniversalAdditionalPropEligible(o)) out.add('additional-prop-general');
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
  [
    'a closed object body (additionalProperties: false)',
    op({ ...obj({ name: { type: 'string' } }), additionalProperties: false }),
  ],
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
    const composite = (s: Set<string>) => [...s].filter((k) => /^(oneof|allof|union)/.test(k));
    expect(composite(eligible(op(searchBody)))).toEqual([]);
    expect(composite(produced(op(searchBody)))).toEqual([]);
  });

  it('leaves a closed body to additional-prop, which sends the same request, so -general never reads as missing', () => {
    // generate.ts's structural dedupe drops one of two identical extra-property requests; -general used to be the one
    // dropped, so every closed body (the common case in Hub) showed additional-prop-general as a missing test.
    const closed = op({ ...obj({ name: { type: 'string' } }), additionalProperties: false });
    expect(isUniversalAdditionalPropEligible(closed)).toBe(false);
    expect(generateUniversalAdditionalProp([closed], {})).toEqual([]);
    expect(generateAdditionalPropsViolations([closed], {}).map((s) => s.type)).toEqual([
      'additional-prop',
    ]);
    expect(isUniversalAdditionalPropEligible(op(obj({ name: { type: 'string' } })))).toBe(true);
  });

  it('keeps a buildable root allOf eligible, and its generators build the scenarios', () => {
    // Two object constituents: both list a required field, and `id` has two different types.
    const o = op({
      allOf: [
        obj({ id: { type: 'string' }, n: { type: 'string' } }, ['id']),
        obj({ id: { type: 'integer' }, m: { type: 'string' } }, ['m']),
      ],
    });
    expect([...eligible(o)].sort()).toEqual(['allof-conflict', 'allof-missing-required']);
    expect([...produced(o)].sort()).toEqual(['allof-conflict', 'allof-missing-required']);
    // Only the conflict kind: the types differ but no constituent lists a required field that the baseline has.
    const noRequired = op({
      allOf: [obj({ id: { type: 'string' } }), obj({ id: { type: 'integer' } })],
    });
    expect([...eligible(noRequired)]).toEqual(['allof-conflict']);
    expect([...produced(noRequired)]).toEqual(['allof-conflict']);
  });

  it('keeps the kinds that are generated: a root oneOf and a root allOf stay eligible', () => {
    const o = op({ oneOf: [a, b, c] });
    expect([...eligible(o)].sort()).toEqual(
      [
        'oneof-ambiguous',
        'oneof-cross-bleed',
        'oneof-multi-ambiguous',
        'oneof-none-match',
        'union',
      ].sort(),
    );
    expect(
      isMissingBodyEligible(op(obj({ name: { type: 'string' } }), { bodyRequired: true })),
    ).toBe(true);
  });
});
