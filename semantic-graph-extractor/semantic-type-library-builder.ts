import { 
  OpenAPISpec, 
  SemanticTypeLibrary, 
  SemanticTypeDefinition, 
  SemanticType,
  Operation,
  InvalidExample,
  ValueGenerationRule
} from './types';

/**
 * Builds semantic type libraries with valid examples and cross-contamination mappings
 */
export class SemanticTypeLibraryBuilder {
  
  /**
   * Build comprehensive semantic type library from OpenAPI spec and operations
   */
  buildLibrary(
    semanticTypes: Map<string, SemanticType>, 
    spec: OpenAPISpec, 
    operations: Operation[]
  ): SemanticTypeLibrary {
    const libraries = new Map<string, SemanticTypeDefinition>();
    
    console.log('Building semantic type libraries...');
    
    // Build library for each semantic type
    for (const [typeName, semanticType] of Array.from(semanticTypes)) {
      const definition: SemanticTypeDefinition = {
        name: typeName,
        description: semanticType.description,
        baseType: semanticType.baseType,
        format: semanticType.format,
        pattern: semanticType.pattern,
        minLength: semanticType.minLength,
        maxLength: semanticType.maxLength,
        validExamples: this.extractValidExamples(typeName, spec, operations),
        invalidExamples: this.generateInvalidExamples(semanticType),
        crossContaminationSources: this.findCrossContaminationSources(semanticType, semanticTypes),
        generationRules: this.buildGenerationRules(semanticType)
      };
      
      libraries.set(typeName, definition);
    }
    
    console.log(`Built libraries for ${libraries.size} semantic types`);
    return { semanticTypes: libraries };
  }
  
  /**
   * Extract valid examples from OpenAPI spec examples and operation responses
   */
  private extractValidExamples(typeName: string, spec: OpenAPISpec, operations: Operation[]): any[] {
    const examples: any[] = [];
    
    // Extract from OpenAPI schema examples
    if (spec.components?.schemas) {
      for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
        if ('x-semantic-type' in schema && schema['x-semantic-type'] === typeName) {
          if (schema.example !== undefined) {
            examples.push(schema.example);
          }
          if (schema.examples) {
            examples.push(...schema.examples);
          }
        }
      }
    }
    
    // Generate pattern-based examples if we have a pattern
    const semanticTypeSchema = this.findSemanticTypeSchema(typeName, spec);
    if (semanticTypeSchema?.pattern) {
      examples.push(...this.generatePatternExamples(semanticTypeSchema.pattern, typeName));
    }
    
    // If no examples found, generate defaults based on type
    if (examples.length === 0) {
      examples.push(...this.generateDefaultExamples(typeName, semanticTypeSchema));
    }
    
    return Array.from(new Set(examples)); // Remove duplicates
  }
  
  /**
   * Generate invalid examples for testing
   */
  private generateInvalidExamples(semanticType: SemanticType): InvalidExample[] {
    const invalidExamples: InvalidExample[] = [];
    
    // Wrong type examples
    if (semanticType.baseType === 'string') {
      invalidExamples.push({
        value: 12345,
        invalidationType: 'wrong_type',
        description: 'Number instead of string'
      });
      invalidExamples.push({
        value: true,
        invalidationType: 'wrong_type', 
        description: 'Boolean instead of string'
      });
      invalidExamples.push({
        value: null,
        invalidationType: 'wrong_type',
        description: 'Null instead of string'
      });
    }
    
    // Wrong format examples
    if (semanticType.pattern) {
      invalidExamples.push({
        value: 'invalid_format',
        invalidationType: 'wrong_format',
        description: `Does not match pattern: ${semanticType.pattern}`
      });
    }
    
    // Out of bounds examples
    if (semanticType.minLength) {
      invalidExamples.push({
        value: 'x'.repeat(semanticType.minLength - 1),
        invalidationType: 'out_of_bounds',
        description: `Below minimum length: ${semanticType.minLength}`
      });
    }
    
    if (semanticType.maxLength) {
      invalidExamples.push({
        value: 'x'.repeat(semanticType.maxLength + 1),
        invalidationType: 'out_of_bounds',
        description: `Above maximum length: ${semanticType.maxLength}`
      });
    }
    
    return invalidExamples;
  }
  
  /**
   * Find other semantic types that could be used for cross-contamination testing
   */
  private findCrossContaminationSources(
    target: SemanticType, 
    allTypes: Map<string, SemanticType>
  ): string[] {
    const contaminants: string[] = [];
    
    for (const [typeName, semanticType] of Array.from(allTypes)) {
      if (typeName === target.name) continue;
      
      // Same base type and format = potential contamination
      if (semanticType.baseType === target.baseType && 
          semanticType.format === target.format) {
        contaminants.push(typeName);
      }
    }
    
    return contaminants;
  }
  
  /**
   * Build value generation rules for test data generation
   */
  private buildGenerationRules(semanticType: SemanticType): ValueGenerationRule[] {
    const rules: ValueGenerationRule[] = [];
    
    if (semanticType.pattern) {
      rules.push({
        type: 'pattern',
        rule: semanticType.pattern
      });
    }
    
    if (semanticType.baseType === 'string' && semanticType.name.includes('Key')) {
      // For key types, generate numeric strings
      rules.push({
        type: 'random',
        rule: 'numeric_string'
      });
    }
    
    return rules;
  }
  
  /**
   * Find the schema definition for a semantic type
   */
  private findSemanticTypeSchema(typeName: string, spec: OpenAPISpec): any {
    if (!spec.components?.schemas) return null;
    
    for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
      if ('x-semantic-type' in schema && schema['x-semantic-type'] === typeName) {
        return schema;
      }
    }
    
    return null;
  }
  
  /**
   * Generate examples based on regex patterns
   */
  private generatePatternExamples(pattern: string, typeName: string): any[] {
    // For Camunda keys which follow pattern ^-?[0-9]+$
    if (pattern === '^-?[0-9]+$') {
      return ['12345', '-67890', '1', '999999999'];
    }
    
    // Add more pattern-based generation as needed
    return [];
  }
  
  /**
   * Generate default examples when no specific examples are available
   */
  private generateDefaultExamples(typeName: string, schema: any): any[] {
    // Generate reasonable defaults for Camunda semantic types
    if (typeName.includes('Key')) {
      return ['12345', '67890'];
    }
    
    if (schema?.type === 'string') {
      return ['example_value'];
    }
    
    return [];
  }
}
