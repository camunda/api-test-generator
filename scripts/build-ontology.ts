// Regenerates the JSON Schema files under `ontology/vocabulary/` from
// their TypeScript source-of-truth modules. The TS modules export the
// schema `as const` so a single literal drives both runtime ajv
// validation and `json-schema-to-ts` type inference; the JSON files
// exist solely so external SPARQL/SHACL/OWL consumers can fetch a
// plain JSON Schema by URL.
//
// Run via: npm run build:ontology
//
// A regression invariant in `configs/<config>/regression-invariants.test.ts`
// asserts that committed JSON files match what this script would write,
// so a stale .json is caught as a CI failure rather than shipping
// silently to external consumers.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { edgeSchema } from '../path-analyser/src/ontology/edgeSchema.ts';
// Namespace import: the schema source lives in the CommonJS-flavoured
// `semantic-graph-extractor` workspace (`type: commonjs` in its
// package.json). Node's CJS-to-ESM interop exposes the actual
// `module.exports` object under `.default` when the cjs-module-lexer
// can't statically infer the named exports from TS source. We tolerate
// either shape so the script works under both tsx (which often inlines
// CJS exports) and Vite/Vitest (which goes through Node's strict
// interop).
import * as bootstrapSequenceModule from '../semantic-graph-extractor/ontology/bootstrapSequenceSchema.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface OntologyArtifact {
  jsonPath: string;
  schema: unknown;
}

const ARTIFACTS: OntologyArtifact[] = [
  {
    jsonPath: join(REPO_ROOT, 'ontology', 'vocabulary', 'edge.schema.json'),
    schema: edgeSchema,
  },
  {
    jsonPath: join(REPO_ROOT, 'ontology', 'vocabulary', 'bootstrap-sequence.schema.json'),
    schema:
      bootstrapSequenceModule.bootstrapSequenceSchema ??
      // biome-ignore lint/plugin: runtime CJS-interop fallback when cjs-module-lexer can't see TS exports
      (bootstrapSequenceModule as { default?: { bootstrapSequenceSchema?: unknown } }).default
        ?.bootstrapSequenceSchema,
  },
];

export function renderSchema(schema: unknown): string {
  // Trailing newline matches the project's other committed JSON files
  // and keeps `git diff` quiet when authors edit by hand.
  return `${JSON.stringify(schema, null, 2)}\n`;
}

function main(): void {
  for (const artifact of ARTIFACTS) {
    const rendered = renderSchema(artifact.schema);
    writeFileSync(artifact.jsonPath, rendered, 'utf8');
    process.stdout.write(`wrote ${artifact.jsonPath}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

export { ARTIFACTS };
