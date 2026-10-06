import { describe, expect, test } from 'vitest';
import {
  buildCsharpDiscriminatorTable,
  type CsharpDiscriminator,
  chooseCsharpDiscriminator,
  findExplicitCsharpDiscriminatorRef,
  resolveCsharpDiscriminatorChain,
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
            oneOf: [{ $ref: '#/components/schemas/ById' }, { $ref: '#/components/schemas/ByKey' }],
          },
          ById: { type: 'object', properties: { id: { type: 'string' } } },
          ByKey: { type: 'object', properties: { key: { type: 'string' } } },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    const subtypeValues = (table.activateJob ?? []).flatMap((d) => d.subtypes.map((s) => s.value));
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
    const subtypeValues = (table.activateJob ?? []).flatMap((d) => d.subtypes.map((s) => s.value));
    expect(subtypeValues).toEqual(['byId']);
  });

  /**
   * Regression coverage for adversarial round-3 finding: a `discriminator.
   * mapping` value is permitted by the OpenAPI spec to be a BARE schema
   * name (e.g. `"ById"`) instead of a full `$ref` string. Before this fix,
   * `collectUnmappedSubtypes` deduped by exact string match against the raw
   * mapping value, so a bare name never matched the `oneOf`/`anyOf` branch's
   * full `$ref` string — producing a second, broken (empty-properties)
   * subtype entry for the same branch on top of the correct one.
   */
  test('does not duplicate a oneOf branch mapped via a bare schema-name value', () => {
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
              // Bare schema name, not a `$ref` string — valid per spec.
              mapping: { byId: 'ById' },
            },
            oneOf: [{ $ref: '#/components/schemas/ById' }, { $ref: '#/components/schemas/ByKey' }],
          },
          ById: { type: 'object', properties: { id: { type: 'string' } } },
          ByKey: { type: 'object', properties: { key: { type: 'string' } } },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    const subtypes = (table.activateJob ?? []).flatMap((d) => d.subtypes);
    // Exactly one entry for the mapped branch (under its mapping value),
    // and it must resolve its properties — not come back empty.
    expect(subtypes.filter((s) => s.value === 'byId' || s.value === 'ById')).toHaveLength(1);
    const byId = subtypes.find((s) => s.value === 'byId' || s.value === 'ById');
    expect(byId?.properties).toEqual(['id']);
    expect(subtypes.map((s) => s.value)).toContain('ByKey');
  });

  /**
   * Regression coverage for adversarial round-3 finding: calling
   * `collectUnmappedSubtypes` separately for `oneOf` and `anyOf` without
   * sharing already-emitted refs let the same `$ref` listed in BOTH produce
   * a duplicate subtype entry.
   */
  test('does not duplicate a $ref listed in both oneOf and anyOf', () => {
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
            oneOf: [{ $ref: '#/components/schemas/RedWidget' }],
            anyOf: [{ $ref: '#/components/schemas/RedWidget' }],
          },
          RedWidget: { type: 'object', properties: { shade: { type: 'string' } } },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    const subtypes = (table.createWidget ?? []).flatMap((d) => d.subtypes);
    expect(subtypes.filter((s) => s.value === 'RedWidget')).toHaveLength(1);
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
    const subtypeValues = (table.createWidget ?? []).flatMap((d) => d.subtypes.map((s) => s.value));
    expect(subtypeValues.sort()).toEqual(['BlueWidget', 'RedWidget']);
  });
});

/**
 * Regression coverage for PR #668 review finding (round 4, "previously
 * missed"): `walkSchema` only descended into a schema's OWN `allOf` /
 * `oneOf` / `anyOf` array entries. A mapping-only subtype — one reached
 * exclusively through `discriminator.mapping`, using `allOf` inheritance
 * (the SUBTYPE's schema carries `allOf: [{ $ref: <base with the
 * discriminator> }]`, not the other way around) rather than appearing as a
 * `oneOf`/`anyOf` branch of the base — was therefore never walked at all,
 * so a discriminator nested inside ITS OWN properties (e.g.
 * `Success.payload`) never made it into the table even though
 * `collectSubtypes` already resolves that same mapping target correctly
 * for subtype SELECTION.
 */
describe('buildCsharpDiscriminatorTable — mapping-only subtype traversal', () => {
  test('finds a discriminator nested inside a subtype reached only via discriminator.mapping (allOf inheritance)', () => {
    const bundle = {
      paths: {
        '/results': {
          post: {
            operationId: 'createResult',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Result' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Result: {
            type: 'object',
            discriminator: {
              propertyName: 'status',
              mapping: { success: '#/components/schemas/Success' },
            },
            // No oneOf/anyOf: `Success` is reachable ONLY via `mapping`.
          },
          // `Success` points BACK at `Result` via `allOf`, rather than
          // `Result` listing `Success` under `oneOf`/`anyOf`.
          Success: {
            type: 'object',
            allOf: [{ $ref: '#/components/schemas/Result' }],
            properties: {
              payload: { $ref: '#/components/schemas/Payload' },
            },
          },
          Payload: {
            type: 'object',
            discriminator: { propertyName: 'kind' },
            oneOf: [
              { $ref: '#/components/schemas/TextPayload' },
              { $ref: '#/components/schemas/JsonPayload' },
            ],
          },
          TextPayload: { type: 'object', properties: { text: { type: 'string' } } },
          JsonPayload: { type: 'object', properties: { data: { type: 'object' } } },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    const paths = (table.createResult ?? []).map((d) => d.path);
    expect(paths).toContain('');
    expect(paths).toContain('payload');
    const payloadEntry = (table.createResult ?? []).find((d) => d.path === 'payload');
    expect(payloadEntry?.subtypes.map((s) => s.value).sort()).toEqual([
      'JsonPayload',
      'TextPayload',
    ]);
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

/**
 * Regression coverage for PR #668 review finding (round 5): walking every
 * union branch's OWN property tree at the same `path` loses which parent
 * branch a nested discriminator belongs to. Two sibling branches (`Success`
 * and `Failure`) can each define their OWN polymorphic `payload` property —
 * or one can leave it non-polymorphic / absent entirely — and without an
 * owner tag, `chooseCsharpDiscriminator` applied whichever entry it found at
 * that path regardless of which branch was actually selected.
 */
describe('buildCsharpDiscriminatorTable — ownerRef tags a nested discriminator to its branch', () => {
  const bundle = {
    paths: {
      '/results': {
        post: {
          operationId: 'createResult',
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Result' } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Result: {
          type: 'object',
          discriminator: { propertyName: 'status' },
          oneOf: [
            { $ref: '#/components/schemas/Success' },
            { $ref: '#/components/schemas/Failure' },
          ],
        },
        // Only `Success` defines a polymorphic `payload`; `Failure`'s
        // `payload` (if any) is a plain, non-discriminated object.
        Success: {
          type: 'object',
          properties: {
            payload: { $ref: '#/components/schemas/Payload' },
          },
        },
        Failure: {
          type: 'object',
          properties: {
            payload: { type: 'object', properties: { text: { type: 'string' } } },
          },
        },
        Payload: {
          type: 'object',
          discriminator: { propertyName: 'kind' },
          oneOf: [{ $ref: '#/components/schemas/TextPayload' }],
        },
        TextPayload: { type: 'object', properties: { text: { type: 'string' } } },
      },
    },
  };

  test('tags the nested payload entry with the owning Success ref, not unconditional', () => {
    const table = buildCsharpDiscriminatorTable(bundle);
    const payloadEntry = (table.createResult ?? []).find((d) => d.path === 'payload');
    expect(payloadEntry?.ownerRef).toBe('#/components/schemas/Success');
  });

  test('tags the top-level Success/Failure entry with no owner (unconditional)', () => {
    const table = buildCsharpDiscriminatorTable(bundle);
    const topEntry = (table.createResult ?? []).find((d) => d.path === '');
    expect(topEntry?.ownerRef).toBeUndefined();
    expect(topEntry?.subtypes.map((s) => s.ref)).toEqual([
      '#/components/schemas/Success',
      '#/components/schemas/Failure',
    ]);
  });
});

/**
 * Regression coverage for PR #668 review round 6 (adversarial finding): a
 * schema SHARED by two sibling `oneOf`/`anyOf` branches at the SAME nested
 * path (e.g. both `BranchA.payload` and `BranchB.payload` point at the same
 * `Base` schema, which itself declares its own discriminator) must get ONE
 * table entry per owning branch, not just the first-visited branch's. Before
 * including `ownerRef` in `walkSchema`'s `visited` dedup key, the second
 * branch's otherwise-identical entry was silently dropped, so
 * `chooseCsharpDiscriminator` could never select `Base`'s nested
 * discriminator when the second-visited branch was the one actually chosen
 * at render time.
 */
describe('buildCsharpDiscriminatorTable — shared nested schema reached via two sibling branches', () => {
  const bundle = {
    paths: {
      '/wraps': {
        post: {
          operationId: 'createWrap',
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Wrap' } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Wrap: {
          type: 'object',
          discriminator: { propertyName: 'kind' },
          oneOf: [
            { $ref: '#/components/schemas/BranchA' },
            { $ref: '#/components/schemas/BranchB' },
          ],
        },
        // Both sibling branches declare a `payload` property pointing at the
        // SAME `Base` schema — `Base`'s own discriminator is logically
        // independent of which branch was chosen.
        BranchA: {
          type: 'object',
          properties: { payload: { $ref: '#/components/schemas/Base' } },
        },
        BranchB: {
          type: 'object',
          properties: { payload: { $ref: '#/components/schemas/Base' } },
        },
        Base: {
          type: 'object',
          discriminator: { propertyName: 'baseKind' },
          oneOf: [{ $ref: '#/components/schemas/TextPayload' }],
        },
        TextPayload: { type: 'object', properties: { text: { type: 'string' } } },
      },
    },
  };

  test('produces one wrap.payload entry per owning sibling branch, not just the first-visited one', () => {
    const table = buildCsharpDiscriminatorTable(bundle);
    const payloadEntries = (table.createWrap ?? []).filter((d) => d.path === 'payload');
    const owners = payloadEntries.map((entry) => entry.ownerRef).sort();
    expect(owners).toEqual(['#/components/schemas/BranchA', '#/components/schemas/BranchB'].sort());
  });

  test('chooseCsharpDiscriminator selects Base.baseKind regardless of which sibling branch owns the render', () => {
    const table = buildCsharpDiscriminatorTable(bundle);
    const payloadEntries = (table.createWrap ?? []).filter((d) => d.path === 'payload');
    expect(
      chooseCsharpDiscriminator(
        {},
        payloadEntries,
        'payload',
        new Set(['#/components/schemas/BranchA']),
      ),
    ).toEqual({ name: 'baseKind', value: 'TextPayload', ref: '#/components/schemas/TextPayload' });
    expect(
      chooseCsharpDiscriminator(
        {},
        payloadEntries,
        'payload',
        new Set(['#/components/schemas/BranchB']),
      ),
    ).toEqual({ name: 'baseKind', value: 'TextPayload', ref: '#/components/schemas/TextPayload' });
  });
});

/**
 * Regression coverage for `chooseCsharpDiscriminator`'s new `ownerChain`
 * parameter and `findExplicitCsharpDiscriminatorRef` (PR #668 review, round
 * 5): a same-path entry scoped to a specific branch (`ownerRef`) must be
 * excluded from selection unless that branch's ref is in the active owner
 * chain, and an EXPLICIT discriminator field in the data must still surface
 * its branch's ref so a nested discriminator further down recognises it.
 */
describe('chooseCsharpDiscriminator / findExplicitCsharpDiscriminatorRef — owner chain scoping', () => {
  const successPayload: CsharpDiscriminator = {
    path: 'payload',
    propertyName: 'kind',
    ownerRef: '#/components/schemas/Success',
    subtypes: [{ value: 'Text', properties: ['text'], required: ['text'] }],
  };
  const topLevel: CsharpDiscriminator = {
    path: '',
    propertyName: 'status',
    subtypes: [
      {
        value: 'Success',
        properties: ['payload'],
        required: [],
        ref: '#/components/schemas/Success',
      },
      {
        value: 'Failure',
        properties: ['payload'],
        required: [],
        ref: '#/components/schemas/Failure',
      },
    ],
  };

  test('excludes an owner-scoped entry when the owner is not in the chain', () => {
    expect(
      chooseCsharpDiscriminator({ text: 'hi' }, [successPayload], 'payload', new Set()),
    ).toBeUndefined();
    expect(
      chooseCsharpDiscriminator(
        { text: 'hi' },
        [successPayload],
        'payload',
        new Set(['#/components/schemas/Failure']),
      ),
    ).toBeUndefined();
  });

  test('includes an owner-scoped entry once its owner ref is in the chain, and surfaces the selected ref', () => {
    expect(
      chooseCsharpDiscriminator(
        { text: 'hi' },
        [successPayload],
        'payload',
        new Set(['#/components/schemas/Success']),
      ),
    ).toEqual({ name: 'kind', value: 'Text', ref: undefined });
  });

  test('an unconditional entry (no ownerRef) applies regardless of the chain', () => {
    expect(chooseCsharpDiscriminator({}, [topLevel], '', new Set())).toEqual({
      name: 'status',
      value: 'Success',
      ref: '#/components/schemas/Success',
    });
  });

  test('findExplicitCsharpDiscriminatorRef resolves the ref of an already-explicit field', () => {
    expect(
      findExplicitCsharpDiscriminatorRef({ status: 'Failure' }, [topLevel], '', new Set()),
    ).toBe('#/components/schemas/Failure');
  });

  test('findExplicitCsharpDiscriminatorRef respects owner-chain scoping too', () => {
    const scopedTop: CsharpDiscriminator = { ...topLevel, ownerRef: '#/components/schemas/Other' };
    expect(
      findExplicitCsharpDiscriminatorRef({ status: 'Failure' }, [scopedTop], '', new Set()),
    ).toBeUndefined();
  });

  test('findExplicitCsharpDiscriminatorRef returns undefined for an unrecognised explicit value', () => {
    expect(
      findExplicitCsharpDiscriminatorRef({ status: 'Unknown' }, [topLevel], '', new Set()),
    ).toBeUndefined();
  });
});

/**
 * Regression coverage for PR #668 review finding (round 7):
 * `chooseCsharpDiscriminator`/`findExplicitCsharpDiscriminatorRef` each only
 * see entries eligible under the `ownerChain` they are GIVEN, so a single
 * call per object can never pick up a SECOND discriminator at the SAME path
 * that only becomes eligible once the FIRST one's ref is added to the
 * chain. `resolveCsharpDiscriminatorChain` loops both resolvers at the same
 * path until a pass adds no new owner ref.
 */
describe('resolveCsharpDiscriminatorChain — same-object chained discriminators (PR #668 review, round 7)', () => {
  const SUCCESS_REF = '#/components/schemas/Success';
  const TEXT_REF = '#/components/schemas/TextKind';

  // NOTE: these `properties`/`required` lists are deliberately NOT
  // hand-flattened to include a nested subtype's fields (e.g. `Success`
  // does NOT list `text`, which belongs only to `Text`) — that flattening
  // is not a shape `collectSubtypes`/`buildCsharpDiscriminatorTable` ever
  // produces (it merges a WRAPPER's own sibling properties into its direct
  // subtypes, never a nested `oneOf` branch's fields). `chooseCsharpDiscriminator`
  // is responsible for seeing past this via `collectChainedSubtypeProperties`
  // (PR #668 review, round 8 / adversarial finding, process round 5) — see
  // `realistic chained oneOf-within-oneOf schema (no hand-flattening)` below
  // for an end-to-end regression built from `buildCsharpDiscriminatorTable`
  // itself.
  const family: CsharpDiscriminator = {
    path: 'result',
    propertyName: 'family',
    subtypes: [
      { value: 'Success', properties: ['family', 'kind'], required: [], ref: SUCCESS_REF },
      { value: 'Failure', properties: ['family'], required: [] },
    ],
  };
  const kind: CsharpDiscriminator = {
    path: 'result',
    propertyName: 'kind',
    ownerRef: SUCCESS_REF,
    subtypes: [{ value: 'Text', properties: ['kind', 'tag'], required: [], ref: TEXT_REF }],
  };
  const tag: CsharpDiscriminator = {
    path: 'result',
    propertyName: 'tag',
    ownerRef: TEXT_REF,
    subtypes: [{ value: 'Plain', properties: ['tag', 'text'], required: ['text'] }],
  };
  const entries = [family, kind, tag];

  test('injects a chain of implicit same-object discriminators and returns the full owner chain', () => {
    const result = resolveCsharpDiscriminatorChain({ text: 'hi' }, entries, 'result');
    expect(result.fields).toEqual([
      ['family', 'Success'],
      ['kind', 'Text'],
      ['tag', 'Plain'],
    ]);
    expect(result.ownerChain).toEqual(new Set([SUCCESS_REF, TEXT_REF]));
  });

  test('recognises an explicit outer tag and still chains the rest from it', () => {
    const result = resolveCsharpDiscriminatorChain(
      { family: 'Success', text: 'hi' },
      entries,
      'result',
    );
    expect(result.fields).toEqual([
      ['kind', 'Text'],
      ['tag', 'Plain'],
    ]);
    expect(result.ownerChain).toEqual(new Set([SUCCESS_REF, TEXT_REF]));
  });

  test('explicit tags at BOTH the outer AND intermediate level still resolve the remainder (PR #668 review, round 8)', () => {
    // `family` and `kind` are both explicit, pointing at the same already-
    // selected `Success`/`TextKind` refs that `findExplicitCsharpDiscriminatorRef`
    // would otherwise keep re-returning -- it must skip past the already-
    // recorded `family` match to reach the still-unresolved `kind` match
    // instead of stalling before `tag` is ever considered.
    const result = resolveCsharpDiscriminatorChain(
      { family: 'Success', kind: 'Text', text: 'hi' },
      entries,
      'result',
    );
    expect(result.fields).toEqual([['tag', 'Plain']]);
    expect(result.ownerChain).toEqual(new Set([SUCCESS_REF, TEXT_REF]));
  });

  test('a branch with no further same-object discriminator terminates after one field', () => {
    const result = resolveCsharpDiscriminatorChain({ family: 'Failure' }, entries, 'result');
    expect(result.fields).toEqual([]);
    expect(result.ownerChain).toEqual(new Set());
  });

  test('starting mid-chain (an already-resolved ownerChain) still resolves the remainder', () => {
    const result = resolveCsharpDiscriminatorChain(
      { text: 'hi' },
      entries,
      'result',
      new Set([SUCCESS_REF]),
    );
    expect(result.fields).toEqual([
      ['kind', 'Text'],
      ['tag', 'Plain'],
    ]);
    expect(result.ownerChain).toEqual(new Set([SUCCESS_REF, TEXT_REF]));
  });

  /**
   * Adversarial finding (process round 5): the unit tests above all hand-
   * construct each entry's `properties` list to already include the
   * transitively-nested inner subtype's fields — a shape
   * `buildCsharpDiscriminatorTable` never actually produces, since
   * `collectProperties` only walks `properties`/`allOf`, never `oneOf`/
   * `anyOf`. Verified directly against `buildCsharpDiscriminatorTable`'s
   * real output (no hand-flattening) that the implicit (no explicit outer
   * tag in the request body) case the round-7 commit claims to resolve
   * actually resolves, through a REAL `Result -oneOf-> Success -oneOf
   * (own discriminator)-> Text -oneOf (own discriminator)-> Plain` chain.
   */
  test('realistic chained oneOf-within-oneOf schema (no hand-flattening)', () => {
    const bundle = {
      paths: {
        '/results': {
          post: {
            operationId: 'createResult',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Result' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Result: {
            type: 'object',
            properties: {
              result: {
                type: 'object',
                discriminator: { propertyName: 'family' },
                oneOf: [
                  { $ref: '#/components/schemas/Success' },
                  { $ref: '#/components/schemas/Failure' },
                ],
              },
            },
          },
          Success: {
            type: 'object',
            discriminator: { propertyName: 'kind' },
            properties: { family: { type: 'string' }, kind: { type: 'string' } },
            oneOf: [{ $ref: '#/components/schemas/TextKind' }],
          },
          Failure: {
            type: 'object',
            properties: { family: { type: 'string' } },
          },
          TextKind: {
            type: 'object',
            discriminator: { propertyName: 'tag' },
            properties: { kind: { type: 'string' }, tag: { type: 'string' } },
            oneOf: [{ $ref: '#/components/schemas/Plain' }],
          },
          Plain: {
            type: 'object',
            required: ['text'],
            properties: { tag: { type: 'string' }, text: { type: 'string' } },
          },
        },
      },
    };

    const table = buildCsharpDiscriminatorTable(bundle);
    const entries = table.createResult ?? [];
    expect(entries.map((e) => e.propertyName).sort()).toEqual(['family', 'kind', 'tag']);

    // None of the real entries' subtype `properties` lists include a
    // sibling-nested subtype's own fields (confirming the fixtures above
    // were the unrealistic flattening, not this one).
    const successEntry = entries.find((e) => e.propertyName === 'family');
    const success = successEntry?.subtypes.find((s) => s.value === 'Success');
    expect(success?.properties).not.toContain('text');
    expect(success?.properties).not.toContain('tag');

    const result = resolveCsharpDiscriminatorChain({ text: 'hi' }, entries, 'result');
    expect(result.fields).toEqual([
      ['family', 'Success'],
      ['kind', 'TextKind'],
      ['tag', 'Plain'],
    ]);
  });
});

/**
 * Regression coverage for PR #668 review "Previously missed" advisory
 * (round 7): a discriminated wrapper can declare its OWN common fields as
 * siblings of `discriminator`/`oneOf` (not merged into every branch via
 * `allOf`). A branch's own subtype schema then has no properties beyond
 * what it adds itself, so a value that ALSO sets the wrapper's common
 * fields was rejected as "extra properties" by `chooseCsharpDiscriminator`,
 * which silently omitted the discriminator entirely instead of selecting
 * the matching branch.
 */
describe('buildCsharpDiscriminatorTable — wrapper-declared common fields merge into every subtype', () => {
  const bundle = {
    paths: {
      '/jobs': {
        post: {
          operationId: 'activateJob',
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Wrapper' } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Wrapper: {
          type: 'object',
          // `common` is declared directly on the wrapper, NOT folded into
          // `A`/`B` via `allOf` — the pre-existing pattern this fix adds to.
          properties: { common: { type: 'string' } },
          required: ['common'],
          discriminator: { propertyName: 'kind' },
          oneOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
        },
        A: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        B: { type: 'object', properties: { b: { type: 'string' } } },
      },
    },
  };

  test('every subtype carries the wrapper-declared common property and requirement', () => {
    const table = buildCsharpDiscriminatorTable(bundle);
    const subtypes = (table.activateJob ?? []).flatMap((d) => d.subtypes);
    const a = subtypes.find((s) => s.value === 'A');
    const b = subtypes.find((s) => s.value === 'B');
    expect(a?.properties).toEqual(expect.arrayContaining(['a', 'common']));
    expect(a?.required).toEqual(expect.arrayContaining(['common']));
    expect(b?.properties).toEqual(expect.arrayContaining(['b', 'common']));
  });

  test('chooseCsharpDiscriminator selects the matching branch for a value that also sets the common field', () => {
    const table = buildCsharpDiscriminatorTable(bundle);
    const entries = table.activateJob ?? [];
    expect(chooseCsharpDiscriminator({ common: 'c', a: 'x' }, entries, '')).toEqual({
      name: 'kind',
      value: 'A',
      ref: '#/components/schemas/A',
    });
  });
});
