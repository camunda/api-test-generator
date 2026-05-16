import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv, type ErrorObject } from 'ajv';
import type { FromSchema } from 'json-schema-to-ts';
import { getActiveConfigDir } from '../configResolver.js';
import { artifactKindsSchema } from './artifactKindsSchema.js';
import { edgeSchema } from './edgeSchema.js';
import { entityKindsSchema } from './entityKindsSchema.js';
import { globalContextSeedsSchema } from './globalContextSeedsSchema.js';
import { runtimeStatesSchema } from './runtimeStatesSchema.js';
import { semanticsSchema } from './semanticsSchema.js';

// ---------------------------------------------------------------------------
// path-analyser/src/ontology/loader.ts
//
// Generic loader for per-config ABox files that ship under
// `configs/<active>/ontology/`. Layout is described by the TBox sources
// under `ontology/vocabulary/` at the repo root.
//
// True single source of truth: the TBox is authored as a TS const
// (`edgeSchema.ts`) and consumed here both at runtime (ajv) and at
// type-time (`FromSchema<typeof edgeSchema>`). The matching
// `edge.schema.json` is generated from the same TS const by
// `scripts/build-ontology.ts` for external SPARQL/SHACL/OWL consumers,
// and a regression invariant guards against the JSON drifting from the
// TS source.
//
// JSON-LD context keys (`@context`, `@type`) are accepted and preserved
// on the parsed value but the loader does not interpret them — they
// exist so an external RDF consumer can ingest the ABox unchanged. No
// runtime in this repo reasons over JSON-LD.
//
// Cross-references against the bundled spec (operationIds existing,
// endpoint kind names existing in semantic-kinds.json, identifier types
// matching) are NOT enforced here; they live as L3 invariants in
// `configs/<name>/regression-invariants.test.ts` so a failure points
// directly at the broken row instead of a generic schema error.
// ---------------------------------------------------------------------------

export type EdgesAbox = FromSchema<typeof edgeSchema>;
export type Edge = EdgesAbox['edges'][number];

export type EntityKindsAbox = FromSchema<typeof entityKindsSchema>;
export type EntityKind = EntityKindsAbox['kinds'][number];

export type ArtifactKindsAbox = FromSchema<typeof artifactKindsSchema>;
export type ArtifactKindEntry = ArtifactKindsAbox['kinds'][number];
export type ArtifactSemanticTypeMapping = ArtifactKindsAbox['semanticTypeMap'][number];
export type ArtifactOperationRule = ArtifactKindsAbox['operationRules'][number];
export type ArtifactFileExtensionMapping = ArtifactKindsAbox['fileExtensionMap'][number];

export type RuntimeStatesAbox = FromSchema<typeof runtimeStatesSchema>;
export type RuntimeStateEntry = RuntimeStatesAbox['states'][number];
export type OperationRequirementEntry = RuntimeStatesAbox['operationRequirements'][number];

export type SemanticsAbox = FromSchema<typeof semanticsSchema>;
export type SemanticTypeEntry = SemanticsAbox['semanticTypes'][number];
export type CapabilityEntry = NonNullable<SemanticsAbox['capabilities']>[number];
export type IdentifierEntry = NonNullable<SemanticsAbox['identifiers']>[number];

export type GlobalContextSeedsAbox = FromSchema<typeof globalContextSeedsSchema>;
export type GlobalContextSeedEntry = GlobalContextSeedsAbox['seeds'][number];

// `Ajv` is the named export pointing at the constructor; the namespace
// also has a self-referential default but the named export is the
// least error-prone form under module=nodenext.
const ajv = new Ajv({ allErrors: true, strict: false });
const validateEdgesAbox = ajv.compile<EdgesAbox>(edgeSchema);
const validateEntityKindsAbox = ajv.compile<EntityKindsAbox>(entityKindsSchema);
const validateArtifactKindsAbox = ajv.compile<ArtifactKindsAbox>(artifactKindsSchema);
const validateRuntimeStatesAbox = ajv.compile<RuntimeStatesAbox>(runtimeStatesSchema);
const validateSemanticsAbox = ajv.compile<SemanticsAbox>(semanticsSchema);
const validateGlobalContextSeedsAbox =
  ajv.compile<GlobalContextSeedsAbox>(globalContextSeedsSchema);

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((e) => `  - ${e.instancePath || '<root>'}: ${e.message ?? '(no message)'}`)
    .join('\n');
}

/**
 * Load and validate the edges ABox file for the active config.
 *
 * @param repoRoot Absolute path to the api-test-generator repository root.
 * @returns The parsed ABox, or `null` if the file does not exist (configs
 *   are not required to ship an edges ABox; a missing file is a no-op).
 * @throws if the file exists but does not validate against the TBox.
 */
export function loadEdgesAbox(repoRoot: string): EdgesAbox | null {
  // The active-config resolver depends on a `configs.json` index at the
  // repo root. Tests that exercise loadGraph against an isolated
  // tmpDir don't ship one, and the right fallback there is "no ABox"
  // (the test will then exercise the legacy spec-annotation path).
  // Treat any resolver failure as "no ABox available" — symmetrical to
  // the ENOENT-on-edges.json case below.
  let aboxPath: string;
  try {
    aboxPath = path.join(getActiveConfigDir(repoRoot), 'ontology', 'edges.json');
  } catch {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(aboxPath, 'utf8');
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse edges ABox at ${aboxPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!validateEdgesAbox(parsed)) {
    throw new Error(
      `Edges ABox at ${aboxPath} failed TBox validation:\n${formatErrors(validateEdgesAbox.errors)}`,
    );
  }
  // ajv's user-defined type guard has narrowed `parsed` to EdgesAbox.
  // Reject duplicate `name` values up front — Draft-07 cannot express
  // uniqueness, but a duplicate edge name would silently shadow facts
  // at query time.
  const names = new Map<string, number>();
  for (const e of parsed.edges) {
    names.set(e.name, (names.get(e.name) ?? 0) + 1);
  }
  const dupes = [...names.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  if (dupes.length > 0) {
    throw new Error(`Edges ABox at ${aboxPath} has duplicate edge name(s): ${dupes.join(', ')}`);
  }
  return parsed;
}

/**
 * Derive the set of operationIds that establish an edge, sourced from
 * the edges ABox for the active config.
 *
 * Lift 3 / #208: the ABox is the authoritative source for "is this op
 * an edge establisher" — a domain claim with no wire signature, per
 * the principle in #198. Per-op `x-semantic-establishes: { shape:
 * "edge" }` annotations in the upstream spec are no longer
 * authoritative at runtime; the planner derives `op.establishes.shape`
 * from the result of this function instead.
 *
 * @returns A Set of opIds, or `null` if no edges ABox exists for the
 *   active config (in which case the caller falls back to the spec
 *   annotation's `shape` field for backward compatibility).
 */
export function loadEdgeEstablishers(repoRoot: string): Set<string> | null {
  const abox = loadEdgesAbox(repoRoot);
  if (abox === null) return null;
  const set = new Set<string>();
  for (const e of abox.edges) {
    set.add(e.establishedBy);
  }
  return set;
}

/**
 * Load and validate the entity-kinds ABox file for the active config.
 *
 * Lift 4 / #210: the entity-kinds ABox is the authoritative runtime
 * source for the inventory of entity kinds (the domain nouns) and
 * their classifier (`entity` vs `external-entity`) per the principle
 * landed in #198. The upstream spec's `kindRegistry` payload (built
 * from `x-semantic-kind` annotations) becomes a transitional fallback
 * for unmigrated configs; once the ABox is shipped it is consulted
 * exclusively.
 *
 * @param repoRoot Absolute path to the api-test-generator repository root.
 * @returns The parsed ABox, or `null` if the file does not exist (configs
 *   are not required to ship one; a missing file leaves the legacy
 *   spec-driven `kindRegistry` path active).
 * @throws if the file exists but does not validate against the TBox, or
 *   if it contains duplicate `name` values.
 */
export function loadEntityKindsAbox(repoRoot: string): EntityKindsAbox | null {
  // Symmetric with `loadEdgesAbox` — tests that exercise loadGraph
  // against an isolated tmpDir don't ship a `configs.json`, and the
  // right fallback there is "no ABox available" so the test exercises
  // the legacy spec-driven path.
  let aboxPath: string;
  try {
    aboxPath = path.join(getActiveConfigDir(repoRoot), 'ontology', 'entity-kinds.json');
  } catch {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(aboxPath, 'utf8');
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse entity-kinds ABox at ${aboxPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!validateEntityKindsAbox(parsed)) {
    throw new Error(
      `Entity-kinds ABox at ${aboxPath} failed TBox validation:\n${formatErrors(validateEntityKindsAbox.errors)}`,
    );
  }
  // Reject duplicate `name` values up front — Draft-07 cannot express
  // uniqueness, but a duplicate kind name would silently shadow facts
  // at query time.
  const names = new Map<string, number>();
  for (const k of parsed.kinds) {
    names.set(k.name, (names.get(k.name) ?? 0) + 1);
  }
  const dupes = [...names.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  if (dupes.length > 0) {
    throw new Error(
      `Entity-kinds ABox at ${aboxPath} has duplicate kind name(s): ${dupes.join(', ')}`,
    );
  }
  return parsed;
}

/**
 * Derive the set of semantic identifier-type names that are minted
 * outside the API (`shape: 'external-entity'` kinds), sourced from the
 * entity-kinds ABox.
 *
 * The planner consults this set in two places:
 *   - `bindSemanticInput.ts` classifies these types as `'externalBoundary'`.
 *   - `scenarioGenerator.ts` short-circuits the upstream-producer
 *     search for them.
 *
 * @returns A Set of identifier-type names, or `null` if no entity-kinds
 *   ABox exists for the active config (in which case the caller falls
 *   back to the spec-emitted `kindRegistry` for backward compatibility).
 */
export function loadExternalEntityIdentifiers(repoRoot: string): Set<string> | null {
  const abox = loadEntityKindsAbox(repoRoot);
  if (abox === null) return null;
  const set = new Set<string>();
  for (const k of abox.kinds) {
    if (k.shape === 'external-entity') {
      for (const id of k.identifiers) {
        set.add(id);
      }
    }
  }
  return set;
}

/**
 * Load and validate the artifact-kinds ABox file for the active config.
 *
 * Lift 5 / #212: the artifact-kinds ABox is the authoritative runtime
 * source for the four artifact-related sub-trees (`artifactKinds`,
 * `semanticTypeToArtifactKind`, `operationArtifactRules`,
 * `artifactFileKinds`). Per the principle landed in #198: artifact
 * dispatch is domain knowledge with no wire signature, so it belongs
 * in the per-config ontology rather than scattered across spec
 * annotations or freeform sidecars.
 *
 * Unlike the edges and entity-kinds ABoxes, the data here was never
 * sourced from upstream OpenAPI annotations — there is no
 * `spec-vs-abox` (sense-1) drift to detect, only the durable
 * `abox-vs-graph` (sense-2) cross-references which are enforced by
 * `detectArtifactKindsDrift` in `graphLoader.ts`.
 *
 * @param repoRoot Absolute path to the api-test-generator repository root.
 * @returns The parsed ABox, or `null` if the file does not exist.
 * @throws if the file exists but does not validate against the TBox, or
 *   if it contains duplicate kind / operationId / extension / semanticType
 *   keys.
 */
export function loadArtifactKindsAbox(repoRoot: string): ArtifactKindsAbox | null {
  // Symmetric with `loadEdgesAbox` / `loadEntityKindsAbox` — tests that
  // exercise loadGraph against an isolated tmpDir may not ship a
  // `configs.json`, and the right fallback there is "no ABox available".
  let aboxPath: string;
  try {
    aboxPath = path.join(getActiveConfigDir(repoRoot), 'ontology', 'artifact-kinds.json');
  } catch {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(aboxPath, 'utf8');
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse artifact-kinds ABox at ${aboxPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!validateArtifactKindsAbox(parsed)) {
    throw new Error(
      `Artifact-kinds ABox at ${aboxPath} failed TBox validation:\n${formatErrors(validateArtifactKindsAbox.errors)}`,
    );
  }
  // Reject duplicate keys up front — Draft-07 cannot express
  // uniqueness, but a duplicate would silently shadow facts at query
  // time. Same defensive check as in the other ABox loaders.
  const dupeKinds = duplicates(parsed.kinds.map((k) => k.name));
  if (dupeKinds.length > 0) {
    throw new Error(
      `Artifact-kinds ABox at ${aboxPath} has duplicate kind name(s): ${dupeKinds.join(', ')}`,
    );
  }
  const dupeSemantics = duplicates(parsed.semanticTypeMap.map((m) => m.semanticType));
  if (dupeSemantics.length > 0) {
    throw new Error(
      `Artifact-kinds ABox at ${aboxPath} has duplicate semanticTypeMap entries for: ${dupeSemantics.join(', ')}`,
    );
  }
  const dupeOps = duplicates(parsed.operationRules.map((r) => r.operationId));
  if (dupeOps.length > 0) {
    throw new Error(
      `Artifact-kinds ABox at ${aboxPath} has duplicate operationRules entries for: ${dupeOps.join(', ')}`,
    );
  }
  // Per-operation rule-id uniqueness — `id` is optional but when
  // present it is used by the emitter to look up the chosen rule via
  // `find(...)`, so a duplicate would silently mask one of the rules.
  // Skip undefined ids (legacy rules need not name themselves).
  for (const rule of parsed.operationRules) {
    if (!rule.rules) continue;
    const ids = rule.rules.map((r) => r.id).filter((id): id is string => typeof id === 'string');
    const dupeRuleIds = duplicates(ids);
    if (dupeRuleIds.length > 0) {
      throw new Error(
        `Artifact-kinds ABox at ${aboxPath} operationRules['${rule.operationId}'] has duplicate rule id(s): ${dupeRuleIds.join(', ')}`,
      );
    }
  }
  const dupeExts = duplicates(parsed.fileExtensionMap.map((m) => m.extension));
  if (dupeExts.length > 0) {
    throw new Error(
      `Artifact-kinds ABox at ${aboxPath} has duplicate fileExtensionMap entries for: ${dupeExts.join(', ')}`,
    );
  }
  return parsed;
}

function duplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([v]) => v);
}

/**
 * Derive the four record-shaped views of the artifact-kinds ABox that
 * `graph.domain.*` consumers (planner, codegen, feature-coverage)
 * expect.
 */
export interface ArtifactKindsViews {
  artifactKinds: Record<
    string,
    {
      producesStates?: string[];
      producibleStates?: string[];
      producesSemantics?: string[];
      identifierType?: string;
      deploymentSlices?: string[];
    }
  >;
  semanticTypeToArtifactKind: Record<string, string>;
  operationArtifactRules: Record<
    string,
    {
      composable?: boolean;
      role?: string;
      rules?: {
        id?: string;
        artifactKind: string;
        priority?: number;
        producesSemantics?: string[];
        producesStates?: string[];
      }[];
    }
  >;
  artifactFileKinds: Record<string, string[]>;
}

export function deriveArtifactKindsViews(repoRoot: string): ArtifactKindsViews | null {
  const abox = loadArtifactKindsAbox(repoRoot);
  if (abox === null) return null;
  const artifactKinds: ArtifactKindsViews['artifactKinds'] = {};
  for (const k of abox.kinds) {
    const entry: ArtifactKindsViews['artifactKinds'][string] = {
      producesStates: k.producesStates,
      producesSemantics: k.producesSemantics,
      identifierType: k.identifierType,
      deploymentSlices: k.deploymentSlices,
    };
    if (k.producibleStates !== undefined) entry.producibleStates = k.producibleStates;
    artifactKinds[k.name] = entry;
  }
  const semanticTypeToArtifactKind: Record<string, string> = {};
  for (const m of abox.semanticTypeMap) {
    semanticTypeToArtifactKind[m.semanticType] = m.artifactKind;
  }
  const operationArtifactRules: ArtifactKindsViews['operationArtifactRules'] = {};
  for (const r of abox.operationRules) {
    const entry: ArtifactKindsViews['operationArtifactRules'][string] = {};
    if (r.composable !== undefined) entry.composable = r.composable;
    if (r.role !== undefined) entry.role = r.role;
    if (r.rules !== undefined) {
      entry.rules = r.rules.map((rule) => {
        const out: NonNullable<
          ArtifactKindsViews['operationArtifactRules'][string]['rules']
        >[number] = {
          artifactKind: rule.artifactKind,
        };
        if (rule.id !== undefined) out.id = rule.id;
        if (rule.priority !== undefined) out.priority = rule.priority;
        if (rule.producesSemantics !== undefined) out.producesSemantics = rule.producesSemantics;
        if (rule.producesStates !== undefined) out.producesStates = rule.producesStates;
        return out;
      });
    }
    operationArtifactRules[r.operationId] = entry;
  }
  const artifactFileKinds: Record<string, string[]> = {};
  for (const m of abox.fileExtensionMap) {
    artifactFileKinds[m.extension] = [...m.artifactKinds];
  }
  return {
    artifactKinds,
    semanticTypeToArtifactKind,
    operationArtifactRules,
    artifactFileKinds,
  };
}

/**
 * Load and validate the runtime-states ABox file for the active config.
 *
 * @param repoRoot Absolute path to the api-test-generator repository root.
 * @returns The parsed ABox, or `null` if the file does not exist.
 * @throws if the file exists but does not validate against the TBox, or
 *   if it contains duplicate state names or duplicate operationRequirements
 *   entries.
 */
export function loadRuntimeStatesAbox(repoRoot: string): RuntimeStatesAbox | null {
  // Symmetric with the other loadXxxAbox helpers — tests that exercise
  // loadGraph against an isolated tmpDir may not ship a `configs.json`,
  // and the right fallback there is "no ABox available".
  let aboxPath: string;
  try {
    aboxPath = path.join(getActiveConfigDir(repoRoot), 'ontology', 'runtime-states.json');
  } catch {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(aboxPath, 'utf8');
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse runtime-states ABox at ${aboxPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!validateRuntimeStatesAbox(parsed)) {
    throw new Error(
      `Runtime-states ABox at ${aboxPath} failed TBox validation:\n${formatErrors(validateRuntimeStatesAbox.errors)}`,
    );
  }
  // Reject duplicate keys up front — Draft-07 cannot express
  // uniqueness, but a duplicate would silently shadow facts at query
  // time. Same defensive check as in the other ABox loaders.
  const dupeStates = duplicates(parsed.states.map((s) => s.name));
  if (dupeStates.length > 0) {
    throw new Error(
      `Runtime-states ABox at ${aboxPath} has duplicate state name(s): ${dupeStates.join(', ')}`,
    );
  }
  const dupeOps = duplicates(parsed.operationRequirements.map((r) => r.operationId));
  if (dupeOps.length > 0) {
    throw new Error(
      `Runtime-states ABox at ${aboxPath} has duplicate operationRequirements entries for: ${dupeOps.join(', ')}`,
    );
  }
  // `eventual: true` requires a witness — same coupling as the legacy
  // `RuntimeStateSpec` (#159 PR B). The TBox cannot express this
  // without `if/then` (Draft-07 supports it, but for consistency with
  // the other ABoxes we keep the cross-property invariants in the
  // loader).
  for (const s of parsed.states) {
    if (s.eventual === true && s.witness === undefined) {
      throw new Error(
        `Runtime-states ABox at ${aboxPath} state '${s.name}' has eventual: true but no witness — eventual states require a witness for the planner's awaitEventually wait`,
      );
    }
  }
  return parsed;
}

/**
 * Derive the two record-shaped views of the runtime-states ABox that
 * `graph.domain.*` consumers (planner BFS, value-binding emitter,
 * witness machinery) expect.
 */
export interface RuntimeStatesViews {
  runtimeStates: Record<
    string,
    {
      kind: 'state';
      producedBy?: string[];
      parameter?: string;
      parameters?: string[];
      requires?: string[];
      eventual?: boolean;
      witness?: {
        operationId: string;
        predicate: { path: string; equals: string | number | boolean };
        waitUpToMs?: number;
        pollIntervalMs?: number;
      };
    }
  >;
  operationRequirements: Record<
    string,
    {
      requires?: string[];
      disjunctions?: string[][];
      implicitAdds?: string[];
      produces?: string[];
      valueBindings?: Record<string, string>;
    }
  >;
}

export function deriveRuntimeStatesViews(repoRoot: string): RuntimeStatesViews | null {
  const abox = loadRuntimeStatesAbox(repoRoot);
  if (abox === null) return null;
  const runtimeStates: RuntimeStatesViews['runtimeStates'] = {};
  for (const s of abox.states) {
    const entry: RuntimeStatesViews['runtimeStates'][string] = { kind: 'state' };
    if (s.producedBy !== undefined) entry.producedBy = [...s.producedBy];
    if (s.parameter !== undefined) entry.parameter = s.parameter;
    if (s.parameters !== undefined) entry.parameters = [...s.parameters];
    if (s.requires !== undefined) entry.requires = [...s.requires];
    if (s.eventual !== undefined) entry.eventual = s.eventual;
    if (s.witness !== undefined) {
      entry.witness = {
        operationId: s.witness.operationId,
        predicate: { path: s.witness.predicate.path, equals: s.witness.predicate.equals },
      };
      if (s.witness.waitUpToMs !== undefined) entry.witness.waitUpToMs = s.witness.waitUpToMs;
      if (s.witness.pollIntervalMs !== undefined)
        entry.witness.pollIntervalMs = s.witness.pollIntervalMs;
    }
    runtimeStates[s.name] = entry;
  }
  const operationRequirements: RuntimeStatesViews['operationRequirements'] = {};
  for (const r of abox.operationRequirements) {
    const entry: RuntimeStatesViews['operationRequirements'][string] = {};
    if (r.requires !== undefined) entry.requires = [...r.requires];
    if (r.disjunctions !== undefined) entry.disjunctions = r.disjunctions.map((d) => [...d]);
    if (r.implicitAdds !== undefined) entry.implicitAdds = [...r.implicitAdds];
    if (r.produces !== undefined) entry.produces = [...r.produces];
    if (r.valueBindings !== undefined) entry.valueBindings = { ...r.valueBindings };
    operationRequirements[r.operationId] = entry;
  }
  return { runtimeStates, operationRequirements };
}

/**
 * Load and validate the semantics ABox file (semanticTypes +
 * capabilities + identifiers) for the active config.
 *
 * @param repoRoot Absolute path to the api-test-generator repository root.
 * @returns The parsed ABox, or `null` if the file does not exist.
 * @throws if the file exists but does not validate against the TBox,
 *   if it contains duplicate names within any sub-tree, or if a
 *   cross-property invariant is violated (e.g. `kind: 'attribute'`
 *   without `clientMinted: true`).
 */
export function loadSemanticsAbox(repoRoot: string): SemanticsAbox | null {
  // Symmetric with the other loadXxxAbox helpers — tests that exercise
  // loadGraph against an isolated tmpDir may not ship a `configs.json`,
  // and the right fallback there is "no ABox available".
  let aboxPath: string;
  try {
    aboxPath = path.join(getActiveConfigDir(repoRoot), 'ontology', 'semantics.json');
  } catch {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(aboxPath, 'utf8');
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse semantics ABox at ${aboxPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!validateSemanticsAbox(parsed)) {
    throw new Error(
      `Semantics ABox at ${aboxPath} failed TBox validation:\n${formatErrors(validateSemanticsAbox.errors)}`,
    );
  }
  // Reject duplicate keys up front — Draft-07 cannot express
  // uniqueness, but a duplicate would silently shadow facts at query
  // time. Same defensive check as in the other ABox loaders.
  const dupeTypes = duplicates(parsed.semanticTypes.map((t) => t.name));
  if (dupeTypes.length > 0) {
    throw new Error(
      `Semantics ABox at ${aboxPath} has duplicate semanticTypes name(s): ${dupeTypes.join(', ')}`,
    );
  }
  if (parsed.capabilities !== undefined) {
    const dupeCaps = duplicates(parsed.capabilities.map((c) => c.name));
    if (dupeCaps.length > 0) {
      throw new Error(
        `Semantics ABox at ${aboxPath} has duplicate capabilities name(s): ${dupeCaps.join(', ')}`,
      );
    }
  }
  if (parsed.identifiers !== undefined) {
    const dupeIds = duplicates(parsed.identifiers.map((i) => i.name));
    if (dupeIds.length > 0) {
      throw new Error(
        `Semantics ABox at ${aboxPath} has duplicate identifiers name(s): ${dupeIds.join(', ')}`,
      );
    }
  }
  // Cross-property invariant: `kind: 'attribute'` ⇒ `clientMinted: true`
  // (#162 PR 2 coupling, was enforced by `domainSemanticsValidator` for the
  // legacy sidecar). Same shape as the runtime-states `eventual`/`witness`
  // coupling check.
  for (const t of parsed.semanticTypes) {
    if (t.kind === 'attribute' && t.clientMinted !== true) {
      throw new Error(
        `Semantics ABox at ${aboxPath} semanticTypes '${t.name}' has kind: 'attribute' but clientMinted is not true — attribute-shaped semantic types must declare clientMinted: true so the planner mints values rather than waiting for a producer`,
      );
    }
  }
  return parsed;
}

/**
 * Derive the three record-shaped views of the semantics ABox that
 * `graph.domain.*` consumers (planner BFS, value-binding emitter,
 * #70 witness-implication loop) expect.
 */
export interface SemanticsViews {
  semanticTypes: Record<
    string,
    {
      witnesses?: string;
      kind?: 'modelDerived' | 'attribute' | 'serverEmergent';
      clientMinted?: boolean;
    }
  >;
  capabilities: Record<
    string,
    {
      kind: 'capability';
      parameter: string;
      producedBy?: string[];
      dependsOn?: string[];
    }
  >;
  identifiers: Record<
    string,
    {
      kind: 'identifier';
      validityState?: string;
      boundBy?: string[];
      fieldPaths?: string[];
      derivedVia?: string;
    }
  >;
}

export function deriveSemanticsViews(repoRoot: string): SemanticsViews | null {
  const abox = loadSemanticsAbox(repoRoot);
  if (abox === null) return null;
  const semanticTypes: SemanticsViews['semanticTypes'] = {};
  for (const t of abox.semanticTypes) {
    const entry: SemanticsViews['semanticTypes'][string] = {};
    if (t.witnesses !== undefined) entry.witnesses = t.witnesses;
    if (t.kind !== undefined) entry.kind = t.kind;
    if (t.clientMinted !== undefined) entry.clientMinted = t.clientMinted;
    semanticTypes[t.name] = entry;
  }
  const capabilities: SemanticsViews['capabilities'] = {};
  for (const c of abox.capabilities ?? []) {
    const entry: SemanticsViews['capabilities'][string] = {
      kind: 'capability',
      parameter: c.parameter,
    };
    if (c.producedBy !== undefined) entry.producedBy = [...c.producedBy];
    if (c.dependsOn !== undefined) entry.dependsOn = [...c.dependsOn];
    capabilities[c.name] = entry;
  }
  const identifiers: SemanticsViews['identifiers'] = {};
  for (const i of abox.identifiers ?? []) {
    const entry: SemanticsViews['identifiers'][string] = { kind: 'identifier' };
    if (i.validityState !== undefined) entry.validityState = i.validityState;
    if (i.boundBy !== undefined) entry.boundBy = [...i.boundBy];
    if (i.fieldPaths !== undefined) entry.fieldPaths = [...i.fieldPaths];
    if (i.derivedVia !== undefined) entry.derivedVia = i.derivedVia;
    identifiers[i.name] = entry;
  }
  return { semanticTypes, capabilities, identifiers };
}

/**
 * Load and structurally validate the per-config global-context-seeds
 * ABox (Lift 8 / #218).
 *
 * @returns the parsed ABox, or `null` if no `global-context-seeds.json`
 *   is shipped under `configs/<active>/ontology/`. A missing file is
 *   non-fatal: `graph.domain.globalContextSeeds` is left undefined and
 *   the Playwright emitter prologue + `loadGlobalContextSeeds` in
 *   `codegen/index.ts` treat it as the empty list. There is no longer
 *   a legacy-sidecar fallback (Lift 8 retired it).
 * @throws if the file exists but does not validate against the TBox,
 *   if it contains duplicate `binding` or `fieldName` values, or if a
 *   cross-property invariant is violated (`stripFromMultipartWhenDefault`
 *   without `defaultSentinel`).
 */
export function loadGlobalContextSeedsAbox(repoRoot: string): GlobalContextSeedsAbox | null {
  let aboxPath: string;
  try {
    aboxPath = path.join(getActiveConfigDir(repoRoot), 'ontology', 'global-context-seeds.json');
  } catch {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(aboxPath, 'utf8');
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse global-context-seeds ABox at ${aboxPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!validateGlobalContextSeedsAbox(parsed)) {
    throw new Error(
      `Global-context-seeds ABox at ${aboxPath} failed TBox validation:\n${formatErrors(validateGlobalContextSeedsAbox.errors)}`,
    );
  }
  // Reject duplicate keys up front — Draft-07 cannot express
  // uniqueness across two distinct properties, but a duplicate would
  // shadow the intent at emission time. Same defensive check as in
  // the other ABox loaders.
  const dupeBindings = duplicates(parsed.seeds.map((s) => s.binding));
  if (dupeBindings.length > 0) {
    throw new Error(
      `Global-context-seeds ABox at ${aboxPath} has duplicate binding(s): ${dupeBindings.join(', ')}`,
    );
  }
  const dupeFields = duplicates(parsed.seeds.map((s) => s.fieldName));
  if (dupeFields.length > 0) {
    throw new Error(
      `Global-context-seeds ABox at ${aboxPath} has duplicate fieldName(s): ${dupeFields.join(', ')}`,
    );
  }
  // Cross-property invariant: stripFromMultipartWhenDefault === true
  // requires a defaultSentinel to compare against. Mirrors the
  // legacy `checkGlobalContextSeedsCoherent` rule.
  for (const s of parsed.seeds) {
    if (s.stripFromMultipartWhenDefault === true && s.defaultSentinel === undefined) {
      throw new Error(
        `Global-context-seeds ABox at ${aboxPath} entry for binding '${s.binding}' sets stripFromMultipartWhenDefault but has no defaultSentinel — the multipart-strip branch has no value to compare against`,
      );
    }
  }
  return parsed;
}

/**
 * Derive the array-shaped view of the global-context-seeds ABox that
 * `graph.domain.globalContextSeeds` consumers (Playwright emitter
 * universal-seed prologue, multipart-strip branches, codegen
 * `loadGlobalContextSeeds`) expect. Returning `null` means no
 * `global-context-seeds.json` ABox is shipped for the active config, so
 * callers leave `graph.domain.globalContextSeeds` undefined and treat it
 * as the empty list.
 */
export interface GlobalContextSeedsViews {
  globalContextSeeds: Array<{
    binding: string;
    fieldName: string;
    seedRule: string;
    defaultSentinel?: string;
    stripFromMultipartWhenDefault?: boolean;
    rationale?: string;
  }>;
}

export function deriveGlobalContextSeedsViews(repoRoot: string): GlobalContextSeedsViews | null {
  const abox = loadGlobalContextSeedsAbox(repoRoot);
  if (abox === null) return null;
  const globalContextSeeds: GlobalContextSeedsViews['globalContextSeeds'] = abox.seeds.map((s) => {
    const entry: GlobalContextSeedsViews['globalContextSeeds'][number] = {
      binding: s.binding,
      fieldName: s.fieldName,
      seedRule: s.seedRule,
    };
    if (s.defaultSentinel !== undefined) entry.defaultSentinel = s.defaultSentinel;
    if (s.stripFromMultipartWhenDefault !== undefined) {
      entry.stripFromMultipartWhenDefault = s.stripFromMultipartWhenDefault;
    }
    if (s.rationale !== undefined) entry.rationale = s.rationale;
    return entry;
  });
  return { globalContextSeeds };
}

/**
 * Boundary-level safety assertion for `globalContextSeeds` arrays
 * accepted by the public Playwright emitter entry points
 * (`renderPlaywrightSuite`, `emitPlaywrightSuite`, `PlaywrightEmitter.emit`).
 *
 * The emitter interpolates `binding`, `fieldName`, `seedRule`, and
 * `defaultSentinel` directly into emitted TS source as identifiers and
 * single-quoted string literals (#87). The graph loader validates the
 * seeds when reading `global-context-seeds.json`, but the emitter
 * accepts a `globalContextSeeds` argument from any caller. This helper
 * re-validates at that boundary so a programmatic caller cannot bypass
 * the loader's safety net and produce broken or injection-vulnerable
 * generated suites.
 *
 * Throws on any structural issue (TBox shape) or any cross-seed
 * coherence violation (uniqueness, strip-requires-sentinel). Returns
 * silently on success.
 */
export function assertSafeGlobalContextSeeds(seeds: unknown): void {
  if (!Array.isArray(seeds)) {
    throw new Error(
      `globalContextSeeds must be an array when provided (received ${seeds === null ? 'null' : typeof seeds}).`,
    );
  }
  const wrapper = { version: 1, seeds };
  if (!validateGlobalContextSeedsAbox(wrapper)) {
    throw new Error(
      `globalContextSeeds failed structural validation:\n${formatErrors(validateGlobalContextSeedsAbox.errors)}`,
    );
  }
  const dupeBindings = duplicates(wrapper.seeds.map((s) => s.binding));
  if (dupeBindings.length > 0) {
    throw new Error(
      `globalContextSeeds failed coherence validation:\n  - duplicate binding(s): ${dupeBindings.join(', ')}`,
    );
  }
  const dupeFields = duplicates(wrapper.seeds.map((s) => s.fieldName));
  if (dupeFields.length > 0) {
    throw new Error(
      `globalContextSeeds failed coherence validation:\n  - duplicate fieldName(s): ${dupeFields.join(', ')}`,
    );
  }
  for (const s of wrapper.seeds) {
    if (s.stripFromMultipartWhenDefault === true && s.defaultSentinel === undefined) {
      throw new Error(
        `globalContextSeeds failed coherence validation:\n  - entry for binding '${s.binding}' sets stripFromMultipartWhenDefault but has no defaultSentinel`,
      );
    }
  }
}
