import { SemanticGraphExtractor } from './index';
import { DependencyEdge, OperationParameter, SemanticTypeReference } from './types';
import * as path from 'path';

/**
 * Validate the semantic graph extraction by examining specific operations
 */
async function validateExtraction() {
  const extractor = new SemanticGraphExtractor();
  
  try {
    // Load the graph
    const graphPath = path.join(__dirname, 'output/operation-dependency-graph.json');
    const graph = await extractor.loadGraph(graphPath);
    
    console.log('=== Semantic Graph Validation ===\n');
    
    // Test 1: Check specific operations exist
    const testOperations = [
      'createProcessInstance',
      'searchProcessInstances', 
      'activateJobs',
      'completeJob'
    ];
    
    console.log('1. Testing Operation Extraction:');
    for (const opId of testOperations) {
      const op = graph.operations.get(opId);
      if (op) {
        console.log(`   ✓ Found ${opId}: ${op.method} ${op.path}`);
      } else {
        console.log(`   ✗ Missing ${opId}`);
      }
    }
    
    // Test 2: Check semantic types are detected
    console.log('\n2. Testing Semantic Type Detection:');
    const expectedTypes = [
      'ProcessInstanceKey',
      'ProcessDefinitionKey', 
      'JobKey',
      'UserTaskKey'
    ];
    
    for (const typeId of expectedTypes) {
      const type = graph.semanticTypes.get(typeId);
      if (type) {
        console.log(`   ✓ Found ${typeId}: ${type.description || 'No description'}`);
      } else {
        console.log(`   ✗ Missing ${typeId}`);
      }
    }
    
    // Test 3: Check specific dependencies
    console.log('\n3. Testing Dependency Detection:');
    
    // Find dependencies where createProcessInstance produces ProcessInstanceKey
    const createInstanceDeps = graph.edges.filter((e: DependencyEdge) => 
      e.sourceOperationId === 'createProcessInstance' && 
      e.semanticType === 'ProcessInstanceKey'
    );
    
    console.log(`   Found ${createInstanceDeps.length} dependencies from createProcessInstance`);
    if (createInstanceDeps.length > 0) {
      console.log(`   Sample: ${createInstanceDeps[0].targetOperationId} consumes ProcessInstanceKey`);
    }
    
    // Find dependencies where activateJobs produces JobKey
    const activateJobDeps = graph.edges.filter((e: DependencyEdge) => 
      e.sourceOperationId === 'activateJobs' && 
      e.semanticType === 'JobKey'
    );
    
    console.log(`   Found ${activateJobDeps.length} dependencies from activateJobs`);
    if (activateJobDeps.length > 0) {
      console.log(`   Sample: ${activateJobDeps[0].targetOperationId} consumes JobKey`);
    }
    
    // Test 4: Examine a specific operation in detail  
    console.log('\n4. Detailed Operation Analysis:');
    const createProcessOp = graph.operations.get('createProcessInstance');
    if (createProcessOp) {
      console.log(`   Operation: ${createProcessOp.operationId}`);
      console.log(`   Parameters: ${createProcessOp.parameters.length}`);
      
      // Show parameters with semantic types
      const semanticParams = createProcessOp.parameters.filter((p: OperationParameter) => p.semanticType);
      console.log(`   Semantic Parameters: ${semanticParams.length}`);
      semanticParams.forEach((p: OperationParameter) => {
        console.log(`     - ${p.name} (${p.location}): ${p.semanticType}`);
      });
      
      // Show response semantic types
      const response200 = createProcessOp.responseSemanticTypes['200'] || [];
      console.log(`   Response Semantic Types (200): ${response200.length}`);
      response200.forEach((r: SemanticTypeReference) => {
        console.log(`     - ${r.fieldPath}: ${r.semanticType}`);
      });
    }
    
    console.log('\n=== Validation Complete ===');
    
  } catch (error) {
    console.error('Validation failed:', error);
    process.exit(1);
  }
}

// Run validation
validateExtraction();
