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
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GraphBuilder } from '../../../semantic-graph-extractor/graph-builder.ts';
import { SemanticGraphExtractor } from '../../../semantic-graph-extractor/index.ts';
import { SchemaAnalyzer } from '../../../semantic-graph-extractor/schema-analyzer.ts';
import type { OpenAPISpec } from '../../../semantic-graph-extractor/types.ts';

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
  it('parses a .json spec file using JSON.parse (not yaml.load)', async () => {
    const tmpPath = join(tmpdir(), 'fixture-two-op-graph.json');
    writeFileSync(tmpPath, JSON.stringify(fixtureTwoOpGraph));

    const extractor = new SemanticGraphExtractor();
    const graph = await extractor.extractGraph(tmpPath);

    // If JSON.parse failed silently and returned an empty spec, operations
    // would be empty. Assert we got real content.
    expect(graph.operations.size).toBe(2);
    expect(graph.semanticTypes.size).toBeGreaterThanOrEqual(1);
  });

  it('extracts the correct edge from a JSON fixture via the full pipeline', async () => {
    const tmpPath = join(tmpdir(), 'fixture-two-op-graph-edges.json');
    writeFileSync(tmpPath, JSON.stringify(fixtureTwoOpGraph));

    const extractor = new SemanticGraphExtractor();
    const graph = await extractor.extractGraph(tmpPath);

    const edge = graph.edges.find(
      (e) => e.sourceOperationId === 'provideKey' && e.targetOperationId === 'consumeKey',
    );
    expect(edge, 'expected edge provideKey → consumeKey via full pipeline').toBeDefined();
    expect(edge?.semanticType).toBe('ProcessDefinitionKey');
  });

  it('parses a .yaml spec string path without error', async () => {
    // Verify the YAML fallback path still works for callers using legacy .yaml sources.
    const yaml = require('js-yaml');
    const yamlContent = yaml.dump(fixtureTwoOpGraph);
    const tmpPath = join(tmpdir(), 'fixture-two-op-graph.yaml');
    writeFileSync(tmpPath, yamlContent);

    const extractor = new SemanticGraphExtractor();
    const graph = await extractor.extractGraph(tmpPath);

    expect(graph.operations.size).toBe(2);
  });
});
