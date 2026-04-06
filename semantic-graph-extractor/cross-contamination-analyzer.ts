import { SemanticType, CrossContaminationMap, SemanticTypeLibrary } from './types';

/**
 * Analyzes semantic types to find cross-contamination opportunities for testing
 */
export class CrossContaminationAnalyzer {
  
  /**
   * Find cross-contamination opportunities between semantic types
   */
  findContaminationOpportunities(
    semanticTypes: Map<string, SemanticType>,
    semanticTypeLibrary?: SemanticTypeLibrary
  ): CrossContaminationMap {
    console.log('Analyzing cross-contamination opportunities...');
    
    const contaminationMap: CrossContaminationMap = {};
    
    // Group semantic types by their base characteristics
    const typeGroups = this.groupSemanticTypesByCharacteristics(semanticTypes);
    
    // For each semantic type, find potential contaminants
    for (const [typeName, semanticType] of Array.from(semanticTypes)) {
      const contaminants = this.findContaminantsForType(semanticType, typeGroups, semanticTypeLibrary);
      if (contaminants.length > 0) {
        contaminationMap[typeName] = contaminants;
      }
    }
    
    console.log(`Found contamination opportunities for ${Object.keys(contaminationMap).length} semantic types`);
    
    return contaminationMap;
  }
  
  /**
   * Group semantic types by their base characteristics for contamination analysis
   */
  private groupSemanticTypesByCharacteristics(
    semanticTypes: Map<string, SemanticType>
  ): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    
    for (const [typeName, semanticType] of Array.from(semanticTypes)) {
      // Create a key based on base type, format, and pattern
      const characteristicKey = this.createCharacteristicKey(semanticType);
      
      if (!groups.has(characteristicKey)) {
        groups.set(characteristicKey, []);
      }
      
      groups.get(characteristicKey)!.push(typeName);
    }
    
    return groups;
  }
  
  /**
   * Create a characteristic key for grouping similar semantic types
   */
  private createCharacteristicKey(semanticType: SemanticType): string {
    const parts = [
      semanticType.baseType,
      semanticType.format || 'no-format',
      semanticType.pattern || 'no-pattern'
    ];
    
    return parts.join('|');
  }
  
  /**
   * Find potential contaminants for a specific semantic type
   */
  private findContaminantsForType(
    targetType: SemanticType,
    typeGroups: Map<string, string[]>,
    semanticTypeLibrary?: SemanticTypeLibrary
  ): string[] {
    const contaminants: string[] = [];
    const targetKey = this.createCharacteristicKey(targetType);
    
    // Find types in the same characteristic group
    const sameCharacteristicTypes = typeGroups.get(targetKey) || [];
    
    for (const typeName of sameCharacteristicTypes) {
      if (typeName !== targetType.name) {
        contaminants.push(typeName);
      }
    }
    
    // Also check for types with similar patterns but different semantics
    const similarPatternTypes = this.findSimilarPatternTypes(targetType, typeGroups);
    contaminants.push(...similarPatternTypes);
    
    // Remove duplicates
    return Array.from(new Set(contaminants));
  }
  
  /**
   * Find semantic types with similar patterns but potentially different semantics
   */
  private findSimilarPatternTypes(
    targetType: SemanticType,
    typeGroups: Map<string, string[]>
  ): string[] {
    const similar: string[] = [];
    
    // For Camunda Key types, they all share the same pattern but different semantics
    if (targetType.pattern === '^-?[0-9]+$' && targetType.name.includes('Key')) {
      for (const [key, typeNames] of Array.from(typeGroups)) {
        if (key.includes('^-?[0-9]+$')) {
          for (const typeName of typeNames) {
            if (typeName !== targetType.name && typeName.includes('Key')) {
              similar.push(typeName);
            }
          }
        }
      }
    }
    
    return similar;
  }
  
  /**
   * Generate contamination test scenarios for a specific semantic type
   */
  generateContaminationScenarios(
    targetType: string,
    contaminants: string[],
    semanticTypeLibrary: SemanticTypeLibrary
  ): ContaminationScenario[] {
    const scenarios: ContaminationScenario[] = [];
    
    for (const contaminantType of contaminants) {
      const contaminantDef = semanticTypeLibrary.semanticTypes.get(contaminantType);
      if (contaminantDef && contaminantDef.validExamples.length > 0) {
        scenarios.push({
          targetSemanticType: targetType,
          contaminantSemanticType: contaminantType,
          contaminantValues: contaminantDef.validExamples.slice(0, 3), // Use first 3 examples
          expectedBehavior: 'rejection',
          description: `Test ${targetType} field with valid ${contaminantType} values`
        });
      }
    }
    
    return scenarios;
  }
  
  /**
   * Analyze the severity of contamination opportunities
   */
  analyzeContaminationSeverity(contaminationMap: CrossContaminationMap): ContaminationSeverityAnalysis {
    const analysis: ContaminationSeverityAnalysis = {
      highRisk: [],
      mediumRisk: [],
      lowRisk: [],
      totalOpportunities: 0
    };
    
    for (const [targetType, contaminants] of Object.entries(contaminationMap)) {
      analysis.totalOpportunities += contaminants.length;
      
      // Classify risk based on semantic similarity and potential for confusion
      const riskLevel = this.classifyContaminationRisk(targetType, contaminants);
      
      const contaminationInfo = {
        targetType,
        contaminants,
        count: contaminants.length
      };
      
      switch (riskLevel) {
        case 'high':
          analysis.highRisk.push(contaminationInfo);
          break;
        case 'medium':
          analysis.mediumRisk.push(contaminationInfo);
          break;
        case 'low':
          analysis.lowRisk.push(contaminationInfo);
          break;
      }
    }
    
    return analysis;
  }
  
  /**
   * Classify the risk level of contamination between semantic types
   */
  private classifyContaminationRisk(targetType: string, contaminants: string[]): 'high' | 'medium' | 'low' {
    // High risk: Many contaminants with similar names (like different Key types)
    if (contaminants.length >= 5 && targetType.includes('Key')) {
      return 'high';
    }
    
    // Medium risk: Some contaminants or semantically related types
    if (contaminants.length >= 2) {
      return 'medium';
    }
    
    // Low risk: Few contaminants
    return 'low';
  }
}

// Additional interfaces for contamination analysis
export interface ContaminationScenario {
  targetSemanticType: string;
  contaminantSemanticType: string;
  contaminantValues: any[];
  expectedBehavior: 'rejection' | 'acceptance' | 'unknown';
  description: string;
}

export interface ContaminationSeverityAnalysis {
  highRisk: ContaminationRisk[];
  mediumRisk: ContaminationRisk[];
  lowRisk: ContaminationRisk[];
  totalOpportunities: number;
}

export interface ContaminationRisk {
  targetType: string;
  contaminants: string[];
  count: number;
}
