import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  generateNestedOneOfAmbiguous,
  generateNestedOneOfNoneMatch,
  isNestedOneOfAmbiguousEligible,
  isNestedOneOfNoneMatchEligible,
  nestedOneOfPositions,
  noneMatchValue,
} from '../../request-validation/src/analysis/nestedOneOf.js';
import { loadRequestValidationConfig } from '../../request-validation/src/config.js';
import type { OperationModel, SchemaFragment } from '../../request-validation/src/model/types.js';

/**
 * #708: the `oneof-none-match` and `oneof-ambiguous` kinds for a `oneOf` nested inside a body property. The shapes
 * below are the ones Hub's and OCA's search bodies have: a filter property that is an exact value or an advanced
 * filter object, behind a single-member `allOf` (how a `$ref` with a description dereferences), and a `page`
 * property that is a `oneOf` of pagination shapes.
 */

function op(body: SchemaFragment, over: Partial<OperationModel> = {}): OperationModel {
  return {
    operationId: 'searchThings',
    method: 'POST',
    path: '/things/search',
    tags: [],
    requestBodySchema: body,
    parameters: [],
    ...over,
  };
}

const obj = (props: Record<string, SchemaFragment>, required?: string[]): SchemaFragment => ({
  type: 'object',
  properties: props,
  ...(required ? { required } : {}),
});

const advancedString = obj({
  $eq: { type: 'string' },
  $in: { type: 'array', items: { type: 'string' } },
});
const stringFilter: SchemaFragment = {
  allOf: [{ oneOf: [{ type: 'string' }, advancedString] }],
  description: 'Name filter.',
};
const integerFilter: SchemaFragment = {
  allOf: [{ oneOf: [{ type: 'integer', format: 'int32' }, obj({ $eq: { type: 'integer' } })] }],
};
const page: SchemaFragment = {
  allOf: [
    {
      oneOf: [
        obj({ limit: { type: 'integer' } }),
        obj({ from: { type: 'integer' }, limit: { type: 'integer' } }),
      ],
    },
  ],
};

const search = op(
  obj({
    filter: obj({ name: stringFilter, version: integerFilter, plain: { type: 'string' } }),
    page,
  }),
);

describe('request-validation: nested oneOf positions (#708)', () => {
  it('finds the filter properties through their allOf wrappers, and leaves out page', () => {
    expect(nestedOneOfPositions(search).map((p) => p.path.join('.'))).toEqual([
      'filter.name',
      'filter.version',
    ]);
  });

  it('does not walk under a parent that has required properties', () => {
    const o = op(
      obj({ filter: obj({ name: stringFilter, scope: { type: 'string' } }, ['scope']) }),
    );
    expect(nestedOneOfPositions(o)).toEqual([]);
  });

  it('does not walk into arrays', () => {
    const o = op(obj({ filters: { type: 'array', items: obj({ name: stringFilter }) } }));
    expect(nestedOneOfPositions(o)).toEqual([]);
  });
});

describe('request-validation: nested oneOf none-match (#708)', () => {
  it('picks a value of a JSON type that no variant accepts', () => {
    expect(noneMatchValue([{ type: 'string' }, advancedString])).toBe(123);
    // An integer variant accepts 123, and so would a number variant.
    expect(noneMatchValue([{ type: 'integer' }, obj({})])).toBe(true);
    expect(noneMatchValue([{ type: 'number' }, { type: 'boolean' }])).toBe('x');
  });

  it('gives up when every type is accepted, or a variant does not say what it accepts', () => {
    expect(
      noneMatchValue([
        { type: 'string' },
        { type: 'integer' },
        { type: 'boolean' },
        { type: 'array', items: {} },
      ]),
    ).toBeUndefined();
    expect(noneMatchValue([{ type: 'string' }, { description: 'anything' }])).toBeUndefined();
  });

  it('puts the value into an otherwise valid body, one scenario per position', () => {
    const scenarios = generateNestedOneOfNoneMatch([search], {});
    expect(scenarios.map((s) => [s.target, s.requestBody])).toEqual([
      ['filter.name', { filter: { name: 123 } }],
      ['filter.version', { filter: { version: true } }],
    ]);
    for (const s of scenarios) {
      expect(s.type).toBe('oneof-none-match');
      expect(s.expectedStatus).toBe(400);
    }
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  });

  it('stops at the cap', () => {
    expect(generateNestedOneOfNoneMatch([search], { capPerOperation: 1 })).toHaveLength(1);
  });

  it('keeps the required fields of the body around the mutated one', () => {
    const o = op(
      obj({ filter: obj({ name: stringFilter }), operationReference: { type: 'integer' } }, [
        'operationReference',
      ]),
    );
    const [s] = generateNestedOneOfNoneMatch([o], {});
    expect(s?.requestBody).toEqual({ operationReference: 1, filter: { name: 123 } });
  });
});

describe('request-validation: nested oneOf ambiguous (#708)', () => {
  const a = obj({ id: { type: 'string' } }, ['id']);
  const b = obj({ name: { type: 'string' } }, ['name']);

  it('merges the required properties of two object variants', () => {
    const o = op(obj({ target: { oneOf: [a, b] } }));
    const scenarios = generateNestedOneOfAmbiguous([o], {});
    expect(scenarios.map((s) => [s.target, s.type, s.requestBody])).toEqual([
      ['target', 'oneof-ambiguous', { target: { id: 'x', name: 'x' } }],
    ]);
  });

  it('skips a pair where a variant forbids other properties, since the merge would match neither', () => {
    const closed = { ...a, additionalProperties: false };
    const o = op(obj({ target: { oneOf: [closed, b] } }));
    expect(generateNestedOneOfAmbiguous([o], {})).toEqual([]);
  });

  it('has nothing to build for a scalar-or-object filter', () => {
    expect(generateNestedOneOfAmbiguous([search], {})).toEqual([]);
  });
});

describe('request-validation: nested oneOf eligibility matches generation (#708)', () => {
  const shapes: [string, OperationModel][] = [
    ['search filter', search],
    ['plain object', op(obj({ name: { type: 'string' } }))],
    [
      'object variants',
      op(
        obj({
          target: {
            oneOf: [obj({ id: { type: 'string' } }, ['id']), obj({ n: { type: 'string' } }, ['n'])],
          },
        }),
      ),
    ],
    [
      'root oneOf',
      op({
        oneOf: [obj({ id: { type: 'string' } }, ['id']), obj({ n: { type: 'string' } }, ['n'])],
      }),
    ],
    ['untyped variant', op(obj({ x: { oneOf: [{ type: 'string' }, { description: 'any' }] } }))],
  ];
  for (const [name, o] of shapes) {
    it(name, () => {
      expect(isNestedOneOfNoneMatchEligible(o)).toBe(
        generateNestedOneOfNoneMatch([o], {}).length > 0,
      );
      expect(isNestedOneOfAmbiguousEligible(o)).toBe(
        generateNestedOneOfAmbiguous([o], {}).length > 0,
      );
    });
  }
});

describe('request-validation: nestedOneOf config', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-nested-oneof-'));
  const cfgDir = path.join(tmpRoot, 'configs', 'probe');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'configs.json'), '{}');
  afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  const write = (cfg: unknown) =>
    fs.writeFileSync(path.join(cfgDir, 'request-validation.json'), JSON.stringify(cfg));

  it('defaults to off, so existing configs keep their output', () => {
    write({});
    expect(loadRequestValidationConfig(tmpRoot, 'probe').nestedOneOf).toBe(false);
  });

  it('accepts true', () => {
    write({ nestedOneOf: true });
    expect(loadRequestValidationConfig(tmpRoot, 'probe').nestedOneOf).toBe(true);
  });

  it('rejects anything but a boolean', () => {
    write({ nestedOneOf: 'yes' });
    expect(() => loadRequestValidationConfig(tmpRoot, 'probe')).toThrow(
      /nestedOneOf.*true or false/,
    );
  });
});
