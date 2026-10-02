// Environment-capability accessor over the global-context-seeds ABox (#404).
//
// A `globalContextSeeds` entry's `capabilityGate` declares, per field, that
// the config's target environment may have disabled the capability that
// field represents (e.g. `tenantId` under single-tenant mode). Confirmed
// live: a FLAT optional occurrence of the field — populated with an
// explicit, non-blank value, exactly what `generateOptionalSubShapeVariants`
// does — is always rejected while the capability is off, independent of the
// value's own shape. A NESTED occurrence (e.g. a search filter field) is a
// different, unaffected case and is never consulted here — every leaf
// `generateOptionalSubShapeVariants` plans is already optional by
// construction, so only the flat/nested split needs checking.

import type { DomainSemantics } from '../types.js';

type GateSource = Pick<DomainSemantics, 'globalContextSeeds'>;

/**
 * The capability-gate rejection to expect for a FLAT optional leaf at
 * `fieldPath`, or `undefined` if this field isn't gated (or the leaf is
 * nested — `fieldPath` contains a `.`, e.g. `filter.tenantId`, which this
 * gate never applies to).
 */
export function capabilityGateFor(
  domain: GateSource | undefined,
  fieldPath: string,
): { disabledDetailContains: string } | undefined {
  if (fieldPath.includes('.')) return undefined;
  const seed = (domain?.globalContextSeeds ?? []).find((s) => s.fieldName === fieldPath);
  return seed?.capabilityGate;
}
