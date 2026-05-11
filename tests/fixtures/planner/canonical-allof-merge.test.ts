/**
 * Canonical-schema merge fixtures — camunda/api-test-generator#152.
 *
 * `path-analyser/src/canonicalSchemas.ts:resolveSchema` collapses an
 * `allOf` composition into a fresh `{}` and folds each branch with
 * `Object.assign`. That silently drops any `properties` / `required`
 * defined on the *wrapping* schema itself.
 *
 * The bundled spec hits this for every "type: object + allOf + own
 * properties" CRUD-create body, e.g. `MappingRuleCreateRequest`,
 * `GlobalTaskListenerCreateRequest`, where the wrapping schema's only
 * job is to add the establisher identifier (`mappingRuleId`, `id`).
 * Pre-fix: identifier missing from canonical request → planner emits a
 * body without it → live-broker 400.
 *
 * Class-scoped invariant guarded here: any property declared on a
 * wrapping schema with both `allOf` and its own `properties` must
 * appear in the canonical request shape, with its `required` flag
 * preserved.
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
  const root = mkdtempSync(join(tmpdir(), 'canonical-allof-'));
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

describe('canonicalSchemas: allOf wrapper preserves wrapping properties (#152)', () => {
  let scratch: ScratchDir | undefined;
  afterEach(() => {
    if (scratch) teardown(scratch);
    scratch = undefined;
  });

  it('preserves wrapping properties when wrapping schema has allOf and own properties', async () => {
    scratch = scratchSpec({
      openapi: '3.0.0',
      paths: {
        '/widgets': {
          post: {
            operationId: 'createWidget',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/WidgetCreateRequest' },
                },
              },
            },
            responses: { '201': { description: 'ok' } },
          },
        },
      },
      components: {
        schemas: {
          WidgetBase: {
            type: 'object',
            properties: { color: { type: 'string' }, size: { type: 'integer' } },
            required: ['color'],
          },
          WidgetCreateRequest: {
            type: 'object',
            allOf: [{ $ref: '#/components/schemas/WidgetBase' }],
            properties: {
              widgetId: { type: 'string', description: 'minted by client' },
            },
            required: ['widgetId'],
          },
        },
      },
    });

    const shapes = await buildCanonicalShapes('/unused-because-env-overrides');
    const json = shapes.createWidget?.requestByMediaType?.['application/json'];
    expect(json).toBeDefined();
    const leaves = (json ?? []).map((n) => ({ path: n.path, required: n.required }));
    // Wrapping schema's own property must survive the allOf merge.
    expect(leaves).toContainEqual({ path: 'widgetId', required: true });
    // allOf branch contributions must also survive.
    expect(leaves).toContainEqual({ path: 'color', required: true });
    expect(leaves).toContainEqual({ path: 'size', required: false });
  });

  it("unions 'required' across allOf branches and the wrapping schema", async () => {
    scratch = scratchSpec({
      openapi: '3.0.0',
      paths: {
        '/items': {
          post: {
            operationId: 'createItem',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ItemCreate' },
                },
              },
            },
            responses: { '201': { description: 'ok' } },
          },
        },
      },
      components: {
        schemas: {
          ItemCreate: {
            type: 'object',
            allOf: [
              {
                type: 'object',
                properties: { a: { type: 'string' }, b: { type: 'string' } },
                required: ['a'],
              },
              {
                type: 'object',
                properties: { c: { type: 'string' } },
                required: ['c'],
              },
            ],
            properties: { d: { type: 'string' } },
            required: ['d'],
          },
        },
      },
    });

    const shapes = await buildCanonicalShapes('/unused');
    const json = shapes.createItem?.requestByMediaType?.['application/json'] ?? [];
    const byPath = new Map(json.map((n) => [n.path, n.required]));
    expect(byPath.get('a')).toBe(true);
    expect(byPath.get('b')).toBe(false);
    expect(byPath.get('c')).toBe(true);
    expect(byPath.get('d')).toBe(true);
  });

  it('merges nested object properties across allOf branches without dropping siblings', async () => {
    // Defensive: confirm the merge is property-wise, not last-write-wins
    // on the whole `properties` object.
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
            allOf: [
              { type: 'object', properties: { x: { type: 'string' } } },
              { type: 'object', properties: { y: { type: 'string' } } },
            ],
          },
        },
      },
    });

    const shapes = await buildCanonicalShapes('/unused');
    const paths = (shapes.createThing?.requestByMediaType?.['application/json'] ?? []).map(
      (n) => n.path,
    );
    expect(paths).toContain('x');
    expect(paths).toContain('y');
  });
});
