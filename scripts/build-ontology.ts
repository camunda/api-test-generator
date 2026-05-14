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
