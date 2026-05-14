import * as fs from 'node:fs';
import * as path from 'node:path';
import { Ajv, type ErrorObject } from 'ajv';
import type { FromSchema } from 'json-schema-to-ts';
import { getActiveConfigName } from '../active-config';
import type { BootstrapSequence } from '../types';
import { bootstrapSequenceSchema } from './bootstrapSequenceSchema';

// ---------------------------------------------------------------------------
// semantic-graph-extractor/ontology/bootstrapSequencesLoader.ts
//
// Generic ABox loader for the bootstrap-sequences slice of the ontology
// (#202, Lift 2). Replaces the hard-coded OCA literals + heuristic
// classifiers in the previous `root-dependency-analyzer.ts` with a
// generic, ABox-driven loader: every sequence is an explicit assertion
// in `configs/<name>/ontology/bootstrap-sequences.json` (validated by
// `bootstrapSequenceSchema.ts`).
//
// The loader silently drops any sequence whose `operations[]` are not
// all present in the parsed spec; this preserves the original
// "if (operationExists(...)) sequences.push(...)" behaviour but in a
// generic, declarative form. (The same ABox can ship across API
// variants that include or omit specific operations.) `produces[]`
// entries are checked as a hard error against the spec's semantic-types
// registry so a typo can never silently disable downstream planning.
// ---------------------------------------------------------------------------

export type BootstrapSequencesAbox = FromSchema<typeof bootstrapSequenceSchema>;
export type BootstrapSequenceEntry = BootstrapSequencesAbox['sequences'][number];

const ajv = new Ajv({ allErrors: true, strict: false });
const validateAbox = ajv.compile<BootstrapSequencesAbox>(bootstrapSequenceSchema);

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((e) => `  - ${e.instancePath || '<root>'}: ${e.message ?? '(no message)'}`)
    .join('\n');
}

export interface LoadOptions {
  /** Set of operationIds present in the parsed spec. */
  knownOperationIds: Set<string>;
  /** Set of semantic-type names present in the parsed spec. */
  knownSemanticTypes: Set<string>;
}

export interface LoadResult {
  sequences: BootstrapSequence[];
  /** Sequences silently dropped because at least one referenced operation is missing from the spec. */
  droppedForMissingOperations: { name: string; missing: string[] }[];
}

/**
 * Load and validate the bootstrap-sequences ABox file for the active config.
 *
 * @param repoRoot Absolute path to the api-test-generator repository root.
 * @param opts Cross-reference indexes from the parsed spec.
 * @returns The parsed sequences, filtered to those whose operations
 *   exist in the spec. Returns an empty array if the ABox file is
 *   missing (configs aren't required to ship one).
 * @throws if the file exists but does not validate against the TBox,
 *   if any sequence references a semantic type not in the spec, or if
 *   two sequences share a `name`.
 */
export function loadBootstrapSequences(repoRoot: string, opts: LoadOptions): LoadResult {
  const aboxPath = path.join(
    repoRoot,
    'configs',
    getActiveConfigName(repoRoot),
    'ontology',
    'bootstrap-sequences.json',
  );
  let raw: string;
  try {
    raw = fs.readFileSync(aboxPath, 'utf8');
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { sequences: [], droppedForMissingOperations: [] };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse bootstrap-sequences ABox at ${aboxPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!validateAbox(parsed)) {
    throw new Error(
      `Bootstrap-sequences ABox at ${aboxPath} failed TBox validation:\n${formatErrors(validateAbox.errors)}`,
    );
  }

  // Reject duplicate `name` values up front — Draft-07 cannot express
  // uniqueness, but a duplicate sequence name would silently shadow
  // the planner's bootstrap-credit accounting at scoring time.
  const counts = new Map<string, number>();
  for (const s of parsed.sequences) {
    counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  }
  const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([n]) => n);
  if (dupes.length > 0) {
    throw new Error(
      `Bootstrap-sequences ABox at ${aboxPath} has duplicate sequence name(s): ${dupes.join(', ')}`,
    );
  }

  // Compute soft-drops first so the `produces[]` cross-reference check
  // only ranges over sequences that will actually be loaded. Otherwise
  // a sequence whose operationId is absent from this variant could
  // still hard-fail extraction if its `produces[]` referenced a
  // semantic type also absent from this variant — defeating the whole
  // "same ABox across API variants" contract.
  const droppedForMissingOperations: { name: string; missing: string[] }[] = [];
  const retained: typeof parsed.sequences = [];
  for (const s of parsed.sequences) {
    const missing = s.operations.filter((op) => !opts.knownOperationIds.has(op));
    if (missing.length > 0) {
      droppedForMissingOperations.push({ name: s.name, missing });
      continue;
    }
    retained.push(s);
  }

  // Hard error: every `produces[]` semantic type on a *retained*
  // sequence must exist in the spec. A typo here would silently
  // disable credit on a downstream scoring path; conversely, a typo
  // on a sequence that's already being soft-dropped is unreachable
  // and shouldn't gate the whole extraction.
  const unknownTypes: { sequence: string; type: string }[] = [];
  for (const s of retained) {
    for (const t of s.produces) {
      if (!opts.knownSemanticTypes.has(t)) {
        unknownTypes.push({ sequence: s.name, type: t });
      }
    }
  }
  if (unknownTypes.length > 0) {
    const list = unknownTypes.map((u) => `  - sequence '${u.sequence}': '${u.type}'`).join('\n');
    throw new Error(
      `Bootstrap-sequences ABox at ${aboxPath} references semantic type(s) not in the spec:\n${list}`,
    );
  }

  const sequences: BootstrapSequence[] = retained.map((s) => ({
    name: s.name,
    description: s.description,
    operations: [...s.operations],
    produces: [...s.produces],
  }));

  return { sequences, droppedForMissingOperations };
}
