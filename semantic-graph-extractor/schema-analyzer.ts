import {
  type ConditionalIdempotencySpec,
  type FieldSchema,
  type MediaTypeObject,
  type OpenAPISpec,
  type Operation,
  type OperationMetadata,
  type OperationObject,
  type OperationParameter,
  OperationType,
  type ParameterObject,
  type ParameterSchema,
  type ReferenceObject,
  type RequestBodyObject,
  type ResponseObject,
  type ResponsesObject,
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
    let opMeta: OperationMetadata | undefined;
    const rawKind = operation['x-operation-kind'];
    if (rawKind) {
      if (Array.isArray(rawKind)) {
        opMeta = rawKind.find(
          (o) =>
            !!o &&
            typeof o === 'object' &&
            (!!o.kind || !!o.duplicatePolicy || !!o.idempotencyMechanism),
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
    const cond = operation['x-conditional-idempotency'];
    let conditionalIdempotency: ConditionalIdempotencySpec | undefined;
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
        const resolvedParam = this.resolveReference<ParameterObject>(param.$ref, spec);
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
      if ('$ref' in param.schema && param.schema.$ref) {
        const ref = param.schema.$ref;
        const resolved = this.resolveReference<Schema>(ref, spec);
        if (resolved) {
          semanticType = this.findSemanticTypeInSchema(resolved);
          if (semanticType && resolved['x-semantic-provider'] === true) {
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
        semanticType = param.schema['x-semantic-type'];
        if (semanticType && param.schema['x-semantic-provider'] === true) {
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
    requestBody: RequestBodyObject | ReferenceObject | undefined,
    spec: OpenAPISpec,
  ): SemanticTypeReference[] {
    if (!requestBody) {
      return [];
    }

    // Resolve reference if needed
    const resolvedBody: RequestBodyObject | null =
      '$ref' in requestBody
        ? this.resolveReference<RequestBodyObject>(requestBody.$ref, spec)
        : requestBody;

    const semanticTypes: SemanticTypeReference[] = [];

    // Check content types (usually application/json)
    if (resolvedBody?.content) {
      for (const mediaType of Object.values(resolvedBody.content)) {
        if (mediaType.schema) {
          this.extractSemanticTypesFromMediaType(mediaType, '', true, semanticTypes, spec);
        }
      }
    }

    return semanticTypes;
  }

  /**
   * Extract semantic types from response schemas
   */
  private extractResponseSemanticTypes(
    responses: ResponsesObject,
    spec: OpenAPISpec,
  ): Record<string, SemanticTypeReference[]> {
    const result: Record<string, SemanticTypeReference[]> = {};

    for (const [statusCode, response] of Object.entries(responses)) {
      let resolvedResponse: ResponseObject | null;

      // Resolve reference if needed
      if (response && typeof response === 'object' && '$ref' in response) {
        resolvedResponse = this.resolveReference<ResponseObject>(response.$ref, spec);
        if (!resolvedResponse) {
          // Unresolvable $ref (e.g. path-local cross-reference) — skip this response code
          continue;
        }
      } else {
        resolvedResponse = response;
      }

      const semanticTypes: SemanticTypeReference[] = [];

      // Check response content
      if (resolvedResponse.content) {
        for (const mediaType of Object.values(resolvedResponse.content)) {
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
      false,
    );
  }

  /**
   * Extract semantic types from a schema, handling references.
   *
   * `inheritedProvider` carries down whether an enclosing object schema named
   * this leaf in its `x-semantic-provider: [propA, propB, ...]` array. The
   * canonical form of the annotation in the Camunda spec is the array form
   * applied to the object schema (e.g. `DeploymentProcessResult` declares
   * `x-semantic-provider: ["processDefinitionKey", "processDefinitionId"]`).
   * The legacy boolean form on the leaf itself is also supported. See
   * camunda/api-test-generator#33 for the bug this fixes.
   */
  private extractSemanticTypesFromSchemaReference(
    schema: Schema | ReferenceObject,
    fieldPath: string,
    required: boolean,
    semanticTypes: SemanticTypeReference[],
    spec: OpenAPISpec,
    inheritedProvider = false,
  ): void {
    let resolvedSchema = schema;

    // Resolve reference if needed
    if ('$ref' in schema && schema.$ref) {
      const ref = this.resolveReference<Schema>(schema.$ref, spec);
      if (!ref) {
        return;
      }
      resolvedSchema = ref;
    }

    // biome-ignore lint/plugin: After the $ref branch above, the value is structurally a Schema (Schema's own $ref is optional).
    const actualSchema = resolvedSchema as Schema;

    // Detect semantic type (direct or via nested allOf chain)
    const directSemanticType = actualSchema['x-semantic-type'];
    const nestedSemanticType = !directSemanticType
      ? this.findSemanticTypeInSchema(actualSchema)
      : undefined;
    let detectedSemanticType = directSemanticType || nestedSemanticType;
    // Fallback: if provider flag present but semantic type unresolved, attempt to resolve via allOf $ref chain
    if (
      !detectedSemanticType &&
      actualSchema['x-semantic-provider'] === true &&
      Array.isArray(actualSchema.allOf)
    ) {
      for (const sub of actualSchema.allOf) {
        if (sub && typeof sub === 'object' && '$ref' in sub && sub.$ref) {
          const resolved = this.resolveReference<Schema>(sub.$ref, spec);
          if (resolved?.['x-semantic-type']) {
            detectedSemanticType = resolved['x-semantic-type'];
            break;
          }
        }
      }
    }
    if (detectedSemanticType) {
      const fieldSchema = this.extractFieldSchema(actualSchema);
      const directProvider = actualSchema['x-semantic-provider'] === true;
      const isProvider = directProvider || inheritedProvider;
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

    // Recursively check properties.
    //
    // Iteration 1 of camunda/api-test-generator#31: a property leaf is reported
    // as `required: true` only when every ancestor along its field path was
    // also required. Previously a leaf could end up flagged required because
    // its immediate parent listed it in `required`, even when the parent
    // itself sat under an optional/array/oneOf ancestor — leaking conditional
    // requiredness up to consumers that planned prerequisite call chains.
    if (actualSchema.properties) {
      const requiredFields = actualSchema.required || [];
      const providerAnnotation = actualSchema['x-semantic-provider'];
      const providerProps = Array.isArray(providerAnnotation) ? providerAnnotation : undefined;

      for (const [propName, propSchema] of Object.entries(actualSchema.properties)) {
        const propPath = fieldPath ? `${fieldPath}.${propName}` : propName;
        const propRequired = required && requiredFields.includes(propName);
        // A child property is an authoritative provider when either:
        //   (a) this object schema lists its name in `x-semantic-provider: [...]`, or
        //   (b) the inherited flag is already true — i.e. an ancestor's array
        //       annotation named a property whose subtree contains this child.
        // Without the OR, a provider annotation on an outer object would be
        // dropped at any intermediate object boundary inside the named subtree.
        // The legacy boolean form (`x-semantic-provider: true`) is honoured at
        // the leaf itself in the detection block above.
        const childInheritedProvider =
          inheritedProvider || (providerProps?.includes(propName) ?? false);

        this.extractSemanticTypesFromSchemaReference(
          propSchema,
          propPath,
          propRequired,
          semanticTypes,
          spec,
          childInheritedProvider,
        );
      }
    }

    // Array items are present only when the array itself is non-empty. Even if
    // the items schema lists required properties, those leaves should not be
    // classified as required at the request level for iteration 1 — base
    // scenarios do not populate optional arrays. (See #31; later iterations
    // may special-case `minItems > 0` to keep strictly required items.)
    if (actualSchema.items) {
      const itemPath = fieldPath ? `${fieldPath}[]` : '[]';
      this.extractSemanticTypesFromSchemaReference(
        actualSchema.items,
        itemPath,
        false,
        semanticTypes,
        spec,
        inheritedProvider,
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
          inheritedProvider,
        );
        // If wrapper is provider, propagate provider to matching semantic type entries just added
        if (actualSchema['x-semantic-provider'] === true) {
          semanticTypes
            .filter((st) => st.fieldPath === fieldPath)
            .forEach((st) => {
              st.provider = true;
            });
        }
      });
    }

    // oneOf / anyOf describe alternative shapes. Each branch is a complete
    // schema with its own `required` list, and exactly one branch is selected
    // per request, so the parent's requiredness propagates into each branch
    // unchanged — the per-branch `required` list then drives leaf classification.
    if (actualSchema.oneOf) {
      actualSchema.oneOf.forEach((subSchema) => {
        this.extractSemanticTypesFromSchemaReference(
          subSchema,
          fieldPath,
          required,
          semanticTypes,
          spec,
          inheritedProvider,
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
          inheritedProvider,
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
   * Resolve a JSON reference to its actual object.
   *
   * The OpenAPI document is parsed as untyped JSON, so the resolved value's runtime
   * shape is determined by where the $ref pointed. Callers supply the expected type
   * via the type parameter, and the casts below are the single boundary where the
   * unsafe narrowing happens.
   */
  private resolveReference<T = unknown>(ref: string, spec: OpenAPISpec): T | null {
    // Handle #/components/schemas/... references
    if (ref.startsWith('#/components/schemas/')) {
      const schemaName = ref.replace('#/components/schemas/', '');
      // biome-ignore lint/plugin: single boundary where untyped JSON is narrowed; caller declares expected schema type
      return (spec.components?.schemas?.[schemaName] as T | undefined) ?? null;
    }

    // Handle #/components/responses/... references
    if (ref.startsWith('#/components/responses/')) {
      const responseName = ref.replace('#/components/responses/', '');
      // biome-ignore lint/plugin: single boundary where untyped JSON is narrowed; caller declares expected schema type
      return (spec.components?.responses?.[responseName] as T | undefined) ?? null;
    }

    // Handle #/components/parameters/... references
    if (ref.startsWith('#/components/parameters/')) {
      const paramName = ref.replace('#/components/parameters/', '');
      // biome-ignore lint/plugin: single boundary where untyped JSON is narrowed; caller declares expected schema type
      return (spec.components?.parameters?.[paramName] as T | undefined) ?? null;
    }

    // Handle #/components/requestBodies/... references
    if (ref.startsWith('#/components/requestBodies/')) {
      const requestBodyName = ref.replace('#/components/requestBodies/', '');
      // biome-ignore lint/plugin: single boundary where untyped JSON is narrowed; caller declares expected schema type
      return (spec.components?.requestBodies?.[requestBodyName] as T | undefined) ?? null;
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
  private isIdempotent(method: string, _operation: OperationObject): boolean {
    const idempotentMethods = ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];
    return idempotentMethods.includes(method.toUpperCase());
  }

  /**
   * Check if an operation is cacheable
   */
  private isCacheable(method: string, _operation: OperationObject): boolean {
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

    let resolvedSchema: Schema | ReferenceObject = schema;
    if ('$ref' in schema && schema.$ref) {
      const resolved = this.resolveReference<Schema>(schema.$ref, spec);
      if (!resolved) return { type: 'string' };
      resolvedSchema = resolved;
    }

    // biome-ignore lint/plugin: After the $ref branch above, the value is structurally a Schema (Schema's own $ref is optional).
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
  private extractParameterExamples(param: ParameterObject): unknown[] {
    const examples: unknown[] = [];

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
  private extractSchemaExamples(schema: Schema): unknown[] {
    const examples: unknown[] = [];

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
