#!/usr/bin/env tsx
/**
 * spec-operations — print the operationIds of the active config's bundled
 * spec, one per line, sorted.
 *
 * Used by the scheduled spec-bump dry-run (.github/workflows/spec-bump-dryrun.yml)
 * to diff the operation surface of the latest upstream spec against the pinned
 * one: `comm`-ing the pinned vs latest output surfaces added/removed operations
 * — the early "a whole new upstream domain appeared" heads-up #387 is about.
 *
 * Reads spec/<config>/bundled/rest-api.bundle.json (produced by fetch-spec), so
 * run fetch-spec for the desired ref first. Config comes from CONFIG (default
 * from configs.json), resolved the same way as the rest of the pipeline.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getSpecBundleDir } from '../path-analyser/src/configResolver.ts';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

function collectOperationIds(bundle: unknown): string[] {
  if (!isRecord(bundle) || !isRecord(bundle.paths)) return [];
  const ids: string[] = [];
  for (const item of Object.values(bundle.paths)) {
    if (!isRecord(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      if (isRecord(op) && typeof op.operationId === 'string' && op.operationId.trim() !== '') {
        ids.push(op.operationId);
      }
    }
  }
  // De-dupe + sort for a stable diff.
  return [...new Set(ids)].sort();
}

function main(): void {
  const bundlePath = join(getSpecBundleDir(REPO_ROOT), 'rest-api.bundle.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(bundlePath, 'utf8'));
  } catch (err) {
    console.error(
      `[spec-operations] cannot read bundle at ${bundlePath} — run fetch-spec first.\n${String(err)}`,
    );
    process.exit(2);
  }
  for (const id of collectOperationIds(raw)) {
    console.log(id);
  }
}

main();
