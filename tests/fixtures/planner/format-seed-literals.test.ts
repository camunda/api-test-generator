/**
 * Canonical-schema format capture — camunda/api-test-generator#397.
 *
 * `path-analyser/src/canonicalSchemas.ts:walkSchema` captures the OpenAPI
 * `format` keyword on leaf scalar nodes so that `buildRequestBodyFromCanonical`
 * can emit format-valid literals (e.g. `"00000000-0000-4000-8000-000000000001"`
 * for `format: uuid`) instead of generic `${varName}` seeds that fail
 * server-side format validation. `format: email` is the one exception: it is
 * routed through the `seed-rules.json` runtime rule (`seed-${rand:6}@example.com`)
 * so addresses vary per call and `{ unique: true }` bindings still apply.
 *
 * Class-scoped invariant guarded here: a required scalar field with `format`
 * declared in the OpenAPI spec must carry that format string on its
 * `CanonicalNodeMeta.format` field after `buildCanonicalShapes`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCanonicalShapes } from '../../../path-analyser/src/canonicalSchemas.ts';

interface ScratchDir {
  root: string;
  prevEnv: string | undefined;
}

function scratchSpec(spec: object): ScratchDir {
  const root = mkdtempSync(join(tmpdir(), 'canonical-format-'));
  const specPath = join(root, 'rest-api.bundle.json');
  writeFileSync(specPath, JSON.stringify(spec));
  const prevEnv = process.env.OPENAPI_SPEC_PATH;
  process.env.OPENAPI_SPEC_PATH = specPath;
  return { root, prevEnv };
}

function teardown(s: ScratchDir): void {
  if (s.prevEnv === undefined) delete process.env.OPENAPI_SPEC_PATH;
  else process.env.OPENAPI_SPEC_PATH = s.prevEnv;
  rmSync(s.root, { recursive: true, force: true });
}

describe('canonicalSchemas: format keyword captured on leaf nodes (#397)', () => {
  let scratch: ScratchDir | undefined;
  afterEach(() => {
    if (scratch) teardown(scratch);
    scratch = undefined;
  });

  it('captures format: email on a required request body field', async () => {
    scratch = scratchSpec({
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/workspaces/{workspaceKey}/collaborators': {
          post: {
            operationId: 'addCollaborator',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['email', 'role'],
                    properties: {
                      email: { type: 'string', format: 'email' },
                      role: { type: 'string', enum: ['workspace_admin', 'workspace_member'] },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    });

    const shapes = await buildCanonicalShapes(scratch.root);
    const shape = shapes.addCollaborator;
    expect(shape, 'addCollaborator must be present in canonical shapes').toBeTruthy();

    const nodes = shape?.requestByMediaType?.['application/json'] ?? [];
    const emailNode = nodes.find((n) => n.path === 'email');
    expect(emailNode, 'email field must be in canonical request nodes').toBeTruthy();
    expect(emailNode?.format).toBe('email');
    expect(emailNode?.required).toBe(true);
  });

  it('captures format: uuid', async () => {
    scratch = scratchSpec({
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/items': {
          post: {
            operationId: 'createItem',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['correlationKey'],
                    properties: {
                      correlationKey: { type: 'string', format: 'uuid' },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    });

    const shapes = await buildCanonicalShapes(scratch.root);
    const nodes = shapes.createItem?.requestByMediaType?.['application/json'] ?? [];
    const node = nodes.find((n) => n.path === 'correlationKey');
    expect(node?.format).toBe('uuid');
  });

  it('does not set format when the field has no format keyword', async () => {
    scratch = scratchSpec({
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/items': {
          post: {
            operationId: 'createItem',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                      name: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    });

    const shapes = await buildCanonicalShapes(scratch.root);
    const nodes = shapes.createItem?.requestByMediaType?.['application/json'] ?? [];
    const node = nodes.find((n) => n.path === 'name');
    expect(node?.format).toBeUndefined();
  });
});
