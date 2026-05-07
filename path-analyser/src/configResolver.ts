import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolves the directory holding the active generator configuration's
 * sidecar files (domain-semantics.json, filter-providers.json,
 * request-defaults.json, spec-pin.json).
 *
 * The active config name comes from `process.env.CONFIG`. If unset,
 * the default declared in the top-level `configs.json` is used.
 *
 * The name is validated in two ways before being used as a path
 * segment:
 *   1. It must match the safe pattern `^[a-z0-9][a-z0-9-]*$`
 *      (defense-in-depth against `..` / path-separator escapes).
 *   2. It must be a key in `configs.json`'s `configs` map (allowlist).
 *
 * See #128 for the broader configuration-driven generation work.
 */

const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

interface ConfigsIndex {
  default: string;
  configs: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function loadConfigsIndex(repoRoot: string): ConfigsIndex {
  const indexPath = path.resolve(repoRoot, 'configs.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to read configs.json at ${indexPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isRecord(raw) || typeof raw.default !== 'string' || !isRecord(raw.configs)) {
    throw new Error(
      `Malformed configs.json at ${indexPath}: expected { default: string, configs: object }`,
    );
  }
  return { default: raw.default, configs: raw.configs };
}

/**
 * Resolve the active config name. Reads `configs.json` at `repoRoot`
 * to:
 *   - look up the default name when `CONFIG` is unset
 *   - validate `CONFIG` against the declared allowlist
 *
 * @param repoRoot Absolute path to the api-test-generator repository
 *   root (the directory containing `configs.json`).
 */
export function getActiveConfigName(repoRoot: string): string {
  const index = loadConfigsIndex(repoRoot);
  const fromEnv = process.env.CONFIG?.trim();
  const name = fromEnv && fromEnv.length > 0 ? fromEnv : index.default;

  if (!SAFE_NAME.test(name)) {
    throw new Error(
      `Invalid CONFIG value: ${JSON.stringify(name)}. ` +
        `Config names must match ${SAFE_NAME} (no path separators, no '..').`,
    );
  }
  if (!Object.hasOwn(index.configs, name)) {
    const known = Object.keys(index.configs).join(', ') || '(none)';
    throw new Error(
      `Unknown CONFIG ${JSON.stringify(name)}. Declared configs in configs.json: ${known}.`,
    );
  }
  return name;
}

export function getActiveConfigDir(repoRoot: string): string {
  return path.resolve(repoRoot, 'configs', getActiveConfigName(repoRoot));
}

/**
 * Per-config layout helpers (#128 PR 2 — output partitioning).
 *
 * Convention:
 *   spec/<config>/bundled/      ← bundled OpenAPI + spec-metadata + semantic-kinds
 *   generated/<config>/graph/             ← semantic-graph-extractor output
 *   generated/<config>/scenarios/         ← path-analyser scenario JSON
 *   generated/<config>/feature-output/    ← path-analyser feature coverage JSON
 *   generated/<config>/variant-output/    ← path-analyser per-variant scenario JSON
 *   generated/<config>/playwright/        ← path-analyser emitted Playwright suite
 *   generated/<config>/request-validation/ ← request-validation emitted negative suite
 *
 * Keeping the layout in one module lets consumers (loaders, codegen,
 * tests, CI artefact paths) ask for the right directory by name rather
 * than concatenating string literals; renaming a partition is a single
 * edit here.
 */
export function getSpecBundleDir(repoRoot: string): string {
  return path.resolve(repoRoot, 'spec', getActiveConfigName(repoRoot), 'bundled');
}

export function getGeneratedDir(repoRoot: string): string {
  return path.resolve(repoRoot, 'generated', getActiveConfigName(repoRoot));
}

export function getGraphDir(repoRoot: string): string {
  return path.join(getGeneratedDir(repoRoot), 'graph');
}

export function getScenariosDir(repoRoot: string): string {
  return path.join(getGeneratedDir(repoRoot), 'scenarios');
}

export function getFeatureOutputDir(repoRoot: string): string {
  return path.join(getGeneratedDir(repoRoot), 'feature-output');
}

export function getVariantOutputDir(repoRoot: string): string {
  return path.join(getGeneratedDir(repoRoot), 'variant-output');
}

export function getPlaywrightSuiteDir(repoRoot: string): string {
  return path.join(getGeneratedDir(repoRoot), 'playwright');
}

export function getRequestValidationSuiteDir(repoRoot: string): string {
  return path.join(getGeneratedDir(repoRoot), 'request-validation');
}
