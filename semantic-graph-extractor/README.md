# Semantic Graph Extractor

## Overview

The Semantic Graph Extractor is a TypeScript tool that analyzes OpenAPI specifications with semantic type annotations to build operation dependency graphs. This is **Phase One** of a test generation project that will ultimately help generate comprehensive test scenarios for APIs.

## What it does

1. **Parses OpenAPI Specifications**: Reads and analyzes `rest-api.domain.yaml` which contains semantic type annotations using `x-semantic-type` extensions
2. **Extracts Semantic Types**: Identifies all semantic types (like `ProcessInstanceKey`, `UserTaskKey`, etc.) and their relationships
3. **Analyzes Operations**: Examines all API operations to understand their input parameters and response schemas
4. **Builds Dependency Graph**: Creates a graph showing how operations depend on each other through shared semantic types
5. **Generates Analysis**: Produces detailed reports about the API structure and dependencies

## Key Findings

From the Camunda OpenAPI specification analysis:

- **144 operations** across the API
- **18 semantic types** that create relationships between operations
- **6,291 dependencies** between operations
- **122 entry points** (operations that can be called without dependencies)
- **Average of 43.69 dependencies per operation**

### Most Important Semantic Types
1. **ProcessInstanceKey** (3,720 dependencies) - Central to process management
2. **ProcessDefinitionKey** (1,449 dependencies) - Key for process templates
3. **ElementInstanceKey** (1,027 dependencies) - Individual process elements

## Architecture

### Core Components

- **`index.ts`**: Main extraction logic and entry point
- **`types.ts`**: TypeScript definitions for OpenAPI and graph structures
- **`schema-analyzer.ts`**: Analyzes OpenAPI schemas and extracts semantic information
- **`graph-builder.ts`**: Builds dependency graphs and performs analysis
- **`analyze.ts`**: Generates human-readable analysis reports

### Output Format

The dependency graph is saved as JSON with the following structure:

```json
{
  "operations": [...],           // Array of all API operations
  "semanticTypes": [...],        // Array of all semantic types
  "edges": [...],               // Array of dependency relationships
  "metadata": {                 // Extraction metadata
    "extractedAt": "2025-08-13T...",
    "totalOperations": 144,
    "totalSemanticTypes": 18,
    "totalDependencies": 6291
  }
}
```

### Dependency Types

Dependencies are classified by strength:
- **REQUIRED**: Target operation cannot be called without source
- **OPTIONAL**: Target operation benefits from source but can work without it
- **CONDITIONAL**: Dependency depends on specific conditions

## Usage

### Prerequisites

```bash
cd api-test
npm install
```

### Extract Dependency Graph

```bash
npm run extract-graph
```

This will:
1. Parse `rest-api.domain.yaml`
2. Extract semantic types and operations
3. Build the dependency graph
4. Save to `dist/output/operation-dependency-graph.json`

### Generate Analysis Report

```bash
npm run analyze-graph
```

This will:
1. Load the previously generated graph
2. Perform analysis to find entry points, sinks, clusters
3. Generate `dist/output/dependency-graph-analysis.md`
4. Display key statistics in the console

## Example Dependencies

Here are some example dependencies discovered:

- **Process Creation → Process Querying**: `createProcessInstance` produces `ProcessInstanceKey` that can be used by `searchProcessInstances`
- **Job Activation → Job Completion**: `activateJobs` produces `JobKey` that is required by `completeJob`
- **Element Navigation**: Various operations produce `ElementInstanceKey` that enables drilling down into specific process elements

## Graph Analysis Features

The tool identifies several important graph characteristics:

### Entry Points
Operations that don't depend on others (122 found):
- `getTopology`, `getLicense`, `getAuthentication`
- `activateJobs`, `createTenant`, `createUser`
- Search operations that can work without specific filters

### Sink Operations  
Operations that don't produce outputs used by others (111 found):
- Status/info operations like `getTopology`
- Completion operations like `completeJob`
- Create operations for standalone entities

### Operation Clusters
Groups of operations with mutual dependencies:
- **Main workflow cluster**: Search operations, process creation, document handling
- **Decision cluster**: Decision definition and evaluation operations

## Future Phases

This semantic graph extractor is designed to support the following phases:

### Phase Two: API Coverage Parser
Build a complete map of the API to reason about test coverage

### Phase Three: Test Path Generator  
Generate test scenarios that traverse the dependency graph to achieve maximum coverage

## Technical Notes

### Graph Format Rationale
JSON was chosen for the dependency graph format because:
- **Readability**: Easy to inspect and debug
- **Interoperability**: Can be consumed by various tools
- **Completeness**: Preserves all extracted information
- **Future-proof**: Easy to extend with additional metadata

### Semantic Type Detection
The tool looks for `x-semantic-type` annotations in:
- Schema definitions (`components/schemas`)
- Parameter schemas
- Request body schemas  
- Response schemas
- Nested object properties

### Performance Considerations
- The tool processes large OpenAPI specs efficiently
- Graph construction is O(n²) in operations but optimized for practical sizes
- Memory usage scales linearly with spec complexity

## Example Output Structure

### Operation Record
```json
{
  "operationId": "createProcessInstance",
  "method": "POST",
  "path": "/process-definitions/{processDefinitionKey}/instances",
  "parameters": [
    {
      "name": "processDefinitionKey",
      "location": "path",
      "semanticType": "ProcessDefinitionKey",
      "required": true
    }
  ],
  "responseSemanticTypes": {
    "200": [
      {
        "semanticType": "ProcessInstanceKey",
        "fieldPath": "processInstanceKey",
        "required": true
      }
    ]
  }
}
```

### Dependency Edge
```json
{
  "sourceOperationId": "createProcessInstance",
  "targetOperationId": "searchProcessInstances", 
  "semanticType": "ProcessInstanceKey",
  "sourceFieldPath": "processInstanceKey",
  "targetFieldPath": "query.processInstanceKey",
  "strength": "optional",
  "description": "searchProcessInstances can filter by ProcessInstanceKey from createProcessInstance"
}
```

This foundation enables sophisticated test generation strategies in future phases by providing a complete understanding of how API operations relate to each other through their data dependencies.
