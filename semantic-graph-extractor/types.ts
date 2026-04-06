/**
 * Type definitions for the semantic graph extractor
 */

// OpenAPI specification types
export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{
    url: string;
    description?: string;
    variables?: Record<string, any>;
  }>;
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, Schema>;
    responses?: Record<string, ResponseObject>;
    parameters?: Record<string, ParameterObject>;
    examples?: Record<string, ExampleObject>;
    requestBodies?: Record<string, RequestBodyObject>;
    headers?: Record<string, HeaderObject>;
    securitySchemes?: Record<string, SecuritySchemeObject>;
    links?: Record<string, LinkObject>;
    callbacks?: Record<string, CallbackObject>;
  };
  security?: SecurityRequirementObject[];
  tags?: TagObject[];
  externalDocs?: ExternalDocumentationObject;
}

export interface PathItem {
  $ref?: string;
  summary?: string;
  description?: string;
  get?: OperationObject;
  put?: OperationObject;
  post?: OperationObject;
  delete?: OperationObject;
  options?: OperationObject;
  head?: OperationObject;
  patch?: OperationObject;
  trace?: OperationObject;
  servers?: ServerObject[];
  parameters?: (ParameterObject | ReferenceObject)[];
}

export interface OperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  externalDocs?: ExternalDocumentationObject;
  operationId?: string;
  parameters?: (ParameterObject | ReferenceObject)[];
  requestBody?: RequestBodyObject | ReferenceObject;
  responses: ResponsesObject;
  callbacks?: Record<string, CallbackObject | ReferenceObject>;
  deprecated?: boolean;
  security?: SecurityRequirementObject[];
  servers?: ServerObject[];
  'x-eventually-consistent'?: boolean;
}

export interface Schema {
  type?: string;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  description?: string;
  'x-semantic-type'?: string;
  allOf?: (Schema | ReferenceObject)[];
  oneOf?: (Schema | ReferenceObject)[];
  anyOf?: (Schema | ReferenceObject)[];
  properties?: Record<string, Schema | ReferenceObject>;
  required?: string[];
  items?: Schema | ReferenceObject;
  additionalProperties?: boolean | Schema | ReferenceObject;
  enum?: any[];
  example?: any;
  examples?: any[];
  $ref?: string;
}

export interface ResponseObject {
  description: string;
  headers?: Record<string, HeaderObject | ReferenceObject>;
  content?: Record<string, MediaTypeObject>;
  links?: Record<string, LinkObject | ReferenceObject>;
}

export interface ResponsesObject {
  [statusCode: string]: ResponseObject | ReferenceObject;
}

export interface MediaTypeObject {
  schema?: Schema | ReferenceObject;
  example?: any;
  examples?: Record<string, ExampleObject | ReferenceObject>;
  encoding?: Record<string, EncodingObject>;
}

export interface ParameterObject {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
  schema?: Schema | ReferenceObject;
  example?: any;
  examples?: Record<string, ExampleObject | ReferenceObject>;
  content?: Record<string, MediaTypeObject>;
}

export interface RequestBodyObject {
  description?: string;
  content: Record<string, MediaTypeObject>;
  required?: boolean;
}

export interface ReferenceObject {
  $ref: string;
}

// Supporting types
export interface ServerObject {
  url: string;
  description?: string;
  variables?: Record<string, ServerVariableObject>;
}

export interface ServerVariableObject {
  enum?: string[];
  default: string;
  description?: string;
}

export interface ExternalDocumentationObject {
  description?: string;
  url: string;
}

export interface TagObject {
  name: string;
  description?: string;
  externalDocs?: ExternalDocumentationObject;
}

export interface SecurityRequirementObject {
  [name: string]: string[];
}

export interface HeaderObject extends Omit<ParameterObject, 'name' | 'in'> {}

export interface ExampleObject {
  summary?: string;
  description?: string;
  value?: any;
  externalValue?: string;
}

export interface EncodingObject {
  contentType?: string;
  headers?: Record<string, HeaderObject | ReferenceObject>;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
}

export interface LinkObject {
  operationRef?: string;
  operationId?: string;
  parameters?: Record<string, any>;
  requestBody?: any;
  description?: string;
  server?: ServerObject;
}

export interface CallbackObject {
  [expression: string]: PathItem;
}

export interface SecuritySchemeObject {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  description?: string;
  name?: string;
  in?: 'query' | 'header' | 'cookie';
  scheme?: string;
  bearerFormat?: string;
  flows?: OAuthFlowsObject;
  openIdConnectUrl?: string;
}

export interface OAuthFlowsObject {
  implicit?: OAuthFlowObject;
  password?: OAuthFlowObject;
  clientCredentials?: OAuthFlowObject;
  authorizationCode?: OAuthFlowObject;
}

export interface OAuthFlowObject {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

// Semantic graph types
export interface SemanticType {
  name: string;
  description?: string;
  format?: string;
  baseType: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface Operation {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters: OperationParameter[];
  requestBodySemanticTypes: SemanticTypeReference[];
  responseSemanticTypes: Record<string, SemanticTypeReference[]>; // keyed by status code
  eventuallyConsistent?: boolean;
  // NEW: Enhanced analysis
  operationType: OperationType;
  requiredSetupOperations?: string[]; // Operations that must run first
  sideEffects?: SideEffect[];
  idempotent?: boolean;
  cacheable?: boolean;
  // Operation metadata (from x-operation-kind)
  operationMetadata?: OperationMetadata;
  // Conditional idempotency extension (x-conditional-idempotency)
  conditionalIdempotency?: ConditionalIdempotencySpec;
}

export enum OperationType {
  CREATE = 'create',      // Creates new resources
  READ = 'read',          // Reads existing resources  
  UPDATE = 'update',      // Modifies existing resources
  DELETE = 'delete',      // Removes resources
  SEARCH = 'search',      // Queries for resources
  ACTION = 'action',      // Performs actions (activate, complete, etc.)
  DEPLOY = 'deploy',      // Special: deployment operations
  SETUP = 'setup'         // Special: setup/initialization operations
}

export interface SideEffect {
  type: 'creates' | 'modifies' | 'deletes' | 'triggers';
  description: string;
  affectedSemanticTypes: string[];
}

export interface OperationParameter {
  name: string;
  location: 'path' | 'query' | 'header' | 'cookie';
  semanticType?: string;
  required: boolean;
  description?: string;
  // NEW: Schema validation details
  schema: ParameterSchema;
  examples?: any[];
  provider?: boolean; // authoritative provider flag if parameter directly provides semantic type
}

export interface ParameterSchema {
  type: string;                    // string, number, boolean, array, object
  format?: string;                 // date, date-time, uri, email, etc.
  pattern?: string;                // regex pattern
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: any[];
  items?: ParameterSchema;         // for arrays
  properties?: Record<string, ParameterSchema>; // for objects
}

export interface SemanticTypeReference {
  semanticType: string;
  fieldPath: string;
  required: boolean;
  description?: string;
  // NEW: Schema validation details
  schema: FieldSchema;
  examples?: any[];
  constraints?: ValidationConstraint[];
  provider?: boolean; // true if this field is an authoritative provider (semantic-provider:true)
}

export interface FieldSchema {
  type: string;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: any[];
  nullable?: boolean;
}

export interface ValidationConstraint {
  type: 'required' | 'format' | 'pattern' | 'range' | 'length' | 'enum';
  rule: string;
  errorMessage?: string;
}

export interface DependencyEdge {
  sourceOperationId: string;
  targetOperationId: string;
  semanticType: string;
  sourceFieldPath: string;  // Where the semantic type is produced
  targetFieldPath: string;  // Where the semantic type is consumed
  strength: DependencyStrength;
  description?: string;
}

export enum DependencyStrength {
  REQUIRED = 'required',    // Target operation cannot be called without source
  OPTIONAL = 'optional',    // Target operation can be called without source, but benefits from it
  CONDITIONAL = 'conditional' // Target operation may need source depending on conditions
}

export interface OperationDependencyGraph {
  operations: Map<string, Operation>;
  semanticTypes: Map<string, SemanticType>;
  edges: DependencyEdge[];
  // NEW: Enhanced analysis results
  semanticTypeLibrary?: SemanticTypeLibrary;
  rootDependencyAnalysis?: RootOperationAnalysis;
  crossContaminationMap?: CrossContaminationMap;
}

// NEW: Semantic Type Library interfaces
export interface SemanticTypeLibrary {
  semanticTypes: Map<string, SemanticTypeDefinition>;
}

export interface SemanticTypeDefinition {
  name: string;
  description?: string;
  baseType: string;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  // NEW: Value libraries for test generation
  validExamples: any[];
  invalidExamples: InvalidExample[];
  crossContaminationSources: string[]; // Other semantic types with same base type
  generationRules: ValueGenerationRule[];
}

export interface InvalidExample {
  value: any;
  invalidationType: 'wrong_type' | 'wrong_format' | 'out_of_bounds' | 'wrong_semantic_type';
  description: string;
}

export interface ValueGenerationRule {
  type: 'random' | 'boundary' | 'pattern' | 'enum';
  rule: string;
}

// Operation metadata vendor extension representation
export interface OperationMetadata {
  kind?: string; // query|create|update|patch|delete|command|event|batch-command
  duplicatePolicy?: string; // conflict|return-existing|ignore|upsert|merge|batch-partial
  idempotent?: boolean;
  safe?: boolean;
  idempotencyMechanism?: string; // natural-key|body-hash|idempotency-key|server-token|none
  idempotencyScope?: string; // resource|request|key+payload
  idempotencyKeyHeader?: string; // required header name if mechanism=idempotency-key
}

export interface ConditionalIdempotencySpec {
  keyFields: string[];
  window: { field: string; unit: string };
  duplicatePolicy: string; // currently 'ignore'
  appliesWhen: string; // 'key-present'
}

// NEW: Root Dependency Analysis interfaces
export interface RootOperationAnalysis {
  deploymentOperations: string[];     // Operations that create foundational resources
  setupOperations: string[];          // Operations that must run before others
  entryPointOperations: string[];     // Operations with no dependencies
  bootstrapSequences: BootstrapSequence[];
}

export interface BootstrapSequence {
  name: string;
  description: string;
  operations: string[];              // Ordered sequence of operations
  produces: string[];               // Semantic types produced by this sequence
}

// NEW: Cross-contamination mapping
export interface CrossContaminationMap {
  [semanticType: string]: string[];  // Maps semantic type to potential contaminants
}

// Analysis result types
export interface GraphAnalysis {
  entryPoints: string[];        // Operations with no dependencies
  sinks: string[];             // Operations that don't produce outputs used by others
  stronglyConnectedComponents: string[][];
  longestPaths: DependencyPath[];
  coverage: {
    semanticTypeCoverage: number;  // Percentage of semantic types that are used
    operationCoverage: number;     // Percentage of operations that are reachable
  };
}

export interface DependencyPath {
  operations: string[];
  semanticTypes: string[];
  totalLength: number;
}

// Test generation types (for future phases)
export interface TestScenario {
  id: string;
  name: string;
  description?: string;
  operations: TestStep[];
  expectedCoverage: {
    operations: string[];
    semanticTypes: string[];
  };
}

export interface TestStep {
  operationId: string;
  dependencies: {
    [parameterName: string]: string; // Maps to previous step's response field
  };
  expectedStatusCode?: string;
  validations?: TestValidation[];
}

export interface TestValidation {
  type: 'response_field' | 'status_code' | 'semantic_type';
  field?: string;
  expectedValue?: any;
  semanticType?: string;
}
