// Exports the full api-test-generator ontology — TBox (vocabulary
// JSON Schemas under `ontology/vocabulary/`) plus per-config ABox
// instance files under `configs/<config>/ontology/` — as a single
// unified JSON-LD artefact.
//
// Output is intended for external SPARQL / SHACL / OWL consumers that
// prefer a single document over fetching individual files by URL.
//
// Run via:
//   npm run export:ontology               # all configs, write to generated/<config>/ontology-bundle.json
//   npm run export:ontology -- --config camunda-oca --out path/to/bundle.json
//   npm run export:ontology -- --stdout   # print to stdout instead of writing
//
// The TBox slice URLs match the `$id`s published by publish-ontology.yml
// at https://camunda.github.io/api-test-generator/ns/v1/<slice>.schema.json
// so a consumer can dereference each TBox independently if they need to.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOCAB_DIR = join(REPO_ROOT, 'ontology', 'vocabulary');
const CONFIGS_DIR = join(REPO_ROOT, 'configs');
const CONFIGS_INDEX = join(REPO_ROOT, 'configs.json');
const NS_BASE = 'https://camunda.github.io/api-test-generator/ns/v1/';

interface ConfigsIndex {
  default: string;
  configs: Record<string, { description?: string }>;
}

interface OntologyBundle {
  $schema: 'https://camunda.github.io/api-test-generator/ns/v1/ontology-bundle.schema.json';
  $id: string;
  '@context': {
    '@vocab': string;
    tbox: { '@id': string; '@container': '@index' };
    abox: { '@id': string; '@container': '@index' };
  };
  generatedAt: string;
  generator: { repo: string; script: string };
  tbox: Record<string, unknown>;
  abox: Record<string, Record<string, unknown>>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConfigsIndex(value: unknown): value is ConfigsIndex {
  if (!isRecord(value)) return false;
  return typeof value.default === 'string' && isRecord(value.configs);
}

function loadConfigsIndex(): ConfigsIndex {
  const raw = readJson(CONFIGS_INDEX);
  if (!isConfigsIndex(raw)) {
    throw new Error(`configs.json has unexpected shape: ${CONFIGS_INDEX}`);
  }
  return raw;
}

function loadTBox(): Record<string, unknown> {
  const tbox: Record<string, unknown> = {};
  const files = readdirSync(VOCAB_DIR)
    .filter((f) => f.endsWith('.schema.json'))
    .sort();
  for (const file of files) {
    const slice = basename(file, '.schema.json');
    tbox[slice] = readJson(join(VOCAB_DIR, file));
  }
  return tbox;
}

function loadAbox(configName: string): Record<string, unknown> {
  const aboxDir = join(CONFIGS_DIR, configName, 'ontology');
  const abox: Record<string, unknown> = {};
  const files = readdirSync(aboxDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const file of files) {
    const slice = basename(file, '.json');
    abox[slice] = readJson(join(aboxDir, file));
  }
  return abox;
}

function buildBundle(configNames: readonly string[]): OntologyBundle {
  const abox: Record<string, Record<string, unknown>> = {};
  for (const name of configNames) {
    abox[name] = loadAbox(name);
  }
  return {
    $schema: 'https://camunda.github.io/api-test-generator/ns/v1/ontology-bundle.schema.json',
    $id: `${NS_BASE}ontology-bundle.json`,
    '@context': {
      '@vocab': NS_BASE,
      tbox: { '@id': `${NS_BASE}tbox`, '@container': '@index' },
      abox: { '@id': `${NS_BASE}abox`, '@container': '@index' },
    },
    generatedAt: new Date().toISOString(),
    generator: {
      repo: 'camunda/api-test-generator',
      script: 'scripts/export-ontology.ts',
    },
    tbox: loadTBox(),
    abox,
  };
}

interface CliArgs {
  configs: readonly string[];
  out?: string;
  stdout: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let stdout = false;
  let out: string | undefined;
  const configs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stdout') {
      stdout = true;
    } else if (arg === '--out') {
      out = argv[++i];
      if (typeof out !== 'string') throw new Error('--out requires a path');
    } else if (arg === '--config') {
      const v = argv[++i];
      if (typeof v !== 'string') throw new Error('--config requires a name');
      configs.push(v);
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: tsx scripts/export-ontology.ts [--config <name> ...] [--out <path> | --stdout]\n',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { configs, out, stdout };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const index = loadConfigsIndex();
  const configs = args.configs.length > 0 ? args.configs : Object.keys(index.configs);
  for (const name of configs) {
    if (!(name in index.configs)) {
      throw new Error(`Unknown config '${name}'. Known: ${Object.keys(index.configs).join(', ')}`);
    }
  }

  const bundle = buildBundle(configs);
  const rendered = `${JSON.stringify(bundle, null, 2)}\n`;

  if (args.stdout) {
    process.stdout.write(rendered);
    return;
  }

  const outPath =
    args.out ??
    join(REPO_ROOT, 'generated', configs.length === 1 ? configs[0] : 'all', 'ontology-bundle.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, rendered, 'utf8');
  process.stdout.write(
    `wrote ${outPath} (${configs.length} config(s), ${rendered.length} bytes)\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
