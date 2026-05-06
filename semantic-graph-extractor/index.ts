import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { CrossContaminationAnalyzer } from './cross-contamination-analyzer';
import { GraphBuilder } from './graph-builder';
import { RootDependencyAnalyzer } from './root-dependency-analyzer';
import { SchemaAnalyzer } from './schema-analyzer';
import { SemanticTypeLibraryBuilder } from './semantic-type-library-builder';
import type { OpenAPISpec, Operation, OperationDependencyGraph, SemanticType } from './types';

/**
 * Semantic Graph Extractor for OpenAPI specifications
 *
 * This tool analyzes an OpenAPI specification with semantic type annotations
 * and builds an operation dependency graph that can be used for test generation.
 */
export class SemanticGraphExtractor {
  private schemaAnalyzer: SchemaAnalyzer;
  private graphBuilder: GraphBuilder;
  private semanticTypeLibraryBuilder: SemanticTypeLibraryBuilder;
  private rootDependencyAnalyzer: RootDependencyAnalyzer;
  private crossContaminationAnalyzer: CrossContaminationAnalyzer;

  constructor() {
    this.schemaAnalyzer = new SchemaAnalyzer();
    this.graphBuilder = new GraphBuilder();
    this.semanticTypeLibraryBuilder = new SemanticTypeLibraryBuilder();
    this.rootDependencyAnalyzer = new RootDependencyAnalyzer();
    this.crossContaminationAnalyzer = new CrossContaminationAnalyzer();
  }

  /**
   * Extract the operation dependency graph from an OpenAPI specification
   */
  async extractGraph(specPath: string): Promise<OperationDependencyGraph> {
    console.log(`Loading OpenAPI specification from: ${specPath}`);

    // Load and parse the OpenAPI spec.
    // The bundled output (rest-api.bundle.json) is plain JSON; YAML parsing
    // is reserved for legacy .yaml / .yml sources. Unknown extensions are
    // rejected explicitly so a typo'd path can't silently fall through to
    // a parser that happens to tolerate the input.
    const specContent = fs.readFileSync(specPath, 'utf8');
    const ext = path.extname(specPath).toLowerCase();
    let parsed: unknown;
    if (ext === '.json') {
      parsed = JSON.parse(specContent);
    } else if (ext === '.yaml' || ext === '.yml') {
      parsed = yaml.load(specContent);
    } else {
      throw new Error(
        `Unsupported spec file extension '${ext || '(none)'}' for ${specPath}; expected .json, .yaml, or .yml`,
      );
    }
    // biome-ignore lint/plugin: runtime contract boundary for parsed input
    const spec = parsed as OpenAPISpec;

    console.log(`Analyzing semantic types and operations...`);

    // Analyze the schema to extract semantic types and operations
    const semanticTypes = this.schemaAnalyzer.extractSemanticTypes(spec);
    const operations = this.schemaAnalyzer.extractOperations(spec);

    console.log(`Found ${semanticTypes.size} semantic types and ${operations.length} operations`);

    // Build the basic dependency graph
    const graph = this.graphBuilder.buildDependencyGraph(operations, semanticTypes);

    console.log(`Built dependency graph with ${graph.edges.length} dependencies`);

    // Enhance with semantic type libraries
    console.log(`Building semantic type libraries...`);
    const semanticTypeLibrary = this.semanticTypeLibraryBuilder.buildLibrary(
      semanticTypes,
      spec,
      operations,
    );

    // Analyze root dependencies and setup operations
    console.log(`Analyzing root dependencies and setup operations...`);
    const rootDependencies = this.rootDependencyAnalyzer.analyzeRootDependencies(graph);

    // Find cross-contamination opportunities
    console.log(`Finding cross-contamination opportunities...`);
    const contaminationOpportunities =
      this.crossContaminationAnalyzer.findContaminationOpportunities(
        semanticTypes,
        semanticTypeLibrary,
      );

    // Add enhanced analysis to the graph
    const enhancedGraph: OperationDependencyGraph = {
      ...graph,
      semanticTypeLibrary,
      rootDependencyAnalysis: rootDependencies,
      crossContaminationMap: contaminationOpportunities,
    };

    console.log(
      `Enhanced analysis complete - ${semanticTypeLibrary.semanticTypes.size} type libraries, ${rootDependencies.entryPointOperations.length} entry points, ${Object.keys(contaminationOpportunities).length} contamination scenarios`,
    );

    return enhancedGraph;
  }

  /**
   * Save the dependency graph to disk in JSON format
   */
  async saveGraph(graph: OperationDependencyGraph, outputPath: string): Promise<void> {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Convert the graph to a JSON-serializable format
    const serializedGraph = {
      operations: Array.from(graph.operations.values()),
      operationsById: Object.fromEntries(
        Array.from(graph.operations.entries()).map(([id, op]) => [id, op]),
      ),
      semanticTypes: Array.from(graph.semanticTypes.values()),
      edges: graph.edges,
      metadata: {
        // Use a deterministic placeholder by default so generated artifacts
        // are byte-reproducible. Set TEST_SEED=random to opt in to a real
        // wall-clock timestamp (only useful for live-broker exploration).
        extractedAt:
          process.env.TEST_SEED === 'random'
            ? new Date().toISOString()
            : `seeded:${process.env.TEST_SEED || 'snapshot-baseline'}`,
        totalOperations: graph.operations.size,
        totalSemanticTypes: graph.semanticTypes.size,
        totalDependencies: graph.edges.length,
      },
      // Enhanced analysis data
      semanticTypeLibrary: graph.semanticTypeLibrary
        ? {
            semanticTypes: Array.from(graph.semanticTypeLibrary.semanticTypes.values()),
          }
        : undefined,
      rootDependencyAnalysis: graph.rootDependencyAnalysis,
      crossContaminationMap: graph.crossContaminationMap,
      // Issue #134 / camunda/camunda#52320: emit the upstream
      // `semantic-kinds.json` registry alongside the dependency graph so
      // the planner can consult kind-shape data (specifically:
      // `external-entity` identifiers must be client-minted, never
      // chained from a producer). The registry sits next to the bundled
      // spec source; absent registry → undefined and the planner skips
      // the kind-scoped fallback.
      kindRegistry: loadKindRegistry(),
    };

    fs.writeFileSync(outputPath, JSON.stringify(serializedGraph, null, 2));
    console.log(`Dependency graph saved to: ${outputPath}`);
  }

  /**
   * Load a previously saved dependency graph from disk
   */
  async loadGraph(inputPath: string): Promise<OperationDependencyGraph> {
    const content = fs.readFileSync(inputPath, 'utf8');
    const data = JSON.parse(content);

    const operations = new Map<string, Operation>();
    data.operations.forEach((op: Operation) => {
      operations.set(op.operationId, op);
    });

    const semanticTypes = new Map<string, SemanticType>();
    data.semanticTypes.forEach((type: SemanticType) => {
      semanticTypes.set(type.name, type);
    });

    return {
      operations,
      semanticTypes,
      edges: data.edges,
    };
  }
}

// Issue #134 / camunda/camunda#52320: load the upstream
// `semantic-kinds.json` registry so the planner can recognise
// `external-entity` kinds (whose identifiers are minted outside the
// Camunda REST API and have no in-API producer by design). Probes a
// short list of well-known locations relative to repo root: first the
// bundled spec dir (in case a future bundler copies it next to the
// bundle), then the upstream clone path used by camunda-schema-bundler.
// Returns `undefined` when the file is missing — older spec pins that
// predate the registry remain compatible (planner skips kind-scoped
// fallback when no registry is present).
function loadKindRegistry():
  | { kinds: Array<{ name: string; shape?: string; identifiers?: string[] }> }
  | undefined {
  const candidates = [
    path.join(__dirname, '../../spec/bundled/semantic-kinds.json'),
    path.join(
      __dirname,
      '../../external-spec/upstream/zeebe/gateway-protocol/src/main/proto/v2/semantic-kinds.json',
    ),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON registry
      const parsed = JSON.parse(raw) as {
        kinds?: Array<{ name?: unknown; shape?: unknown; identifiers?: unknown }>;
      };
      if (!parsed || !Array.isArray(parsed.kinds)) return undefined;
      const kinds: Array<{ name: string; shape?: string; identifiers?: string[] }> = [];
      for (const k of parsed.kinds) {
        if (!k || typeof k.name !== 'string') continue;
        const entry: { name: string; shape?: string; identifiers?: string[] } = { name: k.name };
        if (typeof k.shape === 'string') entry.shape = k.shape;
        if (Array.isArray(k.identifiers)) {
          entry.identifiers = k.identifiers.filter((i): i is string => typeof i === 'string');
        }
        kinds.push(entry);
      }
      return { kinds };
    } catch {
      // Malformed registry → treat as absent; the planner falls back
      // to the strict-chain default (no kind-scoped client-mint).
      return undefined;
    }
  }
  return undefined;
}

// Main execution when run directly
async function main() {
  const extractor = new SemanticGraphExtractor();

  try {
    // Get path from command line arguments, env var, or use default
    // __dirname is semantic-graph-extractor/dist/ when compiled, so ../../ reaches repo root
    const specPath =
      process.argv[2] ||
      process.env.OPENAPI_SPEC_PATH ||
      path.join(__dirname, '../../spec/bundled/rest-api.bundle.json');
    const outputPath = path.join(__dirname, 'output/operation-dependency-graph.json');

    // Extract the dependency graph
    const graph = await extractor.extractGraph(specPath);

    // Save to disk
    await extractor.saveGraph(graph, outputPath);

    console.log('Semantic graph extraction completed successfully!');
    console.log(
      `Graph contains ${graph.operations.size} operations with ${graph.edges.length} dependencies`,
    );
  } catch (error) {
    console.error('Error during graph extraction:', error);
    process.exit(1);
  }
}

// Run main function if this file is executed directly
if (require.main === module) {
  main();
}
