import { 
  OperationDependencyGraph,
  RootOperationAnalysis,
  BootstrapSequence,
  Operation,
  OperationType
} from './types';

/**
 * Analyzes operation dependencies to identify root operations and bootstrap sequences
 */
export class RootDependencyAnalyzer {
  
  /**
   * Analyze the dependency graph to identify root operations and bootstrap sequences
   */
  analyzeRootDependencies(graph: OperationDependencyGraph): RootOperationAnalysis {
    console.log('Analyzing root dependencies...');
    
    const operations = Array.from(graph.operations.values());
    
    // Find different types of root operations
    const deploymentOperations = this.findDeploymentOperations(operations);
    const setupOperations = this.findSetupOperations(operations);
    const entryPointOperations = this.findEntryPointOperations(graph);
    
    // Build bootstrap sequences
    const bootstrapSequences = this.buildBootstrapSequences(deploymentOperations, operations);
    
    console.log(`Found ${deploymentOperations.length} deployment operations, ${setupOperations.length} setup operations`);
    console.log(`Identified ${bootstrapSequences.length} bootstrap sequences`);
    
    return {
      deploymentOperations,
      setupOperations,
      entryPointOperations,
      bootstrapSequences
    };
  }
  
  /**
   * Find operations that deploy resources (foundational operations)
   */
  private findDeploymentOperations(operations: Operation[]): string[] {
    return operations
      .filter(op => this.isDeploymentOperation(op))
      .map(op => op.operationId);
  }
  
  /**
   * Find operations that must run before others (setup operations)
   */
  private findSetupOperations(operations: Operation[]): string[] {
    return operations
      .filter(op => this.isSetupOperation(op))
      .map(op => op.operationId);
  }
  
  /**
   * Find operations that have no dependencies (true entry points)
   */
  private findEntryPointOperations(graph: OperationDependencyGraph): string[] {
    const targetOperations = new Set(graph.edges.map(e => e.targetOperationId));
    const entryPoints: string[] = [];
    
    for (const [opId] of Array.from(graph.operations)) {
      if (!targetOperations.has(opId)) {
        entryPoints.push(opId);
      }
    }
    
    return entryPoints;
  }
  
  /**
   * Build bootstrap sequences that create foundational resources
   */
  private buildBootstrapSequences(deploymentOps: string[], allOps: Operation[]): BootstrapSequence[] {
    const sequences: BootstrapSequence[] = [];
    
    // Helper function to check if operation exists
    const operationExists = (operationId: string): boolean => {
      return allOps.some(op => op.operationId === operationId);
    };
    
    // Process definition bootstrap sequence
    if (deploymentOps.includes('createDeployment')) {
      // createDeployment is a root dependency satisfier that can produce multiple key types
      // According to DeploymentMetadataResult, it returns: ProcessDefinitionKey, DecisionDefinitionKey, FormKey, DeploymentKey
      
      sequences.push({
        name: 'deployment_setup',
        description: 'Deploy resources and obtain all available keys from deployment result',
        operations: ['createDeployment'],
        produces: ['ProcessDefinitionKey', 'DecisionDefinitionKey', 'FormKey', 'DeploymentKey']
      });
      
      // Additional sequences for specific searches (only if those operations exist)
      if (operationExists('searchProcessDefinitions')) {
        sequences.push({
          name: 'process_definition_search',
          description: 'Deploy and search for specific process definitions',
          operations: ['createDeployment', 'searchProcessDefinitions'],
          produces: ['ProcessDefinitionKey', 'DeploymentKey']
        });
      }
      
      if (operationExists('searchDecisionDefinitions')) {
        sequences.push({
          name: 'decision_definition_search',
          description: 'Deploy and search for specific decision definitions',
          operations: ['createDeployment', 'searchDecisionDefinitions'],
          produces: ['DecisionDefinitionKey', 'DeploymentKey']
        });
      }
    }
    
    // User and tenant setup sequences
    const hasCreateUser = allOps.some(op => op.operationId === 'createUser');
    const hasCreateTenant = allOps.some(op => op.operationId === 'createTenant');
    
    if (hasCreateTenant) {
      sequences.push({
        name: 'tenant_setup',
        description: 'Create tenant for multi-tenancy testing',
        operations: ['createTenant'],
        produces: [] // Tenant creation doesn't produce semantic types we track
      });
    }
    
    if (hasCreateUser) {
      sequences.push({
        name: 'user_setup', 
        description: 'Create user for authentication testing',
        operations: ['createUser'],
        produces: [] // User creation doesn't produce semantic types we track
      });
    }
    
    // Process instance workflow bootstrap
    sequences.push({
      name: 'process_instance_workflow_setup',
      description: 'Complete process setup and create instance',
      operations: ['createDeployment', 'searchProcessDefinitions', 'createProcessInstance'],
      produces: ['ProcessDefinitionKey', 'DeploymentKey', 'ProcessInstanceKey']
    });
    
    return sequences;
  }
  
  /**
   * Check if an operation is a deployment operation
   */
  private isDeploymentOperation(operation: Operation): boolean {
    return (
      operation.operationType === 'deploy' ||
      operation.operationId.toLowerCase().includes('deploy') ||
      operation.path.includes('/deployment') ||
      (operation.tags?.includes('Resource') === true && operation.method === 'POST')
    );
  }
  
  /**
   * Check if an operation is a setup operation
   */
  private isSetupOperation(operation: Operation): boolean {
    const setupKeywords = ['create', 'setup', 'initialize', 'configure'];
    const operationName = operation.operationId.toLowerCase();
    
    return (
      operation.operationType === 'setup' ||
      setupKeywords.some(keyword => operationName.includes(keyword)) ||
      // Tenant and user creation are setup operations
      operation.operationId === 'createTenant' ||
      operation.operationId === 'createUser' ||
      operation.operationId === 'createGroup' ||
      operation.operationId === 'createRole'
    );
  }
  
  /**
   * Analyze operation relationships to find implicit dependencies
   */
  findImplicitDependencies(operations: Operation[]): { [operationId: string]: string[] } {
    const implicitDeps: { [operationId: string]: string[] } = {};
    
    // Most operations that work with ProcessInstanceKey need a process definition first
    const processOps = operations.filter(op => 
      op.operationId.toLowerCase().includes('process') && 
      op.operationType !== 'deploy' &&
      op.operationType !== 'search'
    );
    
    for (const op of processOps) {
      if (!implicitDeps[op.operationId]) {
        implicitDeps[op.operationId] = [];
      }
      implicitDeps[op.operationId].push('process_definition_setup');
    }
    
    return implicitDeps;
  }
}
