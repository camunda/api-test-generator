import { describe, expect, test } from 'vitest';
import {
  buildCsharpDiscriminatorTable,
  type CsharpDiscriminator,
  chooseCsharpDiscriminator,
} from '../../materializer/src/csharp-sdk/discriminators.js';

/**
 * Regression coverage for the inline-schema visit-key collision (PR #668
 * review): `walkSchema` keyed its visited-set cache on `<inline>:path` for
 * ANY schema with no `$ref`, but every branch of an inline `allOf`/`oneOf`/
 * `anyOf` is walked with the SAME `path` as its wrapper and as its own
 * siblings. That collapsed the wrapper and its first inline branch (and
 * every inline sibling branch after the first) onto one cache key, so only
 * the first inline schema at a given path was ever visited — discriminators
 * nested in the others were silently dropped from the table.
 *
 * The fix dedupes only on an actual `$ref` + path pair (the only case that
 * can recur via a true schema cycle); inline schemas are always walked
 * since they form a bounded, cycle-free subtree.
 */
describe('buildCsharpDiscriminatorTable — inline schema visit-key collisions', () => {
  test('finds a discriminator nested under an inline allOf wrapper AND inline branch', () => {
    const bundle = {
      paths: {
        '/widgets': {
          post: {
            operationId: 'createWidget',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    // Inline wrapper (no $ref) — itself has no discriminator,
                    // but one of its `allOf` branches (also inline, same
                    // `path`) does. Pre-fix, visiting the wrapper claimed
                    // the `<inline>:` key and the branch below was skipped.
                    allOf: [
                      {
                        type: 'object',
                        properties: { widget: { type: 'object' } },
                      },
                      {
                        type: 'object',
                        properties: {
                          widget: {
                            type: 'object',
                            discriminator: { propertyName: 'kind' },
                            oneOf: [{ $ref: '#/components/schemas/CircularWidget' }],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          CircularWidget: {
            type: 'object',
            properties: { kind: { type: 'string', enum: ['circular'] } },
          },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    expect(table.createWidget).toBeDefined();
    const paths = (table.createWidget ?? []).map((d) => d.path);
    expect(paths).toContain('widget');
  });

  test('finds discriminators in every inline sibling branch of a oneOf under a $ref parent', () => {
    const bundle = {
      paths: {
        '/gadgets': {
          post: {
            operationId: 'createGadget',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/GadgetRequest' },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          GadgetRequest: {
            type: 'object',
            properties: {
              // Two inline (no $ref) oneOf branches at the same `source`
              // path. Pre-fix, the second branch's discriminator was
              // dropped because the first branch's visit already claimed
              // the `<inline>:source` cache key.
              source: {
                oneOf: [
                  {
                    type: 'object',
                    discriminator: { propertyName: 'byId' },
                    properties: { id: { type: 'string' } },
                  },
                  {
                    type: 'object',
                    discriminator: { propertyName: 'byKey' },
                    properties: { key: { type: 'string' } },
                  },
                ],
              },
            },
          },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    const propertyNames = (table.createGadget ?? [])
      .filter((d) => d.path === 'source')
      .map((d) => d.propertyName);
    expect(propertyNames.sort()).toEqual(['byId', 'byKey']);
  });

  test('still terminates on a genuine $ref cycle at the same path (allOf self-reference)', () => {
    // `Node`'s own `allOf` includes a `$ref` back to itself at the SAME
    // path ('' — no property traversal involved), the actual shape a true
    // cycle takes. The fix must still dedupe this (same ref + same path)
    // even though it no longer dedupes inline schemas.
    const bundle = {
      paths: {
        '/nodes': {
          post: {
            operationId: 'createNode',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Node' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Node: {
            type: 'object',
            discriminator: { propertyName: 'type' },
            allOf: [{ $ref: '#/components/schemas/Node' }],
          },
        },
      },
    };

    expect(() => buildCsharpDiscriminatorTable(bundle)).not.toThrow();
  });

  /**
   * Regression coverage for PR #668 review: a cycle reached through a
   * PROPERTY or ARRAY reference (rather than an `allOf` self-reference at
   * the SAME path) grows `path` on every descent (`''`, `child`,
   * `child.child`, ...an array adds `[]` the same way), so a `ref:path`
   * key never repeats and the walk recursed without bound until the call
   * stack overflowed — even for a recursive schema with no discriminator
   * at all, since discovery scans every request schema. `activeRefs`
   * tracks the refs on the CURRENT descent (push on enter, pop on exit),
   * so it catches the cycle regardless of how deep `path` has grown. Each
   * fixture also carries an independent sibling property (`label`) with
   * its OWN discriminator, at a path the cycle never touches, to prove the
   * fix does not also give up early on unrelated branches.
   */
  test('terminates on property recursion through a growing path (Node.child -> Node) and still finds an independent sibling discriminator', () => {
    const bundle = {
      paths: {
        '/nodes': {
          post: {
            operationId: 'createNode',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Node' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              child: { $ref: '#/components/schemas/Node' },
              label: {
                type: 'object',
                discriminator: { propertyName: 'labelType' },
                oneOf: [{ $ref: '#/components/schemas/PlainLabel' }],
              },
            },
          },
          PlainLabel: { type: 'object', properties: { labelType: { type: 'string' } } },
        },
      },
    };

    expect(() => buildCsharpDiscriminatorTable(bundle)).not.toThrow();
    const table = buildCsharpDiscriminatorTable(bundle);
    expect((table.createNode ?? []).map((d) => d.path)).toContain('label');
  });

  test('terminates on array recursion through a growing path (Node.children[] -> Node) and still finds an independent sibling discriminator', () => {
    const bundle = {
      paths: {
        '/nodes': {
          post: {
            operationId: 'createNode',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Node' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
              label: {
                type: 'object',
                discriminator: { propertyName: 'labelType' },
                oneOf: [{ $ref: '#/components/schemas/PlainLabel' }],
              },
            },
          },
          PlainLabel: { type: 'object', properties: { labelType: { type: 'string' } } },
        },
      },
    };

    expect(() => buildCsharpDiscriminatorTable(bundle)).not.toThrow();
    const table = buildCsharpDiscriminatorTable(bundle);
    expect((table.createNode ?? []).map((d) => d.path)).toContain('label');
  });

  test('a recursive schema without its own discriminator does not block discovery at an independent sibling path', () => {
    // "discovery scans every request schema, even a recursive schema
    // without a discriminator prevents the entire C# table from loading"
    // — assert at the TABLE level (two unrelated operations) that one
    // operation's undiscriminated recursive schema can never prevent a
    // completely separate operation's discriminator from being found.
    const bundle = {
      paths: {
        '/nodes': {
          post: {
            operationId: 'createNode',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Node' } },
              },
            },
          },
        },
        '/widgets': {
          post: {
            operationId: 'createWidget',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/WidgetRequest' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          // No discriminator anywhere in Node — purely recursive, nothing
          // to find, but discovery must still terminate.
          Node: {
            type: 'object',
            properties: { child: { $ref: '#/components/schemas/Node' } },
          },
          WidgetRequest: {
            type: 'object',
            discriminator: { propertyName: 'kind' },
            oneOf: [{ $ref: '#/components/schemas/CircularWidget' }],
          },
          CircularWidget: {
            type: 'object',
            properties: { kind: { type: 'string', enum: ['circular'] } },
          },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    expect(table.createNode).toBeUndefined();
    expect(table.createWidget).toBeDefined();
  });
});

/**
 * Regression coverage for `chooseCsharpDiscriminator` (PR #668 review,
 * adversarial finding): once the table-build fix above started allowing
 * MULTIPLE discriminator entries to share the same `path` (one per inline
 * sibling branch), `chooseCsharpDiscriminator` still located its entry with
 * `entries.find((candidate) => candidate.path === path)` — always the
 * FIRST matching entry — so a value shaped for a later sibling entry was
 * scored against the wrong entry's subtypes and silently mismatched.
 * `chooseCsharpDiscriminator` had no unit tests at all before this fix.
 */
describe('chooseCsharpDiscriminator — multiple entries sharing one path', () => {
  const byId: CsharpDiscriminator = {
    path: 'source',
    propertyName: 'byId',
    subtypes: [{ value: 'IdRef', properties: ['id'], required: ['id'] }],
  };
  const byKey: CsharpDiscriminator = {
    path: 'source',
    propertyName: 'byKey',
    subtypes: [{ value: 'KeyRef', properties: ['key'], required: ['key'] }],
  };
  const entries: CsharpDiscriminator[] = [byId, byKey];

  test('matches a value shaped for the FIRST same-path entry', () => {
    expect(chooseCsharpDiscriminator({ id: '1' }, entries, 'source')).toEqual({
      name: 'byId',
      value: 'IdRef',
    });
  });

  test('matches a value shaped for a LATER same-path entry, not just the first', () => {
    // Pre-fix: `.find()` locked onto `byId` and this value (which has no
    // `id` and would fail `byId`'s subtype checks) returned undefined
    // instead of resolving against the `byKey` entry.
    expect(chooseCsharpDiscriminator({ key: 'k1' }, entries, 'source')).toEqual({
      name: 'byKey',
      value: 'KeyRef',
    });
  });

  test('prefers the entry whose own discriminator property is already present', () => {
    // If the value already carries one entry's discriminator property, that
    // entry must be skipped (matching the pre-existing single-entry
    // behaviour) even though it is listed first.
    expect(
      chooseCsharpDiscriminator({ byId: 'IdRef', id: '1' }, entries, 'source'),
    ).toBeUndefined();
  });

  test('returns undefined when no same-path entry matches the value shape', () => {
    expect(chooseCsharpDiscriminator({ unrelated: true }, entries, 'source')).toBeUndefined();
  });

  test('picks the more specific subtype across entries when several match', () => {
    const broad: CsharpDiscriminator = {
      path: 'source',
      propertyName: 'byAny',
      subtypes: [{ value: 'AnyRef', properties: ['id', 'extra'], required: [] }],
    };
    const specific: CsharpDiscriminator = {
      path: 'source',
      propertyName: 'byIdExact',
      subtypes: [{ value: 'IdExactRef', properties: ['id'], required: ['id'] }],
    };
    expect(chooseCsharpDiscriminator({ id: '1' }, [broad, specific], 'source')).toEqual({
      name: 'byIdExact',
      value: 'IdExactRef',
    });
  });
});
