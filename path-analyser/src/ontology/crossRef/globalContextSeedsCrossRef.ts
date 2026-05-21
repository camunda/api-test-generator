// Per-slice cross-reference module for `globalContextSeedsSchema.ts`
// (#87 + Lift 15 / #255).
//
// Owns invariants whose offending field is in `globalContextSeeds[*]`.
// The structural `GlobalContextSeedSchema` zod definition lives in
// `crossRefValidator.ts` because it is also consumed by the public
// boundary-asserter `assertSafeGlobalContextSeeds`; importing it here
// keeps a single source of truth.

import type { DomainSemantics } from '../../types.js';
import type { CrossRefIssue, SliceCrossRefModule } from './types.js';

// JS/TS identifier syntax. Conservative — ASCII only — because the emitter
// builds locals like `__<fieldName>IsDefault` and ctx keys like `<binding>`
// from these strings; restricting them to identifier-safe ASCII rules out
// accidental code injection (`'; DROP TABLE`-style) and ensures the emitted
// TS compiles regardless of the surrounding generator's escape choices.
function isSafeIdentifierName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

// `defaultSentinel` is interpolated into a single-quoted TS string literal
// (preserved verbatim from the pre-#87 emitter so generated suites stay
// byte-identical). Reject characters that would break that literal: single
// quotes, backslashes, line terminators, and other control characters.
// Unicode line separators U+2028 / U+2029 also terminate string literals in
// JS so they're rejected too. The current production sentinel `<default>`
// passes; anything that would have required escaping fails fast at load.
function sentinelHasUnsafeChars(sentinel: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching control chars to reject them
  return /['\\\r\n\t\u0000-\u001f\u2028\u2029]/.test(sentinel);
}

// #87: every globalContextSeeds entry must have a unique, identifier-safe
// `binding` and `fieldName`. The emitter's sentinel local is
// `__<fieldName>IsDefault`, the multipart strip branch keys off `fieldName`,
// and ctx[<binding>] / seedBinding('<seedRule>') interpolate `binding` and
// `seedRule` directly. Restricting these to safe identifiers (and rejecting
// duplicates) means the emitter can interpolate them without an escape pass,
// rules out config-driven code injection, and prevents two entries from
// declaring the same `const __...IsDefault`. Also reject
// `stripFromMultipartWhenDefault: true` without a `defaultSentinel` — the
// strip branch needs something to compare against, otherwise the emitter
// would have to choose a fallback sentinel itself (re-introducing the very
// hard-coding this entry is meant to remove).
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

    if (seed.defaultSentinel !== undefined && sentinelHasUnsafeChars(seed.defaultSentinel)) {
      issues.push({
        code: 'globalContextSeedSentinelSafe',
        message: `globalContextSeeds entry for binding "${seed.binding}" has defaultSentinel containing characters (single-quote, backslash, line terminator, or control char) that would break the emitted single-quoted string literal`,
      });
    }

    if (seed.stripFromMultipartWhenDefault === true && seed.defaultSentinel === undefined) {
      issues.push({
        code: 'globalContextSeedStripRequiresSentinel',
        message: `globalContextSeeds entry for binding "${seed.binding}" sets stripFromMultipartWhenDefault but has no defaultSentinel`,
      });
    }
  }
  return issues;
}

export const GLOBAL_CONTEXT_SEEDS_CROSS_REF: SliceCrossRefModule = {
  slice: 'globalContextSeeds',
  checks: [checkGlobalContextSeedsCoherent],
};
