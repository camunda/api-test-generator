/**
 * Graph-pipeline fixtures for the semantic-graph extractor.
 *
 * These tests exercise the full extraction pipeline — JSON parsing, graph
 * construction and edge derivation — using small hand-crafted bundled-JSON
 * specs. Each test isolates ONE property of the pipeline so a failure
 * names a single broken behaviour.
 *
 * The fixture specs below mirror the format emitted by camunda-schema-bundler
 * (i.e., plain JSON with all $refs resolved), which is what SemanticGraphExtractor
 * now parses via JSON.parse() rather than yaml.load().
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphBuilder } from '../../../semantic-graph-extractor/graph-builder.ts';
import { SemanticGraphExtractor } from '../../../semantic-graph-extractor/index.ts';
import { SchemaAnalyzer } from '../../../semantic-graph-extractor/schema-analyzer.ts';
import type { OpenAPISpec } from '../../../semantic-graph-extractor/types.ts';

// Mock the js-yaml `load` export so we can assert which parser the
// production code routed to. ESM module namespaces are not spy-able
// (vitest issue), so the only reliable way to observe the call is to
// replace the export at module-load time. `dump` is preserved so the
// test still produces real YAML strings to feed back to the extractor.
vi.mock('js-yaml', async () => {
  const actual = await vi.importActual<typeof import('js-yaml')>('js-yaml');
  return {
    ...actual,
    load: vi.fn(actual.load),
  };
});

// ---------------------------------------------------------------------------
// Fixture: minimal bundled JSON spec with two operations sharing one
// semantic type. `provideKey` produces ProcessDefinitionKey in its response;
// `consumeKey` requires ProcessDefinitionKey in its request body.
//
// `components.schemas` is populated to mirror the real camunda-schema-bundler
// output format — extractSemanticTypes() only reads from components.schemas,
// not from inline path schemas.
// ---------------------------------------------------------------------------
const fixtureTwoOpGraph: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-two-op-graph', version: '0.0.0' },
  components: {
    schemas: {
      ProcessDefinitionKey: {
        type: 'string',
        'x-semantic-type': 'ProcessDefinitionKey',
        description: 'Unique key identifying a process definition',
      },
    },
  },
  paths: {
    '/definitions': {
      post: {
        operationId: 'provideKey',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    processDefinitionKey: {
                      type: 'string',
                      'x-semantic-type': 'ProcessDefinitionKey',
                      'x-semantic-provider': true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/instances': {
      post: {
        operationId: 'consumeKey',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['processDefinitionKey'],
                properties: {
                  processDefinitionKey: {
                    type: 'string',
                    'x-semantic-type': 'ProcessDefinitionKey',
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Fixture: two independent operations with NO shared semantic type.
// Zero edges expected between them.
// ---------------------------------------------------------------------------
const fixtureNoSharedType: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-no-shared-type', version: '0.0.0' },
  paths: {
    '/a': {
      get: {
        operationId: 'opA',
        parameters: [
          {
            name: 'jobKey',
            in: 'query',
            schema: { type: 'string', 'x-semantic-type': 'JobKey' },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/b': {
      post: {
        operationId: 'opB',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    processDefinitionKey: {
                      type: 'string',
                      'x-semantic-type': 'ProcessDefinitionKey',
                      'x-semantic-provider': true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildGraphFrom(spec: OpenAPISpec) {
  const analyzer = new SchemaAnalyzer();
  const semanticTypes = analyzer.extractSemanticTypes(spec);
  const operations = analyzer.extractOperations(spec);
  return new GraphBuilder().buildDependencyGraph(operations, semanticTypes);
}

// ---------------------------------------------------------------------------
// Tests: GraphBuilder edge creation
// ---------------------------------------------------------------------------
describe('GraphBuilder: edge creation from semantic type relationships', () => {
  it('creates an edge from producer to consumer when they share a semantic type', () => {
    const graph = buildGraphFrom(fixtureTwoOpGraph);

    const edge = graph.edges.find(
      (e) => e.sourceOperationId === 'provideKey' && e.targetOperationId === 'consumeKey',
    );
    expect(edge, 'expected edge provideKey → consumeKey').toBeDefined();
    expect(edge?.semanticType).toBe('ProcessDefinitionKey');
  });

  it('does NOT create a reverse edge from consumer to producer', () => {
    const graph = buildGraphFrom(fixtureTwoOpGraph);

    const reverseEdge = graph.edges.find(
      (e) => e.sourceOperationId === 'consumeKey' && e.targetOperationId === 'provideKey',
    );
    expect(reverseEdge, 'reverse edge must not exist').toBeUndefined();
  });

  it('creates zero edges when no semantic type is shared between operations', () => {
    const graph = buildGraphFrom(fixtureNoSharedType);
    expect(graph.edges).toHaveLength(0);
  });

  it('includes both operations in the graph regardless of edge count', () => {
    const graph = buildGraphFrom(fixtureNoSharedType);
    expect(graph.operations.has('opA')).toBe(true);
    expect(graph.operations.has('opB')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: SemanticGraphExtractor.extractGraph() — JSON vs YAML parsing
// ---------------------------------------------------------------------------
describe('SemanticGraphExtractor.extractGraph(): JSON input parsing', () => {
  // Each test gets its own temp dir so parallel vitest workers don't
  // collide on fixed filenames under os.tmpdir() and stale files don't
  // accumulate between runs.
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'extractor-graph-'));
    vi.mocked(yaml.load).mockClear();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses a .json spec file using JSON.parse and not yaml.load', async () => {
    const tmpPath = join(tmpDir, 'fixture-two-op-graph.json');
    writeFileSync(tmpPath, JSON.stringify(fixtureTwoOpGraph));

    const extractor = new SemanticGraphExtractor();
    const graph = await extractor.extractGraph(tmpPath);

    // If the extractor regressed to YAML-parsing JSON inputs, yaml.load
    // would be called and this assertion would fail — guarding the
    // contract independently of the parsed output (yaml.load happens to
    // handle JSON text, so output equality alone cannot detect the
    // regression).
    expect(yaml.load).not.toHaveBeenCalled();
    expect(graph.operations.size).toBe(2);
    expect(graph.semanticTypes.size).toBeGreaterThanOrEqual(1);
  });

  it('extracts the correct edge from a JSON fixture via the full pipeline', async () => {
    const tmpPath = join(tmpDir, 'fixture-two-op-graph-edges.json');
    writeFileSync(tmpPath, JSON.stringify(fixtureTwoOpGraph));

    const extractor = new SemanticGraphExtractor();
    const graph = await extractor.extractGraph(tmpPath);

    const edge = graph.edges.find(
      (e) => e.sourceOperationId === 'provideKey' && e.targetOperationId === 'consumeKey',
    );
    expect(edge, 'expected edge provideKey → consumeKey via full pipeline').toBeDefined();
    expect(edge?.semanticType).toBe('ProcessDefinitionKey');
  });

  it('parses a .yaml spec via yaml.load (legacy fallback)', async () => {
    const yamlContent = yaml.dump(fixtureTwoOpGraph);
    const tmpPath = join(tmpDir, 'fixture-two-op-graph.yaml');
    writeFileSync(tmpPath, yamlContent);

    const extractor = new SemanticGraphExtractor();
    const graph = await extractor.extractGraph(tmpPath);

    // Symmetric with the .json case: assert yaml.load was actually
    // exercised for the .yaml path so the routing is observably correct
    // in both directions.
    expect(yaml.load).toHaveBeenCalledTimes(1);
    expect(graph.operations.size).toBe(2);
  });

  it('throws on an unsupported spec extension instead of silently parsing', async () => {
    const tmpPath = join(tmpDir, 'fixture.txt');
    writeFileSync(tmpPath, JSON.stringify(fixtureTwoOpGraph));

    const extractor = new SemanticGraphExtractor();
    await expect(extractor.extractGraph(tmpPath)).rejects.toThrow(
      /Unsupported spec file extension/,
    );
  });
});

// ---------------------------------------------------------------------------
// #330 — parameter whose schema is a union of branded-key schemas.
//
// `getResourceContent` declares `path.resourceKey` as `$ref: ResourceKey`
// where `ResourceKey = oneOf [ProcessDefinitionKey, FormKey]`. Each branch
// carries its own `x-semantic-type` and has a producer in the graph.
//
// Pre-#330 behaviour (the bug):
//   - `findSemanticTypeInSchema` only walked `allOf`, so the union returned
//     `undefined`.
//   - A ref-name heuristic synthesised the string "ResourceKey" \u2014 a name
//     no schema, producer or consumer in the spec ever uses.
//   - The graph-builder's strict `===` equality found zero producers of
//     "ResourceKey", so the consumer had zero incoming edges and the planner
//     fell back to a free-form placeholder that fails the server's `LongKey`
//     regex (`^-?[0-9]+$`).
//
// Post-#330: the extractor walks `oneOf` (and `anyOf`, `$ref`), collects every
// branch's `x-semantic-type` into `semanticTypeAlternatives`, and the
// graph-builder treats a producer of any branch as a valid edge source.
// ---------------------------------------------------------------------------
const fixtureUnionOfBrandedKeysParam: OpenAPISpec = {
  openapi: '3.0.3',
  info: { title: 'fixture-union-of-branded-keys-param', version: '0.0.0' },
  components: {
    schemas: {
      ProcessDefinitionKey: {
        type: 'string',
        'x-semantic-type': 'ProcessDefinitionKey',
      },
      FormKey: {
        type: 'string',
        'x-semantic-type': 'FormKey',
      },
      ResourceKey: {
        oneOf: [
          { $ref: '#/components/schemas/ProcessDefinitionKey' },
          { $ref: '#/components/schemas/FormKey' },
        ],
      },
    },
  },
  paths: {
    '/process-definitions/deploy': {
      post: {
        operationId: 'deployProcessDefinition',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    processDefinitionKey: {
                      type: 'string',
                      'x-semantic-type': 'ProcessDefinitionKey',
                      'x-semantic-provider': true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/forms/deploy': {
      post: {
        operationId: 'deployForm',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    formKey: {
                      type: 'string',
                      'x-semantic-type': 'FormKey',
                      'x-semantic-provider': true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/resources/{resourceKey}/content': {
      get: {
        operationId: 'getResourceContent',
        parameters: [
          {
            name: 'resourceKey',
            in: 'path',
            required: true,
            schema: { $ref: '#/components/schemas/ResourceKey' },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

describe('#330: parameter with oneOf-of-branded-keys schema', () => {
  it('records every branch x-semantic-type in semanticTypeAlternatives', () => {
    const analyzer = new SchemaAnalyzer();
    const operations = analyzer.extractOperations(fixtureUnionOfBrandedKeysParam);
    const consumer = operations.find((o) => o.operationId === 'getResourceContent');
    expect(consumer, 'getResourceContent operation must be extracted').toBeDefined();
    const param = consumer?.parameters.find((p) => p.name === 'resourceKey');
    expect(param).toBeDefined();
    expect(param?.semanticTypeAlternatives).toEqual(
      expect.arrayContaining(['ProcessDefinitionKey', 'FormKey']),
    );
    // Singular is set to the first branch for back-compat with code paths
    // that key on a single string (planner `requires`, scenario generator
    // path-param lookup).
    expect(param?.semanticType).toBe('ProcessDefinitionKey');
  });

  it('does NOT fall back to the ref-name heuristic when union branches resolve', () => {
    const analyzer = new SchemaAnalyzer();
    const operations = analyzer.extractOperations(fixtureUnionOfBrandedKeysParam);
    const consumer = operations.find((o) => o.operationId === 'getResourceContent');
    const param = consumer?.parameters.find((p) => p.name === 'resourceKey');
    // Pre-#330 the heuristic synthesised the literal string "ResourceKey",
    // which appears nowhere in `components.schemas` as a semantic type.
    expect(param?.semanticType).not.toBe('ResourceKey');
    expect(param?.semanticTypeAlternatives).not.toContain('ResourceKey');
  });

  it('creates an edge from any branch producer to the union consumer', () => {
    const graph = buildGraphFrom(fixtureUnionOfBrandedKeysParam);

    const fromProcess = graph.edges.find(
      (e) =>
        e.sourceOperationId === 'deployProcessDefinition' &&
        e.targetOperationId === 'getResourceContent',
    );
    const fromForm = graph.edges.find(
      (e) => e.sourceOperationId === 'deployForm' && e.targetOperationId === 'getResourceContent',
    );

    expect(fromProcess, 'expected edge deployProcessDefinition → getResourceContent').toBeDefined();
    expect(fromForm, 'expected edge deployForm → getResourceContent').toBeDefined();
    // Edge label is the PRODUCER's branch type (not the union name) so
    // materialisation can chase the producer's response field path.
    expect(fromProcess?.semanticType).toBe('ProcessDefinitionKey');
    expect(fromForm?.semanticType).toBe('FormKey');
  });
});
