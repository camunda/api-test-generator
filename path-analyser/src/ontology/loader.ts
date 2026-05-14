import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv, type ErrorObject } from 'ajv';
import type { FromSchema } from 'json-schema-to-ts';
import { getActiveConfigDir } from '../configResolver.js';
import { edgeSchema } from './edgeSchema.js';

// ---------------------------------------------------------------------------
// path-analyser/src/ontology/loader.ts
//
// Generic loader for per-config ABox files that ship under
// `configs/<active>/ontology/`. Layout is described by the TBox sources
// under `ontology/vocabulary/` at the repo root.
//
// True single source of truth: the TBox is authored as a TS const
// (`edge.schema.ts`) and consumed here both at runtime (ajv) and at
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

// `Ajv` is the named export pointing at the constructor; the namespace
// also has a self-referential default but the named export is the
// least error-prone form under module=nodenext.
const ajv = new Ajv({ allErrors: true, strict: false });
const validateAbox = ajv.compile<EdgesAbox>(edgeSchema);

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
  if (!validateAbox(parsed)) {
    throw new Error(
      `Edges ABox at ${aboxPath} failed TBox validation:\n${formatErrors(validateAbox.errors)}`,
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
