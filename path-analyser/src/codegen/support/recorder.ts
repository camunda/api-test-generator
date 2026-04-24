import { promises as fs } from 'node:fs';
import path from 'node:path';

type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue };

export interface ResponseObservation {
  timestamp: string;
  operationId: string;
  scenarioId?: string;
  scenarioName?: string;
  stepIndex?: number;
  isFinal?: boolean;
  method: string;
  pathTemplate: string;
  status: number;
  expectedStatus?: number;
  errorScenario?: boolean;
  bodyShape?: JSONValue;
}

function getOutputPath(): string {
  const base = process.cwd();
  // Write under dist/runtime-observations relative to path-analyser CWD
  // If invoked from repo root, still resolves correctly due to CWD handling elsewhere
  return path.resolve(base, 'dist', 'runtime-observations', 'responses.jsonl');
}

export async function recordResponse(obs: ResponseObservation): Promise<void> {
  try {
    const file = getOutputPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const line = `${JSON.stringify(obs)}\n`;
    await fs.appendFile(file, line, 'utf8');
  } catch {
    // best-effort; never throw in tests
  }
}

function isPlainObject(v: unknown): v is { [key: string]: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Replace concrete values with type-shaped placeholders to avoid leaking data
export function sanitizeBody(value: unknown): JSONValue {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string') return '<string>';
  if (t === 'number') return 0;
  if (t === 'boolean') return true;
  if (Array.isArray(value)) return value.map((v) => sanitizeBody(v));
  if (isPlainObject(value)) {
    const out: Record<string, JSONValue> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeBody(v);
    }
    return out;
  }
  // Fallback for unsupported types
  return '<unknown>';
}
