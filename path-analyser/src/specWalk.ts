import fsSync from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Reading an OpenAPI document: local `$ref`s, composed schemas and the spec file itself. */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

/**
 * The node a local `$ref` (`#/components/schemas/X`, `#/paths/~1files~1search/post/requestBody`, ...)
 * points to: an RFC 6901 JSON pointer, with `~1` and `~0` unescaped and percent-decoding applied.
 * Anything that is not a local pointer, or does not resolve, yields undefined.
 */
export function resolvePointer(spec: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let cur: unknown = spec;
  for (const raw of ref.slice(2).split('/')) {
    let token = raw;
    try {
      token = decodeURIComponent(raw);
    } catch {
      // keep the raw token; a malformed escape cannot match a key anyway
    }
    token = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(cur)) cur = cur[Number(token)];
    else if (isRecord(cur)) cur = cur[token];
    else return undefined;
  }
  return cur;
}

/** Follows `$ref`s until a node that is not a reference. */
export function follow(spec: Record<string, unknown>, node: unknown): Record<string, unknown> {
  let cur = node;
  for (let depth = 0; depth < 10 && isRecord(cur) && typeof cur.$ref === 'string'; depth++) {
    cur = resolvePointer(spec, cur.$ref);
  }
  return isRecord(cur) ? cur : {};
}

/**
 * A schema with its `$ref`s followed and its `allOf` branches merged in: the union of their
 * `properties` and `required`, the first `enum`, `items`, `type`, `format` and `pattern` found, and
 * the tightest `minLength` and `maxLength` (the largest minimum and the smallest maximum). Enough to read which properties a request
 * body takes and what a sort item's `field` may be, however the spec composes them.
 */
export function flatten(
  spec: Record<string, unknown>,
  node: unknown,
  depth = 0,
): Record<string, unknown> {
  const schema = follow(spec, node);
  if (depth > 10) return schema;
  const merged: Record<string, unknown> = { ...schema };
  const properties: Record<string, unknown> = isRecord(schema.properties)
    ? { ...schema.properties }
    : {};
  const required: unknown[] = Array.isArray(schema.required) ? [...schema.required] : [];
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      const part = flatten(spec, branch, depth + 1);
      if (isRecord(part.properties)) Object.assign(properties, part.properties);
      if (merged.enum === undefined && part.enum !== undefined) merged.enum = part.enum;
      if (merged.items === undefined && part.items !== undefined) merged.items = part.items;
      // Scalar facts a branch contributes when the node itself does not state them.
      for (const key of ['type', 'format', 'pattern']) {
        if (merged[key] === undefined && part[key] !== undefined) merged[key] = part[key];
      }
      // allOf is an intersection, so the tightest length limits win, not the first ones found.
      if (typeof part.maxLength === 'number') {
        merged.maxLength =
          typeof merged.maxLength === 'number'
            ? Math.min(merged.maxLength, part.maxLength)
            : part.maxLength;
      }
      if (typeof part.minLength === 'number') {
        merged.minLength =
          typeof merged.minLength === 'number'
            ? Math.max(merged.minLength, part.minLength)
            : part.minLength;
      }
      if (Array.isArray(part.required)) required.push(...part.required);
    }
  }
  if (required.length) merged.required = [...new Set(required)];
  if (Object.keys(properties).length) merged.properties = properties;
  return merged;
}

/**
 * The spec the other readers use: `OPENAPI_SPEC_PATH` when set (resolved against `baseDir`, like
 * the graph loader), else the active config's bundled spec. JSON or YAML.
 */
export function loadSpecDocument(baseDir: string, bundledSpecPath: string): unknown {
  const override = process.env.OPENAPI_SPEC_PATH;
  const specPath = override ? path.resolve(baseDir, override) : bundledSpecPath;
  return parseYaml(fsSync.readFileSync(specPath, 'utf8'));
}
