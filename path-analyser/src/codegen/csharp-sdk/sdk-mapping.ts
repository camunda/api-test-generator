export interface OperationMapEntry {
  file: string;
  region: string;
  label: string;
}

export type OperationMap = Record<string, OperationMapEntry[]>;

export interface SdkMappingSource {
  resolveMethod(operationId: string): string;
  knownOperationIds(): string[];
}

function toPascalCase(value: string): string {
  if (!value) return value;
  // Preserve existing camelCase by uppercasing the first character only.
  if (/^[a-z][A-Za-z0-9]*$/.test(value)) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  const parts = value
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function ensureAsyncSuffix(methodName: string): string {
  if (!methodName) return methodName;
  return methodName.endsWith('Async') ? methodName : `${methodName}Async`;
}

export class OperationMapJsonSource implements SdkMappingSource {
  private readonly map: OperationMap;

  constructor(map: OperationMap) {
    this.map = map;
  }

  resolveMethod(operationId: string): string {
    const entries = this.map[operationId];
    if (entries && entries.length > 0 && entries[0].region) {
      return ensureAsyncSuffix(entries[0].region);
    }
    return ensureAsyncSuffix(toPascalCase(operationId));
  }

  knownOperationIds(): string[] {
    return Object.keys(this.map);
  }

  static fromJson(json: string): OperationMapJsonSource {
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON from a fetched file
    const parsed = JSON.parse(json) as OperationMap;
    return new OperationMapJsonSource(parsed);
  }
}

export class FallbackMappingSource implements SdkMappingSource {
  resolveMethod(operationId: string): string {
    return ensureAsyncSuffix(toPascalCase(operationId));
  }

  knownOperationIds(): string[] {
    return [];
  }
}
