import fsSync from 'node:fs';
import path from 'node:path';
import type { EndpointScenario, OperationGraph } from './types.js';

export interface OptionalFieldsEntry {
  operationId: string;
  /** Names the variant; unique per operation. */
  name: string;
  /** Optional request fields sent on the final call, merged over the generated body. */
  body: Record<string, unknown>;
  /** Response fields that must equal these values (the request fields echoed back). */
  echo: Record<string, unknown>;
}

export interface OptionalFieldsConfig {
  variants: OptionalFieldsEntry[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * `configs/<config>/optional-fields.json` (optional): operations that also get a success-path
 * test sending optional request fields and asserting the response echoes them. Returns `null`
 * when absent; throws when present but malformed.
 */
export function loadOptionalFields(configDir: string): OptionalFieldsConfig | null {
  const p = path.join(configDir, 'optional-fields.json');
  if (!fsSync.existsSync(p)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fsSync.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to read/parse ${p}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isRecord(raw) || !Array.isArray(raw.variants)) {
    throw new Error(`${p}: expected a JSON object with a "variants" array.`);
  }
  const seen = new Set<string>();
  const variants = raw.variants.map((e, i): OptionalFieldsEntry => {
    const rec = isRecord(e) ? e : {};
    const { operationId, name, body, echo } = rec;
    if (
      typeof operationId !== 'string' ||
      !operationId ||
      typeof name !== 'string' ||
      !name ||
      !isRecord(body) ||
      Object.keys(body).length === 0 ||
      !isRecord(echo) ||
      Object.keys(echo).length === 0
    ) {
      throw new Error(
        `${p}: variants[${i}] must be { operationId, name, body: {...}, echo: {...} } with non-empty values.`,
      );
    }
    const key = `${operationId}/${name}`;
    if (seen.has(key)) throw new Error(`${p}: variants[${i}] repeats ${key}.`);
    seen.add(key);
    return { operationId, name, body, echo };
  });
  return { variants };
}

/** Fails generation for an entry naming an operation the spec does not have. */
export function validateOptionalFields(graph: OperationGraph, config: OptionalFieldsConfig): void {
  const unknown = config.variants.map((v) => v.operationId).filter((id) => !graph.operations[id]);
  if (unknown.length) {
    throw new Error(
      `optional-fields.json lists operationId(s) not present in the spec: ${unknown.join(', ')}.`,
    );
  }
}

/** The optional-field variants for `chain`'s target operation. */
export function buildOptionalFieldsScenarios(
  chain: EndpointScenario,
  config: OptionalFieldsConfig,
): EndpointScenario[] {
  const target = chain.operations[chain.operations.length - 1];
  return config.variants
    .filter((v) => v.operationId === target?.operationId)
    .map((v) => ({
      ...chain,
      id: `${chain.id}:optional:${v.name}`,
      name: `optional fields - ${v.name}`,
      description: `Sends ${Object.keys(v.body).join(', ')} and expects the response to echo ${Object.keys(v.echo).join(', ')}.`,
      strategy: 'featureCoverage' as const,
      variantKey: `optional=${v.name}`,
      optionalFields: { body: v.body, echo: v.echo },
      bindings: { ...(chain.bindings ?? {}) },
      requestPlan: undefined,
      seedBindings: undefined,
    }));
}
