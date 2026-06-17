// NOTE: Many schema shapes are dynamic OpenAPI fragments. We model them as
// permissive recursive structures so that consumers must narrow before reading
// nested fields, while preserving full structural access (vs. opaque `unknown`).
export interface SchemaFragment {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, SchemaFragment>;
  items?: SchemaFragment;
  enum?: unknown[];
  oneOf?: SchemaFragment[];
  anyOf?: SchemaFragment[];
  allOf?: SchemaFragment[];
  additionalProperties?: boolean | SchemaFragment;
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  multipleOf?: number;
  [key: string]: unknown;
}

export interface OperationModel {
  operationId: string;
  method: string; // GET, POST ...
  path: string;
  tags: string[];
  requestBodySchema?: SchemaFragment; // dereferenced schema (JSON)
  /** True if the OpenAPI operation-level requestBody object is marked required: true */
  bodyRequired?: boolean;
  requiredProps?: string[]; // top-level required fields (object bodies)
  parameters: ParameterModel[];
  rootOneOf?: SchemaFragment[]; // array of variant schemas if oneOf at root
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  /** multipart/form-data schema if present (raw dereferenced) */
  multipartSchema?: SchemaFragment;
  /** Required properties for multipart schema (if any) */
  multipartRequiredProps?: string[];
  /** All request body media types advertised by the operation */
  mediaTypes?: string[];
  /**
   * True when the operation is secured *conditionally* on the `auth`
   * deployment-mode axis: it declares (or inherits) a `security` requirement
   * that references a security scheme whose `x-enforcement` is `conditional`
   * (camunda/camunda#53708). Such an operation returns 401 when called
   * without credentials against a server started in secured mode, and is
   * unauthenticated otherwise. An explicit `security: []` override (publicly
   * unauthenticated at runtime) yields `false`.
   */
  conditionalAuth?: boolean;
  /**
   * True when the operation's effective `security` requirement (its own, the
   * path item's, or the global `security`, by OpenAPI precedence) *mandates*
   * authentication — i.e. it is a non-empty array in which EVERY alternative
   * names at least one scheme, regardless of `x-enforcement`.
   *
   * The `security` array is an OR: an empty Security Requirement Object `{}`
   * (or an empty array `[]`) permits anonymous access, so either makes this
   * `false`. Distinct from `conditionalAuth`: this is the "does this op require
   * auth at all" signal, used by BOTH 401 generators (auth-absent and
   * auth-invalid) under `authAbsentMode: 'all-secured'` for APIs uniformly
   * authenticated via a single global scheme (e.g. Hub).
   */
  secured?: boolean;
  /**
   * Response status codes the operation declares in its OpenAPI `responses`
   * map (e.g. `['200','400','404','500']`). Used by the not-found-fake-id
   * generator to emit a 404 test only when the contract actually allows a
   * 404 (#381 / #279).
   */
  responseCodes?: string[];
  /**
   * True when the operation's success (2xx) JSON response schema is a
   * paginated collection (its top-level object has an `items` or `page`
   * property). Such list/search endpoints return an empty `200` — not a
   * `404` — for a nonexistent parent id, so the not-found-fake-id generator
   * excludes them (#372 pattern 3 / #381).
   */
  successIsCollection?: boolean;
}

export interface ParameterModel {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  schema?: SchemaFragment;
}

export interface SpecModel {
  operations: OperationModel[];
}

export type ScenarioKind =
  | 'missing-required'
  | 'missing-required-combo'
  | 'type-mismatch'
  | 'union'
  | 'constraint-violation'
  | 'enum-violation'
  | 'additional-prop'
  | 'oneof-ambiguous'
  | 'oneof-none-match'
  | 'discriminator-mismatch'
  | 'param-missing'
  | 'param-type-mismatch'
  | 'param-enum-violation'
  | 'param-constraint-violation'
  | 'missing-body'
  | 'body-top-type-mismatch'
  | 'nested-additional-prop'
  | 'unique-items-violation'
  | 'multiple-of-violation'
  | 'format-invalid'
  | 'additional-prop-general'
  | 'oneof-multi-ambiguous'
  | 'oneof-cross-bleed'
  | 'discriminator-structure-mismatch'
  | 'allof-missing-required'
  | 'allof-conflict'
  | 'not-found-fake-id'
  | 'auth-absent'
  | 'auth-invalid'
  | 'auth-deny';

export interface ValidationScenario {
  id: string;
  operationId: string;
  method: string;
  path: string;
  type: ScenarioKind;
  target?: string; // field or parameter
  requestBody?: unknown;
  params?: Record<string, string>;
  expectedStatus: number; // usually 400
  description: string;
  /**
   * Whether to send the configured *admin* credentials, i.e. authHeaders()
   * (multipart) / jsonHeaders() (JSON). false → no admin credentials.
   * NOTE: some scenario kinds render their own `Authorization` header
   * regardless of this flag (which they leave `false`):
   *   - `auth-deny` authenticates as the zero-grant probe user via
   *     denyProbeHeaders() (a different principal);
   *   - `auth-invalid` sends a well-formed header carrying an invalid/unknown
   *     credential (`Bearer invalid-token`).
   * For all other kinds, `false` → no headers (`{}`).
   */
  headersAuth: boolean;
  source?: 'body' | 'query' | 'path' | 'header' | 'cookie';
  /** How to encode the body; defaults to json if omitted */
  bodyEncoding?: 'json' | 'multipart';
  /** Multipart form fields (used when bodyEncoding === 'multipart') */
  multipartForm?: Record<string, unknown>;
  /** Additional metadata for constraint-based scenarios */
  constraintKind?: string; // e.g. pattern | length-min | length-max | enum
  constraintOrigin?: 'body' | 'param';
}
