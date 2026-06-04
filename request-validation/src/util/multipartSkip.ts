import type { OperationModel, SchemaFragment, ValidationScenario } from '../model/types.js';

/**
 * Multipart-only operations need three classes of JSON-derived
 * validation scenarios dropped before the multipart-adaptation pass
 * tries to wrap them as form-data submissions (#135):
 *
 *   1. `body-top-type-mismatch` — there is no JSON top-level type to
 *      invert. Wrapping `[]` / scalar bodies as form data produces a
 *      meaningless multipart envelope; the broker returns 415 (or
 *      occasionally 200/201) before body validation runs.
 *
 *   2. `type-mismatch` whose target is a top-level multipart part with
 *      `format: binary` — any binary part still satisfies the schema
 *      regardless of the bytes we put in it, so the wrapped form-data
 *      submission yields 201 instead of the expected 400.
 *
 *   3. `constraint-violation` whose target is a top-level multipart
 *      part with `type: array` — array-cardinality / item-shape
 *      mutations don't translate to a multipart `files=...` repetition
 *      pattern; the broker accepts the upload and returns 201.
 *
 *   4. `additional-prop` / `additional-prop-general` (#364) — multipart
 *      endpoints have no `additionalProperties: false` enforcement on
 *      form data the way a JSON body does, so an unknown extra form part
 *      is silently ignored and the upload returns 201, not the expected
 *      400. Unconditional for multipart-only ops — any extra part is
 *      ignored regardless of the target. Verified live:
 *
 *          POST /v2/documents -F file=x -F __unexpectedField=x   -> 201
 *
 *
 * `shouldSkipForMultipart` returns `true` for scenarios that fall into
 * any of those classes on a multipart-only operation. Other scenarios
 * (missing-required, etc.) flow through the existing adaptation pass
 * unchanged.
 *
 * A targeted multipart-aware mutation strategy (omit a required part,
 * send wrong Content-Type per part, exceed declared size) is a separate
 * larger feature and intentionally out of scope here — see #135.
 */

const TOP_LEVEL_FIELD_RE = /^[^.[\]]+$/;

function isMultipartOnly(op: OperationModel): boolean {
  const hasMultipart = !!op.mediaTypes?.includes('multipart/form-data');
  const hasJson = !!op.mediaTypes?.includes('application/json');
  return hasMultipart && !hasJson;
}

function topLevelMultipartPart(
  op: OperationModel,
  target: string | undefined,
): SchemaFragment | undefined {
  if (!target || !TOP_LEVEL_FIELD_RE.test(target)) return undefined;
  const props = op.multipartSchema?.properties;
  if (!props) return undefined;
  const part = props[target];
  return part && typeof part === 'object' ? part : undefined;
}

function isBinaryPart(schema: SchemaFragment | undefined): boolean {
  if (!schema) return false;
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  return t === 'string' && schema.format === 'binary';
}

function isArrayPart(schema: SchemaFragment | undefined): boolean {
  if (!schema) return false;
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  return t === 'array';
}

export function shouldSkipForMultipart(scenario: ValidationScenario, op: OperationModel): boolean {
  if (!isMultipartOnly(op)) return false;
  if (scenario.type === 'body-top-type-mismatch') return true;
  // #364 — an unknown extra form part is ignored by multipart endpoints
  // (no additionalProperties:false on form data), so the upload returns 201
  // rather than 400. Drop regardless of target.
  if (scenario.type === 'additional-prop' || scenario.type === 'additional-prop-general') {
    return true;
  }
  if (scenario.type === 'type-mismatch') {
    const part = topLevelMultipartPart(op, scenario.target);
    if (isBinaryPart(part)) return true;
  }
  if (scenario.type === 'constraint-violation') {
    const part = topLevelMultipartPart(op, scenario.target);
    if (isArrayPart(part)) return true;
  }
  return false;
}
