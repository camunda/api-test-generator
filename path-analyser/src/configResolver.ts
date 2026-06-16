import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolves the directory holding the active generator configuration's
 * per-config generator files (ontology ABoxes, filter-providers.json,
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
 * fields from the index can load `configs.json` exactly once per invocation.
 * A second read could see a different on-disk snapshot (TOCTOU), validate
 * against one and look up the config entry from another.
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

/**
 * Root of the per-config template-scenarios partition (#270). The
 * orchestrator wipes this entire tree before writing per-template
 * subdirectories so an ABox template that's been removed (or whose
 * `appliesTo` no longer matches any subject) can't leave a stale
 * directory behind. Deriving the wipe set from current `results`
 * would miss exactly those cases.
 */
export function getTemplateScenariosRootDir(repoRoot: string): string {
  return path.join(getScenariosDir(repoRoot), 'templates');
}

/**
 * Per-template subdirectory under the scenarios partition (#270).
 * Layout: `generated/<config>/scenarios/templates/<TemplateName>/`.
 * One JSON file per (template × subject) pair lands underneath.
 */
export function getTemplateScenariosDir(repoRoot: string, templateName: string): string {
  return path.join(getTemplateScenariosRootDir(repoRoot), templateName);
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

/**
 * Output directory for a non-Playwright SDK emitter.
 *
 * Each SDK target gets its own subdirectory under `generated/<config>/` so
 * every `codegen:<target>` run produces a self-contained, runnable artifact
 * without conflicting with the Playwright suite's scaffolding.
 *
 * @param emitterId  The `EmitterStrategy.id` value (e.g. `'js-sdk'`,
 *                   `'python-sdk'`, `'csharp-sdk'`).
 */
export function getSdkOutDir(repoRoot: string, emitterId: string): string {
  return path.join(getGeneratedDir(repoRoot), emitterId);
}

export function getRequestValidationSuiteDir(repoRoot: string): string {
  return path.join(getGeneratedDir(repoRoot), 'request-validation');
}

/**
 * Per-config planner caps (#292).
 *
 * Field names mirror the internal option keys consumed by
 * `generateScenariosForEndpoint` (`maxChainAlternatives`) and
 * `generateOptionalSubShapeVariants` (`maxVariantsPerEndpoint`) so the
 * config key is the option key — no translation layer.
 *
 * Defaults preserve the pre-#292 hard-codes so a config without a
 * `planner` block (or with a partial one) keeps the same emission
 * shape it had before the lift.
 *
 * NOT exposed here: the two inner `maxChainAlternatives: 1` caps inside
 * variant planning in `scenarioGenerator.ts`. Those are load-bearing
 * strategy constants (one producer chain per variant leaf is the whole
 * point of the variant emitter), not a budget — lifting them into
 * config would invite a user to break the strategy by raising them.
 */
export interface PlannerConfig {
  maxChainAlternatives: number;
  maxVariantsPerEndpoint: number;
}

const PLANNER_DEFAULTS: PlannerConfig = {
  maxChainAlternatives: 20,
  maxVariantsPerEndpoint: 20,
};

function readPositiveInt(
  raw: Record<string, unknown>,
  key: keyof PlannerConfig,
  configName: string,
): number | undefined {
  if (!Object.hasOwn(raw, key)) return undefined;
  const v = raw[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new Error(
      `Malformed configs.json: configs.${configName}.planner.${key} must be a positive integer; got ${JSON.stringify(v)}.`,
    );
  }
  return v;
}

export function getActivePlannerConfig(repoRoot: string): PlannerConfig {
  const index = loadConfigsIndex(repoRoot);
  const name = resolveActiveConfigName(index);
  const entry = index.configs[name];
  if (!isRecord(entry)) return { ...PLANNER_DEFAULTS };
  const planner = entry.planner;
  if (planner === undefined) return { ...PLANNER_DEFAULTS };
  if (!isRecord(planner)) {
    throw new Error(
      `Malformed configs.json: configs.${name}.planner must be an object when present.`,
    );
  }
  return {
    maxChainAlternatives:
      readPositiveInt(planner, 'maxChainAlternatives', name) ??
      PLANNER_DEFAULTS.maxChainAlternatives,
    maxVariantsPerEndpoint:
      readPositiveInt(planner, 'maxVariantsPerEndpoint', name) ??
      PLANNER_DEFAULTS.maxVariantsPerEndpoint,
  };
}

/**
 * Per-config spec source declaration (read from `configs.<name>.spec`).
 *
 * Two fetch modes, selected by which fields are present:
 *
 *   - **Network fetch** (`camunda-oca`): `repoUrl` + (optional) `entryFile`.
 *     `fetch-spec` passes `--ref $SPEC_REF` and `--repo-url` to
 *     `camunda-schema-bundler`, which sparse-clones the repo. NOTE: the
 *     bundler CLI derives the *in-repo* spec subdirectory from the ref
 *     (`zeebe/gateway-protocol/src/main/proto/v2` for `camunda/camunda`) and
 *     exposes no flag to override it — so network fetch only works for repos
 *     that ship the spec at that default path. A repo with a different
 *     in-repo path must use `localSpecDir` instead (tracked as an upstream
 *     bundler gap).
 *
 *   - **Local bundle** (`camunda-hub`): `localSpecDir` + (optional)
 *     `entryFile`. `fetch-spec` passes `--spec-dir <localSpecDir>` (resolved
 *     relative to the repo root) and skips the network entirely. Used when
 *     the spec lives in a private repo and/or at a non-default in-repo path;
 *     the spec directory is expected to be a sibling clone (e.g.
 *     `../camunda-hub/restapi/public-api/src/main/resources/openapi/v2`,
 *     matching `docker/start-hub.sh`'s `../camunda-hub` convention).
 */
export interface SpecSource {
  repoUrl?: string;
  entryFile?: string;
  localSpecDir?: string;
}

const SPEC_SOURCE_KEYS = ['repoUrl', 'entryFile', 'localSpecDir'] as const;

export function getActiveSpecSource(repoRoot: string): SpecSource {
  const index = loadConfigsIndex(repoRoot);
  const name = resolveActiveConfigName(index);
  const entry = index.configs[name];
  if (!isRecord(entry)) return {};
  const spec = entry.spec;
  if (spec === undefined) return {};
  if (!isRecord(spec)) {
    throw new Error(`Malformed configs.json: configs.${name}.spec must be an object when present.`);
  }
  const out: SpecSource = {};
  for (const key of SPEC_SOURCE_KEYS) {
    if (!Object.hasOwn(spec, key)) continue;
    const v = spec[key];
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(
        `Malformed configs.json: configs.${name}.spec.${key} must be a non-empty string when present.`,
      );
    }
    out[key] = v;
  }
  return out;
}
