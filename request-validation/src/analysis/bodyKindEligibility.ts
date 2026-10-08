import type { OperationModel, SchemaFragment } from '../model/types.js';
import { buildBaselineBody } from '../schema/baseline.js';

/**
 * Which body-shape scenario kinds the generators can build for an operation. The coverage report counts a kind
 * as "applicable" and reports it missing when no scenario of that kind exists, so "applicable" has to mean "the
 * generator would build one": a kind the generators can never produce is a measuring gap, not a missing test.
 *
 * Before this, `generate.ts` marked these kinds applicable whenever its schema walk found a `oneOf` or `allOf`
 * anywhere in the body, at any depth (a search body has them inside `filter`), and `missing-body` for every
 * object body. The generators only look at the root of the body (`op.requestBodySchema.oneOf`,
 * `op.requestBodySchema.allOf`, `op.rootOneOf`) and `missing-body` only for a required body, so those kinds
 * showed as missing on every search endpoint although nothing could generate them.
 *
 * Each rule below repeats the guard of its generator (named next to it). A test runs the generators over a
 * set of schema shapes and checks that a kind is eligible exactly when its generator produces a scenario, so
 * the two cannot drift apart unnoticed.
 */

function isObjectVariant(v: SchemaFragment | undefined): v is SchemaFragment {
  return !!v && typeof v === 'object' && !Array.isArray(v) && v.type === 'object';
}

/** bodyTopLevel.ts `generateMissingBody`: only a body that is required, or whose properties are all required. */
export function isMissingBodyEligible(op: OperationModel): boolean {
  if (!op.requestBodySchema) return false;
  if (op.bodyRequired === true) return true;
  const schema = op.requestBodySchema;
  if (schema.type === 'object' && schema.properties && op.requiredProps?.length) {
    const propCount = Object.keys(schema.properties).length;
    return propCount > 0 && op.requiredProps.length === propCount;
  }
  return false;
}

const hasRequired = (v: SchemaFragment) => Array.isArray(v.required);

export function eligibleOneOfKinds(op: OperationModel): Set<string> {
  const out = new Set<string>();
  const root = op.requestBodySchema;
  // oneOfNoneMatch.ts / oneOfAmbiguous.ts read `op.requestBodySchema.oneOf` (at least 2 variants).
  const rootOneOf =
    root && Array.isArray(root.oneOf) && root.oneOf.length >= 2 ? root.oneOf : undefined;
  if (rootOneOf) {
    const objects = rootOneOf.filter(isObjectVariant);
    // oneof-none-match: two object variants, and at least one of the first two has a required field to omit.
    const [a, b] = objects;
    if (a && b) {
      const reqA = Array.isArray(a.required) ? a.required : [];
      const reqB = Array.isArray(b.required) ? b.required : [];
      if (reqA.length || reqB.length) out.add('oneof-none-match');
    }
    // oneof-ambiguous: some pair of object variants that both list `required`.
    for (let i = 0; i < rootOneOf.length; i++) {
      for (let j = i + 1; j < rootOneOf.length; j++) {
        const x = rootOneOf[i];
        const y = rootOneOf[j];
        if (
          x &&
          y &&
          x.type === 'object' &&
          y.type === 'object' &&
          hasRequired(x) &&
          hasRequired(y)
        ) {
          out.add('oneof-ambiguous');
        }
      }
    }
  }
  // unionViolations.ts and oneOfAdvanced.ts read `op.rootOneOf`.
  const variants = op.rootOneOf;
  if (variants && variants.length >= 2) {
    // union: two object variants that list `required`.
    if (variants.filter((v) => v && v.type === 'object' && hasRequired(v)).length >= 2) {
      out.add('union');
    }
    // oneof-cross-bleed: two object variants with properties, the second having a property the first lacks.
    const withProps = variants.filter(
      (v) => v && typeof v === 'object' && v.type === 'object' && v.properties,
    );
    const [a, b] = withProps;
    if (a && b) {
      const aProps = a.properties ?? {};
      if (Object.keys(b.properties ?? {}).some((k) => !(k in aProps))) out.add('oneof-cross-bleed');
    }
  }
  // oneof-multi-ambiguous: at least 3 object variants that list `required`.
  if (
    variants &&
    variants.length >= 3 &&
    variants.filter((v) => v && typeof v === 'object' && v.type === 'object' && hasRequired(v))
      .length >= 3
  ) {
    out.add('oneof-multi-ambiguous');
  }
  return out;
}

export function eligibleAllOfKinds(op: OperationModel): Set<string> {
  const out = new Set<string>();
  const root = op.requestBodySchema;
  // allOf.ts reads `op.requestBodySchema.allOf`, and needs an object baseline body.
  if (!root || !Array.isArray(root.allOf)) return out;
  const baseline = buildBaselineBody(op);
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return out;
  // allof-missing-required: two constituents that list `required`, one of whose required fields is in the baseline.
  const withRequired = root.allOf.filter(
    (c) => c && c.type === 'object' && Array.isArray(c.required),
  );
  if (
    withRequired.length >= 2 &&
    withRequired.some((c) => (c.required ?? []).some((r) => r in baseline))
  ) {
    out.add('allof-missing-required');
  }
  // allof-conflict: two object constituents with properties that give one property different types.
  const objects = root.allOf.filter((c) => c && c.type === 'object' && c.properties);
  if (objects.length >= 2) {
    const types: Record<string, Set<string>> = {};
    for (const c of objects) {
      for (const [k, v] of Object.entries(c.properties ?? {})) {
        const t = v.type || 'any';
        const set = types[k] ?? new Set<string>();
        set.add(Array.isArray(t) ? String(t[0]) : String(t));
        types[k] = set;
      }
    }
    if (Object.values(types).some((s) => s.size > 1)) out.add('allof-conflict');
  }
  return out;
}
