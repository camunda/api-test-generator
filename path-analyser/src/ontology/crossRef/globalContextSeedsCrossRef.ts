// Per-slice cross-reference module for `globalContextSeedsSchema.ts`
// (#87 + Lift 15 / #255 + #342).
//
// Owns invariants whose offending field is in `globalContextSeeds[*]`.
// The structural `GlobalContextSeedSchema` zod definition lives in
// `crossRefValidator.ts` because it is also consumed by the public
// boundary-asserter `assertSafeGlobalContextSeeds`; importing it here
// keeps a single source of truth.

import type { DomainSemantics } from '../../types.js';
import type { CrossRefIssue, SliceCrossRefModule } from './types.js';

// JS/TS identifier syntax. Conservative — ASCII only — because the emitter
// builds ctx keys like `<binding>` from these strings; restricting them to
// identifier-safe ASCII rules out accidental code injection
// (`'; DROP TABLE`-style) and ensures the emitted TS compiles regardless
// of the surrounding generator's escape choices.
function isSafeIdentifierName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

// #87: every globalContextSeeds entry must have a unique, identifier-safe
// `binding` and `fieldName`. The multipart-field omission keys off
// `fieldName`, and ctx[<binding>] / seedBinding('<seedRule>') interpolate
// `binding` and `seedRule` directly. Restricting these to safe identifiers
// (and rejecting duplicates) means the emitter can interpolate them without
// an escape pass and rules out config-driven code injection.
export function checkGlobalContextSeedsCoherent(d: DomainSemantics): CrossRefIssue[] {
  const issues: CrossRefIssue[] = [];
  const seenBindings = new Set<string>();
  const seenFieldNames = new Set<string>();
  for (const seed of d.globalContextSeeds ?? []) {
    if (seenBindings.has(seed.binding)) {
      issues.push({
        code: 'globalContextSeedBindingUnique',
        message: `globalContextSeeds contains duplicate binding "${seed.binding}"`,
      });
    }
    seenBindings.add(seed.binding);

    if (seenFieldNames.has(seed.fieldName)) {
      issues.push({
        code: 'globalContextSeedFieldNameUnique',
        message: `globalContextSeeds contains duplicate fieldName "${seed.fieldName}"`,
      });
    }
    seenFieldNames.add(seed.fieldName);

    for (const [key, value] of [
      ['binding', seed.binding],
      ['fieldName', seed.fieldName],
      ['seedRule', seed.seedRule],
    ] as const) {
      if (!isSafeIdentifierName(value)) {
        issues.push({
          code: 'globalContextSeedSafeIdentifier',
          message: `globalContextSeeds entry for binding "${seed.binding}" has ${key} "${value}", which is not a safe identifier (must match /^[A-Za-z_$][A-Za-z0-9_$]*$/)`,
        });
      }
    }
  }
  return issues;
}

export const GLOBAL_CONTEXT_SEEDS_CROSS_REF: SliceCrossRefModule = {
  slice: 'globalContextSeeds',
  checks: [checkGlobalContextSeedsCoherent],
};
