import { describe, expect, test } from 'vitest';
import { buildCsharpDiscriminatorTable } from '../../materializer/src/csharp-sdk/discriminators.js';

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
});
