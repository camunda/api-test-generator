// Shared shapes for per-slice cross-reference modules.
//
// Lift 15 / #255 splits the cross-reference invariants out of the
// monolithic `crossRefValidator.ts` into one module per per-slice TBox
// under `path-analyser/src/ontology/*Schema.ts`. Each module exports a
// `SliceCrossRefModule` describing which slice it owns, which check
// functions it ships, and a `noChecksRationale` for slices with no
// cross-references today (so an empty module is an explicit declaration,
// not an oversight). The composer in `crossRefValidator.ts` enumerates
// the registered modules and runs every check.
//
// The build-time guard in `configs/<config>/regression-invariants.test.ts`
// asserts every `*Schema.ts` slice has a matching `crossRef/*CrossRef.ts`
// registered in `CROSS_REF_MODULES`. Adding a new slice schema without a
// corresponding module fails the test — the drift case Lift 15 / #255
// was filed to prevent.

import type { DomainSemantics } from '../../types.js';

export interface CrossRefIssue {
  /**
   * Stable invariant code. Surfaced as the `invariant` field on
   * `DomainSemanticsValidationError` so test assertions and CI grep
   * patterns can target a specific class of violation regardless of
   * which row triggered it.
   */
  code: string;
  /**
   * Human-readable message identifying the offending property. One
   * check function may emit multiple issues — one per offending row —
   * each carrying the same `code` but a distinct `message`.
   */
  message: string;
}

export type CrossRefCheck = (d: DomainSemantics) => CrossRefIssue[];

export interface SliceCrossRefModule {
  /**
   * Stem of the slice's TBox source file (e.g. `runtimeStates` for
   * `runtimeStatesSchema.ts`). The build-time guard pairs this against
   * the discovered `*Schema.ts` files; a mismatch is a configuration
   * error.
   */
  slice: string;
  /**
   * Cross-reference check functions owned by this slice. May be empty.
   */
  checks: CrossRefCheck[];
  /**
   * Required iff `checks.length === 0`. Documents why the slice has no
   * cross-reference invariants today, so an empty module is an explicit
   * "no checks needed" declaration rather than an oversight.
   */
  noChecksRationale?: string;
}
