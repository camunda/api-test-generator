import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { OpenAPISpec, OperationDependencyGraph, SemanticType, Operation, DependencyEdge } from './types';
import { SchemaAnalyzer } from './schema-analyzer';
import { GraphBuilder } from './graph-builder';
import { SemanticTypeLibraryBuilder } from './semantic-type-library-builder';
import { RootDependencyAnalyzer } from './root-dependency-analyzer';
import { CrossContaminationAnalyzer } from './cross-contamination-analyzer';

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
    
    // Load and parse the OpenAPI spec
    const specContent = fs.readFileSync(specPath, 'utf8');
    const spec = yaml.load(specContent) as OpenAPISpec;
    
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
    const semanticTypeLibrary = this.semanticTypeLibraryBuilder.buildLibrary(semanticTypes, spec, operations);
    
    // Analyze root dependencies and setup operations
    console.log(`Analyzing root dependencies and setup operations...`);
    const rootDependencies = this.rootDependencyAnalyzer.analyzeRootDependencies(graph);
    
    // Find cross-contamination opportunities
    console.log(`Finding cross-contamination opportunities...`);
    const contaminationOpportunities = this.crossContaminationAnalyzer.findContaminationOpportunities(semanticTypes, semanticTypeLibrary);
    
    // Add enhanced analysis to the graph
    const enhancedGraph: OperationDependencyGraph = {
      ...graph,
      semanticTypeLibrary,
      rootDependencyAnalysis: rootDependencies,
      crossContaminationMap: contaminationOpportunities
    };
    
    console.log(`Enhanced analysis complete - ${semanticTypeLibrary.semanticTypes.size} type libraries, ${rootDependencies.entryPointOperations.length} entry points, ${Object.keys(contaminationOpportunities).length} contamination scenarios`);
    
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
  operationsById: Object.fromEntries(Array.from(graph.operations.entries()).map(([id, op]) => [id, op])),
      semanticTypes: Array.from(graph.semanticTypes.values()),
      edges: graph.edges,
      metadata: {
        extractedAt: new Date().toISOString(),
        totalOperations: graph.operations.size,
        totalSemanticTypes: graph.semanticTypes.size,
        totalDependencies: graph.edges.length
      },
      // Enhanced analysis data
      semanticTypeLibrary: graph.semanticTypeLibrary ? {
        semanticTypes: Array.from(graph.semanticTypeLibrary.semanticTypes.values())
      } : undefined,
      rootDependencyAnalysis: graph.rootDependencyAnalysis,
      crossContaminationMap: graph.crossContaminationMap
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
      edges: data.edges
    };
  }
}

// Main execution when run directly
async function main() {
  const extractor = new SemanticGraphExtractor();
  
  try {
    // Get path from command line arguments, env var, or use default
    // __dirname is semantic-graph-extractor/dist/ when compiled, so ../../ reaches repo root
    const specPath = process.argv[2] || process.env.OPENAPI_SPEC_PATH || path.join(__dirname, '../../spec/bundled/rest-api.bundle.json');
    const outputPath = path.join(__dirname, 'output/operation-dependency-graph.json');
    
    // Extract the dependency graph
    const graph = await extractor.extractGraph(specPath);
    
  // Save to disk
  await extractor.saveGraph(graph, outputPath);
    
    console.log('Semantic graph extraction completed successfully!');
    console.log(`Graph contains ${graph.operations.size} operations with ${graph.edges.length} dependencies`);
    
  } catch (error) {
    console.error('Error during graph extraction:', error);
    process.exit(1);
  }
}

// Run main function if this file is executed directly
if (require.main === module) {
  main();
}
