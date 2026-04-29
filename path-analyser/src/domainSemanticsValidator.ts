import { z } from 'zod';

// ---------------------------------------------------------------------------
// path-analyser/src/domainSemanticsValidator.ts
//
// Load-time validator for path-analyser/domain-semantics.json.
//
// The shape of `DomainSemantics` (in types.ts) describes *what* fields exist;
// this module describes *which combinations of values are coherent* — the
// cross-reference invariants between sections. Each invariant is reported
// from `superRefine` via `ctx.addIssue(..., { params: { invariant } })` so
// failures point directly at the broken property rather than at a structural diff.
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

// Strict: mirrors `additionalProperties: false` in domain-semantics.schema.json
// so runtime validation matches the published JSON Schema. Unknown keys are
// almost always a typo (e.g. `seedRules` for `seedRule`) and silently
// dropping them would mask the typo until the emitted suite misbehaves.
export const GlobalContextSeedSchema = z
  .object({
    binding: z.string().min(1),
    fieldName: z.string().min(1),
    seedRule: z.string().min(1),
    defaultSentinel: z.string().optional(),
    stripFromMultipartWhenDefault: z.boolean().optional(),
    rationale: z.string().optional(),
  })
  .strict();

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
    globalContextSeeds: z.array(GlobalContextSeedSchema).optional(),
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
function checkGlobalContextSeedsCoherent(d: DomainSemanticsShape): CrossRefIssue[] {
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

const CROSS_REF_CHECKS = [
  checkArtifactKindStateDeclared,
  checkArtifactKindWitnessDeclared,
  checkSemanticTypeWitnessTargetResolves,
  checkSemanticBindingTargetResolves,
  checkDisjunctionNotWitnessRedundant,
  checkDisjunctionMemberResolves,
  checkGlobalContextSeedsCoherent,
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
 * empty array on success; otherwise returns one entry per Zod issue — a
 * single invariant can produce multiple entries when several instances
 * violate it (each entry carries the same `invariant` name but a distinct
 * `message` identifying the offending property).
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

/**
 * Boundary-level safety assertion for `globalContextSeeds`.
 *
 * The Playwright emitter interpolates `binding`, `fieldName`, `seedRule`,
 * and `defaultSentinel` directly into emitted TS source as identifiers and
 * single-quoted string literals (#87). The loader validates the seeds when
 * reading `domain-semantics.json`, but the public emitter entry points
 * (`renderPlaywrightSuite`, `emitPlaywrightSuite`, `PlaywrightEmitter.emit`)
 * accept a `globalContextSeeds` argument from any caller. This helper
 * re-validates at that boundary so a programmatic caller cannot bypass
 * the loader's safety net and produce broken or injection-vulnerable
 * generated suites.
 *
 * Throws on any structural issue (Zod `.strict()` schema) or any
 * cross-seed coherence violation (uniqueness, identifier safety, sentinel
 * char safety, strip-requires-sentinel). Returns silently on success.
 *
 * The validation is intentionally redundant with `validateDomainSemantics`
 * — both surfaces use the same `GlobalContextSeedSchema` and
 * `checkGlobalContextSeedsCoherent` so they cannot drift.
 */
export function assertSafeGlobalContextSeeds(seeds: readonly unknown[]): void {
  const arrayResult = z.array(GlobalContextSeedSchema).safeParse(seeds);
  if (!arrayResult.success) {
    const formatted = arrayResult.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`globalContextSeeds failed structural validation:\n${formatted}`);
  }
  const issues = checkGlobalContextSeedsCoherent({ globalContextSeeds: arrayResult.data });
  if (issues.length > 0) {
    const formatted = issues.map((i) => `  - [${i.code}] ${i.message}`).join('\n');
    throw new Error(`globalContextSeeds failed coherence validation:\n${formatted}`);
  }
}
