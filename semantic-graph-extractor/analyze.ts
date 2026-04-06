import { SemanticGraphExtractor } from './index';
import { GraphBuilder } from './graph-builder';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate a human-readable analysis report of the dependency graph
 */
async function generateAnalysisReport() {
  const extractor = new SemanticGraphExtractor();
  const graphBuilder = new GraphBuilder();
  
  try {
    // Load the previously generated graph
    const graphPath = path.join(__dirname, 'output/operation-dependency-graph.json');
    const graph = await extractor.loadGraph(graphPath);
    
    console.log('Generating analysis report...');
    
    // Generate the summary
    const summary = graphBuilder.generateSummary(graph);
    
    // Save the summary to a file
    const summaryPath = path.join(__dirname, 'output/dependency-graph-analysis.md');
    fs.writeFileSync(summaryPath, summary);
    
    console.log(`Analysis report saved to: ${summaryPath}`);
    
    // Also output key statistics to console
    const analysis = graphBuilder.analyzeDependencyGraph(graph);
    
    console.log('\n=== Dependency Graph Analysis ===');
    console.log(`Total Operations: ${analysis.stats.totalOperations}`);
    console.log(`Total Semantic Types: ${analysis.stats.totalSemanticTypes}`);
    console.log(`Total Dependencies: ${analysis.stats.totalDependencies}`);
    console.log(`Average Dependencies per Operation: ${analysis.stats.averageDependenciesPerOperation.toFixed(2)}`);
    
    console.log(`\nEntry Points (${analysis.entryPoints.length}):`);
    analysis.entryPoints.slice(0, 5).forEach(op => {
      const operation = graph.operations.get(op);
      console.log(`  - ${op}: ${operation?.summary || 'No summary'}`);
    });
    if (analysis.entryPoints.length > 5) {
      console.log(`  ... and ${analysis.entryPoints.length - 5} more`);
    }
    
    console.log(`\nMost Used Semantic Types:`);
    const sortedTypes = Array.from(analysis.stats.semanticTypeUsage.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    
    for (const [semanticType, count] of sortedTypes) {
      console.log(`  - ${semanticType}: ${count} dependencies`);
    }
    
    console.log('\nAnalysis completed successfully!');
    
  } catch (error) {
    console.error('Error during analysis:', error);
    process.exit(1);
  }
}

// Run the analysis
generateAnalysisReport();
