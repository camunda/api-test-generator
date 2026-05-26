/**
 * Python SDK operation map loading and source code generation.
 *
 * The Python SDK operation-map.json maps OpenAPI operationId → SDK method name.
 * This module loads it and provides Python-specific code generation utilities.
 */

/**
 * Escape a string for embedding in a Python string literal (single-quoted).
 * Handles: backslashes, single quotes, and special characters.
 *
 * Commit 86d980d — toPythonLiteral escaping
 * Added specialized escaping for Python single-quoted strings, ensuring
 * proper handling of backslashes and quotes. Unlike JavaScript, Python's
 * single-quoted strings require different escape rules.
 */
export function toPythonLiteral(s: string): string {
  // Escape backslashes first (otherwise they'd swallow the quote-escaping backslash we add next)
  let result = s.replace(/\\/g, '\\\\');
  // Escape single quotes
  result = result.replace(/'/g, "\\'");
  // Escape newlines and tabs for readability
  result = result.replace(/\n/g, '\\n');
  result = result.replace(/\t/g, '\\t');
  return result;
}

/**
 * Substitute placeholders in a string, handling only whole-string replacements.
 * This ensures placeholders like "${varName}" are only replaced when they occupy
 * the entire string value (not embedded in larger strings).
 *
 * Commit 7082e67 — whole-string-only placeholder substitution in toPythonLiteral
 * Restricts placeholder substitution to whole-string values only, preventing
 * accidental partial substitutions within text content.
 *
 * @param str The string to process
 * @param varMap Mapping of placeholder names to their replacement values
 * @returns The processed string with placeholders replaced
 */
export function substituteWholeStringPlaceholders(
  str: string,
  varMap: Record<string, string>,
): string {
  // Match whole-string placeholders like "${varName}"
  const wholeStringMatch = str.match(/^\$\{([^}]+)\}$/);
  if (wholeStringMatch) {
    const varName = wholeStringMatch[1];
    if (varName in varMap) {
      return varMap[varName];
    }
  }
  return str;
}

/**
 * Representation of an operation map loaded from JSON.
 * Maps OpenAPI operationId to SDK method/function references.
 */
export interface OperationMap {
  [operationId: string]: {
    /** SDK package or module reference (e.g., 'orchestration_client.v1') */
    package?: string;
    /** SDK function/method name (e.g., 'deploy_process') */
    method?: string;
    /** Full qualified path if needed */
    qualifiedName?: string;
  };
}

/**
 * Create an operation map source from JSON string.
 * Returns a structured representation that emitters can query.
 *
 * Commit 86d980d — createOperationMapSourceFromJson
 * Added factory function to parse operation-map.json and create a queryable
 * source object, enabling emitters to look up SDK method references by operationId.
 */
export function createOperationMapSourceFromJson(jsonString: string): OperationMapSource {
  let raw: unknown;
  try {
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON from operation-map file
    raw = JSON.parse(jsonString);
  } catch (e) {
    throw new Error(
      `Failed to parse operation-map.json: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Validate basic structure
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('operation-map.json must be a JSON object');
  }

  const map = raw as Record<string, unknown>;
  return new OperationMapSource(map);
}

/**
 * Queryable wrapper around the operation map, providing methods to look up
 * SDK references and validate coverage.
 */
export class OperationMapSource {
  private readonly map: Record<string, unknown>;

  constructor(data: Record<string, unknown>) {
    this.map = data;
  }

  /**
   * Look up the SDK reference for an operation by its OpenAPI operationId.
   * Returns undefined if the operation is not in the map.
   */
  lookup(operationId: string): OperationMapEntry | undefined {
    const entry = this.map[operationId];
    if (!entry || typeof entry !== 'object') return undefined;
    return entry as OperationMapEntry;
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
 * A single entry in the operation map.
 */
export interface OperationMapEntry {
  [key: string]: unknown;
}
