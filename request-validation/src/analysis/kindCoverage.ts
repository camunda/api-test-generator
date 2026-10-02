import { normalizeKind } from '../model/types.js';

export interface KindCoverage {
  /** Kinds that should have a scenario for the operation (aliases resolved, present kinds included). */
  applicable: Set<string>;
  /** Kinds that do have a scenario for the operation (aliases resolved). */
  present: Set<string>;
  /** Applicable kinds with no scenario, sorted. */
  missingApplicable: string[];
}

/**
 * The per-operation coverage of scenario kinds that COVERAGE.json reports.
 *
 * Both sides go through `normalizeKind`: a `body-top-type-mismatch` scenario is counted as
 * `type-mismatch`, so the applicable set has to say `type-mismatch` too. If only the present side
 * were normalized, the aliased kind would be reported as missing for every operation that takes it
 * whatever was generated. Present kinds are also added to the applicable set so the percentage
 * cannot exceed 100.
 */
export function computeKindCoverage(
  applicableKinds: Iterable<string>,
  presentKinds: Iterable<string>,
): KindCoverage {
  const present = new Set<string>();
  for (const kind of presentKinds) present.add(normalizeKind(kind));
  const applicable = new Set<string>();
  for (const kind of applicableKinds) applicable.add(normalizeKind(kind));
  for (const kind of present) applicable.add(kind);
  const missingApplicable = Array.from(applicable)
    .filter((kind) => !present.has(kind))
    .sort();
  return { applicable, present, missingApplicable };
}
