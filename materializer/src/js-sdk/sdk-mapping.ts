/**
 * JavaScript SDK operation map loading and source code generation.
 *
 * The JavaScript SDK operation-map.json maps OpenAPI operationId → SDK method name.
 * This module loads it and provides JavaScript-specific utilities.
 */

/**
 * Representation of a single operation map entry.
 * Maps from operationId to SDK method/function reference.
 */
export interface OperationMapEntry {
  [key: string]: unknown;
}

/**
 * Queryable wrapper around the operation map, providing methods to look up
 * SDK references and validate coverage.
 */
export class OperationMapJsonSource {
  private readonly map: Record<string, unknown>;

  constructor(data: Record<string, unknown>) {
    this.map = data;
  }

  /**
   * Factory method to create an operation map from JSON string.
   * @param jsonString JSON string containing the operation map
   * @returns OperationMapJsonSource instance
   */
  static fromJson(jsonString: string): OperationMapJsonSource {
    let raw: unknown;
    try {
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON from operation-map file
      raw = JSON.parse(jsonString);
    } catch (e) {
      throw new Error(
        `Failed to parse JavaScript SDK operation-map.json: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Validate basic structure
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('JavaScript SDK operation-map.json must be a JSON object');
    }

    const map = raw as Record<string, unknown>;
    return new OperationMapJsonSource(map);
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
