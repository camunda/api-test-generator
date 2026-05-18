import { z } from 'zod';
import { classifySemantic } from '../bindSemanticInput.js';
import type { DomainSemantics, OperationGraph } from '../types.js';
import { ARTIFACT_KINDS_CROSS_REF } from './crossRef/artifactKindsCrossRef.js';
import { EDGES_CROSS_REF } from './crossRef/edgeCrossRef.js';
import { ENTITY_KINDS_CROSS_REF } from './crossRef/entityKindsCrossRef.js';
import {
  checkGlobalContextSeedsCoherent,
  GLOBAL_CONTEXT_SEEDS_CROSS_REF,
} from './crossRef/globalContextSeedsCrossRef.js';
import { RUNTIME_STATES_CROSS_REF } from './crossRef/runtimeStatesCrossRef.js';
import { SCENARIO_TEMPLATE_CROSS_REF } from './crossRef/scenarioTemplateCrossRef.js';
import { SEMANTICS_CROSS_REF } from './crossRef/semanticsCrossRef.js';
import type { SliceCrossRefModule } from './crossRef/types.js';

// ---------------------------------------------------------------------------
// path-analyser/src/ontology/crossRefValidator.ts
//
// Composer for the per-slice cross-reference invariants that gate the
// synthesized merged-domain view (`DomainSemantics`).
//
// History: pre-Lift 15 / #255 this module hand-encoded the merged-overlay
// shape as zod schemas — a parallel encoding of the per-slice TBoxes
// (`runtimeStatesSchema.ts`, `semanticsSchema.ts`, `artifactKindsSchema.ts`,
// `globalContextSeedsSchema.ts`). Because the zod shapes used `passthrough`
// they did not actually validate — they only narrowed types — and they
// silently drifted whenever a slice TBox added a property. Lift 15 split
// the cross-reference checks into per-slice modules under
// `./crossRef/<slice>CrossRef.ts`, each registered in
// {@link CROSS_REF_MODULES}. A build-time L3 invariant in
// `configs/<config>/regression-invariants.test.ts` asserts every
// `*Schema.ts` slice has a matching cross-ref module — adding a new slice
// without considering cross-references now fails the build.
//
// Structural validation of each per-slice ABox happens in
// `./loader.ts` against the source-of-truth `*Schema.ts` TBoxes (ajv).
// By the time `validateDomainSemantics` is called from
// `graphLoader.ts` post-overlay re-validation, the merged-domain view
// is already structurally well-formed; this module's job is purely
// cross-reference invariants between sections.
//
// Each cross-reference issue is surfaced as a
// {@link DomainSemanticsValidationError} carrying a stable `invariant`
// code so test assertions and CI greps can target a specific class of
// violation regardless of which row triggered it.
// ---------------------------------------------------------------------------

/**
 * Registry of per-slice cross-reference modules. The composer iterates
 * this list and runs every check; the build-time guard L3 invariant
 * enumerates `path-analyser/src/ontology/*Schema.ts` and asserts every
 * slice has an entry here (a module with `checks: []` and an explicit
 * `noChecksRationale` is the way to declare "no cross-refs needed").
 *
 * Ordering is insertion order → issue order, kept stable so test
 * snapshots and CI logs are reproducible across runs.
 */
export const CROSS_REF_MODULES: readonly SliceCrossRefModule[] = [
  EDGES_CROSS_REF,
  ENTITY_KINDS_CROSS_REF,
  ARTIFACT_KINDS_CROSS_REF,
  RUNTIME_STATES_CROSS_REF,
  SEMANTICS_CROSS_REF,
  GLOBAL_CONTEXT_SEEDS_CROSS_REF,
  SCENARIO_TEMPLATE_CROSS_REF,
];

// Public-boundary structural validator for `globalContextSeeds`. Kept
// in this module (not the per-slice cross-ref module) because it is
// also consumed by {@link assertSafeGlobalContextSeeds} below — the
// public entry point for the Playwright emitter. Strict: mirrors
// `additionalProperties: false` in `globalContextSeedsSchema.ts` so
// runtime validation matches the published JSON Schema. Unknown keys
// are almost always a typo and silently dropping them would mask the
// typo until the emitted suite misbehaved.
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

export interface DomainSemanticsValidationError {
  invariant: string;
  message: string;
}

/**
 * Run every registered cross-reference invariant against `raw`. Returns
 * the empty array on success; otherwise returns one entry per offending
 * row — multiple instances of the same invariant produce multiple
 * entries each carrying the same `invariant` code and a distinct
 * `message` identifying the property.
 *
 * `raw` is accepted as `unknown` so callers do not have to assert
 * `DomainSemantics` at the call site, but in production it is always
 * the loader-synthesized merged-domain view (already structurally
 * validated by ajv against the per-slice TBoxes during ABox load).
 * The only structural rejection done here is "is it an object" — if
 * `raw` is `null`, an array, or a primitive, every cross-ref check
 * would defensively no-op and the caller would silently get an empty
 * result; the early rejection makes mis-use surface explicitly.
 */
export function validateDomainSemantics(raw: unknown): DomainSemanticsValidationError[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [
      {
        invariant: 'shape',
        message: `validateDomainSemantics expected an object describing the merged DomainSemantics view; received ${
          raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw
        }.`,
      },
    ];
  }
  // The merged-domain view is structurally well-formed by construction —
  // the loader builds it from per-slice ABoxes that have already been
  // ajv-validated against their `*Schema.ts` TBoxes. Cross-ref checks
  // tolerate any subset of sub-trees being absent (every `Object.entries(
  // d.X ?? {})` access is defensive).
  // biome-ignore lint/plugin: caller boundary; downstream check fns are defensive on every field access
  const domain = raw as DomainSemantics;
  const issues: DomainSemanticsValidationError[] = [];
  for (const module_ of CROSS_REF_MODULES) {
    for (const check of module_.checks) {
      for (const issue of check(domain)) {
        issues.push({ invariant: issue.code, message: issue.message });
      }
    }
  }
  return issues;
}

/**
 * Boundary-level safety assertion for `globalContextSeeds`.
 *
 * The Playwright emitter interpolates `binding`, `fieldName`, `seedRule`,
 * and `defaultSentinel` directly into emitted TS source as identifiers and
 * single-quoted string literals (#87). The loader validates the seeds when
 * reading the ontology-derived graph domain, but the public emitter entry points
 * (`renderPlaywrightSuite`, `emitPlaywrightSuite`, `PlaywrightEmitter.emit`)
 * accept a `globalContextSeeds` argument from any caller. This helper
 * re-validates at that boundary so a programmatic caller cannot bypass
 * the loader's safety net and produce broken or injection-vulnerable
 * generated suites.
 *
 * Throws on any structural issue ({@link GlobalContextSeedSchema}'s
 * `.strict()` schema) or any cross-seed coherence violation
 * (uniqueness, identifier safety, sentinel char safety,
 * strip-requires-sentinel). Returns silently on success.
 *
 * The validation is intentionally redundant with `validateDomainSemantics`
 * — both surfaces use the same {@link GlobalContextSeedSchema} and the
 * same {@link checkGlobalContextSeedsCoherent} so they cannot drift.
 */
export function assertSafeGlobalContextSeeds(seeds: unknown): void {
  if (!Array.isArray(seeds)) {
    throw new TypeError(
      `globalContextSeeds must be an array when provided (received ${seeds === null ? 'null' : typeof seeds}).`,
    );
  }
  const arrayResult = z.array(GlobalContextSeedSchema).safeParse(seeds);
  if (!arrayResult.success) {
    const formatted = arrayResult.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`globalContextSeeds failed structural validation:\n${formatted}`);
  }
  // biome-ignore lint/plugin: zod-validated entries narrow safely to the DomainSemantics shape
  const issues = checkGlobalContextSeedsCoherent({
    globalContextSeeds: arrayResult.data,
  } as DomainSemantics);
  if (issues.length > 0) {
    const formatted = issues.map((i) => `  - [${i.code}] ${i.message}`).join('\n');
    throw new Error(`globalContextSeeds failed coherence validation:\n${formatted}`);
  }
}

/**
 * Validate cross-references between `domain.runtimeStates[*].witness` and
 * the loaded operation graph (#159 PR B review).
 *
 * The structural validator (`validateDomainSemantics`) can only see the
 * domain-semantics sidecar in isolation — it has no visibility into the
 * operation graph, so a witness `operationId` that doesn't resolve to a
 * real operation slips through it. Pre-this-check the planner silently
 * skipped unknown witnesses; the user got back an emitted suite missing
 * the wait it expected, and the racing-broker symptom returned.
 *
 * Two invariants:
 *   1. `witnessOperationResolves` — every eventual state's `witness.operationId`
 *      must resolve to a real entry in `graph.operations`.
 *   2. `witnessOperationIsGet` — PR B only supports GET-shape witnesses
 *      (the emitter renders `request.get(...)` and `awaitEventually`'s
 *      retry semantics assume a read). Non-GET witnesses are rejected
 *      now so the gap is visible at load time rather than as an emitted
 *      suite that calls `request.post(...)` against a witness URL with
 *      no body.
 *
 * Returns the empty array on success. Designed to be called after
 * `loadGraph` has assembled `graph.operations` and `graph.domain`.
 */
export function validateRuntimeStateWitnessGraphRefs(
  graph: OperationGraph,
): DomainSemanticsValidationError[] {
  const issues: DomainSemanticsValidationError[] = [];
  const states = graph.domain?.runtimeStates;
  if (!states) return issues;
  for (const [stateName, spec] of Object.entries(states)) {
    if (spec.eventual !== true || !spec.witness) continue;
    const witnessOp = graph.operations[spec.witness.operationId];
    if (!witnessOp) {
      issues.push({
        invariant: 'witnessOperationResolves',
        message: `runtimeStates.${stateName}.witness.operationId references "${spec.witness.operationId}", which does not resolve to a known operation in the bundled spec.`,
      });
      continue;
    }
    const method = witnessOp.method?.toUpperCase?.() ?? '';
    if (method !== 'GET') {
      issues.push({
        invariant: 'witnessOperationIsGet',
        message: `runtimeStates.${stateName}.witness.operationId "${spec.witness.operationId}" is ${method || 'an unknown method'}; PR B (#159) supports GET-shape witnesses only.`,
      });
    }
  }
  return issues;
}

/**
 * Validate that every semantic referenced by any operation's
 * `requestBodySemanticTypes` resolves to a non-`'unclassified'`
 * classification (#162 PR 5).
 *
 * The five terminal classifications are defined in
 * `bindSemanticInput.ts#classifySemantic`:
 *
 *   - `modelDerived`            (domain-semantics: kind: 'modelDerived')
 *   - `clientMintedAttribute`   (domain-semantics: kind: 'attribute' + clientMinted)
 *   - `serverEmergent`          (domain-semantics: kind: 'serverEmergent')
 *   - `producerBound`           (graph.producersByType[T])
 *   - `clientMintedIdentifier`  (graph.establishersByType[T])
 *   - `externalBoundary`        (graph.externalEntityIdentifiers)
 *
 * If a semantic falls through every tier, the planner has no rule for
 * what value to bind into the request body. Pre-PR 5 this surfaced as
 * a placeholder string in the emitted suite with no record of the gap;
 * PR 5 turns it into a fail-fast at graph load so a future spec change
 * that introduces a new semantic without an accompanying classification
 * is caught immediately.
 *
 * The check is class-scoped: every (operationId, semantic) pair across
 * the full graph is collected before throwing, so one load failure
 * surfaces every gap rather than peeling them off one at a time.
 *
 * Returns the empty array on success.
 */
export function validateRequestBodySemanticsClassified(
  graph: OperationGraph,
): DomainSemanticsValidationError[] {
  const issues: DomainSemanticsValidationError[] = [];
  // Group offending sites by semantic so the error message stays
  // readable when a missing classification fans out to many fields
  // (e.g. AuditLogEntityKey appears at 10 sites in the live spec).
  const offendersBySemantic = new Map<string, string[]>();
  for (const op of Object.values(graph.operations)) {
    for (const entry of op.requestBodySemantics ?? []) {
      const classification = classifySemantic(entry.semantic, graph);
      if (classification !== 'unclassified') continue;
      const sites = offendersBySemantic.get(entry.semantic) ?? [];
      sites.push(`${op.operationId}.${entry.fieldPath}`);
      offendersBySemantic.set(entry.semantic, sites);
    }
  }
  for (const [semantic, sites] of offendersBySemantic) {
    issues.push({
      invariant: 'requestBodySemanticUnclassified',
      message: `semantic type "${semantic}" referenced by ${sites.length} requestBodySemanticTypes site(s) is unclassified — declare a semantics ABox entry (e.g. kind: 'serverEmergent' for server-minted lifecycle keys, kind: 'attribute' + clientMinted: true for client-supplied filter values), wire a producer/establisher in the spec, or add it to the kindRegistry as an external-entity identifier. Sites: ${sites.join(', ')}`,
    });
  }
  return issues;
}
