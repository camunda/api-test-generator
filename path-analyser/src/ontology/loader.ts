import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getActiveConfigDir } from '../configResolver.js';

// ---------------------------------------------------------------------------
// path-analyser/src/ontology/loader.ts
//
// Generic loader for per-config ABox files that ship under
// `configs/<active>/ontology/`. Layout is the one validated end-to-end by
// Lift 1 (#201) and described by the TBox JSON Schemas under
// `ontology/vocabulary/` at the repo root.
//
// JSON-LD context keys (`@context`, `@type`) are accepted and preserved on
// the parsed value but the loader does not interpret them — they exist so
// an external SPARQL/SHACL/OWL consumer can ingest the ABox unchanged.
// No runtime in this repo reasons over JSON-LD.
//
// Cross-references against the bundled spec (operationIds existing,
// endpoint kind names existing in semantic-kinds.json, identifier types
// matching) are NOT enforced here; they live as L3 invariants in
// `configs/<name>/regression-invariants.test.ts` so a failure points
// directly at the broken row instead of a generic schema error.
// ---------------------------------------------------------------------------

const EdgeSchema = z
  .object({
    '@type': z.string().optional(),
    name: z.string().regex(/^[A-Z][A-Za-z0-9]+$/, 'edge name must be PascalCase singular noun'),
    endpoints: z.object({ from: z.string().min(1), to: z.string().min(1) }).strict(),
    identifiedBy: z.array(z.string().min(1)).length(2),
    establishedBy: z.string().min(1),
    observableVia: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

const EdgesAboxSchema = z
  .object({
    $schema: z.string().optional(),
    // Mirror the TBox's `@context` shape (object|string|array) so the
    // loader can't accept ABox files that the published JSON Schema
    // would reject. JSON-LD permits other forms in principle, but this
    // ontology only emits these three and a tighter type prevents the
    // loader from drifting laxer than the TBox.
    '@context': z
      .union([z.record(z.string(), z.unknown()), z.string(), z.array(z.unknown())])
      .optional(),
    version: z.number().int().min(1),
    edges: z.array(EdgeSchema).min(1),
  })
  .strict();

export type Edge = z.infer<typeof EdgeSchema>;
export type EdgesAbox = z.infer<typeof EdgesAboxSchema>;

/**
 * Load and validate the edges ABox file for the active config.
 *
 * @param repoRoot Absolute path to the api-test-generator repository root.
 * @returns The parsed ABox, or `null` if the file does not exist (configs
 *   are not required to ship an edges ABox; a missing file is a no-op).
 * @throws if the file exists but does not validate against the TBox.
 */
export function loadEdgesAbox(repoRoot: string): EdgesAbox | null {
  const aboxPath = path.join(getActiveConfigDir(repoRoot), 'ontology', 'edges.json');
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
  const result = EdgesAboxSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Edges ABox at ${aboxPath} failed validation:\n${result.error.issues
        .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('\n')}`,
    );
  }
  // Reject duplicate `name` values up front — the TBox can't express
  // uniqueness in Draft-07, but a duplicate edge name is always a bug
  // (it would silently shadow facts at query time).
  const names = new Map<string, number>();
  for (const e of result.data.edges) {
    names.set(e.name, (names.get(e.name) ?? 0) + 1);
  }
  const dupes = [...names.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  if (dupes.length > 0) {
    throw new Error(`Edges ABox at ${aboxPath} has duplicate edge name(s): ${dupes.join(', ')}`);
  }
  return result.data;
}
