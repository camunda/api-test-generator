import type { OperationModel, SchemaFragment, ValidationScenario } from '../model/types.js';
import { isBinaryPart } from './multipartSkip.js';

/**
 * Names of an operation's top-level multipart parts that carry file content:
 * `format: binary` strings, or arrays whose items are (each array item is one
 * repeated file part, as in createDeployment's `resources`).
 */
export function binaryMultipartParts(op: OperationModel): Set<string> {
  const names = new Set<string>();
  const props = op.multipartSchema?.properties;
  if (!props) return names;
  for (const [name, part] of Object.entries(props)) {
    if (!part || typeof part !== 'object') continue;
    if (isBinaryPart(part) || isBinaryArrayPart(part)) names.add(name);
  }
  return names;
}

function isBinaryArrayPart(schema: SchemaFragment): boolean {
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (t !== 'array') return false;
  const items = schema.items;
  return !!items && typeof items === 'object' && !Array.isArray(items) && isBinaryPart(items);
}

/**
 * Move a multipart scenario's binary parts from `multipartForm` (text fields)
 * to `multipartFiles` (file parts). The JSON-to-multipart adaptation renders a
 * binary array as the text `["x"]`; the file gets the first item as content.
 * Scenarios with no binary part in their form are returned unchanged.
 */
export function splitMultipartFileParts(
  s: ValidationScenario,
  op: OperationModel,
): ValidationScenario {
  if (s.bodyEncoding !== 'multipart' || !s.multipartForm) return s;
  const binary = binaryMultipartParts(op);
  if (binary.size === 0) return s;
  const form: Record<string, unknown> = {};
  const files: Record<string, string> = { ...s.multipartFiles };
  for (const [k, v] of Object.entries(s.multipartForm)) {
    if (binary.has(k)) files[k] = fileContent(v);
    else form[k] = v;
  }
  if (Object.keys(files).length === 0) return s;
  return { ...s, multipartForm: form, multipartFiles: files };
}

function fileContent(v: unknown): string {
  if (typeof v !== 'string') return 'x';
  if (v.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) {
        const first: unknown = parsed[0];
        return typeof first === 'string' && first.length > 0 ? first : 'x';
      }
    } catch {
      /* not JSON — use the raw text as content */
    }
  }
  return v.length > 0 ? v : 'x';
}
