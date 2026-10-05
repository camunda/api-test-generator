import type { OptionalFieldsConfig, OptionalFieldsEntry } from './optionalFields.js';
import { flatten, follow, HTTP_METHODS, isRecord } from './specWalk.js';

/** The variant derived for an operation; one per operation, carrying all of its eligible fields. */
export const DERIVED_VARIANT_NAME = 'optional strings';

const WRITE_METHODS = new Set(['post', 'patch', 'put']);

interface Candidate {
  field: string;
  minLength?: number;
  maxLength?: number;
}

/** A create/update operation found in the spec, with the optional string fields it can echo. */
export interface SpecWriteOperation {
  operationId: string;
  method: string;
  path: string;
  candidates: Candidate[];
  /** For PATCH/PUT: a GET on the same path and where each candidate sits in its response. */
  readBack?: { operationId: string; locations: Record<string, string> };
}

/** Statuses the planner treats as a success with a body (see extractSchemas.ts). */
const SUPPORTED_SUCCESS = ['200', '201'];

function successProperties(
  spec: Record<string, unknown>,
  op: Record<string, unknown>,
  codes: string[] = SUPPORTED_SUCCESS,
): Record<string, unknown> | null {
  const responses = isRecord(op.responses) ? op.responses : {};
  for (const code of codes) {
    const response = follow(spec, responses[code]);
    const content = isRecord(response.content) ? response.content : {};
    const json = isRecord(content['application/json']) ? content['application/json'] : null;
    if (!json) continue;
    const props = flatten(spec, json.schema).properties;
    return isRecord(props) ? props : {};
  }
  return null;
}

/**
 * Where `field` sits in a response: at the top, or inside the one wrapper object that holds it (a
 * `get` operation may return `{ folder: {...}, content: {...} }`). Undefined when absent or ambiguous.
 */
function locate(
  spec: Record<string, unknown>,
  props: Record<string, unknown>,
  field: string,
): string | undefined {
  if (field in props) return isWriteOnly(spec, props[field]) ? undefined : field;
  const inside = Object.entries(props).filter(([, v]) => {
    const inner = flatten(spec, v).properties;
    return isRecord(inner) && field in inner && !isWriteOnly(spec, inner[field]);
  });
  return inside.length === 1 ? `${inside[0][0]}.${field}` : undefined;
}

/** A write-only property is accepted in a request but never returned, so it cannot be echoed or read back. */
function isWriteOnly(spec: Record<string, unknown>, schema: unknown): boolean {
  return flatten(spec, schema).writeOnly === true;
}

/** The optional plain-string request fields that `echoed` (a success response's properties) returns. */
function stringCandidates(
  spec: Record<string, unknown>,
  properties: Record<string, unknown>,
  required: Set<unknown>,
  echoed: Record<string, unknown>,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [field, schema] of Object.entries(properties)) {
    if (required.has(field) || !(field in echoed)) continue;
    const s = flatten(spec, schema);
    // A read-only property is set by the server, so sending it is wrong; a write-only one is
    // not returned, so there is nothing to echo.
    if (s.readOnly === true || isWriteOnly(spec, echoed[field])) continue;
    if (
      s.type !== 'string' ||
      s.format !== undefined ||
      s.pattern !== undefined ||
      s.enum !== undefined
    )
      continue;
    const minLength = typeof s.minLength === 'number' ? s.minLength : undefined;
    const maxLength = typeof s.maxLength === 'number' ? s.maxLength : undefined;
    // No string satisfies a minimum above the maximum (the limits of every allOf branch apply).
    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) continue;
    candidates.push({
      field,
      ...(minLength !== undefined ? { minLength } : {}),
      ...(maxLength !== undefined ? { maxLength } : {}),
    });
  }
  return candidates;
}

/**
 * Write operations that would qualify but return their JSON body under a 2xx status the planner does
 * not treat as a success with a body (202, 203, ...). Deriving a test for one would expect the wrong
 * status, and skipping it silently would lose the coverage the rule promises, so generation names them.
 */
export function findUnsupportedSuccessWrites(
  spec: unknown,
): { operationId: string; status: string }[] {
  if (!isRecord(spec) || !isRecord(spec.paths)) return [];
  const out: { operationId: string; status: string }[] = [];
  for (const item of Object.values(spec.paths)) {
    if (!isRecord(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method) || !WRITE_METHODS.has(method)) continue;
      if (!isRecord(op) || typeof op.operationId !== 'string') continue;
      if (successProperties(spec, op)) continue; // handled by findWriteOperations
      const responses = isRecord(op.responses) ? op.responses : {};
      const others = Object.keys(responses).filter(
        (c) => /^2\d\d$/.test(c) && !SUPPORTED_SUCCESS.includes(c),
      );
      const status = others.find((c) => successProperties(spec, op, [c]));
      const echoed = status ? successProperties(spec, op, [status]) : null;
      if (!status || !echoed) continue;
      const body = follow(spec, op.requestBody);
      const content = isRecord(body.content) ? body.content : {};
      const json = isRecord(content['application/json']) ? content['application/json'] : {};
      const request = flatten(spec, json.schema);
      const properties = isRecord(request.properties) ? request.properties : {};
      const required = new Set(Array.isArray(request.required) ? request.required : []);
      if (stringCandidates(spec, properties, required, echoed).length > 0) {
        out.push({ operationId: op.operationId, status });
      }
    }
  }
  return out;
}

/** Every create/update operation whose body has optional plain-string fields echoed by its response. */
export function findWriteOperations(spec: unknown): SpecWriteOperation[] {
  if (!isRecord(spec) || !isRecord(spec.paths)) return [];
  const getByPath = new Map<string, { operationId: string; props: Record<string, unknown> }>();
  for (const [urlPath, item] of Object.entries(spec.paths)) {
    if (!isRecord(item) || !isRecord(item.get) || typeof item.get.operationId !== 'string')
      continue;
    const props = successProperties(spec, item.get);
    if (props) getByPath.set(urlPath, { operationId: item.get.operationId, props });
  }
  const out: SpecWriteOperation[] = [];
  for (const [urlPath, item] of Object.entries(spec.paths)) {
    if (!isRecord(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method) || !WRITE_METHODS.has(method)) continue;
      if (!isRecord(op) || typeof op.operationId !== 'string') continue;
      const body = follow(spec, op.requestBody);
      const content = isRecord(body.content) ? body.content : {};
      const json = isRecord(content['application/json']) ? content['application/json'] : {};
      const request = flatten(spec, json.schema);
      const properties = isRecord(request.properties) ? request.properties : {};
      const required = new Set(Array.isArray(request.required) ? request.required : []);
      const echoed = successProperties(spec, op);
      if (!echoed) continue; // no JSON response (204): nothing to echo
      const candidates = stringCandidates(spec, properties, required, echoed);
      if (candidates.length === 0) continue;
      const get = method === 'get' ? undefined : getByPath.get(urlPath);
      let readBack: SpecWriteOperation['readBack'];
      if (get && method !== 'post') {
        const locations: Record<string, string> = {};
        for (const c of candidates) {
          const where = locate(spec, get.props, c.field);
          if (where) locations[c.field] = where;
        }
        if (Object.keys(locations).length) readBack = { operationId: get.operationId, locations };
      }
      out.push({
        operationId: op.operationId,
        method,
        path: urlPath,
        candidates,
        ...(readBack ? { readBack } : {}),
      });
    }
  }
  return out;
}

/** A value that fits the field: text naming the field, cut to its maximum length and padded to its minimum. */
function valueFor(c: Candidate): string {
  let text = `Optional ${c.field} sent by the generated suite.`;
  if (c.maxLength !== undefined && text.length > c.maxLength) text = text.slice(0, c.maxLength);
  // Pad up to the minimum; the minimum never exceeds the maximum (see findWriteOperations).
  if (c.minLength !== undefined && text.length < c.minLength) text = text.padEnd(c.minLength, 'x');
  return text;
}

/**
 * The effective config: the explicit variants plus, with `auto`, one `optional strings` variant for
 * every write operation found in the spec that has eligible fields, minus excluded operations and
 * fields. An operation that already has an explicit variant of that name is left to it. An
 * exclusion that matches nothing found is an error, so a stale one cannot linger.
 */
export function deriveOptionalFields(
  config: OptionalFieldsConfig,
  spec: unknown,
): OptionalFieldsConfig {
  if (!config.auto) return config;
  const found = findWriteOperations(spec);
  const byId = new Map(found.map((o) => [o.operationId, o]));
  const unsupported = findUnsupportedSuccessWrites(spec);
  const unsupportedIds = new Set(unsupported.map((u) => u.operationId));
  for (const e of config.exclude) {
    const op = byId.get(e.operationId);
    // An operation that cannot be derived because of its success status may still be excluded as a whole.
    if (!op && e.field === undefined && unsupportedIds.has(e.operationId)) continue;
    if (!op) {
      throw new Error(
        `optional-fields.json excludes ${e.operationId}, which has no derivable optional string fields in the spec.`,
      );
    }
    if (e.field !== undefined && !op.candidates.some((c) => c.field === e.field)) {
      throw new Error(
        `optional-fields.json excludes ${e.operationId}.${e.field}, which is not an eligible field.`,
      );
    }
  }
  const excludedOps = new Set(
    config.exclude.filter((e) => e.field === undefined).map((e) => e.operationId),
  );
  const excludedFields = new Set(
    config.exclude.filter((e) => e.field !== undefined).map((e) => `${e.operationId}.${e.field}`),
  );
  const unhandled = unsupported.filter((u) => !excludedOps.has(u.operationId));
  if (unhandled.length) {
    throw new Error(
      `optional-fields.json: ${unhandled.map((u) => `${u.operationId} (${u.status})`).join(', ')} return their JSON body under a 2xx status the planner does not treat as a success with a body (200 and 201 are), so no test can be derived. Exclude each with a reason.`,
    );
  }
  const own = new Set(
    config.variants.filter((v) => v.name === DERIVED_VARIANT_NAME).map((v) => v.operationId),
  );
  const derived: OptionalFieldsEntry[] = [];
  const unreadable: string[] = [];
  for (const op of found) {
    if (excludedOps.has(op.operationId) || own.has(op.operationId)) continue;
    const fields = op.candidates.filter((c) => !excludedFields.has(`${op.operationId}.${c.field}`));
    if (fields.length === 0) continue;
    const body: Record<string, unknown> = {};
    for (const c of fields) body[c.field] = valueFor(c);
    const readBackEcho: Record<string, unknown> = {};
    for (const c of fields) {
      const where = op.readBack?.locations[c.field];
      if (where) readBackEcho[where] = body[c.field];
      // An update that is not read back would claim persistence coverage it does not have.
      else if (op.method !== 'post') unreadable.push(`${op.operationId}.${c.field}`);
    }
    derived.push({
      operationId: op.operationId,
      name: DERIVED_VARIANT_NAME,
      body,
      echo: { ...body },
      before: [],
      chainBodies: {},
      ...(op.readBack && Object.keys(readBackEcho).length
        ? { readBack: { operationId: op.readBack.operationId, echo: readBackEcho } }
        : {}),
    });
  }
  if (unreadable.length) {
    throw new Error(
      `optional-fields.json: no GET on the same path returns these updated fields under a unique name, so they cannot be read back: ${unreadable.join(', ')}. Exclude each with a reason, or add the GET.`,
    );
  }
  return { ...config, variants: [...config.variants, ...derived] };
}
