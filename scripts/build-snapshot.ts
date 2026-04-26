#!/usr/bin/env -S npx tsx
/**
 * Capture / update the pipeline output snapshot.
 *
 * Reads the four output trees (semantic-graph-extractor, path-analyser
 * scenarios, path-analyser generated Playwright tests, request-validation
 * generated tests), hashes every file with SHA-256, and writes the manifest
 * to tests/regression/pipeline-snapshot.json.
 *
 * Run this AFTER regenerating the pipeline whenever you intentionally
 * change generator behaviour:
 *
 *   npm run testsuite:generate && npm run generate:request-validation
 *   npm run snapshot:update
 *
 * The regression test (tests/regression/pipeline-snapshot.test.ts) then
 * compares current on-disk outputs against this snapshot.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const SNAPSHOT_PATH = join(REPO_ROOT, 'tests', 'regression', 'pipeline-snapshot.json');

const OUTPUT_TREES = [
  'semantic-graph-extractor/dist/output',
  'path-analyser/dist/output',
  'path-analyser/dist/generated-tests',
  'request-validation/generated',
] as const;

/**
 * Path patterns that may appear inside an output tree but represent runtime
 * artifacts (Playwright runs, npm installs) rather than generator output.
 * They MUST be excluded from the snapshot — otherwise the snapshot drifts
 * locally vs. CI depending on whether tests / installs ran first.
 */
const EXCLUDE_SEGMENTS = ['/node_modules/', '/test-results/', '/playwright-report/'];

function isExcluded(relPath: string): boolean {
  return EXCLUDE_SEGMENTS.some((seg) => relPath.includes(seg));
}

interface Manifest {
  generatedAt: string;
  fileCount: number;
  trees: string[];
  files: Record<string, string>;
}

function listFilesRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

function hashFile(absPath: string, relPath: string): string {
  const buf = readFileSync(absPath);
  // Strip volatile fields from generator summary files before hashing so the
  // snapshot reflects generator behaviour, not wall-clock metadata.
  if (relPath.endsWith('/dist/output/index.json')) {
    const parsed: unknown = JSON.parse(buf.toString('utf8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const clone: Record<string, unknown> = { ...parsed };
      delete clone.generatedAt;
      delete clone.nodeVersion;
      const normalised = JSON.stringify(clone, null, 2);
      return createHash('sha256').update(normalised).digest('hex');
    }
  }
  return createHash('sha256').update(buf).digest('hex');
}

export function buildManifest(): Manifest {
  const files: Record<string, string> = {};
  for (const tree of OUTPUT_TREES) {
    const absRoot = join(REPO_ROOT, tree);
    for (const file of listFilesRecursive(absRoot)) {
      const rel = relative(REPO_ROOT, file).replaceAll('\\', '/');
      if (isExcluded(`/${rel}`)) continue;
      files[rel] = hashFile(file, rel);
    }
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return {
    generatedAt: new Date().toISOString(),
    fileCount: Object.keys(sorted).length,
    trees: [...OUTPUT_TREES],
    files: sorted,
  };
}

export function snapshotPath(): string {
  return SNAPSHOT_PATH;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = buildManifest();
  if (m.fileCount === 0) {
    console.error('No output files found. Run the generation pipeline first.');
    process.exit(1);
  }
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
  console.log(`Wrote snapshot: ${m.fileCount} files -> ${relative(REPO_ROOT, SNAPSHOT_PATH)}`);
}
