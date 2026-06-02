/**
 * Operation to C# SDK method name mapping.
 *
 * The C# SDK emitter consults this interface to determine what method to call
 * for each upstream OpenAPI `operationId`. The mapping is loaded from
 * `csharp-sdk/examples/operation-map.json` in the spec directory; if the file
 * is absent, every operation maps to a default (toPascalCase(opId) + 'Async').
 */
export interface SdkMappingSource {
  resolveMethod(operationId: string): string;
}

export class FallbackMappingSource implements SdkMappingSource {
  resolveMethod(operationId: string): string {
    // Capitalise the first letter of each `-`/`_`-separated segment while
    // preserving existing camelCase humps, so `createProcessInstance` becomes
    // `CreateProcessInstanceAsync` (not `CreateprocessinstanceAsync`).
    const pascal = operationId
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
    return `${pascal}Async`;
  }
}
