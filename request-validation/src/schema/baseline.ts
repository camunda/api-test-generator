import type { OperationModel } from '../model/types.js';
import {
  buildValidValue,
  findValidValue,
  orderedDateValuesFor,
  type ResolvedParamSchema,
  resolveFieldSchema,
} from '../util/paramSchema.js';
import { buildWalk, type SchemaFragment, type WalkNode } from './walker.js';

export type BaselineValue =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

export interface BaselineOpts {
  /**
   * Capability-gated field names (`capabilityGate` in global-context-seeds.json, #404), e.g.
   * `tenantId` while multi-tenancy is off. The server rejects any non-blank value for an optional
   * gated field, so sending one makes it answer for the gate instead of the field under test. An
   * optional occurrence is left out of the baseline unless it is on `keep`.
   */
  gates?: ReadonlyMap<string, unknown>;
  /**
   * Path of the field a scenario will change (`['filter', 'tenantId']`, array items as `'0'`).
   * Fields on this path are never left out for being gated or for having no valid value, so the
   * scenario still finds its target. It does not add fields the baseline would not otherwise have.
   */
  keep?: readonly string[];
}

function isSchemaFragment(v: unknown): v is SchemaFragment {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Set when a field has no value that satisfies its schema. */
const NO_VALID_VALUE = Symbol('no valid value');

/**
 * A request body that satisfies the operation's schema, for a scenario to change one field of.
 * Every value in it is valid for its own schema: a field the scenario does not target must not make
 * the server reject the request for the wrong reason (`scopeKey: "x"` for a numeric key). An optional
 * field no value can satisfy is left out, and so is an optional gated field (see `opts.gates`).
 */
export function buildBaselineBody(op: OperationModel, opts: BaselineOpts = {}): BaselineValue {
  const walk = buildWalk(op);
  if (!walk?.root) return undefined;
  const keep = opts.keep ?? [];

  function resolved(node: WalkNode): ResolvedParamSchema {
    const source = isSchemaFragment(node.source) ? node.source : node.raw;
    const r = resolveFieldSchema(source ?? {});
    if (r.type === undefined) r.type = node.type;
    if (node.enum?.length && !r.enumValues) r.enumValues = node.enum.slice();
    return r;
  }

  function synth(node: WalkNode, depth: number, onKeep: boolean): unknown {
    const t = Array.isArray(node.type) ? node.type[0] : node.type;
    switch (t) {
      case 'object': {
        const obj: Record<string, unknown> = {};
        if (!node.properties) return obj;
        const included = Object.entries(node.properties).filter(([k, child]) => {
          if (node.required?.includes(k)) return true;
          // Include "interesting" optional properties (constraints, enum, format, nested
          // additionalProperties=false), unless gated.
          const raw = isSchemaFragment(child.raw) ? child.raw : undefined;
          if (!raw || !isInteresting(raw)) return false;
          const kept = onKeep && keep[depth] === k;
          return kept || !opts.gates?.has(k);
        });
        const dates = orderedDateValuesFor(
          included.map(([k, child]) => ({ name: k, resolved: resolved(child) })),
        );
        for (const [k, child] of included) {
          const kept = onKeep && keep[depth] === k;
          const required = node.required?.includes(k) ?? false;
          const date = dates.get(k);
          const value = date ?? synth(child, depth + 1, kept);
          if (value !== NO_VALID_VALUE) {
            obj[k] = value;
          } else if (required || kept) {
            // Cannot be omitted (required) or is the field under test: send a placeholder.
            obj[k] = buildValidValue(resolved(child));
          }
        }
        return obj;
      }
      case 'array': {
        if (!node.items) return [];
        const item = synth(node.items, depth + 1, onKeep && keep[depth] === '0');
        // An item no value satisfies still gets a placeholder: an empty array can break `minItems`.
        return [item === NO_VALID_VALUE ? buildValidValue(resolved(node.items)) : item];
      }
      case 'integer':
      case 'number':
        return validNumber(node.constraints ?? {}, t === 'integer');
      case 'boolean':
        return true;
      case 'string': {
        const first = node.enum?.[0];
        if (typeof first === 'string') return first;
        return findValidValue(resolved(node)) ?? NO_VALID_VALUE;
      }
      default:
        return null;
    }
  }
  const body = synth(walk.root, 0, true);
  return body === NO_VALID_VALUE ? undefined : toBaseline(body);
}

function isInteresting(raw: SchemaFragment): boolean {
  return !!(
    (Array.isArray(raw.enum) && raw.enum.length) ||
    raw.format ||
    raw.pattern ||
    raw.minimum !== undefined ||
    raw.maximum !== undefined ||
    raw.multipleOf !== undefined ||
    raw.minLength !== undefined ||
    raw.maxLength !== undefined ||
    raw.uniqueItems ||
    raw.additionalProperties === false
  );
}

/** 1, moved into the schema's range when the range excludes it. */
function validNumber(c: Record<string, unknown>, integer: boolean): number {
  let v = 1;
  if (typeof c.minimum === 'number' && v < c.minimum) v = c.minimum;
  if (typeof c.exclusiveMinimum === 'number' && v <= c.exclusiveMinimum)
    v = integer ? Math.floor(c.exclusiveMinimum) + 1 : c.exclusiveMinimum + 1;
  if (typeof c.maximum === 'number' && v > c.maximum) v = c.maximum;
  if (typeof c.exclusiveMaximum === 'number' && v >= c.exclusiveMaximum)
    v = integer ? Math.ceil(c.exclusiveMaximum) - 1 : c.exclusiveMaximum - 1;
  return integer ? Math.ceil(v) : v;
}

function toBaseline(v: unknown): BaselineValue {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (isSchemaFragment(v)) return v;
  return undefined;
}
