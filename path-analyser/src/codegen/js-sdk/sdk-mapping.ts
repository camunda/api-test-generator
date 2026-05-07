/**
 * SDK mapping strategy for the JS SDK emitter.
 *
 * `SdkMappingSource` is the shared interface for resolving operationIds to
 * method symbols. The JS emitter uses `OperationMapJsonSource` backed by
 * `examples/operation-map.json` from the `camunda/orchestration-cluster-api-js`
 * repository (fetched at generation time via `npm run fetch-js-sdk-map`).
 *
 * Future Python and C# emitters can implement `SdkMappingSource` with their
 * own lookup tables.
 */

export interface OperationMapEntry {
  file: string;
  region: string;
  label: string;
}

export type OperationMap = Record<string, OperationMapEntry[]>;

/**
 * Resolves an operationId to the preferred SDK method symbol.
 *
 * Implementations must be stateless and side-effect-free after construction.
 */
export interface SdkMappingSource {
  /**
   * Returns the preferred SDK method symbol for the given operationId.
   *
   * Strategy (Option C from issue #8):
   * - Look up `operation-map.json[operationId][0].region`
   * - Convert the PascalCase region to camelCase to get the method name
   * - If no mapping exists, return `operationId` directly (already camelCase)
   */
  resolveMethod(operationId: string): string;

  /** Returns all operationIds known to this mapping source. */
  knownOperationIds(): string[];
}

/**
 * Converts a PascalCase region string to the camelCase SDK method name.
 *
 * Examples:
 *   "DeployResourcesFromFiles" → "deployResourcesFromFiles"
 *   "CreateProcessInstanceById" → "createProcessInstanceById"
 *   "GetTopology" → "getTopology"
 */
export function regionToCamelCase(region: string): string {
  if (!region) return region;
  return region.charAt(0).toLowerCase() + region.slice(1);
}

/**
 * Implements `SdkMappingSource` using `examples/operation-map.json` from
 * `camunda/orchestration-cluster-api-js`.
 *
 * Each entry maps an operationId to one or more SDK examples. The first
 * entry's `region` field is the preferred method symbol (PascalCase).
 * This class converts it to camelCase.
 */
export class OperationMapJsonSource implements SdkMappingSource {
  private readonly map: OperationMap;

  constructor(map: OperationMap) {
    this.map = map;
  }

  resolveMethod(operationId: string): string {
    const entries = this.map[operationId];
    if (entries && entries.length > 0 && entries[0].region) {
      return regionToCamelCase(entries[0].region);
    }
    // Fallback: operationId is already camelCase in the Camunda REST API.
    return operationId;
  }

  knownOperationIds(): string[] {
    return Object.keys(this.map);
  }

  /**
   * Constructs an `OperationMapJsonSource` from raw JSON text.
   *
   * Throws `SyntaxError` on malformed JSON — callers should handle this
   * and fall back to an empty source or propagate the error.
   */
  static fromJson(json: string): OperationMapJsonSource {
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON from a fetched file
    const parsed = JSON.parse(json) as OperationMap;
    return new OperationMapJsonSource(parsed);
  }
}

/**
 * A no-op `SdkMappingSource` that always falls back to the operationId.
 *
 * Used when `operation-map.json` has not been fetched yet (e.g. the user
 * has not run `npm run fetch-js-sdk-map`). The emitted code will still work
 * since operationIds already match the raw SDK method names.
 */
export class FallbackMappingSource implements SdkMappingSource {
  resolveMethod(operationId: string): string {
    return operationId;
  }

  knownOperationIds(): string[] {
    return [];
  }
}
