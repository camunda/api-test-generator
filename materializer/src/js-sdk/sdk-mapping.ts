/**
 * JavaScript SDK operation map loading and source code generation.
 *
 * The JavaScript SDK operation-map.json maps OpenAPI operationId → SDK method name.
 * This module loads it and provides JavaScript-specific utilities for rendering
 * test code (string escaping, URL expressions with template literals, body substitution).
 */

/**
 * Queryable wrapper around the operation map, providing methods to look up
 * SDK references and validate coverage.
 */
export class OperationMapJsonSource {
  private readonly map: Record<string, string>;

  constructor(data: Record<string, string>) {
    this.map = data;
  }

  /**
   * Factory method to create an operation map from JSON string.
   * Validates that the map is a plain object with string values.
   *
   * @param jsonString JSON string containing the operation map
   * @returns OperationMapJsonSource instance
   * @throws Error if JSON is invalid or structure is wrong
   */
  static fromJson(jsonString: string): OperationMapJsonSource {
    let raw: unknown;
    try {
      raw = JSON.parse(jsonString);
    } catch (e) {
      throw new Error(
        `Failed to parse JavaScript SDK operation-map.json: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('JavaScript SDK operation-map.json must be a JSON object');
    }

    // biome-ignore lint/plugin: runtime contract boundary — parsed JSON validated as a plain object above
    const map = raw as Record<string, string>;
    return new OperationMapJsonSource(map);
  }

  /**
   * Look up the SDK method name for an operation by its OpenAPI operationId.
   * Returns undefined if the operation is not in the map.
   */
  lookup(operationId: string): string | undefined {
    const entry = this.map[operationId];
    return typeof entry === 'string' ? entry : undefined;
  }

  /**
   * Get all operation IDs in the map.
   */
  operationIds(): string[] {
    return Object.keys(this.map);
  }

  /**
   * Check if an operation is mapped in the SDK.
   */
  has(operationId: string): boolean {
    return operationId in this.map;
  }
}

/**
 * Render a JavaScript string literal with proper escaping.
 * Handles single quotes, backticks, backslashes, and special characters.
 *
 * Uses single quotes as the outer delimiter and escapes internal single quotes
 * with backslashes.
 *
 * @example
 * toJavaScriptLiteral("hello's world") → "hello\\'s world"
 */
export function toJavaScriptLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\') // backslash
    .replace(/'/g, "\\'") // single quote
    .replace(/\n/g, '\\n') // newline
    .replace(/\r/g, '\\r') // carriage return
    .replace(/\t/g, '\\t'); // tab
}

/**
 * Build a JavaScript template literal expression for a path with parameter substitution.
 *
 * Converts OpenAPI path parameters (in curly braces) to template literal syntax
 * with context variable lookups. Provides fallback to the original parameter name
 * if the binding is missing.
 *
 * @example
 * buildJavaScriptUrlExpression('/tasks/{taskId}')
 * → "`/tasks/${ctx['taskId'] ?? '{taskId}'}`"
 *
 * @param pathTemplate OpenAPI-style path with {paramName} placeholders
 * @param pathParams Optional path-param mappings from the planner
 * @returns JavaScript template literal expression
 */
export function buildJavaScriptUrlExpression(
  pathTemplate: string,
  pathParams?: { name: string; var: string }[],
): string {
  const nameToVar = new Map<string, string>();
  for (const param of pathParams ?? []) {
    nameToVar.set(param.name, param.var);
  }

  const result = pathTemplate.replace(/\{([^}]+)\}/g, (_, paramName: string) => {
    const varName = nameToVar.get(paramName) ?? paramName;
    return `\${ctx['${varName}'] ?? '{${paramName}}'}`;
  });

  return `\`${result}\``;
}

/**
 * Render a request body as a JavaScript object, substituting placeholder variables.
 *
 * Replaces "${varName}" placeholders with ctx['varName'] references.
 * Handles nested structures by working with the JSON representation.
 *
 * @example
 * renderJavaScriptBody({ name: "${userName}" }, {...})
 * → { name: ctx['userName'] }
 *
 * @param bodyTemplate Request body template (may contain ${...} placeholders)
 * @param bindings Available context bindings (for validation if needed)
 * @returns JavaScript code that evaluates to the body object
 */
export function renderJavaScriptBody(
  bodyTemplate: unknown,
  _bindings: Record<string, string | undefined> = {},
): string {
  if (!bodyTemplate) return '{}';

  const json = JSON.stringify(bodyTemplate, null, 2);
  let result = json;

  // Replace "${varName}" or "\${varName}" placeholders with ctx['varName']
  // Only match placeholders that are entire string values (Commit 7082e67 pattern from Python)
  result = result.replace(/"\\?\$\{([^}]+)\}"/g, (_match, varName: string) => {
    return `ctx['${varName}']`;
  });

  return result;
}
