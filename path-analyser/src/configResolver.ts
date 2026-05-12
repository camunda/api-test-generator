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
 * Resolve the active config name against an already-loaded {@link ConfigsIndex}.
 *
 * Split out from {@link getActiveConfigName} so callers that also need other
 * fields from the index (e.g. {@link getPlaywrightCodegenOptions}) can load
 * `configs.json` exactly once per invocation. A second read could see a
 * different on-disk snapshot (TOCTOU), validate against one and look up the
 * config entry from another.
 */
function resolveActiveConfigName(index: ConfigsIndex): string {
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
  return resolveActiveConfigName(loadConfigsIndex(repoRoot));
}

export function getActiveConfigDir(repoRoot: string): string {
  return path.resolve(repoRoot, 'configs', getActiveConfigName(repoRoot));
}

/**
 * Options that control the Playwright emitter, sourced from
 * `configs.json#configs.<active>.codegen.playwright`.
 *
 * Every field is optional in the on-disk schema and has an explicit
 * default documented on the field. Missing `codegen` / `codegen.playwright`
 * blocks yield an all-defaults result without throwing.
 */
export interface PlaywrightCodegenOptions {
  /**
   * When true, every emitted scenario step appends a `recordResponse({...})`
   * call (and the suite imports `recordResponse`/`sanitizeBody` from
   * `./support/recorder`). When false, neither the call nor the import is
   * emitted, and `recorder.ts` is not vendored into the suite's `support/`
   * directory.
   *
   * Default: false. The recorder is opt-in tooling for downstream
   * response-shape diffing; suites that don't consume
   * `dist/runtime-observations/responses.jsonl` get cleaner output and
   * skip the per-step `fs.appendFile`.
   */
  recordResponses: boolean;
}

/**
 * Resolve the Playwright codegen options for the active config. Strict
 * shape-checking on the `codegen.playwright` block — a non-object, or a
 * non-boolean `recordResponses`, throws. Missing keys default.
 */
export function getPlaywrightCodegenOptions(repoRoot: string): PlaywrightCodegenOptions {
  // Single-pass: load configs.json exactly once and resolve the active
  // config name against that same snapshot. Calling getActiveConfigName()
  // here would re-read the file and could observe a different on-disk
  // state from the one we then index into below.
  const index = loadConfigsIndex(repoRoot);
  const name = resolveActiveConfigName(index);
  const entry = index.configs[name];
  if (!isRecord(entry)) {
    return { recordResponses: false };
  }
  if (!('codegen' in entry)) {
    return { recordResponses: false };
  }
  const codegen = entry.codegen;
  if (!isRecord(codegen)) {
    throw new Error(
      `Malformed configs.json: configs.${name}.codegen must be an object, got ${typeof codegen}.`,
    );
  }
  if (!('playwright' in codegen)) {
    return { recordResponses: false };
  }
  const playwright = codegen.playwright;
  if (!isRecord(playwright)) {
    throw new Error(
      `Malformed configs.json: configs.${name}.codegen.playwright must be an object, got ${typeof playwright}.`,
    );
  }
  let recordResponses = false;
  if ('recordResponses' in playwright) {
    const v = playwright.recordResponses;
    if (typeof v !== 'boolean') {
      throw new Error(
        `Malformed configs.json: configs.${name}.codegen.playwright.recordResponses must be a boolean, got ${typeof v}.`,
      );
    }
    recordResponses = v;
  }
  return { recordResponses };
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
