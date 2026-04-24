import type { OperationModel } from '../model/types.js';
import { buildWalk, type SchemaFragment, type WalkNode } from './walker.js';

export type BaselineValue =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

function isSchemaFragment(v: unknown): v is SchemaFragment {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function buildBaselineBody(op: OperationModel): BaselineValue {
  const walk = buildWalk(op);
  if (!walk?.root) return undefined;
  function synth(node: WalkNode): BaselineValue {
    const t = Array.isArray(node.type) ? node.type[0] : node.type;
    switch (t) {
      case 'object': {
        const obj: Record<string, unknown> = {};
        // Always include required
        if (node.required && node.properties) {
          for (const r of node.required) {
            const child = node.properties[r];
            if (child) obj[r] = synth(child);
          }
        }
        // Include "interesting" optional properties (constraints, enum, format, nested additionalProperties=false)
        if (node.properties) {
          for (const [k, child] of Object.entries(node.properties)) {
            if (node.required?.includes(k)) continue;
            const raw = isSchemaFragment(child.raw) ? child.raw : undefined;
            if (raw) {
              const interesting = !!(
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
              if (interesting) {
                obj[k] = synth(child);
              }
            }
          }
        }
        return obj;
      }
      case 'array': {
        if (node.items) return [synth(node.items)];
        return [];
      }
      case 'integer':
      case 'number':
        return 1;
      case 'boolean':
        return true;
      case 'string': {
        const first = node.enum?.[0];
        return typeof first === 'string' ? first : 'x';
      }
      default:
        return null;
    }
  }
  return synth(walk.root);
}
