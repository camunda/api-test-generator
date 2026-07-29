#!/usr/bin/env tsx
/**
 * spec-fields — print, as JSON, a TOP-LEVEL-ONLY property fingerprint of every
 * operation in the active config's bundled spec: for each operationId, the
 * request body's and primary success response's property names, a compact
 * type descriptor, and which are required.
 *
 * Used by the scheduled spec-bump check (.github/workflows/spec-bump-check.yml)
 * to diff the pinned spec's field surface against latest upstream — the
 * companion to spec-operations.ts, which only diffs whole operationIds added/
 * removed. This catches a property added to (or removed from, or newly
 * required on) an EXISTING operation's schema — the case spec-operations.ts
 * is blind to, since the operationId itself doesn't change.
 *
 * Deliberately top-level only (not deep-recursive into nested objects): this
 * stays cheap and readable, and top-level is where the signal that matters
 * lives — a nested $ref'd sub-object's own internal changes are out of scope
 * (recorded as an opaque "ref"/"allOf" type descriptor here, not expanded).
 *
 * Reads spec/<config>/bundled/rest-api.bundle.json (produced by fetch-spec), so
 * run fetch-spec for the desired ref first. Config comes from CONFIG (default
 * from configs.json), resolved the same way as the rest of the pipeline.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getSpecBundleDir } from '../path-analyser/src/configResolver.ts';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

interface FieldInfo {
  type: string;
  required: boolean;
}

interface SideFields {
  properties: Record<string, FieldInfo>;
}

interface OperationFields {
  request: SideFields | null;
  response: SideFields | null;
}

// One level of $ref resolution into components.schemas, unwrapping a single
// allOf wrapper too (the common "description + $ref" pattern seen in this
// spec, e.g. CreateClusterRequest.license) — anything deeper stays opaque.
function resolveSchema(
  schema: unknown,
  components: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!isRecord(schema)) return null;
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.split('/').pop();
    const schemas = isRecord(components.schemas) ? components.schemas : {};
    const resolved = name ? schemas[name] : undefined;
    return isRecord(resolved) ? resolved : null;
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length === 1) {
    return resolveSchema(schema.allOf[0], components);
  }
  return schema;
}

// Compact, top-level-only type descriptor — not a full schema dump, just
// enough to see WHAT changed in a diff (e.g. "array<string>?" for a new
// nullable string array) without expanding nested refs.
function describeType(propSchema: unknown): string {
  if (!isRecord(propSchema)) return 'unknown';
  const nullableSuffix = propSchema.nullable === true ? '?' : '';
  if (typeof propSchema.$ref === 'string') return 'ref';
  if (Array.isArray(propSchema.allOf)) return 'allOf';
  if (propSchema.type === 'array') {
    const items = propSchema.items;
    let itemType = 'unknown';
    if (isRecord(items)) {
      itemType =
        typeof items.$ref === 'string'
          ? 'ref'
          : typeof items.type === 'string'
            ? items.type
            : 'unknown';
    }
    return `array<${itemType}>${nullableSuffix}`;
  }
  return `${typeof propSchema.type === 'string' ? propSchema.type : 'unknown'}${nullableSuffix}`;
}

function extractFields(schema: unknown, components: Record<string, unknown>): SideFields | null {
  const resolved = resolveSchema(schema, components);
  if (!resolved || !isRecord(resolved.properties)) return null;
  const required = new Set(Array.isArray(resolved.required) ? resolved.required : []);
  const properties: Record<string, FieldInfo> = {};
  for (const [name, propSchema] of Object.entries(resolved.properties)) {
    properties[name] = { type: describeType(propSchema), required: required.has(name) };
  }
  return { properties };
}

// First 2xx response with a JSON body — the "primary success response" this
// tool cares about. A 204 (no content) or error-only operation legitimately
// has no response fields to fingerprint (response: null).
function primarySuccessSchema(
  responses: unknown,
  components: Record<string, unknown>,
): SideFields | null {
  if (!isRecord(responses)) return null;
  for (const [status, resp] of Object.entries(responses)) {
    if (!status.startsWith('2') || !isRecord(resp)) continue;
    const content = resp.content;
    if (!isRecord(content)) continue;
    const json = content['application/json'];
    if (!isRecord(json)) continue;
    return extractFields(json.schema, components);
  }
  return null;
}

function collectOperationFields(bundle: unknown): Record<string, OperationFields> {
  if (!isRecord(bundle) || !isRecord(bundle.paths)) {
    throw new Error('bundle has no `paths` object — not a valid OpenAPI bundle');
  }
  const components = isRecord(bundle.components) ? bundle.components : {};
  const out: Record<string, OperationFields> = {};
  for (const item of Object.values(bundle.paths)) {
    if (!isRecord(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      if (!isRecord(op) || typeof op.operationId !== 'string' || op.operationId.trim() === '')
        continue;

      let request: SideFields | null = null;
      if (isRecord(op.requestBody)) {
        const content = op.requestBody.content;
        const json = isRecord(content) ? content['application/json'] : undefined;
        if (isRecord(json)) request = extractFields(json.schema, components);
      }
      const response = primarySuccessSchema(op.responses, components);
      out[op.operationId] = { request, response };
    }
  }
  return out;
}

function main(): void {
  const bundlePath = join(getSpecBundleDir(REPO_ROOT), 'rest-api.bundle.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(bundlePath, 'utf8'));
  } catch (err) {
    console.error(
      `[spec-fields] cannot read bundle at ${bundlePath} — run fetch-spec first.\n${String(err)}`,
    );
    process.exit(2);
  }
  let fields: Record<string, OperationFields>;
  try {
    fields = collectOperationFields(raw);
  } catch (err) {
    console.error(`[spec-fields] ${bundlePath}: ${String(err)} — re-run fetch-spec.`);
    process.exit(2);
  }
  console.log(JSON.stringify(fields, null, 2));
}

main();
