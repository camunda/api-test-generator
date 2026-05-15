import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv, type ErrorObject } from 'ajv';
import type { FromSchema } from 'json-schema-to-ts';
import { getActiveConfigDir } from '../configResolver.js';
import { edgeSchema } from './edgeSchema.js';
import { entityKindsSchema } from './entityKindsSchema.js';

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

// `Ajv` is the named export pointing at the constructor; the namespace
// also has a self-referential default but the named export is the
// least error-prone form under module=nodenext.
const ajv = new Ajv({ allErrors: true, strict: false });
const validateEdgesAbox = ajv.compile<EdgesAbox>(edgeSchema);
const validateEntityKindsAbox = ajv.compile<EntityKindsAbox>(entityKindsSchema);

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
