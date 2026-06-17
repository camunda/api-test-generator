import SwaggerParser from '@apidevtools/swagger-parser';
import type { OperationModel, ParameterModel, SchemaFragment, SpecModel } from '../model/types.js';

// --------------------------------------------------------------------------
// Narrowing helpers
//
// SwaggerParser.dereference() returns an untyped graph at runtime. We avoid
// `any` and `as` casts by narrowing each access through these guards.
//
// `SchemaFragment` is defined with an index signature `[key: string]: unknown`,
// so any `Record<string, unknown>` is structurally assignable to it — no
// cast required.
// --------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isSchemaFragmentArray(v: unknown): v is SchemaFragment[] {
  return Array.isArray(v) && v.every(isRecord);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asSchemaFragment(v: unknown): SchemaFragment | undefined {
  return isRecord(v) ? v : undefined;
}

function asDiscriminator(
  v: unknown,
): { propertyName: string; mapping?: Record<string, string> } | undefined {
  if (!isRecord(v)) return undefined;
  const propertyName = asString(v.propertyName);
  if (!propertyName) return undefined;
  let mapping: Record<string, string> | undefined;
  if (isRecord(v.mapping)) {
    const acc: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.mapping)) {
      if (typeof val === 'string') acc[k] = val;
    }
    mapping = acc;
  }
  return { propertyName, mapping };
}

/**
 * Collect the names of security schemes that declare `x-enforcement:
 * conditional` (camunda/camunda#53708). These are enforced only under
 * certain deployment-mode profiles (e.g. the `auth: [secured]` axis) and
 * bypassed otherwise, so an operation referencing one is the auth-absent
 * (401) test surface for the secured profile.
 */
function collectConditionalSchemes(api: unknown): Set<string> {
  const names = new Set<string>();
  if (isRecord(api) && isRecord(api.components) && isRecord(api.components.securitySchemes)) {
    for (const [name, scheme] of Object.entries(api.components.securitySchemes)) {
      if (isRecord(scheme) && scheme['x-enforcement'] === 'conditional') {
        names.add(name);
      }
    }
  }
  return names;
}

/**
 * Evaluate an OpenAPI `security` requirement list against the set of
 * conditionally-enforced scheme names.
 *
 * - `true`      — at least one requirement references a conditional scheme.
 * - `false`     — the list is present but references no conditional scheme
 *                 (including the explicit `security: []` public override).
 * - `undefined` — no `security` declared at this level; the caller should
 *                 fall back to the global `security`.
 */
function securityRequiresConditional(
  security: unknown,
  conditional: Set<string>,
): boolean | undefined {
  if (!Array.isArray(security)) return undefined;
  if (security.length === 0) return false;
  for (const requirement of security) {
    if (isRecord(requirement)) {
      for (const schemeName of Object.keys(requirement)) {
        if (conditional.has(schemeName)) return true;
      }
    }
  }
  return false;
}

/**
 * Evaluate whether a `security` requirement list *mandates* authentication.
 *
 * The OpenAPI `security` array is an OR of Security Requirement Objects. An
 * empty object `{}` is the "anonymous access permitted" alternative, so its
 * presence — like an empty array `[]` — means auth is NOT required even if a
 * sibling alternative names a scheme. Authentication is mandatory only when
 * EVERY alternative demands at least one scheme.
 *
 * - `true`      — non-empty list AND every alternative references ≥1 scheme.
 * - `false`     — `security: []`, OR any `{}` (anonymous) alternative present.
 * - `undefined` — no `security` declared at this level; the caller should fall
 *                 back to the path-item / global `security`.
 *
 * Mirrors `securityRequiresConditional`'s precedence contract but is agnostic
 * to `x-enforcement` — it drives the `authAbsentMode: 'all-secured'` 401
 * surface for uniformly-authenticated APIs (e.g. Hub).
 */
function securityRequiresAuth(security: unknown): boolean | undefined {
  if (!Array.isArray(security)) return undefined;
  if (security.length === 0) return false;
  return security.every(
    (requirement) => isRecord(requirement) && Object.keys(requirement).length > 0,
  );
}

function buildParameter(raw: unknown): ParameterModel | undefined {
  if (!isRecord(raw)) return undefined;
  const name = asString(raw.name);
  const inField = asString(raw.in);
  if (!name || !inField) return undefined;
  if (inField !== 'path' && inField !== 'query' && inField !== 'header' && inField !== 'cookie') {
    return undefined;
  }
  return {
    name,
    in: inField,
    required: raw.required === true,
    schema: asSchemaFragment(raw.schema),
  };
}

function extractResponseInfo(op: Record<string, unknown>): {
  responseCodes: string[];
  successIsCollection: boolean;
} {
  const responses = isRecord(op.responses) ? op.responses : {};
  const responseCodes = Object.keys(responses);
  let successIsCollection = false;
  for (const code of ['200', '201']) {
    const r = responses[code];
    if (!isRecord(r) || !isRecord(r.content)) continue;
    const json = asSchemaFragment(r.content['application/json']);
    const schema = json?.schema ? asSchemaFragment(json.schema) : undefined;
    if (schema && isRecord(schema.properties)) {
      const props = Object.keys(schema.properties);
      if (props.includes('items') || props.includes('page')) {
        successIsCollection = true;
        break;
      }
    }
  }
  return { responseCodes, successIsCollection };
}

export async function loadSpec(file: string): Promise<SpecModel> {
  const api: unknown = await SwaggerParser.dereference(file);
  const operations: OperationModel[] = [];
  const paths = isRecord(api) && isRecord(api.paths) ? api.paths : {};
  const conditionalSchemes = collectConditionalSchemes(api);
  const globalSecurity = isRecord(api) ? api.security : undefined;
  for (const [p, methods] of Object.entries(paths)) {
    if (!isRecord(methods)) continue;
    // Path-level parameters are inherited by every operation under the path.
    const pathLevelParams = Array.isArray(methods.parameters) ? methods.parameters : [];
    // Path-item-level `security` sits between operation-level and global in the
    // OpenAPI precedence chain (op.security ?? pathItem.security ?? global).
    const pathLevelSecurity = methods.security;
    for (const [m, op] of Object.entries(methods)) {
      const method = m.toUpperCase();
      if (!isRecord(op)) continue;
      const operationId = asString(op.operationId);
      if (!operationId) continue;
      const params: ParameterModel[] = [];
      const opParams = Array.isArray(op.parameters) ? op.parameters : [];
      for (const pDef of [...opParams, ...pathLevelParams]) {
        const built = buildParameter(pDef);
        if (built) params.push(built);
      }
      let requestBodySchema: SchemaFragment | undefined;
      let requiredProps: string[] | undefined;
      let rootOneOf: SchemaFragment[] | undefined;
      let discriminator: { propertyName: string; mapping?: Record<string, string> } | undefined;
      let bodyRequired: boolean | undefined;
      let multipartSchema: SchemaFragment | undefined;
      let multipartRequiredProps: string[] | undefined;
      let mediaTypes: string[] | undefined;
      if (isRecord(op.requestBody) && isRecord(op.requestBody.content)) {
        if (op.requestBody.required === true) bodyRequired = true; // OpenAPI requestBody.required
        const content = op.requestBody.content;
        mediaTypes = Object.keys(content);
        const json = asSchemaFragment(content['application/json']);
        const multipart = asSchemaFragment(content['multipart/form-data']);
        if (json?.schema) {
          requestBodySchema = asSchemaFragment(json.schema);
        } else if (multipart?.schema) {
          // Fallback: treat multipart schema as primary body schema if json absent
          requestBodySchema = asSchemaFragment(multipart.schema);
        }
        if (multipart?.schema) {
          multipartSchema = asSchemaFragment(multipart.schema);
          if (multipartSchema?.type === 'object' && isStringArray(multipartSchema.required)) {
            multipartRequiredProps = [...multipartSchema.required];
          }
        }
        if (requestBodySchema) {
          if (requestBodySchema.type === 'object' && isStringArray(requestBodySchema.required)) {
            requiredProps = [...requestBodySchema.required];
          }
          if (isSchemaFragmentArray(requestBodySchema.oneOf)) {
            rootOneOf = requestBodySchema.oneOf;
          }
          discriminator = asDiscriminator(requestBodySchema.discriminator);
        }
      }
      const { responseCodes, successIsCollection } = extractResponseInfo(op);
      operations.push({
        operationId,
        method,
        path: p,
        tags: isStringArray(op.tags) ? op.tags : [],
        requestBodySchema,
        bodyRequired,
        requiredProps,
        parameters: params,
        rootOneOf,
        discriminator,
        multipartSchema,
        multipartRequiredProps,
        mediaTypes,
        responseCodes,
        successIsCollection,
        conditionalAuth:
          securityRequiresConditional(op.security, conditionalSchemes) ??
          securityRequiresConditional(pathLevelSecurity, conditionalSchemes) ??
          securityRequiresConditional(globalSecurity, conditionalSchemes) ??
          false,
        secured:
          securityRequiresAuth(op.security) ??
          securityRequiresAuth(pathLevelSecurity) ??
          securityRequiresAuth(globalSecurity) ??
          false,
      });
    }
  }
  return { operations };
}
