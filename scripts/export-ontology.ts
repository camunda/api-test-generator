// Bundles the per-config ABox JSON-LD slices and TBox JSON Schemas into a
// single generated/<cfg>/ontology-bundle.json. With --rdf, also emits:
//   generated/<cfg>/ontology-bundle.ttl  (Turtle)
//   generated/<cfg>/ontology-bundle.nq   (N-Quads)
//
// Run via:
//   npm run export:ontology
//   npm run export:ontology -- --rdf     (also emit Turtle and N-Quads)
//
// The RDF output wraps the ABox instances in a single @graph document
// with an inline @context, so jsonld.toRDF runs fully offline without
// needing to fetch any external URL.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  getActiveConfigDir,
  getActiveConfigName,
  getGeneratedDir,
} from '../path-analyser/src/configResolver.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Slice manifests
// ---------------------------------------------------------------------------

/** ABox slice filenames (under configs/<config>/ontology/) and their bundle keys. */
const ABOX_SLICES = [
  { file: 'edges.json', key: 'edges' },
  { file: 'entity-kinds.json', key: 'entityKinds' },
  { file: 'artifact-kinds.json', key: 'artifactKinds' },
  { file: 'runtime-states.json', key: 'runtimeStates' },
  { file: 'semantics.json', key: 'semantics' },
  { file: 'global-context-seeds.json', key: 'globalContextSeeds' },
  { file: 'scenario-templates.json', key: 'scenarioTemplates' },
] as const;

/** TBox slice filenames (under ontology/vocabulary/) and their bundle keys. */
const TBOX_SLICES = [
  { file: 'edge.schema.json', key: 'edge' },
  { file: 'entity-kinds.schema.json', key: 'entityKinds' },
  { file: 'artifact-kinds.schema.json', key: 'artifactKinds' },
  { file: 'runtime-states.schema.json', key: 'runtimeStates' },
  { file: 'semantics.schema.json', key: 'semantics' },
  { file: 'global-context-seeds.schema.json', key: 'globalContextSeeds' },
  { file: 'scenario-template.schema.json', key: 'scenarioTemplate' },
] as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OntologyBundle {
  config: string;
  /** Deterministic placeholder unless TEST_SEED=random. */
  bundledAt: string;
  /** Keyed TBox JSON Schema slices from ontology/vocabulary/. */
  tbox: Record<string, unknown>;
  /** Keyed ABox JSON-LD slices from configs/<config>/ontology/. */
  abox: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Core helpers — imported by tests and the visualise script
// ---------------------------------------------------------------------------

/**
 * Build the unified bundle from the active config's committed ABox files and
 * the TBox JSON Schemas under ontology/vocabulary/.  Does not write anything
 * to disk; callers decide where to save.
 */
export function buildBundle(): OntologyBundle {
  const configDir = getActiveConfigDir(REPO_ROOT);
  const configName = getActiveConfigName(REPO_ROOT);

  const tbox: Record<string, unknown> = {};
  for (const { file, key } of TBOX_SLICES) {
    const p = join(REPO_ROOT, 'ontology', 'vocabulary', file);
    tbox[key] = JSON.parse(readFileSync(p, 'utf8'));
  }

  const abox: Record<string, unknown> = {};
  for (const { file, key } of ABOX_SLICES) {
    const p = join(configDir, 'ontology', file);
    abox[key] = JSON.parse(readFileSync(p, 'utf8'));
  }

  return {
    config: configName,
    bundledAt:
      process.env.TEST_SEED === 'random'
        ? new Date().toISOString()
        : `seeded:${process.env.TEST_SEED ?? 'snapshot-baseline'}`,
    tbox,
    abox,
  };
}

/** Absolute path where the bundle is written for the active config. */
export function getBundlePath(repoRoot: string): string {
  return join(getGeneratedDir(repoRoot), 'ontology-bundle.json');
}

// ---------------------------------------------------------------------------
// RDF emission (only loaded when --rdf is passed)
// ---------------------------------------------------------------------------

/**
 * Convert the ABox JSON-LD slices to N-Quads and Turtle, writing both files
 * into `outDir`.
 *
 * An offline document loader maps the external shared context URL to the
 * local `ontology/context.jsonld` so the conversion works in CI without
 * network access.
 */
export async function writeRdf(bundle: OntologyBundle, outDir: string): Promise<void> {
  // Dynamic imports so the bundle step (without --rdf) has zero overhead from
  // these packages.
  const { default: jsonld } = await import('jsonld');
  const { Writer, Parser } = await import('n3');

  // Derive the @context from the local context file (if committed) or fall
  // back to a simple @vocab mapping.  Individual ABox items are extracted
  // from each slice's array, then wrapped in a single @graph document with
  // this inline context so jsonld.toRDF never needs to fetch an external URL.
  const localContextPath = join(REPO_ROOT, 'ontology', 'context.jsonld');
  const localContextDoc: Record<string, unknown> = existsSync(localContextPath)
    ? // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      (JSON.parse(readFileSync(localContextPath, 'utf8')) as Record<string, unknown>)
    : { '@context': { '@vocab': 'https://camunda.github.io/api-test-generator/ns/v1/' } };

  // Collect all ABox instances into a JSON-LD @graph.
  const graphNodes: Record<string, unknown>[] = [];
  for (const { key } of ABOX_SLICES) {
    const slice = bundle.abox[key];
    if (!slice || typeof slice !== 'object' || Array.isArray(slice)) continue;
    // biome-ignore lint/plugin: runtime contract boundary for parsed JSON; narrowed to object above
    for (const value of Object.values(slice as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            // biome-ignore lint/plugin: runtime contract boundary for parsed JSON; narrowed to object above
            graphNodes.push(item as Record<string, unknown>);
          }
        }
      }
    }
  }

  // Build a single document with an inline @context so toRDF runs fully
  // offline (no external URL fetch required).
  const doc = {
    '@context': localContextDoc['@context'] ?? {
      '@vocab': 'https://camunda.github.io/api-test-generator/ns/v1/',
    },
    '@graph': graphNodes,
  };

  // Serialize to N-Quads via jsonld.
  // biome-ignore lint/plugin: runtime contract boundary for inline JSON-LD assembly; types from @types/jsonld are looser than the actual runtime contract
  const nquadsResult = await jsonld.toRDF(doc as Parameters<typeof jsonld.toRDF>[0], {
    format: 'application/n-quads',
  });
  if (typeof nquadsResult !== 'string') {
    throw new Error('jsonld.toRDF did not return a string; unexpected output format');
  }
  const nquads: string = nquadsResult;

  const nqPath = join(outDir, 'ontology-bundle.nq');
  writeFileSync(nqPath, nquads, 'utf8');
  process.stdout.write(`wrote ${nqPath}\n`);

  // Convert N-Quads → Turtle using n3.
  const parser = new Parser({ format: 'N-Quads' });
  const writer = new Writer({ format: 'text/turtle' });
  const quads = parser.parse(nquads);
  writer.addQuads(quads);
  const turtle: string = await new Promise((resolve, reject) => {
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });

  const ttlPath = join(outDir, 'ontology-bundle.ttl');
  writeFileSync(ttlPath, turtle, 'utf8');
  process.stdout.write(`wrote ${ttlPath}\n`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rdf = process.argv.includes('--rdf');
  const bundle = buildBundle();

  const outDir = getGeneratedDir(REPO_ROOT);
  mkdirSync(outDir, { recursive: true });

  const outPath = getBundlePath(REPO_ROOT);
  writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote ${outPath}\n`);

  if (rdf) {
    await writeRdf(bundle, outDir);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
