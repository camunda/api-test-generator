/**
 * Canonical-schema oneOf/anyOf response descent — camunda/api-test-generator#388.
 *
 * `path-analyser/src/canonicalSchemas.ts:walkSchema` originally resolved only
 * `allOf`; a `oneOf`/`anyOf` composition was recorded as a single leaf and its
 * variant branches were never walked. The semantic-graph extractor, by contrast,
 * descends every union branch when lifting provider leaves. On a spec with a
 * semantic provider nested inside a discriminated-union variant (e.g.
 * camunda/camunda's `searchAgentInstanceHistory`, whose
 * `AgentInstanceMessageContent` DOCUMENT variant carries
 * `content[].documentReference.documentId`), that divergence made the
 * canonical-path validator report a false extractor↔bundler mismatch and abort
 * the positive pipeline.
 *
 * Guarded here:
 *   1. the RESPONSE shape descends `oneOf`/`anyOf` so variant-nested paths
 *      (incl. provider leaves) appear, matching the extractor;
 *   2. the REQUEST shape does NOT descend unions — merging mutually-exclusive
 *      variants would synthesise invalid request bodies.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCanonicalShapes } from '../../../path-analyser/src/canonicalSchemas.ts';

interface ScratchDir {
  root: string;
  specPath: string;
  prevEnv: string | undefined;
}

function scratchSpec(spec: object): ScratchDir {
  const root = mkdtempSync(join(tmpdir(), 'canonical-oneof-'));
  const specPath = join(root, 'rest-api.bundle.json');
  writeFileSync(specPath, JSON.stringify(spec));
  const prevEnv = process.env.OPENAPI_SPEC_PATH;
  process.env.OPENAPI_SPEC_PATH = specPath;
  return { root, specPath, prevEnv };
}

function teardown(s: ScratchDir): void {
  if (s.prevEnv === undefined) delete process.env.OPENAPI_SPEC_PATH;
  else process.env.OPENAPI_SPEC_PATH = s.prevEnv;
  rmSync(s.root, { recursive: true, force: true });
}

describe('canonicalSchemas: oneOf/anyOf response descent (#388)', () => {
  let scratch: ScratchDir | undefined;
  afterEach(() => {
    if (scratch) teardown(scratch);
    scratch = undefined;
  });

  it('descends oneOf variants in the response shape so a variant-nested provider leaf appears', async () => {
    scratch = scratchSpec({
      openapi: '3.0.0',
      paths: {
        '/history/search': {
          post: {
            operationId: 'searchHistory',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/HistorySearchResult' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          HistorySearchResult: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { $ref: '#/components/schemas/HistoryItem' } },
            },
          },
          HistoryItem: {
            type: 'object',
            properties: {
              content: { type: 'array', items: { $ref: '#/components/schemas/MessageContent' } },
            },
          },
          // Discriminated union: the DOCUMENT variant carries the provider leaf.
          MessageContent: {
            oneOf: [
              { $ref: '#/components/schemas/TextContent' },
              { $ref: '#/components/schemas/DocumentContent' },
            ],
          },
          TextContent: { type: 'object', properties: { text: { type: 'string' } } },
          DocumentContent: {
            type: 'object',
            properties: { documentReference: { $ref: '#/components/schemas/DocumentReference' } },
          },
          DocumentReference: {
            type: 'object',
            properties: {
              documentId: { type: 'string', 'x-semantic-provider': true },
            },
          },
        },
      },
    });

    const shapes = await buildCanonicalShapes('/unused-because-env-overrides');
    const response = shapes.searchHistory?.response;
    expect(response).toBeDefined();
    const paths = (response ?? []).map((n) => n.path);
    // The provider leaf nested inside the DOCUMENT oneOf variant must surface.
    expect(paths).toContain('items[].content[].documentReference.documentId');
    // The sibling TEXT variant's leaf is also reachable (union of branches).
    expect(paths).toContain('items[].content[].text');
  });

  it('does NOT descend a oneOf in the request shape (variants stay un-merged)', async () => {
    scratch = scratchSpec({
      openapi: '3.0.0',
      paths: {
        '/things': {
          post: {
            operationId: 'createThing',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ThingCreate' },
                },
              },
            },
            responses: { '201': { description: 'ok' } },
          },
        },
      },
      components: {
        schemas: {
          ThingCreate: {
            type: 'object',
            properties: { payload: { $ref: '#/components/schemas/PayloadUnion' } },
          },
          PayloadUnion: {
            oneOf: [
              { $ref: '#/components/schemas/VariantA' },
              { $ref: '#/components/schemas/VariantB' },
            ],
          },
          VariantA: { type: 'object', properties: { aOnly: { type: 'string' } } },
          VariantB: { type: 'object', properties: { bOnly: { type: 'string' } } },
        },
      },
    });

    const shapes = await buildCanonicalShapes('/unused-because-env-overrides');
    const request = shapes.createThing?.requestByMediaType?.['application/json'];
    expect(request).toBeDefined();
    const paths = (request ?? []).map((n) => n.path);
    // The request walk must NOT merge mutually-exclusive variant props.
    expect(paths).not.toContain('payload.aOnly');
    expect(paths).not.toContain('payload.bOnly');
  });

  it('descends oneOf variants even when the schema also declares an explicit `type`', async () => {
    // OpenAPI permits `type` alongside `oneOf`/`anyOf` (a base object whose
    // variants add fields). The descent must still walk the variants so a
    // provider leaf nested in one is not skipped, while the base object's own
    // properties are also walked.
    scratch = scratchSpec({
      openapi: '3.0.0',
      paths: {
        '/events/search': {
          post: {
            operationId: 'searchEvents',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/EventEnvelope' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          // Base object (own property `kind`) that is ALSO a oneOf union.
          EventEnvelope: {
            type: 'object',
            properties: { kind: { type: 'string' } },
            oneOf: [
              { $ref: '#/components/schemas/CreatedEvent' },
              { $ref: '#/components/schemas/DeletedEvent' },
            ],
          },
          CreatedEvent: {
            type: 'object',
            properties: {
              createdResourceKey: { type: 'string', 'x-semantic-provider': true },
            },
          },
          DeletedEvent: { type: 'object', properties: { deletedAt: { type: 'string' } } },
        },
      },
    });

    const shapes = await buildCanonicalShapes('/unused-because-env-overrides');
    const paths = (shapes.searchEvents?.response ?? []).map((n) => n.path);
    // Base object's own property is walked...
    expect(paths).toContain('kind');
    // ...AND the provider leaf nested in a variant is not skipped.
    expect(paths).toContain('createdResourceKey');
  });

  it('walks a component schema referenced under two sibling paths (seen is per-branch, not global)', async () => {
    // `seen` guards against $ref cycles along one path; it must NOT act as a
    // global "visited anywhere" set, or a schema referenced under two sibling
    // properties (or two oneOf variants) would be walked once and the second
    // occurrence's paths would silently vanish from the canonical shape —
    // reintroducing the extractor↔bundler divergence (#389 review).
    scratch = scratchSpec({
      openapi: '3.0.0',
      paths: {
        '/refs/search': {
          post: {
            operationId: 'searchRefs',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/RefPair' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          RefPair: {
            type: 'object',
            properties: {
              left: { $ref: '#/components/schemas/DocRef' },
              right: { $ref: '#/components/schemas/DocRef' },
            },
          },
          DocRef: {
            type: 'object',
            properties: { documentId: { type: 'string', 'x-semantic-provider': true } },
          },
        },
      },
    });

    const shapes = await buildCanonicalShapes('/unused-because-env-overrides');
    const paths = (shapes.searchRefs?.response ?? []).map((n) => n.path);
    // Both sibling references to the shared DocRef schema must be walked.
    expect(paths).toContain('left.documentId');
    expect(paths).toContain('right.documentId');
  });
});
