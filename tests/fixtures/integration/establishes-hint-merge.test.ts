/**
 * Integration fixture for the establisher self-satisfaction drop on the
 * hint-merge path (camunda/api-test-generator#104, PR #112).
 *
 * The planner-only fixtures in `tests/fixtures/planner/` build their
 * `OperationGraph` by hand and never exercise `loadOpenApiSemanticHints`.
 * That helper walks the raw OpenAPI request schema independently of the
 * graph and re-adds `Username`-style semanticTypes back to a self-
 * establishing op's `requires` via the `x-semantic-type` annotation on
 * the identifier field. Without the second-pass drop in
 * `path-analyser/src/index.ts`, BFS skips the establisher as its own
 * producer (`producerOpId === endpointOpId`) and the endpoint plans an
 * unsatisfied chain.
 *
 * This fixture goes through `loadGraph` + `loadOpenApiSemanticHints`
 * against a tiny on-disk spec so the hint-merge surface is actually
 * exercised; it then replays the index.ts drop and asserts the merged
 * `requires` no longer carries the established semantic.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadGraph, loadOpenApiSemanticHints } from '../../../path-analyser/src/graphLoader.ts';

const SELF_ESTABLISHING_SPEC = `
openapi: 3.0.3
info:
  title: fixture-establishes-hint-merge
  version: 0.0.0
paths:
  /users:
    post:
      operationId: createUser
      x-semantic-establishes:
        kind: User
        identifiedBy:
          - in: body
            name: username
            semanticType: Username
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [username]
              properties:
                username:
                  type: string
                  x-semantic-type: Username
      responses:
        '201':
          description: created
`;

let tmpDir: string;
let specPath: string;
let savedSpecPath: string | undefined;
let savedGraphPath: string | undefined;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'establishes-hint-merge-'));
  specPath = join(tmpDir, 'rest-api.bundle.yaml');
  writeFileSync(specPath, SELF_ESTABLISHING_SPEC, 'utf8');
  // Minimal graph with the self-establisher recorded as a producer for
  // its own semantic — mirrors what the extractor would emit.
  const graphPath = join(tmpDir, 'operation-dependency-graph.json');
  writeFileSync(
    graphPath,
    JSON.stringify({
      operations: {
        createUser: {
          operationId: 'createUser',
          method: 'POST',
          path: '/users',
          requires: { required: [], optional: [] },
          produces: ['Username'],
          establishes: {
            kind: 'User',
            identifiedBy: [{ in: 'body', name: 'username', semanticType: 'Username' }],
          },
        },
      },
      producersByType: { Username: ['createUser'] },
      establishersByType: { Username: ['createUser'] },
    }),
    'utf8',
  );
  savedSpecPath = process.env.OPENAPI_SPEC_PATH;
  savedGraphPath = process.env.OPERATION_GRAPH_PATH;
  process.env.OPENAPI_SPEC_PATH = specPath;
  process.env.OPERATION_GRAPH_PATH = graphPath;
});

afterAll(() => {
  if (savedSpecPath === undefined) delete process.env.OPENAPI_SPEC_PATH;
  else process.env.OPENAPI_SPEC_PATH = savedSpecPath;
  if (savedGraphPath === undefined) delete process.env.OPERATION_GRAPH_PATH;
  else process.env.OPERATION_GRAPH_PATH = savedGraphPath;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('integration: x-semantic-establishes self-satisfaction drop on hint-merge path (#104)', () => {
  it('drops established semantics from `requires` after hint-merge would re-add them', async () => {
    const graph = await loadGraph(tmpDir);
    const hints = await loadOpenApiSemanticHints(tmpDir);

    // Sanity check: the hint-merger DID re-surface `Username` on
    // `createUser` from the request body's `x-semantic-type`. If this
    // assertion ever stops holding, the test no longer guards the
    // drop and must be rewritten — it's not "just a flaky parser".
    expect(hints.createUser?.required).toContain('Username');

    // Replay the exact merge + drop sequence from
    // `path-analyser/src/index.ts` (the loop body around L88-L120).
    const op = graph.operations.createUser;
    const reqReq = new Set(op.requires.required);
    for (const s of hints.createUser?.required ?? []) reqReq.add(s);
    op.requires.required = [...reqReq];
    if (op.establishes && op.establishes.shape !== 'edge') {
      const established = new Set(op.establishes.identifiedBy.map((i) => i.semanticType));
      op.requires.required = op.requires.required.filter((s) => !established.has(s));
      op.requires.optional = op.requires.optional.filter((s) => !established.has(s));
    }

    expect(op.requires.required).not.toContain('Username');
  });
});
