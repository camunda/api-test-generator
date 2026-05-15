import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveRuntimeStatesViews,
  deriveSemanticsViews,
} from '../../path-analyser/src/ontology/loader.js';

interface OperationDomainRequirements {
  disjunctions?: string[][];
}
interface SemanticTypeSpec {
  witnesses?: string;
}
interface DomainSemantics {
  operationRequirements?: Record<string, OperationDomainRequirements>;
  semanticTypes?: Record<string, SemanticTypeSpec>;
  runtimeStates?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
}

function loadDomain(): DomainSemantics {
  const repoRoot = path.resolve(import.meta.dirname, '../..');
  const runtimeViews = deriveRuntimeStatesViews(repoRoot);
  const semanticsViews = deriveSemanticsViews(repoRoot);
  if (!runtimeViews) throw new Error('runtime-states ABox missing');
  if (!semanticsViews) throw new Error('semantics ABox missing');
  return {
    operationRequirements: runtimeViews.operationRequirements,
    runtimeStates: runtimeViews.runtimeStates,
    semanticTypes: semanticsViews.semanticTypes,
    capabilities: semanticsViews.capabilities,
  };
}

describe('domain ABox — disjunctions vs witnesses (#66)', () => {
  it('no disjunction group may contain both a semantic type X and the state semanticTypes[X].witnesses', () => {
    // After #70 introduced the witnesses relation, a disjunction of the
    // form ["ProcessDefinitionKey", "ProcessDefinitionDeployed"] is
    // redundant: every operation that produces ProcessDefinitionKey is
    // already a producer of ProcessDefinitionDeployed (via the witness
    // merge in graphLoader). The disjunction collapses to a plain
    // requirement on the witnessed state.
    //
    // Worse, the planner's domainDisjunctionsSatisfied only inspects
    // state.domainStates, which never contains semantic types — so the
    // X branch of such a disjunction is dead code. Catch this class
    // here so future bindings don't reintroduce the redundancy.
    const domain = loadDomain();
    const witnessOf = new Map<string, string>();
    for (const [semanticType, spec] of Object.entries(domain.semanticTypes ?? {})) {
      if (typeof spec.witnesses === 'string' && spec.witnesses.length > 0) {
        witnessOf.set(semanticType, spec.witnesses);
      }
    }

    const redundant: {
      operationId: string;
      group: string[];
      semanticType: string;
      witnessed: string;
    }[] = [];
    for (const [operationId, req] of Object.entries(domain.operationRequirements ?? {})) {
      for (const group of req.disjunctions ?? []) {
        for (const member of group) {
          const witnessed = witnessOf.get(member);
          if (witnessed && group.includes(witnessed)) {
            redundant.push({ operationId, group, semanticType: member, witnessed });
          }
        }
      }
    }

    expect(
      redundant,
      `disjunctions contain both a semantic type and its witnessed state — collapse to requires: [<witnessed>]: ${JSON.stringify(redundant, null, 2)}`,
    ).toEqual([]);
  });

  it('every disjunction member must resolve to a declared runtimeState or capability', () => {
    // After collapsing semantic-type/witnessed-state pairs, every remaining
    // disjunction member must be a real domain state — otherwise the planner
    // can never satisfy it (domainStates only ever contains state names).
    const domain = loadDomain();

    const declaredStates = new Set([
      ...Object.keys(domain.runtimeStates ?? {}),
      ...Object.keys(domain.capabilities ?? {}),
    ]);

    const dangling: { operationId: string; group: string[]; member: string }[] = [];
    for (const [operationId, req] of Object.entries(domain.operationRequirements ?? {})) {
      for (const group of req.disjunctions ?? []) {
        for (const member of group) {
          if (!declaredStates.has(member)) {
            dangling.push({ operationId, group, member });
          }
        }
      }
    }

    expect(
      dangling,
      `disjunctions reference non-state members the planner cannot satisfy: ${JSON.stringify(dangling, null, 2)}`,
    ).toEqual([]);
  });
});
