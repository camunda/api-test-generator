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

export interface CsharpOperationMapEntry {
  file: string;
  region: string;
  label?: string;
}

export type CsharpOperationMap = Record<string, CsharpOperationMapEntry[]>;

function isCsharpOperationMapEntry(value: unknown): value is CsharpOperationMapEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'region' in value &&
    typeof value.region === 'string' &&
    value.region.length > 0
  );
}

export class CsharpOperationMapSource implements SdkMappingSource {
  private readonly methodByOpId: Map<string, string>;
  private readonly fallback: FallbackMappingSource;

  constructor(mapping?: CsharpOperationMap) {
    this.methodByOpId = new Map<string, string>();
    this.fallback = new FallbackMappingSource();
    if (mapping) {
      for (const [opId, entries] of Object.entries(mapping)) {
        const first = entries?.[0];
        if (isCsharpOperationMapEntry(first)) this.methodByOpId.set(opId, first.region);
      }
    }
  }

  resolveMethod(operationId: string): string {
    return this.methodByOpId.get(operationId) ?? this.fallback.resolveMethod(operationId);
  }
}

export class FallbackMappingSource implements SdkMappingSource {
  resolveMethod(operationId: string): string {
    // Preserve operation ids that are already valid C# method names.
    // The generated C# SDK map can carry PascalCase method names already
    // suffixed with Async, and those must flow through unchanged.
    if (/^[A-Z][A-Za-z0-9]*Async$/.test(operationId)) {
      return operationId;
    }

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
