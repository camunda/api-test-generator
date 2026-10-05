import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadOptionalFields } from '../../../path-analyser/src/optionalFields.ts';
import {
  DERIVED_VARIANT_NAME,
  deriveOptionalFields,
  findWriteOperations,
} from '../../../path-analyser/src/optionalFieldsDerive.ts';

const dirs: string[] = [];
function configDir(content: unknown): string {
  const d = mkdtempSync(join(tmpdir(), 'optional-derive-'));
  dirs.push(d);
  writeFileSync(join(d, 'optional-fields.json'), JSON.stringify(content));
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const body = (props: Record<string, unknown>, required: string[] = []) => ({
  content: { 'application/json': { schema: { type: 'object', required, properties: props } } },
});
const ok = (props: Record<string, unknown>) => ({
  '200': { content: { 'application/json': { schema: { type: 'object', properties: props } } } },
});
const str = (extra: Record<string, unknown> = {}) => ({ type: 'string', ...extra });

// A thing with create (POST), update (PATCH) and get (GET, wrapping the resource), plus a few
// operations that must not produce a variant.
const spec = {
  paths: {
    '/things': {
      post: {
        operationId: 'createThing',
        requestBody: body(
          {
            name: str(),
            description: str({ maxLength: 20 }),
            kind: str({ enum: ['a', 'b'] }),
            link: str({ format: 'uri' }),
            code: str({ pattern: '^[A-Z]+$' }),
            secret: str(),
          },
          ['name'],
        ),
        responses: ok({ name: str(), description: str(), kind: str(), link: str(), code: str() }),
      },
    },
    '/things/{key}': {
      get: {
        operationId: 'getThing',
        responses: ok({
          thing: { type: 'object', properties: { name: str(), description: str() } },
        }),
      },
      patch: {
        operationId: 'updateThing',
        requestBody: body({ name: str(), description: str(), count: { type: 'integer' } }),
        responses: ok({ name: str(), description: str(), count: { type: 'integer' } }),
      },
    },
    // 204: nothing to echo
    '/silent': {
      post: { operationId: 'silent', requestBody: body({ note: str() }), responses: { '204': {} } },
    },
    // a field composed through allOf, optional, echoed
    '/composed': {
      post: {
        operationId: 'composed',
        requestBody: body({
          label: { description: 'x', allOf: [{ $ref: '#/components/schemas/Label' }] },
        }),
        responses: ok({ label: str() }),
      },
    },
    // GET is not a write operation
    '/search': { get: { operationId: 'readOnly', responses: ok({ note: str() }) } },
  },
  components: { schemas: { Label: { type: 'string', maxLength: 8 } } },
};

const base = { auto: true, exclude: [], variants: [] };

describe('finding write operations with optional string fields', () => {
  it('keeps optional plain strings the response echoes, and nothing else', () => {
    const ops = findWriteOperations(spec);
    expect(ops.map((o) => o.operationId)).toEqual(['createThing', 'updateThing', 'composed']);
    // name is required on create, kind/link/code are constrained, secret is not echoed
    expect(ops[0].candidates.map((c) => c.field)).toEqual(['description']);
    expect(ops[1].candidates.map((c) => c.field)).toEqual(['name', 'description']);
    // allOf of a $ref carries the string type and its length limit
    expect(ops[2].candidates).toEqual([{ field: 'label', maxLength: 8 }]);
  });

  it('pairs an update with the GET on the same path and finds the field inside the wrapper', () => {
    const update = findWriteOperations(spec).find((o) => o.operationId === 'updateThing');
    expect(update?.readBack).toEqual({
      operationId: 'getThing',
      locations: { name: 'thing.name', description: 'thing.description' },
    });
  });

  it('gives a create no read-back', () => {
    expect(findWriteOperations(spec)[0].readBack).toBeUndefined();
  });
});

describe('deriving optional-string variants', () => {
  it('builds one variant per operation: values that fit, echoed, with a read-back for updates', () => {
    const { variants } = deriveOptionalFields(base, spec);
    expect(variants.map((v) => `${v.operationId}/${v.name}`)).toEqual([
      `createThing/${DERIVED_VARIANT_NAME}`,
      `updateThing/${DERIVED_VARIANT_NAME}`,
      `composed/${DERIVED_VARIANT_NAME}`,
    ]);
    const [create, update, composed] = variants;
    // cut to the field's maxLength
    expect(String(create.body.description)).toHaveLength(20);
    expect(create.echo).toEqual(create.body);
    expect(create.readBack).toBeUndefined();
    expect(Object.keys(update.body)).toEqual(['name', 'description']);
    expect(update.readBack).toEqual({
      operationId: 'getThing',
      echo: { 'thing.name': update.body.name, 'thing.description': update.body.description },
    });
    expect(String(composed.body.label)).toHaveLength(8);
  });

  it('does nothing without auto', () => {
    const config = { ...base, auto: false };
    expect(deriveOptionalFields(config, spec)).toBe(config);
  });

  it('skips an excluded operation or field, and leaves an operation with its own variant alone', () => {
    const own = {
      operationId: 'createThing',
      name: DERIVED_VARIANT_NAME,
      body: { description: 'mine' },
      echo: { description: 'mine' },
      before: [],
      chainBodies: {},
    };
    const { variants } = deriveOptionalFields(
      {
        ...base,
        variants: [own],
        exclude: [
          { operationId: 'updateThing', field: 'name', reason: 'r' },
          { operationId: 'composed', reason: 'r' },
        ],
      },
      spec,
    );
    expect(variants.map((v) => v.operationId)).toEqual(['createThing', 'updateThing']);
    expect(variants[0]).toBe(own);
    expect(Object.keys(variants[1].body)).toEqual(['description']);
    expect(variants[1].readBack?.echo).toEqual({
      'thing.description': variants[1].body.description,
    });
  });

  it('fails for an exclusion that matches nothing', () => {
    expect(() =>
      deriveOptionalFields({ ...base, exclude: [{ operationId: 'nope', reason: 'r' }] }, spec),
    ).toThrow(/nope/);
    expect(() =>
      deriveOptionalFields(
        { ...base, exclude: [{ operationId: 'createThing', field: 'name', reason: 'r' }] },
        spec,
      ),
    ).toThrow(/createThing\.name/);
  });
});

describe('auto and exclude in optional-fields.json', () => {
  it('loads them, and defaults to no auto and no exclusions', () => {
    const f = {
      auto: true,
      exclude: [{ operationId: 'a', field: 'f', reason: 'r' }],
      variants: [],
    };
    expect(loadOptionalFields(configDir(f))).toEqual(f);
    expect(loadOptionalFields(configDir({ variants: [] }))).toMatchObject({
      auto: false,
      exclude: [],
    });
  });

  it.each([
    ['auto not a boolean', { auto: 'yes', variants: [] }],
    ['exclude not an array', { exclude: {}, variants: [] }],
    ['exclude without a reason', { exclude: [{ operationId: 'a' }], variants: [] }],
    [
      'exclude with an empty field',
      { exclude: [{ operationId: 'a', field: '', reason: 'r' }], variants: [] },
    ],
  ])('rejects: %s', (_label, content) => {
    expect(() => loadOptionalFields(configDir(content))).toThrow();
  });
});

describe('values that fit every length limit', () => {
  const specFor = (field: unknown): unknown => ({
    paths: {
      '/x': {
        post: {
          operationId: 'makeX',
          requestBody: body({ f: field }),
          responses: ok({ f: str() }),
        },
      },
    },
    components: {
      schemas: { Short: { type: 'string', maxLength: 8 }, Long: { type: 'string', minLength: 3 } },
    },
  });
  const derivedValue = (field: unknown): string => {
    const [v] = deriveOptionalFields(base, specFor(field)).variants;
    return String(v.body.f);
  };

  it('intersects allOf limits: the smallest maximum and the largest minimum win', () => {
    const [op] = findWriteOperations(
      specFor({
        allOf: [
          { type: 'string', maxLength: 100, minLength: 2 },
          { $ref: '#/components/schemas/Short' },
          { $ref: '#/components/schemas/Long' },
        ],
      }),
    );
    expect(op.candidates).toEqual([{ field: 'f', minLength: 3, maxLength: 8 }]);
    expect(
      derivedValue({
        allOf: [{ type: 'string', maxLength: 100 }, { $ref: '#/components/schemas/Short' }],
      }),
    ).toHaveLength(8);
  });

  it('pads up to the minimum length', () => {
    expect(derivedValue({ type: 'string', minLength: 80 })).toHaveLength(80);
    expect(derivedValue({ type: 'string', minLength: 200, maxLength: 255 })).toHaveLength(200);
  });

  it('allows an empty value when the maximum is zero', () => {
    expect(derivedValue({ type: 'string', maxLength: 0 })).toBe('');
  });

  it('leaves out a field whose minimum is above its maximum', () => {
    expect(findWriteOperations(specFor({ type: 'string', minLength: 10, maxLength: 5 }))).toEqual(
      [],
    );
  });
});

describe('an update must be readable back', () => {
  const update = (getProps: Record<string, unknown> | null) => ({
    paths: {
      '/y/{key}': {
        ...(getProps ? { get: { operationId: 'getY', responses: ok(getProps) } } : {}),
        patch: {
          operationId: 'updateY',
          requestBody: body({ note: str() }),
          responses: ok({ note: str() }),
        },
      },
    },
  });

  it('derives with a read-back when the GET returns the field', () => {
    const [v] = deriveOptionalFields(base, update({ note: str() })).variants;
    expect(v.readBack?.operationId).toBe('getY');
  });

  it('fails, naming the field, when there is no GET on the path', () => {
    expect(() => deriveOptionalFields(base, update(null))).toThrow(/updateY\.note/);
  });

  it('fails when the GET does not return the field, or returns it under two wrappers', () => {
    expect(() => deriveOptionalFields(base, update({ other: str() }))).toThrow(/updateY\.note/);
    const twice = {
      a: { type: 'object', properties: { note: str() } },
      b: { type: 'object', properties: { note: str() } },
    };
    expect(() => deriveOptionalFields(base, update(twice))).toThrow(/updateY\.note/);
  });

  it('passes once the field or the operation is excluded', () => {
    expect(
      deriveOptionalFields(
        { ...base, exclude: [{ operationId: 'updateY', field: 'note', reason: 'r' }] },
        update(null),
      ).variants,
    ).toEqual([]);
    expect(
      deriveOptionalFields(
        { ...base, exclude: [{ operationId: 'updateY', reason: 'r' }] },
        update(null),
      ).variants,
    ).toEqual([]);
  });

  it('needs no read-back for a create', () => {
    expect(() => deriveOptionalFields(base, spec)).not.toThrow();
  });
});
