import { z } from 'zod';

// ---------------------------------------------------------------------------
// path-analyser/src/domainSemanticsValidator.ts
//
// Load-time validator for path-analyser/domain-semantics.json.
//
// The shape of `DomainSemantics` (in types.ts) describes *what* fields exist;
// this module describes *which combinations of values are coherent* — the
// cross-reference invariants between sections. Each invariant in the schema
// is named (via `.refine(..., { params: { code } })`) so failures point
// directly at the broken property rather than at a structural diff.
//
// Invariants encoded (all class-scoped — they reject the defect class, not
// just one instance):
//
//   1. artifactKindStateDeclared — every state in artifactKinds.*.producesStates
//      is declared in runtimeStates ∪ capabilities.
//   2. artifactKindWitnessDeclared — every key-shaped semantic type
//      (artifactKinds.*.producesSemantics) declares a semanticTypes[T].witnesses
//      edge.
//   3. semanticTypeWitnessTargetResolves — every semanticTypes[T].witnesses
//      target resolves to runtimeStates ∪ capabilities.
//   4. semanticBindingTargetResolves — every valueBindings RHS of the form
//      `semantic:X` references a declared semanticTypes entry.
//   5. disjunctionNotWitnessRedundant — no disjunction group contains both a
//      semantic type X and the state semanticTypes[X].witnesses.
//   6. disjunctionMemberResolves — every disjunction member resolves to
//      runtimeStates ∪ capabilities.
//
// The corresponding tests in tests/regression/ remain in place as
// human-readable, hand-curated regression statements; this module promotes
// them into a load-time gate inside graphLoader.
// ---------------------------------------------------------------------------

const SemanticTypeSpecSchema = z
  .object({
    witnesses: z.string().min(1).optional(),
  })
  .passthrough();

const ArtifactKindSpecSchema = z
  .object({
    producesStates: z.array(z.string()).optional(),
    producesSemantics: z.array(z.string()).optional(),
  })
  .passthrough();

const OperationDomainRequirementsSchema = z
  .object({
    requires: z.array(z.string()).optional(),
    disjunctions: z.array(z.array(z.string())).optional(),
    implicitAdds: z.array(z.string()).optional(),
    produces: z.array(z.string()).optional(),
    valueBindings: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

// Top-level shape — `passthrough` so unrelated fields (operationArtifactRules,
// artifactFileKinds, semanticTypeToArtifactKind, identifiers, version, $schema)
// flow through unmodified.
const DomainSemanticsShape = z
  .object({
    runtimeStates: z.record(z.string(), z.unknown()).optional(),
    capabilities: z.record(z.string(), z.unknown()).optional(),
    semanticTypes: z.record(z.string(), SemanticTypeSpecSchema).optional(),
    artifactKinds: z.record(z.string(), ArtifactKindSpecSchema).optional(),
    operationRequirements: z.record(z.string(), OperationDomainRequirementsSchema).optional(),
  })
  .passthrough();

type DomainSemanticsShape = z.infer<typeof DomainSemanticsShape>;

interface CrossRefIssue {
  code: string;
  message: string;
}

// Helpers ---------------------------------------------------------------

function declaredStates(d: DomainSemanticsShape): Set<string> {
  return new Set([...Object.keys(d.runtimeStates ?? {}), ...Object.keys(d.capabilities ?? {})]);
}

function witnessOf(d: DomainSemanticsShape): Map<string, string> {
  const m = new Map<string, string>();
  for (const [type, spec] of Object.entries(d.semanticTypes ?? {})) {
    if (typeof spec.witnesses === 'string' && spec.witnesses.length > 0) {
      m.set(type, spec.witnesses);
    }
  }
  return m;
}

// Cross-reference invariants -------------------------------------------

function checkArtifactKindStateDeclared(d: DomainSemanticsShape): CrossRefIssue[] {
  const declared = declaredStates(d);
  const issues: CrossRefIssue[] = [];
  for (const [kind, spec] of Object.entries(d.artifactKinds ?? {})) {
    for (const state of spec.producesStates ?? []) {
      if (!declared.has(state)) {
        issues.push({
          code: 'artifactKindStateDeclared',
          message: `artifactKinds.${kind}.producesStates references "${state}", which is not declared in runtimeStates or capabilities`,
        });
      }
    }
  }
  return issues;
}

function checkArtifactKindWitnessDeclared(d: DomainSemanticsShape): CrossRefIssue[] {
  const declared = d.semanticTypes ?? {};
  const issues: CrossRefIssue[] = [];
  for (const [kind, spec] of Object.entries(d.artifactKinds ?? {})) {
    for (const type of spec.producesSemantics ?? []) {
      const entry = declared[type];
      if (!entry || typeof entry.witnesses !== 'string' || entry.witnesses.length === 0) {
        issues.push({
          code: 'artifactKindWitnessDeclared',
          message: `artifactKinds.${kind}.producesSemantics references "${type}", which has no semanticTypes.${type}.witnesses declaration`,
        });
      }
    }
  }
  return issues;
}

function checkSemanticTypeWitnessTargetResolves(d: DomainSemanticsShape): CrossRefIssue[] {
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

function checkSemanticBindingTargetResolves(d: DomainSemanticsShape): CrossRefIssue[] {
  const declared = new Set(Object.keys(d.semanticTypes ?? {}));
  const issues: CrossRefIssue[] = [];
  for (const [op, req] of Object.entries(d.operationRequirements ?? {})) {
    for (const [field, rhs] of Object.entries(req.valueBindings ?? {})) {
      if (!rhs.startsWith('semantic:')) continue;
      const ref = rhs.slice('semantic:'.length);
      if (!declared.has(ref)) {
        issues.push({
          code: 'semanticBindingTargetResolves',
          message: `operationRequirements.${op}.valueBindings["${field}"] references semantic type "${ref}", which is not declared in semanticTypes`,
        });
      }
    }
  }
  return issues;
}

function checkDisjunctionNotWitnessRedundant(d: DomainSemanticsShape): CrossRefIssue[] {
  const witness = witnessOf(d);
  const issues: CrossRefIssue[] = [];
  for (const [op, req] of Object.entries(d.operationRequirements ?? {})) {
    for (const group of req.disjunctions ?? []) {
      for (const member of group) {
        const w = witness.get(member);
        if (w && group.includes(w)) {
          issues.push({
            code: 'disjunctionNotWitnessRedundant',
            message: `operationRequirements.${op}.disjunctions contains both semantic type "${member}" and its witnessed state "${w}" — collapse to requires: ["${w}"]`,
          });
        }
      }
    }
  }
  return issues;
}

function checkDisjunctionMemberResolves(d: DomainSemanticsShape): CrossRefIssue[] {
  const declared = declaredStates(d);
  const issues: CrossRefIssue[] = [];
  for (const [op, req] of Object.entries(d.operationRequirements ?? {})) {
    for (const group of req.disjunctions ?? []) {
      for (const member of group) {
        if (!declared.has(member)) {
          issues.push({
            code: 'disjunctionMemberResolves',
            message: `operationRequirements.${op}.disjunctions references "${member}", which is not declared in runtimeStates or capabilities`,
          });
        }
      }
    }
  }
  return issues;
}

const CROSS_REF_CHECKS = [
  checkArtifactKindStateDeclared,
  checkArtifactKindWitnessDeclared,
  checkSemanticTypeWitnessTargetResolves,
  checkSemanticBindingTargetResolves,
  checkDisjunctionNotWitnessRedundant,
  checkDisjunctionMemberResolves,
] as const;

// Composed schema: structural shape + every cross-reference invariant.
export const DomainSemanticsSchema = DomainSemanticsShape.superRefine((d, ctx) => {
  for (const check of CROSS_REF_CHECKS) {
    for (const issue of check(d)) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        params: { invariant: issue.code },
      });
    }
  }
});

export interface DomainSemanticsValidationError {
  invariant: string;
  message: string;
}

/**
 * Run all structural and cross-reference checks against `raw`. Returns the
 * empty array on success; otherwise returns one entry per violated invariant.
 *
 * The graphLoader calls this immediately after JSON.parse and throws if any
 * issues are returned. Tests can call it directly against synthetic
 * minimal-domain objects to verify each invariant in isolation.
 */
export function validateDomainSemantics(raw: unknown): DomainSemanticsValidationError[] {
  const result = DomainSemanticsSchema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const params = issue.code === 'custom' ? issue.params : undefined;
    const invariantRaw =
      params && typeof params === 'object' ? Reflect.get(params, 'invariant') : undefined;
    const invariant = typeof invariantRaw === 'string' ? invariantRaw : 'shape';
    return { invariant, message: issue.message };
  });
}
