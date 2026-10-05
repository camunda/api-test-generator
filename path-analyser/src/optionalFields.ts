import fsSync from 'node:fs';
import path from 'node:path';
import type { EndpointScenario, OperationGraph } from './types.js';

/** A setup call run after the target's own setup chain and before the target. */
export interface OptionalFieldsSetup {
  operationId: string;
  /** Body fields merged over the generated body; values may reference earlier results as "${xVar}". */
  body?: Record<string, unknown>;
  /**
   * Response field -> variable name to store it under, instead of the planner's default. Lets a
   * setup call create a second resource without overwriting the first one's key.
   */
  extractAs?: Record<string, string>;
}

export interface OptionalFieldsEntry {
  operationId: string;
  /** Names the variant; unique per operation. */
  name: string;
  /** Optional request fields sent on the final call, merged over the generated body. */
  body: Record<string, unknown>;
  /** Response fields that must equal these values (the request fields echoed back). A string "${xVar}" is the value stored in that variable. */
  echo: Record<string, unknown>;
  /** Setup calls between the target's own chain and the target. */
  before: OptionalFieldsSetup[];
}

export interface OptionalFieldsConfig {
  variants: OptionalFieldsEntry[];
}

/** A name ends up in a scenario ID and a generated test title, so it must be quote-safe. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;

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
    const before = parseSetup(p, i, rec.before);
    if (
      typeof operationId !== 'string' ||
      !operationId ||
      typeof name !== 'string' ||
      !SAFE_NAME.test(name) ||
      !isRecord(body) ||
      Object.keys(body).length === 0 ||
      !isRecord(echo) ||
      Object.keys(echo).length === 0
    ) {
      throw new Error(
        `${p}: variants[${i}] must be { operationId, name, body: {...}, echo: {...} } with non-empty values; name may only use letters, digits, space, '.', '_' and '-'.`,
      );
    }
    const key = `${operationId}/${name}`;
    if (seen.has(key)) throw new Error(`${p}: variants[${i}] repeats ${key}.`);
    seen.add(key);
    return { operationId, name, body, echo, before };
  });
  return { variants };
}

function parseSetup(p: string, i: number, raw: unknown): OptionalFieldsSetup[] {
  if (raw === undefined) return [];
  const bad = (why: string) =>
    new Error(
      `${p}: variants[${i}].before ${why}; each must be { operationId, body?, extractAs? }.`,
    );
  if (!Array.isArray(raw)) throw bad('must be an array');
  return raw.map((s): OptionalFieldsSetup => {
    if (!isRecord(s) || typeof s.operationId !== 'string' || !s.operationId)
      throw bad('has an entry without an operationId');
    if (s.body !== undefined && !isRecord(s.body)) throw bad('has a body that is not an object');
    const names: Record<string, string> = {};
    if (s.extractAs !== undefined) {
      if (!isRecord(s.extractAs)) throw bad('has an extractAs that is not an object');
      for (const [field, name] of Object.entries(s.extractAs)) {
        if (typeof name !== 'string' || !/^\w+$/.test(name)) {
          throw bad('has an extractAs that is not a map of response field to variable name');
        }
        names[field] = name;
      }
    }
    return {
      operationId: s.operationId,
      ...(isRecord(s.body) ? { body: s.body } : {}),
      ...(Object.keys(names).length ? { extractAs: names } : {}),
    };
  });
}

/** Fails generation for an entry naming an operation the spec does not have. */
export function validateOptionalFields(graph: OperationGraph, config: OptionalFieldsConfig): void {
  // The planner finds the final step by its operationId, so a setup call to the target itself would
  // be taken for the final step too and receive the optional fields.
  const samePrimary = config.variants.filter((v) =>
    v.before.some((b) => b.operationId === v.operationId),
  );
  if (samePrimary.length) {
    throw new Error(
      `optional-fields.json: a setup call cannot be the target operation itself: ${samePrimary.map((v) => `${v.operationId}/${v.name}`).join(', ')}.`,
    );
  }
  const unknown = config.variants
    .flatMap((v) => [v.operationId, ...v.before.map((b) => b.operationId)])
    .filter((id) => !graph.operations[id]);
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
  graph: OperationGraph,
): EndpointScenario[] {
  const target = chain.operations[chain.operations.length - 1];
  return config.variants
    .filter((v) => v.operationId === target?.operationId)
    .map((v) => {
      const first = chain.operations.length - 1;
      const stepBodies: Record<number, Record<string, unknown>> = {};
      const stepExtractAs: Record<number, Record<string, string>> = {};
      v.before.forEach((b, bi) => {
        if (b.body) stepBodies[first + bi] = b.body;
        if (b.extractAs) stepExtractAs[first + bi] = b.extractAs;
      });
      return {
        ...chain,
        operations: [
          ...chain.operations.slice(0, -1),
          ...v.before.map((b) => {
            const {
              operationId,
              method,
              path: opPath,
              eventuallyConsistent,
              serverOverride,
            } = graph.operations[b.operationId];
            return { operationId, method, path: opPath, eventuallyConsistent, serverOverride };
          }),
          target,
        ],
        id: `${chain.id}:optional:${v.name}`,
        name: `optional fields - ${v.name}`,
        description: `Sends ${Object.keys(v.body).join(', ')} and expects the response to echo ${Object.keys(v.echo).join(', ')}.`,
        strategy: 'featureCoverage' as const,
        variantKey: `optional=${v.name}`,
        optionalFields: { body: v.body, echo: v.echo },
        bindings: { ...(chain.bindings ?? {}) },
        requestPlan: undefined,
        seedBindings: undefined,
        ...(Object.keys(stepBodies).length ? { stepBodies } : {}),
        ...(Object.keys(stepExtractAs).length ? { stepExtractAs } : {}),
      };
    });
}
