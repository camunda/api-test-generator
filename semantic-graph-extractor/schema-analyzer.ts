import {
  type FieldSchema,
  type MediaTypeObject,
  type OpenAPISpec,
  type Operation,
  type OperationObject,
  type OperationParameter,
  OperationType,
  type ParameterObject,
  type ParameterSchema,
  type ReferenceObject,
  type ResponseObject,
  type Schema,
  type SemanticType,
  type SemanticTypeReference,
  type ValidationConstraint,
} from './types';

/**
 * Analyzes OpenAPI schemas to extract semantic types and operations
 */
export class SchemaAnalyzer {
  /**
   * Extract all semantic types from the OpenAPI specification
   */
  extractSemanticTypes(spec: OpenAPISpec): Map<string, SemanticType> {
    const semanticTypes = new Map<string, SemanticType>();

    if (!spec.components?.schemas) {
      return semanticTypes;
    }

    // Walk through all schema definitions
    for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
      this.extractSemanticTypesFromSchema(schemaName, schema, semanticTypes);
    }

    return semanticTypes;
  }

  /**
   * Extract semantic type information from a single schema
   */
  private extractSemanticTypesFromSchema(
    schemaName: string,
    schema: Schema | ReferenceObject,
    semanticTypes: Map<string, SemanticType>,
  ): void {
    // Handle reference objects
    if ('$ref' in schema) {
      return; // Skip references for now, they'll be processed when we encounter the actual schema
    }

    // Check if this schema has a semantic type annotation
    if (schema['x-semantic-type']) {
      const semanticType: SemanticType = {
        name: schema['x-semantic-type'],
        description: schema.description,
        format: schema.format,
        baseType: schema.type || 'string',
        pattern: schema.pattern,
        minLength: schema.minLength,
        maxLength: schema.maxLength,
      };

      semanticTypes.set(schema['x-semantic-type'], semanticType);
    }

    // Recursively check allOf, oneOf, anyOf schemas
    if (schema.allOf) {
      schema.allOf.forEach((subSchema) => {
        this.extractSemanticTypesFromSchema(schemaName, subSchema, semanticTypes);
      });
    }

    if (schema.oneOf) {
      schema.oneOf.forEach((subSchema) => {
        this.extractSemanticTypesFromSchema(schemaName, subSchema, semanticTypes);
      });
    }

    if (schema.anyOf) {
      schema.anyOf.forEach((subSchema) => {
        this.extractSemanticTypesFromSchema(schemaName, subSchema, semanticTypes);
      });
    }

    // Check properties
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        this.extractSemanticTypesFromSchema(`${schemaName}.${propName}`, propSchema, semanticTypes);
      }
    }

    // Check array items
    if (schema.items) {
      this.extractSemanticTypesFromSchema(`${schemaName}[]`, schema.items, semanticTypes);
    }
  }

  /**
   * Extract all operations from the OpenAPI specification
   */
  extractOperations(spec: OpenAPISpec): Operation[] {
    const operations: Operation[] = [];

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      // Handle each HTTP method
      const methods = [
        'get',
        'post',
        'put',
        'patch',
        'delete',
        'head',
        'options',
        'trace',
      ] as const;

      for (const method of methods) {
        const operation = pathItem[method];
        if (operation) {
          const extractedOp = this.extractOperation(method, path, operation, spec);
          if (extractedOp) {
            operations.push(extractedOp);
          }
        }
      }
    }

    return operations;
  }

  /**
   * Extract operation details including semantic type dependencies
   */
  private extractOperation(
    method: string,
    path: string,
    operation: OperationObject,
    spec: OpenAPISpec,
  ): Operation | null {
    if (!operation.operationId) {
      console.warn(`Operation ${method.toUpperCase()} ${path} has no operationId, skipping`);
      return null;
    }

    // Extract parameters
    const parameters = this.extractParameters(operation.parameters || [], spec);

    // Extract request body semantic types
    const requestBodySemanticTypes = this.extractRequestBodySemanticTypes(
      operation.requestBody,
      spec,
    );

    // Extract response semantic types
    const responseSemanticTypes = this.extractResponseSemanticTypes(operation.responses, spec);

    // Classify operation type
    const operationType = this.classifyOperation(operation, path, method);

    // Extract x-operation-kind (operation metadata). Accept object or array, prefer first object with kind field.
    let opMeta: any | undefined;
    const rawKind = (operation as any)['x-operation-kind'];
    if (rawKind) {
      if (Array.isArray(rawKind)) {
        opMeta = rawKind.find(
          (o) =>
            o && typeof o === 'object' && (o.kind || o.duplicatePolicy || o.idempotencyMechanism),
        );
      } else if (typeof rawKind === 'object') {
        opMeta = rawKind;
      }
    }
    const operationMetadata = opMeta
      ? {
          kind: opMeta.kind,
          duplicatePolicy: opMeta.duplicatePolicy,
          idempotent: opMeta.idempotent,
          safe: opMeta.safe,
          idempotencyMechanism: opMeta.idempotencyMechanism,
          idempotencyScope: opMeta.idempotencyScope,
          idempotencyKeyHeader: opMeta.idempotencyKeyHeader,
        }
      : undefined;

    // Extract conditional idempotency extension
    const cond = (operation as any)['x-conditional-idempotency'];
    let conditionalIdempotency: any | undefined;
    if (cond && typeof cond === 'object') {
      if (
        Array.isArray(cond.keyFields) &&
        cond.keyFields.length &&
        cond.window &&
        typeof cond.window.field === 'string'
      ) {
        conditionalIdempotency = {
          keyFields: [...cond.keyFields],
          window: { field: cond.window.field, unit: cond.window.unit },
          duplicatePolicy: cond.duplicatePolicy,
          appliesWhen: cond.appliesWhen,
        };
      }
    }

    return {
      operationId: operation.operationId,
      method: method.toUpperCase(),
      path,
      summary: operation.summary,
      description: operation.description,
      tags: operation.tags,
      parameters,
      requestBodySemanticTypes,
      responseSemanticTypes,
      eventuallyConsistent: operation['x-eventually-consistent'],
      operationType,
      idempotent: this.isIdempotent(method, operation),
      cacheable: this.isCacheable(method, operation),
      operationMetadata,
      conditionalIdempotency,
    };
  }

  /**
   * Extract parameters and their semantic types
   */
  private extractParameters(
    parameters: (ParameterObject | ReferenceObject)[],
    spec: OpenAPISpec,
  ): OperationParameter[] {
    const result: OperationParameter[] = [];

    for (const param of parameters) {
      if ('$ref' in param) {
        // Resolve reference
        const resolvedParam = this.resolveReference(param.$ref, spec) as ParameterObject;
        if (resolvedParam) {
          result.push(this.extractParameter(resolvedParam, spec));
        }
      } else {
        result.push(this.extractParameter(param, spec));
      }
    }

    return result;
  }

  /**
   * Extract a single parameter's semantic type information
   */
  private extractParameter(param: ParameterObject, spec: OpenAPISpec): OperationParameter {
    let semanticType: string | undefined;
    let provider: boolean | undefined;
    if (param.schema) {
      // If schema is a $ref, resolve and search for x-semantic-type
      if ('$ref' in param.schema) {
        const ref = (param.schema as any).$ref as string;
        const resolved = this.resolveReference(ref, spec) as Schema | undefined;
        if (resolved) {
          semanticType = this.findSemanticTypeInSchema(resolved);
          if (semanticType && (resolved as any)['x-semantic-provider'] === true) {
            provider = true;
          }
          // Heuristic: if still not found, derive from last segment of ref if it looks like a semantic type (PascalCase + Key suffix)
          if (!semanticType) {
            const name = ref.split('/').pop();
            if (name && /[A-Z]/.test(name) && /Key$/.test(name)) {
              // Only assign if that schema ultimately expands to a semantic type in its allOf/oneOf chain
              semanticType = name;
            }
          }
        }
      } else if (!('$ref' in param.schema)) {
        // Direct inline schema: check x-semantic-type
        semanticType = (param.schema as any)['x-semantic-type'];
        if (semanticType && (param.schema as any)['x-semantic-provider'] === true) {
          provider = true;
        }
      }
    }

    // Extract parameter schema details
    const schema = this.extractParameterSchema(param.schema, spec);

    return {
      name: param.name,
      location: param.in,
      semanticType,
      required: param.required || param.in === 'path', // path params are always required
      description: param.description,
      schema,
      examples: this.extractParameterExamples(param),
      provider,
    };
  }

  /**
   * Extract semantic types from request body
   */
  private extractRequestBodySemanticTypes(
    requestBody: any,
    spec: OpenAPISpec,
  ): SemanticTypeReference[] {
    if (!requestBody) {
      return [];
    }

    // Resolve reference if needed
    if ('$ref' in requestBody) {
      requestBody = this.resolveReference(requestBody.$ref, spec);
    }

    const semanticTypes: SemanticTypeReference[] = [];

    // Check content types (usually application/json)
    if (requestBody.content) {
      for (const [contentType, mediaType] of Object.entries(requestBody.content)) {
        const typedMediaType = mediaType as MediaTypeObject;
        if (typedMediaType.schema) {
          this.extractSemanticTypesFromMediaType(typedMediaType, '', true, semanticTypes, spec);
        }
      }
    }

    return semanticTypes;
  }

  /**
   * Extract semantic types from response schemas
   */
  private extractResponseSemanticTypes(
    responses: any,
    spec: OpenAPISpec,
  ): Record<string, SemanticTypeReference[]> {
    const result: Record<string, SemanticTypeReference[]> = {};

    for (const [statusCode, response] of Object.entries(responses)) {
      let resolvedResponse = response;

      // Resolve reference if needed
      if (typeof response === 'object' && response !== null && '$ref' in response) {
        resolvedResponse = this.resolveReference((response as ReferenceObject).$ref, spec);
        if (!resolvedResponse) {
          // Unresolvable $ref (e.g. path-local cross-reference) — skip this response code
          continue;
        }
      }

      const semanticTypes: SemanticTypeReference[] = [];

      // Check response content
      if ((resolvedResponse as ResponseObject).content) {
        for (const [contentType, mediaType] of Object.entries(
          (resolvedResponse as ResponseObject).content!,
        )) {
          this.extractSemanticTypesFromMediaType(mediaType, '', false, semanticTypes, spec);
        }
      }

      result[statusCode] = semanticTypes;
    }

    return result;
  }

  /**
   * Extract semantic types from a media type object (request/response content)
   */
  private extractSemanticTypesFromMediaType(
    mediaType: MediaTypeObject,
    fieldPath: string,
    required: boolean,
    semanticTypes: SemanticTypeReference[],
    spec: OpenAPISpec,
  ): void {
    if (!mediaType.schema) {
      return;
    }

    this.extractSemanticTypesFromSchemaReference(
      mediaType.schema,
      fieldPath,
      required,
      semanticTypes,
      spec,
    );
  }

  /**
   * Extract semantic types from a schema, handling references
   */
  private extractSemanticTypesFromSchemaReference(
    schema: Schema | ReferenceObject,
    fieldPath: string,
    required: boolean,
    semanticTypes: SemanticTypeReference[],
    spec: OpenAPISpec,
  ): void {
    let resolvedSchema = schema;

    // Resolve reference if needed
    if ('$ref' in schema && schema.$ref) {
      resolvedSchema = this.resolveReference(schema.$ref, spec) as Schema;
      if (!resolvedSchema) {
        return;
      }
    }

    const actualSchema = resolvedSchema as Schema;

    // Detect semantic type (direct or via nested allOf chain)
    const directSemanticType = (actualSchema as any)['x-semantic-type'];
    const nestedSemanticType = !directSemanticType
      ? this.findSemanticTypeInSchema(actualSchema)
      : undefined;
    let detectedSemanticType = directSemanticType || nestedSemanticType;
    // Fallback: if provider flag present but semantic type unresolved, attempt to resolve via allOf $ref chain
    if (
      !detectedSemanticType &&
      (actualSchema as any)['x-semantic-provider'] === true &&
      Array.isArray(actualSchema.allOf)
    ) {
      for (const sub of actualSchema.allOf) {
        if (sub && typeof sub === 'object' && '$ref' in sub) {
          const resolved = this.resolveReference((sub as any).$ref, spec) as Schema | undefined;
          if (resolved && (resolved as any)['x-semantic-type']) {
            detectedSemanticType = (resolved as any)['x-semantic-type'];
            break;
          }
        }
      }
    }
    if (detectedSemanticType) {
      const fieldSchema = this.extractFieldSchema(actualSchema);
      const isProvider = (actualSchema as any)['x-semantic-provider'] === true;
      // Deduplicate by semanticType+fieldPath; upgrade provider flag if any occurrence marks it
      const existing = semanticTypes.find(
        (st) => st.semanticType === detectedSemanticType && st.fieldPath === fieldPath,
      );
      if (existing) {
        if (isProvider) existing.provider = true;
      } else {
        semanticTypes.push({
          semanticType: detectedSemanticType,
          fieldPath,
          required,
          description: actualSchema.description,
          schema: fieldSchema,
          examples: this.extractSchemaExamples(actualSchema),
          constraints: this.extractValidationConstraints(actualSchema),
          provider: isProvider,
        });
      }
    }

    // Recursively check properties
    if (actualSchema.properties) {
      const requiredFields = actualSchema.required || [];

      for (const [propName, propSchema] of Object.entries(actualSchema.properties)) {
        const propPath = fieldPath ? `${fieldPath}.${propName}` : propName;
        const propRequired = requiredFields.includes(propName);

        this.extractSemanticTypesFromSchemaReference(
          propSchema,
          propPath,
          propRequired,
          semanticTypes,
          spec,
        );
      }
    }

    // Check array items
    if (actualSchema.items) {
      const itemPath = fieldPath ? `${fieldPath}[]` : '[]';
      this.extractSemanticTypesFromSchemaReference(
        actualSchema.items,
        itemPath,
        required,
        semanticTypes,
        spec,
      );
    }

    // Handle allOf, oneOf, anyOf
    if (actualSchema.allOf) {
      actualSchema.allOf.forEach((subSchema) => {
        this.extractSemanticTypesFromSchemaReference(
          subSchema,
          fieldPath,
          required,
          semanticTypes,
          spec,
        );
        // If wrapper is provider, propagate provider to matching semantic type entries just added
        if ((actualSchema as any)['x-semantic-provider'] === true) {
          semanticTypes
            .filter((st) => st.fieldPath === fieldPath)
            .forEach((st) => {
              st.provider = true;
            });
        }
      });
    }

    if (actualSchema.oneOf) {
      actualSchema.oneOf.forEach((subSchema) => {
        this.extractSemanticTypesFromSchemaReference(
          subSchema,
          fieldPath,
          required,
          semanticTypes,
          spec,
        );
      });
    }

    if (actualSchema.anyOf) {
      actualSchema.anyOf.forEach((subSchema) => {
        this.extractSemanticTypesFromSchemaReference(
          subSchema,
          fieldPath,
          required,
          semanticTypes,
          spec,
        );
      });
    }
  }

  /**
   * Find semantic type annotation in a schema (recursively)
   */
  private findSemanticTypeInSchema(schema: Schema): string | undefined {
    if (schema['x-semantic-type']) {
      return schema['x-semantic-type'];
    }

    // Check in allOf
    if (schema.allOf) {
      for (const subSchema of schema.allOf) {
        if (!('$ref' in subSchema)) {
          const found = this.findSemanticTypeInSchema(subSchema);
          if (found) return found;
        }
      }
    }

    return undefined;
  }

  /**
   * Resolve a JSON reference to its actual object
   */
  private resolveReference(ref: string, spec: OpenAPISpec): any {
    // Handle #/components/schemas/... references
    if (ref.startsWith('#/components/schemas/')) {
      const schemaName = ref.replace('#/components/schemas/', '');
      return spec.components?.schemas?.[schemaName];
    }

    // Handle #/components/responses/... references
    if (ref.startsWith('#/components/responses/')) {
      const responseName = ref.replace('#/components/responses/', '');
      return spec.components?.responses?.[responseName];
    }

    // Handle #/components/parameters/... references
    if (ref.startsWith('#/components/parameters/')) {
      const paramName = ref.replace('#/components/parameters/', '');
      return spec.components?.parameters?.[paramName];
    }

    // Handle #/components/requestBodies/... references
    if (ref.startsWith('#/components/requestBodies/')) {
      const requestBodyName = ref.replace('#/components/requestBodies/', '');
      return spec.components?.requestBodies?.[requestBodyName];
    }

    console.warn(`Unable to resolve reference: ${ref}`);
    return null;
  }

  /**
   * Classify operation type based on method, path, and operation details
   */
  private classifyOperation(
    operation: OperationObject,
    path: string,
    method: string,
  ): OperationType {
    // Special cases first
    if (path.includes('/deployment') && method.toUpperCase() === 'POST')
      return OperationType.DEPLOY;
    if (operation.operationId?.includes('search') || path.includes('/search'))
      return OperationType.SEARCH;

    // Standard REST patterns
    switch (method.toUpperCase()) {
      case 'POST':
        if (
          path.includes('/activation') ||
          path.includes('/completion') ||
          path.includes('/deletion')
        ) {
          return OperationType.ACTION;
        }
        return OperationType.CREATE;
      case 'GET':
        return OperationType.READ;
      case 'PUT':
      case 'PATCH':
        return OperationType.UPDATE;
      case 'DELETE':
        return OperationType.DELETE;
      default:
        return OperationType.ACTION;
    }
  }

  /**
   * Check if an operation is idempotent
   */
  private isIdempotent(method: string, operation: OperationObject): boolean {
    const idempotentMethods = ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];
    return idempotentMethods.includes(method.toUpperCase());
  }

  /**
   * Check if an operation is cacheable
   */
  private isCacheable(method: string, operation: OperationObject): boolean {
    const cacheableMethods = ['GET', 'HEAD'];
    return cacheableMethods.includes(method.toUpperCase());
  }

  /**
   * Extract parameter schema details
   */
  private extractParameterSchema(
    schema: Schema | ReferenceObject | undefined,
    spec: OpenAPISpec,
  ): ParameterSchema {
    if (!schema) return { type: 'string' };

    let resolvedSchema = schema;
    if ('$ref' in schema && schema.$ref) {
      resolvedSchema = this.resolveReference(schema.$ref, spec) as Schema;
      if (!resolvedSchema) return { type: 'string' };
    }

    const actualSchema = resolvedSchema as Schema;

    return {
      type: actualSchema.type || 'string',
      format: actualSchema.format,
      pattern: actualSchema.pattern,
      minLength: actualSchema.minLength,
      maxLength: actualSchema.maxLength,
      enum: actualSchema.enum,
      items: actualSchema.items ? this.extractParameterSchema(actualSchema.items, spec) : undefined,
      properties: actualSchema.properties
        ? Object.fromEntries(
            Object.entries(actualSchema.properties).map(([key, prop]) => [
              key,
              this.extractParameterSchema(prop, spec),
            ]),
          )
        : undefined,
    };
  }

  /**
   * Extract field schema details for semantic type references
   */
  private extractFieldSchema(schema: Schema): FieldSchema {
    return {
      type: schema.type || 'string',
      format: schema.format,
      pattern: schema.pattern,
      minLength: schema.minLength,
      maxLength: schema.maxLength,
      enum: schema.enum,
    };
  }

  /**
   * Extract examples from parameter objects
   */
  private extractParameterExamples(param: ParameterObject): any[] {
    const examples: any[] = [];

    if (param.example !== undefined) {
      examples.push(param.example);
    }

    if (param.examples) {
      for (const example of Object.values(param.examples)) {
        if ('value' in example) {
          examples.push(example.value);
        }
      }
    }

    return examples;
  }

  /**
   * Extract examples from schema objects
   */
  private extractSchemaExamples(schema: Schema): any[] {
    const examples: any[] = [];

    if (schema.example !== undefined) {
      examples.push(schema.example);
    }

    if (schema.examples) {
      examples.push(...schema.examples);
    }

    return examples;
  }

  /**
   * Extract validation constraints from schema
   */
  private extractValidationConstraints(schema: Schema): ValidationConstraint[] {
    const constraints: ValidationConstraint[] = [];

    if (schema.pattern) {
      constraints.push({
        type: 'pattern',
        rule: schema.pattern,
        errorMessage: `Must match pattern: ${schema.pattern}`,
      });
    }

    if (schema.minLength !== undefined) {
      constraints.push({
        type: 'length',
        rule: `minLength: ${schema.minLength}`,
        errorMessage: `Must be at least ${schema.minLength} characters long`,
      });
    }

    if (schema.maxLength !== undefined) {
      constraints.push({
        type: 'length',
        rule: `maxLength: ${schema.maxLength}`,
        errorMessage: `Must be no more than ${schema.maxLength} characters long`,
      });
    }

    if (schema.enum) {
      constraints.push({
        type: 'enum',
        rule: `enum: [${schema.enum.join(', ')}]`,
        errorMessage: `Must be one of: ${schema.enum.join(', ')}`,
      });
    }

    return constraints;
  }
}
