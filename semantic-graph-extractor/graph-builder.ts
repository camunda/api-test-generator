import { 
  Operation, 
  SemanticType, 
  OperationDependencyGraph, 
  DependencyEdge, 
  DependencyStrength,
  SemanticTypeReference 
} from './types';

/**
 * Builds operation dependency graphs based on semantic type relationships
 */
export class GraphBuilder {
  
  /**
   * Build the operation dependency graph from operations and semantic types
   */
  buildDependencyGraph(
    operations: Operation[], 
    semanticTypes: Map<string, SemanticType>
  ): OperationDependencyGraph {
    const operationMap = new Map<string, Operation>();
    const edges: DependencyEdge[] = [];
    
    // Build operation map
    operations.forEach(op => {
      operationMap.set(op.operationId, op);
    });
    
    console.log('Building dependency graph...');
    
    // Find dependencies between operations based on semantic types
    for (const sourceOp of operations) {
      for (const targetOp of operations) {
        if (sourceOp.operationId === targetOp.operationId) {
          continue; // Skip self-dependencies
        }
        
        const dependencies = this.findDependencies(sourceOp, targetOp);
        edges.push(...dependencies);
      }
    }
    
    console.log(`Found ${edges.length} total dependencies`);
    
    return {
      operations: operationMap,
      semanticTypes,
      edges
    };
  }
  
  /**
   * Find dependencies between two operations based on semantic types
   */
  private findDependencies(sourceOp: Operation, targetOp: Operation): DependencyEdge[] {
    const dependencies: DependencyEdge[] = [];
    
    // Get all semantic types produced by the source operation (from responses)
    const producedTypes = this.getProducedSemanticTypes(sourceOp);
    
    // Get all semantic types consumed by the target operation (from parameters and request body)
    const consumedTypes = this.getConsumedSemanticTypes(targetOp);
    
    // Find matches between produced and consumed types
    for (const produced of producedTypes) {
      for (const consumed of consumedTypes) {
        if (produced.semanticType === consumed.semanticType) {
          const dependency: DependencyEdge = {
            sourceOperationId: sourceOp.operationId,
            targetOperationId: targetOp.operationId,
            semanticType: produced.semanticType,
            sourceFieldPath: produced.fieldPath,
            targetFieldPath: consumed.fieldPath,
            strength: this.determineDependencyStrength(produced, consumed, sourceOp, targetOp),
            description: `${targetOp.operationId} requires ${produced.semanticType} from ${sourceOp.operationId}`
          };
          
          dependencies.push(dependency);
        }
      }
    }
    
    return dependencies;
  }
  
  /**
   * Get all semantic types produced by an operation (from its responses)
   */
  private getProducedSemanticTypes(operation: Operation): SemanticTypeReference[] {
    const produced: SemanticTypeReference[] = [];
    
    // Check all response status codes, focusing on success responses
    for (const [statusCode, responseTypes] of Object.entries(operation.responseSemanticTypes)) {
      // Focus on success responses (2xx) and some redirects (3xx)
      if (statusCode.startsWith('2') || statusCode.startsWith('3')) {
        produced.push(...responseTypes);
      }
    }
    
    return produced;
  }
  
  /**
   * Get all semantic types consumed by an operation (from parameters and request body)
   */
  private getConsumedSemanticTypes(operation: Operation): SemanticTypeReference[] {
    const consumed: SemanticTypeReference[] = [];
    
    // Add semantic types from parameters
    for (const param of operation.parameters) {
      if (param.semanticType) {
        consumed.push({
          semanticType: param.semanticType,
          fieldPath: `${param.location}.${param.name}`,
          required: param.required,
          description: param.description,
          schema: {
            type: param.schema.type,
            format: param.schema.format,
            pattern: param.schema.pattern,
            minLength: param.schema.minLength,
            maxLength: param.schema.maxLength,
            enum: param.schema.enum
          },
          examples: param.examples,
          constraints: []
        });
      }
    }
    
    // Add semantic types from request body
    consumed.push(...operation.requestBodySemanticTypes);
    
    return consumed;
  }
  
  /**
   * Determine the strength of a dependency based on various factors
   */
  private determineDependencyStrength(
    produced: SemanticTypeReference,
    consumed: SemanticTypeReference,
    sourceOp: Operation,
    targetOp: Operation
  ): DependencyStrength {
    // If the consumed field is required, it's a required dependency
    if (consumed.required) {
      return DependencyStrength.REQUIRED;
    }
    
    // If the source operation has eventual consistency issues, it's conditional
    if (sourceOp.eventuallyConsistent) {
      return DependencyStrength.CONDITIONAL;
    }
    
    // Path parameters are always required
    if (consumed.fieldPath.startsWith('path.')) {
      return DependencyStrength.REQUIRED;
    }
    
    // Query parameters are usually optional unless marked as required
    if (consumed.fieldPath.startsWith('query.')) {
      return consumed.required ? DependencyStrength.REQUIRED : DependencyStrength.OPTIONAL;
    }
    
    // Request body fields - check if they're in a required property
    if (consumed.fieldPath && !consumed.fieldPath.includes('.')) {
      // Top-level request body field
      return consumed.required ? DependencyStrength.REQUIRED : DependencyStrength.OPTIONAL;
    }
    
    // Default to optional for other cases
    return DependencyStrength.OPTIONAL;
  }
  
  /**
   * Analyze the dependency graph for insights
   */
  analyzeDependencyGraph(graph: OperationDependencyGraph): {
    entryPoints: string[];
    sinks: string[];
    clusters: string[][];
    stats: {
      totalOperations: number;
      totalSemanticTypes: number;
      totalDependencies: number;
      averageDependenciesPerOperation: number;
      semanticTypeUsage: Map<string, number>;
    };
  } {
    const entryPoints: string[] = [];
    const sinks: string[] = [];
    const semanticTypeUsage = new Map<string, number>();
    
    // Find operations that are not targets of any dependency (entry points)
    const targetOperations = new Set(graph.edges.map(e => e.targetOperationId));
    for (const opId of Array.from(graph.operations.keys())) {
      if (!targetOperations.has(opId)) {
        entryPoints.push(opId);
      }
    }
    
    // Find operations that are not sources of any dependency (sinks)
    const sourceOperations = new Set(graph.edges.map(e => e.sourceOperationId));
    for (const opId of Array.from(graph.operations.keys())) {
      if (!sourceOperations.has(opId)) {
        sinks.push(opId);
      }
    }
    
    // Count semantic type usage
    for (const edge of graph.edges) {
      const count = semanticTypeUsage.get(edge.semanticType) || 0;
      semanticTypeUsage.set(edge.semanticType, count + 1);
    }
    
    // Find strongly connected components (simplified)
    const clusters = this.findStronglyConnectedComponents(graph);
    
    return {
      entryPoints,
      sinks,
      clusters,
      stats: {
        totalOperations: graph.operations.size,
        totalSemanticTypes: graph.semanticTypes.size,
        totalDependencies: graph.edges.length,
        averageDependenciesPerOperation: graph.edges.length / graph.operations.size,
        semanticTypeUsage
      }
    };
  }
  
  /**
   * Find strongly connected components in the dependency graph
   * Uses a simplified approach - operations that have mutual dependencies
   */
  private findStronglyConnectedComponents(graph: OperationDependencyGraph): string[][] {
    const clusters: string[][] = [];
    const visited = new Set<string>();
    
    // Build adjacency lists
    const outgoing = new Map<string, Set<string>>();
    const incoming = new Map<string, Set<string>>();
    
    for (const edge of graph.edges) {
      if (!outgoing.has(edge.sourceOperationId)) {
        outgoing.set(edge.sourceOperationId, new Set());
      }
      if (!incoming.has(edge.targetOperationId)) {
        incoming.set(edge.targetOperationId, new Set());
      }
      
      outgoing.get(edge.sourceOperationId)!.add(edge.targetOperationId);
      incoming.get(edge.targetOperationId)!.add(edge.sourceOperationId);
    }
    
    // Find clusters of mutually dependent operations
    for (const opId of Array.from(graph.operations.keys())) {
      if (visited.has(opId)) {
        continue;
      }
      
      const cluster = this.findCluster(opId, outgoing, incoming, visited);
      if (cluster.length > 1) {
        clusters.push(cluster);
      }
    }
    
    return clusters;
  }
  
  /**
   * Find a cluster of operations starting from a given operation
   */
  private findCluster(
    startOp: string,
    outgoing: Map<string, Set<string>>,
    incoming: Map<string, Set<string>>,
    visited: Set<string>
  ): string[] {
    const cluster = [startOp];
    visited.add(startOp);
    
    // Simple approach: add operations that are directly connected both ways
    const outgoingOps = outgoing.get(startOp) || new Set();
    const incomingOps = incoming.get(startOp) || new Set();
    
    for (const targetOp of Array.from(outgoingOps)) {
      if (!visited.has(targetOp) && incomingOps.has(targetOp)) {
        // Mutual dependency found
        cluster.push(targetOp);
        visited.add(targetOp);
      }
    }
    
    return cluster;
  }
  
  /**
   * Generate a human-readable summary of the dependency graph
   */
  generateSummary(graph: OperationDependencyGraph): string {
    const analysis = this.analyzeDependencyGraph(graph);
    
    let summary = `# Operation Dependency Graph Summary\n\n`;
    
    summary += `## Statistics\n`;
    summary += `- **Total Operations**: ${analysis.stats.totalOperations}\n`;
    summary += `- **Total Semantic Types**: ${analysis.stats.totalSemanticTypes}\n`;
    summary += `- **Total Dependencies**: ${analysis.stats.totalDependencies}\n`;
    summary += `- **Average Dependencies per Operation**: ${analysis.stats.averageDependenciesPerOperation.toFixed(2)}\n\n`;
    
    summary += `## Entry Points (${analysis.entryPoints.length})\n`;
    summary += `Operations that can be called without dependencies:\n`;
    for (const entryPoint of analysis.entryPoints.slice(0, 10)) {
      const op = graph.operations.get(entryPoint);
      summary += `- **${entryPoint}**: ${op?.summary || op?.description || 'No description'}\n`;
    }
    if (analysis.entryPoints.length > 10) {
      summary += `... and ${analysis.entryPoints.length - 10} more\n`;
    }
    summary += '\n';
    
    summary += `## Sink Operations (${analysis.sinks.length})\n`;
    summary += `Operations that don't produce outputs used by others:\n`;
    for (const sink of analysis.sinks.slice(0, 10)) {
      const op = graph.operations.get(sink);
      summary += `- **${sink}**: ${op?.summary || op?.description || 'No description'}\n`;
    }
    if (analysis.sinks.length > 10) {
      summary += `... and ${analysis.sinks.length - 10} more\n`;
    }
    summary += '\n';
    
    summary += `## Most Used Semantic Types\n`;
    const sortedTypes = Array.from(analysis.stats.semanticTypeUsage.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10);
    
    for (const [semanticType, count] of sortedTypes) {
      const type = graph.semanticTypes.get(semanticType);
      summary += `- **${semanticType}** (${count} dependencies): ${type?.description || 'No description'}\n`;
    }
    
    if (analysis.clusters.length > 0) {
      summary += `\n## Operation Clusters\n`;
      summary += `Groups of operations with mutual dependencies:\n`;
      for (const cluster of analysis.clusters) {
        summary += `- Cluster: ${cluster.join(', ')}\n`;
      }
    }
    
    return summary;
  }
}
