// Per-slice cross-reference module for `semanticsSchema.ts`
// (Lift 7 / #216 + Lift 15 / #255).
//
// Owns invariants whose offending field is in `semanticTypes[*]`.

import type { DomainSemantics } from '../../types.js';
import type { CrossRefIssue, SliceCrossRefModule } from './types.js';

function declaredStates(d: DomainSemantics): Set<string> {
  return new Set([...Object.keys(d.runtimeStates ?? {}), ...Object.keys(d.capabilities ?? {})]);
}

export function checkSemanticTypeWitnessTargetResolves(d: DomainSemantics): CrossRefIssue[] {
  const declared = declaredStates(d);
  const issues: CrossRefIssue[] = [];
  for (const [type, spec] of Object.entries(d.semanticTypes ?? {})) {
    const w = spec.witnesses;
    if (typeof w !== 'string' || w.length === 0) continue;
    if (!declared.has(w)) {
      issues.push({
        code: 'semanticTypeWitnessTargetResolves',
        message: `semanticTypes.${type}.witnesses targets "${w}", which is not declared in runtimeStates or capabilities`,
      });
    }
  }
  return issues;
}

// #162 PR 2: `kind: 'attribute'` and `clientMinted: true` are paired —
// a `clientMinted: true` flag without `kind: 'attribute'` is dead config
// (the planner only consults clientMinted on attribute-kind semantics),
// and `kind: 'attribute'` without `clientMinted: true` is currently
// undefined (PR 2's planner branch hard-requires clientMinted, since the
// alternative interpretation — server-minted attributes — isn't part of
// the classification vocabulary). Both directions get a load-time error
// so a typo doesn't silently fall through.
export function checkAttributeKindClientMintedPairing(d: DomainSemantics): CrossRefIssue[] {
  const issues: CrossRefIssue[] = [];
  for (const [name, spec] of Object.entries(d.semanticTypes ?? {})) {
    const kind = spec.kind;
    const clientMinted = spec.clientMinted === true;
    if (kind === 'attribute' && !clientMinted) {
      issues.push({
        code: 'attributeKindClientMintedPairing',
        message: `semanticTypes.${name} sets kind: 'attribute' but is missing clientMinted: true. PR 2 (#162) requires the pairing — declare clientMinted: true or change the kind.`,
      });
    }
    if (clientMinted && kind !== 'attribute') {
      issues.push({
        code: 'attributeKindClientMintedPairing',
        message: `semanticTypes.${name} sets clientMinted: true but kind is ${kind ? `'${kind}'` : 'absent'}. The planner only consults clientMinted on attribute-kind semantics.`,
      });
    }
  }
  return issues;
}

export const SEMANTICS_CROSS_REF: SliceCrossRefModule = {
  slice: 'semantics',
  checks: [checkSemanticTypeWitnessTargetResolves, checkAttributeKindClientMintedPairing],
};
