/**
 * Python SDK operation mapping — converts camelCase operationId to snake_case
 * method names and loads the operation-map.json from the Python SDK.
 *
 * The Python SDK's operation-map.json keys are already in snake_case
 * (e.g., "get_agent_instance", "create_deployment"). This module provides
 * helpers to:
 *
 *   1. Load the map from spec/python-sdk/operation-map.json
 *   2. Convert operationId (camelCase) to snake_case for map lookup
 *   3. Resolve the mapped Python method name or fall back to camelToSnake()
 */

/**
 * Convert camelCase to snake_case.
 *
 * Examples:
 *   activateJobs → activate_jobs
 *   createDeployment → create_deployment
 *   deleteProcessDefinition → delete_process_definition
 */
export function camelToSnake(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Convert PascalCase (e.g. "DeployResources") to snake_case.
 * Used for region values in the operation-map.
 *
 * Examples:
 *   DeployResources → deploy_resources
 *   ActivateJobs → activate_jobs
 */
export function pascalToSnake(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Operation-map entry structure (from examples/operation-map.json)
 *
 * The map's values are arrays where the first element contains the region
 * (Python method symbol). Example:
 *
 * {
 *   "activate_jobs": [{ "region": "activate_jobs" }],
 *   "create_deployment": [{ "region": "create_deployment" }]
 * }
 */
interface OperationMapEntry {
  region?: string;
  [key: string]: unknown;
}

/**
 * Python SDK operation mapping source.
 *
 * Loads the operation-map.json from spec/python-sdk/ (populated by
 * fetch-python-sdk-map.ts) and provides lookup methods.
 */
export interface OperationMapJsonSource {
  /** Resolve operationId (camelCase) → Python method symbol (snake_case). */
  resolvePythonMethod(operationId: string): string;
}

/**
 * Create an OperationMapJsonSource from parsed operation-map.json data.
 *
 * The operationId is converted from camelCase to snake_case, then looked up
 * in the map. If found, the first entry's "region" field is used as the
 * Python method symbol. Otherwise, falls back to camelToSnake(operationId).
 */
export function createOperationMapSource(
  mapData: Record<string, OperationMapEntry[]>,
): OperationMapJsonSource {
  return {
    resolvePythonMethod(operationId: string): string {
      const snakeOperationId = camelToSnake(operationId);
      const entry = mapData[snakeOperationId];
      if (entry && entry.length > 0 && entry[0].region) {
        // Region values are already in snake_case method form
        return entry[0].region;
      }
      // Fallback: convert operationId directly
      return snakeOperationId;
    },
  };
}

/**
 * Default operation map source — used when the Python SDK map is unavailable.
 * Simple fallback: convert operationId camelCase → snake_case.
 */
export function createDefaultOperationMapSource(): OperationMapJsonSource {
  return {
    resolvePythonMethod(operationId: string): string {
      return camelToSnake(operationId);
    },
  };
}

/**
 * Create an `OperationMapJsonSource` by parsing a raw JSON string from
 * `spec/python-sdk/operation-map.json`. Isolates the JSON-parse boundary
 * so callers (e.g. the materializer orchestrator) don't need access to the
 * unexported `OperationMapEntry` type.
 *
 * Throws `SyntaxError` on malformed JSON — callers should handle this
 * and fall back to `createDefaultOperationMapSource()`.
 */
export function createOperationMapSourceFromJson(json: string): OperationMapJsonSource {
  // biome-ignore lint/plugin: runtime contract boundary — JSON from fetched SDK operation-map file
  const mapData = JSON.parse(json) as Record<string, OperationMapEntry[]>;
  return createOperationMapSource(mapData);
}
