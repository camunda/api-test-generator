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
import { artifactKindsSchema } from '../path-analyser/src/ontology/artifactKindsSchema.ts';
import { edgeSchema } from '../path-analyser/src/ontology/edgeSchema.ts';
import { entityKindsSchema } from '../path-analyser/src/ontology/entityKindsSchema.ts';
import { globalContextSeedsSchema } from '../path-analyser/src/ontology/globalContextSeedsSchema.ts';
import { runtimeStatesSchema } from '../path-analyser/src/ontology/runtimeStatesSchema.ts';
import { semanticsSchema } from '../path-analyser/src/ontology/semanticsSchema.ts';
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

/**
 * Resolve a schema literal that may have come through one of several
 * cross-module-system import paths (ESM named import, CJS-interop
 * default-property accessor, etc.). If none of them produced a value
 * we throw rather than letting `JSON.stringify(undefined)` write the
 * string "undefined" into the published JSON file — that would be a
 * silent corruption of an artefact that downstream RDF/JSON-Schema
 * tooling reads by URL.
 */
function requireSchema(schema: unknown, exportName: string): unknown {
  if (schema === undefined || schema === null) {
    throw new Error(
      `build-ontology: failed to resolve '${exportName}' from its source module — ` +
        `cross-module-system import returned ${schema}. Refusing to write 'undefined' ` +
        `into the published JSON Schema artefact. Check the import path and any ` +
        `recent rename of the exported binding.`,
    );
  }
  return schema;
}

const ARTIFACTS: OntologyArtifact[] = [
  {
    jsonPath: join(REPO_ROOT, 'ontology', 'vocabulary', 'edge.schema.json'),
    schema: edgeSchema,
  },
  {
    jsonPath: join(REPO_ROOT, 'ontology', 'vocabulary', 'entity-kinds.schema.json'),
    schema: entityKindsSchema,
  },
  {
    jsonPath: join(REPO_ROOT, 'ontology', 'vocabulary', 'artifact-kinds.schema.json'),
    schema: artifactKindsSchema,
  },
  {
    jsonPath: join(REPO_ROOT, 'ontology', 'vocabulary', 'runtime-states.schema.json'),
    schema: runtimeStatesSchema,
  },
  {
    jsonPath: join(REPO_ROOT, 'ontology', 'vocabulary', 'semantics.schema.json'),
    schema: semanticsSchema,
  },
  {
    jsonPath: join(REPO_ROOT, 'ontology', 'vocabulary', 'global-context-seeds.schema.json'),
    schema: globalContextSeedsSchema,
  },
  {
    jsonPath: join(REPO_ROOT, 'ontology', 'vocabulary', 'bootstrap-sequence.schema.json'),
    schema: requireSchema(
      bootstrapSequenceModule.bootstrapSequenceSchema ??
        // biome-ignore lint/plugin: runtime CJS-interop fallback when cjs-module-lexer can't see TS exports
        (bootstrapSequenceModule as { default?: { bootstrapSequenceSchema?: unknown } }).default
          ?.bootstrapSequenceSchema,
      'bootstrapSequenceSchema',
    ),
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
