// Artifact-kind model-spec accessors over the artifact-kinds ABox
// (Lift 10 / #227).
//
// The artifact-kinds ABox declares an optional `modelKind` per kind
// (see `artifactKindsSchema.ts` and
// `configs/<config>/ontology/artifact-kinds.json`). `modelKind`
// discriminates which `GeneratedModelSpec` variant the planner should
// construct when binding an artifact to a chain. Conventional values
// today: `'bpmn'`, `'form'`. The discriminated-union shape of
// `GeneratedModelSpec` is itself the subject of Lift 13 (#199 / Source
// 6); until then, only the conventional values map to a model-spec
// entry — other values (a future second API's kinds) would surface as
// "no model spec" rather than crash.
//
// All accessors are pure and tolerant of `undefined`/missing ABoxes,
// matching the `operationRoles.ts` pattern.

import type { DomainSemantics } from '../types.js';

/**
 * Subset of `DomainSemantics` consumed by the model-kind accessors.
 * Accepting the narrow shape (instead of the full `DomainSemantics`)
 * lets callers supply a partially-derived view (e.g. directly from
 * `deriveArtifactKindsViews`) without fabricating unrelated top-level
 * fields.
 */
type ModelKindSource = Pick<DomainSemantics, 'artifactKinds' | 'semanticTypeToArtifactKind'>;

/**
 * Resolve the `modelKind` discriminator for a semantic type by walking
 * the ABox: `semantic → artifactKind → modelKind`. Returns `undefined`
 * when any link in the chain is missing (e.g. the semantic has no
 * mapping, or the kind has no `modelKind` declared).
 *
 * The two-step lookup is intentional: it keeps the planner from
 * re-deriving the semantic→kind table that already lives in the ABox
 * (`semanticTypeMap[]`), while letting per-kind `modelKind` declarations
 * stay close to the rest of the kind's metadata.
 */
export function getModelKindForSemantic(
  domain: ModelKindSource | undefined,
  semantic: string,
): string | undefined {
  const artifactKind = domain?.semanticTypeToArtifactKind?.[semantic];
  if (!artifactKind) return undefined;
  return domain?.artifactKinds?.[artifactKind]?.modelKind;
}
