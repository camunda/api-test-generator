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

  /**
   * Regression coverage for PR #668 adversarial finding (round 3): the same
   * unbounded-`allOf`-recursion bug class just fixed in `walkSchema` (via
   * `activeRefs`) was untouched in `collectProperties`/`collectRequired` —
   * the helpers `collectSubtypes` calls for every discriminator's subtypes.
   * Those two functions recursed through `resolved.allOf` with no
   * visited/active-ref guard at all, so a discriminator SUBTYPE whose own
   * `allOf` chain cycles back to itself (not just a growing-path cycle)
   * stack-overflowed discovery instead of terminating.
   */
  test('terminates when a discriminator subtype has a self-cycling allOf chain', () => {
    const bundle = {
      paths: {
        '/nodes': {
          post: {
            operationId: 'createNode',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/NodeRequest' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          NodeRequest: {
            type: 'object',
            discriminator: { propertyName: 'kind' },
            oneOf: [{ $ref: '#/components/schemas/CyclicSubtype' }],
          },
          // The subtype's own `allOf` cycles back to itself — a cycle
          // reachable only through `collectProperties`/`collectRequired`,
          // not through `walkSchema`'s `properties`/`items`/`oneOf`/`anyOf`
          // traversal.
          CyclicSubtype: {
            type: 'object',
            allOf: [{ $ref: '#/components/schemas/CyclicSubtype' }],
            properties: { kind: { type: 'string', enum: ['cyclic'] } },
          },
        },
      },
    };

    expect(() => buildCsharpDiscriminatorTable(bundle)).not.toThrow();
    const table = buildCsharpDiscriminatorTable(bundle);
    expect(table.createNode).toBeDefined();
  });
});

/**
 * Regression coverage for PR #668 review findings (round 3): `collectSubtypes`
 * returned early as soon as a `discriminator.mapping` was present, so any
 * `oneOf`/`anyOf` branch NOT named in that mapping was dropped entirely
 * instead of being collected under its implicit schema-name value (the
 * OpenAPI discriminator spec treats a referenced-but-unmapped branch as
 * still selectable). A discriminator with `ById` explicitly mapped but
 * `ByKey` only referenced via `oneOf` previously had no way to ever select
 * `ByKey`.
 */
describe('buildCsharpDiscriminatorTable — partial discriminator mappings', () => {
  test('still collects a oneOf branch left out of a partial discriminator mapping', () => {
    const bundle = {
      paths: {
        '/jobs': {
          post: {
            operationId: 'activateJob',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/JobFilter' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          JobFilter: {
            type: 'object',
            discriminator: {
              propertyName: 'filterType',
              // Only ById is explicitly mapped — ByKey is referenced via
              // `oneOf` below but has no mapping entry of its own.
              mapping: { byId: '#/components/schemas/ById' },
            },
            oneOf: [
              { $ref: '#/components/schemas/ById' },
              { $ref: '#/components/schemas/ByKey' },
            ],
          },
          ById: { type: 'object', properties: { id: { type: 'string' } } },
          ByKey: { type: 'object', properties: { key: { type: 'string' } } },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    const subtypeValues = (table.activateJob ?? []).flatMap((d) =>
      d.subtypes.map((s) => s.value),
    );
    expect(subtypeValues).toContain('byId');
    expect(subtypeValues).toContain('ByKey');
    const byKey = (table.activateJob ?? [])
      .flatMap((d) => d.subtypes)
      .find((s) => s.value === 'ByKey');
    expect(byKey?.properties).toEqual(['key']);
  });

  test('does not duplicate a oneOf branch that IS covered by the mapping', () => {
    const bundle = {
      paths: {
        '/jobs': {
          post: {
            operationId: 'activateJob',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/JobFilter' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          JobFilter: {
            type: 'object',
            discriminator: {
              propertyName: 'filterType',
              mapping: { byId: '#/components/schemas/ById' },
            },
            oneOf: [{ $ref: '#/components/schemas/ById' }],
          },
          ById: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    const subtypeValues = (table.activateJob ?? []).flatMap((d) =>
      d.subtypes.map((s) => s.value),
    );
    expect(subtypeValues).toEqual(['byId']);
  });
});

/**
 * Regression coverage for PR #668 review finding (round 3, "previously
 * missed"): `collectSubtypes` without a `mapping` only ever iterated
 * `oneOf`, so a discriminator placed on an `anyOf` schema with no explicit
 * mapping got an empty subtype list — discovery found the discriminator via
 * `walkSchema`'s `anyOf` traversal, but selection had nothing to choose
 * from.
 */
describe('buildCsharpDiscriminatorTable — implicit anyOf subtype mapping', () => {
  test('collects anyOf branches into subtypes when there is no explicit mapping', () => {
    const bundle = {
      paths: {
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
          WidgetRequest: {
            type: 'object',
            discriminator: { propertyName: 'kind' },
            anyOf: [
              { $ref: '#/components/schemas/RedWidget' },
              { $ref: '#/components/schemas/BlueWidget' },
            ],
          },
          RedWidget: { type: 'object', properties: { shade: { type: 'string' } } },
          BlueWidget: { type: 'object', properties: { tone: { type: 'string' } } },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    const subtypeValues = (table.createWidget ?? []).flatMap((d) =>
      d.subtypes.map((s) => s.value),
    );
    expect(subtypeValues.sort()).toEqual(['BlueWidget', 'RedWidget']);
  });
});

/**
 * Regression coverage for PR #668 review finding (round 3): request bodies
 * expressed as `{ "$ref": "#/components/requestBodies/X" }` were silently
 * skipped by discriminator discovery because `resolveSchema` only resolved
 * `#/components/schemas/` references — a request-body `$ref` resolved to
 * `undefined`, `content` was then absent, and the whole operation was
 * skipped even though its body carries a discriminator. The extractor
 * already resolves this reference shape
 * (`semantic-graph-extractor/schema-analyzer.ts`).
 */
describe('buildCsharpDiscriminatorTable — request body component references', () => {
  test('resolves a requestBody expressed as a #/components/requestBodies ref', () => {
    const bundle = {
      paths: {
        '/jobs': {
          post: {
            operationId: 'createJob',
            requestBody: { $ref: '#/components/requestBodies/CreateJobRequest' },
          },
        },
      },
      components: {
        schemas: {
          JobFilter: {
            type: 'object',
            discriminator: { propertyName: 'kind' },
            oneOf: [{ $ref: '#/components/schemas/ById' }],
          },
          ById: { type: 'object', properties: { id: { type: 'string' } } },
        },
        requestBodies: {
          CreateJobRequest: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/JobFilter' } },
            },
          },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    expect(table.createJob).toBeDefined();
    expect((table.createJob ?? [])[0]?.propertyName).toBe('kind');
  });
});

/**
 * Regression coverage for PR #668 review finding (round 3, "previously
 * missed"): `resolveSchema` resolved a `$ref` only ONE hop. An alias schema
 * whose own body is itself just `{ "$ref": "..." }` (e.g. `JobResultAlias`
 * pointing at `JobResult`) resolved to an object carrying no fields of its
 * own except the overwritten `$ref`, so a body referencing the alias never
 * saw `JobResult`'s `properties`/`discriminator`/`allOf` — only a DIRECT
 * reference to `JobResult` worked.
 */
describe('buildCsharpDiscriminatorTable — schema alias reference chains', () => {
  test('follows an alias schema (a bare $ref) through to the aliased schema discriminator', () => {
    const bundle = {
      paths: {
        '/jobs': {
          post: {
            operationId: 'createJob',
            requestBody: {
              content: {
                'application/json': {
                  // References the ALIAS, not JobResult directly.
                  schema: { $ref: '#/components/schemas/JobResultAlias' },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          // An alias: its own schema body is nothing but a $ref.
          JobResultAlias: { $ref: '#/components/schemas/JobResult' },
          JobResult: {
            type: 'object',
            discriminator: { propertyName: 'kind' },
            oneOf: [{ $ref: '#/components/schemas/Success' }],
          },
          Success: { type: 'object', properties: { value: { type: 'string' } } },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    expect(table.createJob).toBeDefined();
    expect((table.createJob ?? [])[0]?.propertyName).toBe('kind');
  });

  test('terminates on an alias chain that cycles back on itself', () => {
    const bundle = {
      paths: {
        '/jobs': {
          post: {
            operationId: 'createJob',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/AliasA' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          AliasA: { $ref: '#/components/schemas/AliasB' },
          AliasB: { $ref: '#/components/schemas/AliasA' },
        },
      },
    };

    expect(() => buildCsharpDiscriminatorTable(bundle)).not.toThrow();
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
