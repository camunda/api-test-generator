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

// $ref resolution into components.schemas, plus allOf composition: a
// single-branch allOf is the common "description + $ref" wrapper pattern
// (e.g. CreateClusterRequest.license) and unwraps to that one branch; a
// genuine multi-branch allOf (composing a base schema + operation-specific
// fields — not currently used at the top level of any request/response in
// this spec, but a plausible upstream pattern) has its branches' properties
// and required arrays MERGED, not dropped. Silently returning {} for a
// multi-branch allOf would defeat this tool's entire point: missing exactly
// the kind of field-level change a human wouldn't otherwise catch either.
// Anything deeper than one level of composition stays opaque (top-level only
// by design — see the file header).
//
// `seen` guards against a $ref cycle (schema A -> B -> A) recursing forever;
// each $ref is added before resolving its target and any repeat short-
// circuits to null rather than looping.
function resolveSchema(
  schema: unknown,
  components: Record<string, unknown>,
  seen: ReadonlySet<string> = new Set(),
): Record<string, unknown> | null {
  if (!isRecord(schema)) return null;
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return null;
    const name = schema.$ref.split('/').pop();
    const schemas = isRecord(components.schemas) ? components.schemas : {};
    const resolved = name ? schemas[name] : undefined;
    if (!isRecord(resolved)) return null;
    return resolveSchema(resolved, components, new Set([...seen, schema.$ref]));
  }
  if (Array.isArray(schema.allOf)) {
    // Single- and multi-branch allOf get the SAME treatment: merge every
    // branch's properties/required AND the wrapper object's own top-level
    // properties/required, if any. A single-branch allOf is NOT reliably a
    // pure "description + $ref" wrapper with nothing of its own — confirmed
    // in the real camunda-oca bundle, where the entire *SearchQuery/
    // *SearchQueryResult family (105 schemas) uses exactly this shape, e.g.
    // ProcessInstanceSearchQuery: `allOf: [{$ref: SearchQueryRequest}]` PLUS
    // its own `sort`/`filter` properties sitting alongside allOf — a
    // single-branch-only unwrap would have silently dropped both, the two
    // most operation-specific fields on that request body.
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    if (isRecord(schema.properties)) Object.assign(properties, schema.properties);
    if (Array.isArray(schema.required)) required.push(...schema.required);
    for (const branch of schema.allOf) {
      const resolvedBranch = resolveSchema(branch, components, seen);
      if (resolvedBranch && isRecord(resolvedBranch.properties)) {
        Object.assign(properties, resolvedBranch.properties);
      }
      if (resolvedBranch && Array.isArray(resolvedBranch.required)) {
        required.push(...resolvedBranch.required);
      }
    }
    return { properties, required };
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

// Resolves a $ref pointing into a top-level components bucket OTHER than
// schemas — e.g. an operation's requestBody as `$ref: "#/components/
// requestBodies/Foo"`, or a response entry as `$ref: "#/components/
// responses/Foo"`. Distinct from resolveSchema (which only ever resolves
// into components.schemas): these two component kinds live in their own
// buckets, so the bucket name is a parameter, not hardcoded.
function resolveComponentRef(
  obj: unknown,
  bucketKey: string,
  components: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!isRecord(obj)) return null;
  if (typeof obj.$ref === 'string') {
    const name = obj.$ref.split('/').pop();
    const bucket = isRecord(components[bucketKey]) ? components[bucketKey] : {};
    const resolved = name ? bucket[name] : undefined;
    return isRecord(resolved) ? resolved : null;
  }
  return obj;
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
  for (const [status, respRaw] of Object.entries(responses)) {
    if (!status.startsWith('2')) continue;
    const resp = resolveComponentRef(respRaw, 'responses', components);
    if (!resp) continue;
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
      const requestBody = resolveComponentRef(op.requestBody, 'requestBodies', components);
      if (requestBody) {
        const content = requestBody.content;
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
  // Same refusal as spec-operations.ts: an empty surface here would let
  // spec-field-diff.ts silently report "no field changes" for a run whose
  // bundle is actually broken/reshaped, which could let an unsafe drift
  // auto-adopt instead of failing loudly.
  if (Object.keys(fields).length === 0) {
    console.error(
      `[spec-fields] no operations found in ${bundlePath} — refusing to emit an empty field surface (it would corrupt the field-diff). Re-run fetch-spec.`,
    );
    process.exit(2);
  }
  console.log(JSON.stringify(fields, null, 2));
}

main();
