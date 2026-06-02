import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type EmitContext,
  type EmitterStrategy,
  getEmitter,
  type LoadedRoleBundle,
  listEmitters,
  type RoleHookProvider,
  registerEmitter,
  registerRoleHookProvider,
} from '@camunda8/emitter-sdk';
import {
  getActiveConfigDir,
  getActiveConfigName,
  getFeatureOutputDir,
  getPlaywrightSuiteDir,
  getSpecBundleDir,
  getTemplateScenariosDir,
  getTemplateScenariosRootDir,
  getVariantOutputDir,
} from 'path-analyser/configResolver';
import {
  assertSafeGlobalContextSeeds,
  deriveArtifactKindsViews,
  deriveGlobalContextSeedsViews,
  loadScenarioTemplatesAbox,
} from 'path-analyser/ontology/loader';
import { getEmitterRoleForOperation } from 'path-analyser/ontology/operationRoles';
import type { EndpointScenarioCollection, GlobalContextSeed } from 'path-analyser/types';
import { parseCliArgs } from './cli-args.js';
import { buildCoverage, type CoverageResult, templateOutputDir } from './coverage.js';
import { buildCoverageSummary, loadSpecOperationIds } from './coverageSummary.js';
import { writeEmitted, writeScaffolded } from './orchestrator.js';
import { PlaywrightEmitter } from './playwright/emitter.js';
import {
  materializeFixtures,
  materializeResponseSchemas,
  materializeRoleSupportFiles,
  materializeSupport,
} from './playwright/materialize-support.js';
import { loadRoleBundlesForActiveConfig } from './playwright/roleRenderer.js';
import { emitTemplateSuites } from './playwright/templateEmitter.js';
import { RoleHookConflictError, resolveRoleExtras } from './roleHookResolver.js';

// Built-in emitter registrations. RoleHookProviders are no longer
// registered statically here: every provider lives next to its role
// bundle under configs/<config>/codegen/playwright/roles/<role>/hook.ts
// and is discovered + registered at run time by `discoverRoleHooks`
// (Lift 19 / #261). This keeps the materializer a generic orchestrator
// — the previously hard-coded role-hook provider import
// pulled OCA-specific knowledge into a package that is supposed to be
// config-agnostic.
registerEmitter(PlaywrightEmitter);

/**
 * Walk the active config's role bundles and register any role-hook
 * providers shipped alongside them.
 *
 * Conventions enforced here:
 *   - A hook lives at `<roleDir>/hook.ts` and default-exports a
 *     `RoleHookProvider`.
 *   - `provider.role` must equal the role directory name, so the role
 *     dispatcher in the emitter (which keys `roleExtras` by role) and
 *     the directory layout cannot drift.
 *
 * The build/runtime gap is bridged via tsx (see `codegen:playwright`
 * scripts) — dynamic imports of `.ts` files only resolve when the
 * orchestrator is run under tsx, which is why the codegen scripts no
 * longer invoke `node materializer/dist/src/index.js` directly.
 */
async function discoverRoleHooks(roleBundles: Map<string, LoadedRoleBundle>): Promise<void> {
  for (const [roleName, bundle] of roleBundles) {
    const hookPath = path.join(bundle.dir, 'hook.ts');
    if (!fsSync.existsSync(hookPath)) continue;
    const mod = await import(pathToFileURL(hookPath).href);
    if (!isRoleHookProvider(mod.default)) {
      throw new Error(
        `Role hook ${hookPath} must default-export a RoleHookProvider with { hook: string, role: string, compute: function }.`,
      );
    }
    const provider: RoleHookProvider = mod.default;
    if (provider.role !== roleName) {
      throw new Error(
        `Role hook ${hookPath} declares role ${JSON.stringify(provider.role)} ` +
          `but lives under directory ${JSON.stringify(roleName)} — these must agree, ` +
          `otherwise the emitter will look for ctx.roleExtras[${JSON.stringify(roleName)}] ` +
          `and find nothing.`,
      );
    }
    registerRoleHookProvider(provider);
  }
}

function isRoleHookProvider(value: unknown): value is RoleHookProvider {
  if (typeof value !== 'object' || value === null) return false;
  if (!('hook' in value) || !('role' in value) || !('compute' in value)) return false;
  // biome-ignore lint/plugin: runtime contract boundary for a dynamic-imported module
  const v = value as { hook: unknown; role: unknown; compute: unknown };
  return (
    typeof v.hook === 'string' && typeof v.role === 'string' && typeof v.compute === 'function'
  );
}

// JSON.parse is a runtime contract boundary: the on-disk scenario files are
// produced by the generator and conform structurally to EndpointScenarioCollection.
// Downstream code accesses `.endpoint?.operationId` optionally and tolerates
// malformed entries via the surrounding try/catch.
function parseScenarioCollection(text: string): EndpointScenarioCollection {
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
  return JSON.parse(text) as EndpointScenarioCollection;
}

/**
 * Load `globalContextSeeds` from the per-config global-context-seeds
 * ABox (`configs/<active>/ontology/global-context-seeds.json`,
 * Lift 8 / #218). Returns `[]` when no ABox is shipped. The graphLoader
 * validates the ABox during planning, but we re-validate here because
 * these values are interpolated directly into emitted TS source — a
 * malformed entry (wrong type, unsafe characters, duplicate fieldName)
 * would produce a broken suite or, worse, allow config-driven code
 * injection.
 */
async function loadGlobalContextSeeds(baseDir: string): Promise<GlobalContextSeed[]> {
  const repoRoot = path.resolve(baseDir, '..');
  const aboxViews = deriveGlobalContextSeedsViews(repoRoot);
  if (aboxViews === null) return [];
  assertSafeGlobalContextSeeds(aboxViews.globalContextSeeds);
  return aboxViews.globalContextSeeds;
}

/**
 * Load this emitter's per-config knobs from
 * `configs/<configName>/codegen/<emitterId>/config.json`. Returns `{}`
 * when no such file exists (every field must have an explicit default
 * inside the emitter). Always validated against the emitter's
 * `configSchema` if one is declared.
 */
function loadEmitterConfig(configDir: string, emitter: EmitterStrategy): Record<string, unknown> {
  const configPath = path.join(configDir, 'codegen', emitter.id, 'config.json');
  if (!fsSync.existsSync(configPath)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(fsSync.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to read ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(
      `${configPath}: expected a JSON object, got ${Array.isArray(raw) ? 'array' : typeof raw}.`,
    );
  }
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
  const cfg = raw as Record<string, unknown>;
  validateEmitterConfig(emitter, cfg, configPath);
  return cfg;
}

/**
 * Minimal JSON-Schema validator covering only the constructs used by
 * built-in emitter configSchemas (object, additionalProperties=false,
 * top-level `properties` map with leaf `type` values from the subset
 * `boolean|string|number|integer|array|object|null`).
 * Keeps the SDK dependency-free — we deliberately avoid pulling in Ajv
 * for the small surface that emitter configs cover today. Schemas that
 * exceed this subset must extend this validator alongside.
 */
function validateEmitterConfig(
  emitter: EmitterStrategy,
  cfg: Record<string, unknown>,
  source: string,
): void {
  const schema = emitter.configSchema;
  if (!schema) return;
  const properties =
    typeof schema.properties === 'object' && schema.properties !== null
      ? // biome-ignore lint/plugin: JSONSchema is intentionally permissive (Record<string, unknown>); narrowing the leaf to a typed shape is the validator's job
        (schema.properties as Record<string, { type?: string }>)
      : {};
  const additionalProperties = schema.additionalProperties;
  if (additionalProperties === false) {
    for (const key of Object.keys(cfg)) {
      if (!Object.hasOwn(properties, key)) {
        throw new Error(
          `${source}: unknown key '${key}' for emitter '${emitter.id}'. ` +
            `Allowed: ${Object.keys(properties).join(', ') || '(none)'}.`,
        );
      }
    }
  }
  for (const [key, value] of Object.entries(cfg)) {
    const spec = properties[key];
    if (!spec || typeof spec.type !== 'string') continue;
    if (!matchesJsonType(value, spec.type)) {
      throw new Error(
        `${source}: key '${key}' for emitter '${emitter.id}' must be of type ${spec.type}, got ${typeof value}.`,
      );
    }
  }
}

function matchesJsonType(value: unknown, jsonType: string): boolean {
  switch (jsonType) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'null':
      return value === null;
    default:
      throw new Error(`Unsupported JSON schema type '${jsonType}'.`);
  }
}

/**
 * Read the active config's `codegen/emitters.json` registry. The file
 * declares which emitters this config supports; the orchestrator
 * cross-checks the requested `--target` against this list and against
 * the emitter's own `supportedConfigs`.
 *
 * Returns the array of emitter ids. Throws when the file is missing or
 * malformed — configs MUST be explicit about which emitters they
 * authorise.
 */
function loadEnabledEmitters(configDir: string): string[] {
  const file = path.join(configDir, 'codegen', 'emitters.json');
  if (!fsSync.existsSync(file)) {
    throw new Error(
      `Missing ${file}. Every config must declare its enabled emitters as ` +
        `{"emitters": ["playwright", ...]}.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fsSync.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${file}: expected a JSON object with an "emitters" array.`);
  }
  // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.emitters) || !obj.emitters.every((s) => typeof s === 'string')) {
    throw new Error(`${file}: "emitters" must be an array of strings.`);
  }
  // biome-ignore lint/plugin: just validated above that every element is a string
  return obj.emitters as string[];
}

function printUsage(): void {
  const targets = listEmitters()
    .map((e) => `${e.id} (${e.name})`)
    .join(', ');
  console.error(
    'Usage: tsx materializer/src/index.ts [--target=<id>] <operationId>|--all\n' +
      `Available targets: ${targets || '(none)'}`,
  );
}

// Walks up from process.cwd() to find the repo root, identified by the
// presence of configs.json. Allows the CLI to be invoked from any
// workspace (root, materializer/, path-analyser/) without per-cwd
// special-casing — the legacy heuristic only worked when CWD was the
// repo root or path-analyser/.
function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  let parent = path.dirname(dir);
  while (parent !== dir) {
    if (fsSync.existsSync(path.join(dir, 'configs.json'))) return dir;
    dir = parent;
    parent = path.dirname(dir);
  }
  if (fsSync.existsSync(path.join(dir, 'configs.json'))) return dir;
  throw new Error(
    `Could not find repo root (no configs.json found walking up from ${start}). ` +
      `Run from inside the api-test-generator repository.`,
  );
}

async function run() {
  const { target, positional, help } = parseCliArgs(process.argv.slice(2));
  const repoRoot = findRepoRoot(process.cwd());
  // loadGraph / loadGlobalContextSeeds were carved out of the original
  // path-analyser CLI and still take `baseDir = <repoRoot>/path-analyser`
  // (they compute repoRoot internally as `path.resolve(baseDir, '..')`).
  // Keep the contract; pass the conventional path so we don't churn the
  // planner-side API in this PR.
  const baseDir = path.join(repoRoot, 'path-analyser');
  // Per-config output partition (#128 PR 2): scenario inputs and the
  // emitted Playwright suite all live under generated/<config>/.
  const featureDir = getFeatureOutputDir(repoRoot);
  const variantDir = getVariantOutputDir(repoRoot);
  const outDir = getPlaywrightSuiteDir(repoRoot);

  if (help || !positional) {
    printUsage();
    process.exit(1);
  }

  const emitter = getEmitter(target);
  if (!emitter) {
    console.error(
      `Unknown emitter target: '${target}'. Available: ${listEmitters()
        .map((e) => e.id)
        .join(', ')}`,
    );
    process.exit(1);
  }

  // Validate this emitter is wired to the active config from both sides:
  //   1. emitter.supportedConfigs declares which configs the emitter targets;
  //   2. configs/<config>/codegen/emitters.json declares which emitters the
  //      config authorises. Both must agree before the orchestrator invokes
  //      `emit()` — otherwise an emitter could write into a config that
  //      didn't opt in to its output shape, or vice versa.
  const configName = getActiveConfigName(repoRoot);
  const configDir = getActiveConfigDir(repoRoot);
  const enabledEmitters = loadEnabledEmitters(configDir);
  if (!enabledEmitters.includes(emitter.id)) {
    console.error(
      `Emitter '${emitter.id}' is not enabled in config '${configName}'. ` +
        `Add it to ${path.join(configDir, 'codegen', 'emitters.json')}.`,
    );
    process.exit(1);
  }
  if (!emitter.supportedConfigs.includes('*') && !emitter.supportedConfigs.includes(configName)) {
    console.error(
      `Emitter '${emitter.id}' does not support config '${configName}'. ` +
        `Supported: ${emitter.supportedConfigs.join(', ')}.`,
    );
    process.exit(1);
  }
  const emitterConfig = loadEmitterConfig(configDir, emitter);
  const resolveConfigPath = (relative: string): string => path.resolve(configDir, relative);

  // Wipe before write so emitted spec files left over from a previous spec
  // version cannot survive into the current run. Without this, local
  // pre-push validation can diverge from CI (which always sees a fresh tree).
  // The support/ tree, README.md, and responses.json are re-materialised below.
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  // Lift 12 / #231: per-role template bundles for the active config's
  // Playwright emitter. Loaded from configs/<config>/codegen/playwright/roles/
  // and threaded into every EmitContext below. `undefined` for non-Playwright
  // emitters (computed inside the gate below). Per-role scope additions
  // (e.g. spec-derived `extracts` for deploymentGateway) live in
  // `roleExtras`, keyed by role name.
  let roleBundles: Map<string, LoadedRoleBundle> | undefined;
  let roleExtras: Map<string, Record<string, unknown>> | undefined;
  let getRoleForOperationFn: ((opId: string) => string | undefined) | undefined;
  if (emitter.id === 'playwright') {
    const recordResponses =
      typeof emitterConfig.recordResponses === 'boolean' ? emitterConfig.recordResponses : false;
    const excludeSupportFiles = recordResponses ? undefined : ['recorder.ts'];
    await materializeSupport(outDir, undefined, excludeSupportFiles);
    // Lift 12 / #231: load per-role bundles. Vendoring the role helper
    // files into <outDir>/support/ is deferred until after the role-hook
    // loop below populates `roleExtras` — templated helpers
    // (`support.<ext>.tmpl`, #243) are rendered against those extras at
    // codegen time so spec-derived constants (e.g. the deployment-gateway
    // `EXTRACTS` list) live inside the helper instead of being threaded
    // through every call-site literal.
    roleBundles = loadRoleBundlesForActiveConfig(repoRoot);
    // Lift 19 / #261: per-config role-hook discovery. Replaces the
    // static `registerRoleHookProvider(...)` for the deployment role
    // call at module load. Must run before the `emitter.roleHooks`
    // loop below resolves providers via `getRoleHookProvider(hook)`.
    await discoverRoleHooks(roleBundles);
    // Copy BPMN/DMN/form fixture files into <outDir>/fixtures/ so the suite
    // is self-contained: @@FILE:<rel-path> markers in emitted tests resolve
    // via support/fixtures.ts regardless of process.cwd().
    await materializeFixtures(outDir);
    // Also extract response-body schemas alongside the emitted specs so the
    // generated `validateResponse(...)` calls have a schema source. Co-located
    // here (rather than a separate npm script) so every codegen run produces
    // a runnable suite as a single artifact.
    await materializeResponseSchemas(outDir);
  }

  const files = (await fs.readdir(featureDir)).filter((f) => f.endsWith('-scenarios.json'));
  const globalContextSeeds = await loadGlobalContextSeeds(baseDir);
  // Lift 9 / #225: discriminator for the role-based dispatch in
  // emitters, sourced from the active config's artifact-kinds ABox
  // (`operationRules[].role`). `undefined` when no ABox is shipped —
  // role dispatch then has nothing to do and emitters take their
  // fallback path for every step.
  const artifactViews = deriveArtifactKindsViews(repoRoot);
  // Wire role dispatch + per-role extras for any emitter that opts in
  // via `roleHooks`. Previously, the orchestrator hard-coded
  // deployment-gateway knowledge inline; now it delegates to
  // `RoleHookProvider`s registered against the SDK (see #233 Step 6).
  if (emitter.id === 'playwright') {
    const domain = artifactViews
      ? { operationArtifactRules: artifactViews.operationArtifactRules }
      : undefined;
    getRoleForOperationFn = (opId: string) => getEmitterRoleForOperation(domain, opId);
  }
  // #350: roleHook resolution. Declarations are advisory — a config that
  // doesn't ship a provider for a declared hook simply doesn't populate
  // the corresponding role's extras. Operations actually dispatched to
  // the unbacked role surface a named error at materialization time
  // (`findRoleForStep` in playwright/emitter.ts and the support-template
  // assertions in materialize-support.ts). The resolver throws
  // `RoleHookConflictError` on duplicate-role conflicts (formerly
  // `process.exit(1)` here); any other error from a provider’s
  // `compute()` propagates with its full stack so unexpected hook bugs
  // remain debuggable.
  try {
    roleExtras = await resolveRoleExtras(emitter, { repoRoot, configName });
  } catch (err) {
    if (!(err instanceof RoleHookConflictError)) throw err;
    console.error(err.message);
    process.exit(1);
  }

  // #243: Vendor per-role helper files now that `roleExtras` is populated,
  // so templated helpers (`support.<ext>.tmpl`) render against the same
  // per-role data the call-site renderer sees. Roles bound in the ABox but
  // missing a bundle raise at render time (see roleRenderer.findRoleForStep
  // in playwright/emitter.ts). The wider materializer LoadedRoleBundle
  // (which carries `supportFilePath` and `supportIsTemplated`) is
  // structurally a superset of the SDK shape, so we feed it straight into
  // `materializeRoleSupportFiles` and the same map into ctx.roleBundles.
  if (emitter.id === 'playwright' && roleBundles) {
    await materializeRoleSupportFiles(outDir, roleBundles, roleExtras);
  }

  function buildCtx(suiteName: string, mode: 'feature' | 'variant'): EmitContext {
    return {
      outDir,
      suiteName,
      mode,
      configName,
      emitterConfig,
      resolveConfigPath,
      globalContextSeeds,
      getRoleForOperation: getRoleForOperationFn,
      roleBundles,
      roleExtras,
    };
  }

  // #233 Step 7: one-shot project-root scaffolding via the SDK contract.
  // Generic across emitters — Playwright today returns the five
  // PROJECT_TEMPLATE_FILES; future SDK emitters (JS/C#/Python) return their
  // own project framing. No-op when emitter.scaffold is omitted.
  // Called once per CLI invocation, before any emit() call, per
  // EmitterStrategy.scaffold's contract. suiteName/mode are unused by
  // scaffold itself but are part of the shared EmitContext type; pass safe
  // placeholders.
  await writeScaffolded(emitter, buildCtx('', 'feature'));

  if (positional === '--all') {
    // #335: scenario-template names are derived from the active
    // config's scenario-templates ABox — the single source of truth.
    // The materializer is a generic transformer: for each ABox row it
    // reads `scenarios/templates/<name>/` and emits to
    // `playwright/templates/<name>/`. The on-disk layout mirrors the
    // planner's so the scenario → emitted-spec relationship is visible
    // from the directory structure alone. Returns `[]` when no ABox
    // ships (template suites are then a no-op).
    const templatesAbox = loadScenarioTemplatesAbox(repoRoot);
    const templateNames = (templatesAbox?.templates ?? []).map((t) => t.name);

    // #331: scenario-template coverage. Build the suppression set
    // from on-disk template scenario JSONs before the feature loop so
    // operations covered by a well-formed scenario-template spec do
    // not also emit a structurally weaker per-endpoint feature spec.
    // Suppression only applies to emitters that ship the
    // corresponding template suites; for now that is Playwright.
    let coverage: CoverageResult = { suppressedOpIds: new Set(), entries: [] };
    if (emitter.id === PlaywrightEmitter.id) {
      coverage = await buildCoverage({
        templateScenariosRootDir: getTemplateScenariosRootDir(repoRoot),
        templatesAboxPath: path.join(configDir, 'ontology', 'scenario-templates.json'),
        templateNames,
      });
    }
    let count = 0;
    let suppressedCount = 0;
    // #335: track which opIds were emitted as feature specs so the
    // coverage summary can compute the unmapped set (ops in the spec
    // that are neither emitted as a feature spec nor suppressed by a
    // scenario-template lifecycle suite). Should be empty on a healthy
    // spec; a non-empty set surfaces planner / coverage drift.
    const emittedFeatureOpIds = new Set<string>();
    for (const f of files) {
      try {
        const content = await fs.readFile(path.join(featureDir, f), 'utf8');
        const parsed = parseScenarioCollection(content);
        if (!parsed.endpoint?.operationId) continue;
        if (coverage.suppressedOpIds.has(parsed.endpoint.operationId)) {
          suppressedCount++;
          continue;
        }
        await writeEmitted(emitter, parsed, buildCtx(parsed.endpoint.operationId, 'feature'));
        emittedFeatureOpIds.add(parsed.endpoint.operationId);
        count++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('Skipping file (parse/emission failed):', f, msg);
      }
    }
    // Issue #105: also materialise optional sub-shape variant scenarios
    // (#37) into Playwright tests. The variant-output directory is
    // populated by the planner only for endpoints with at least one
    // optional sub-shape; emit nothing when the directory is absent so
    // local runs that scope to feature scenarios still succeed.
    let variantCount = 0;
    let variantFiles: string[] = [];
    try {
      variantFiles = (await fs.readdir(variantDir)).filter((f) => f.endsWith('-scenarios.json'));
    } catch (e) {
      if (
        !(typeof e === 'object' && e !== null && 'code' in e && Reflect.get(e, 'code') === 'ENOENT')
      ) {
        throw e;
      }
    }
    for (const f of variantFiles) {
      try {
        const content = await fs.readFile(path.join(variantDir, f), 'utf8');
        const parsed = parseScenarioCollection(content);
        if (!parsed.endpoint?.operationId) continue;
        if (!parsed.scenarios?.length) continue;
        await writeEmitted(emitter, parsed, buildCtx(parsed.endpoint.operationId, 'variant'));
        variantCount++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('Skipping variant file (parse/emission failed):', f, msg);
      }
    }
    // Template-derived suites (Lift 22 / #270; extended in #280 with
    // EntityLifecycle, #305 with UpdatedFieldVisibleOnReadBack +
    // StateTransitionVisibleAfterAction). One Playwright suite per
    // subject under `<playwrightSuiteDir>/templates/<TemplateName>/`.
    // Only the Playwright emitter wires this — other emitters opt in
    // by implementing their own template-aware renderer. The scenarios
    // are produced by the planner (`scenarioTemplateInstantiator.ts`);
    // if a directory is missing (older planner runs, configs that
    // don't ship the corresponding template), `emitTemplateSuites`
    // no-ops. Adding a new template requires only an ABox row in
    // `configs/<config>/ontology/scenario-templates.json` (#335).
    let lifecycleCount = 0;
    if (emitter.id === PlaywrightEmitter.id) {
      const seedsArg = globalContextSeeds.map((s) => ({
        binding: s.binding,
        seedRule: s.seedRule,
        // #342: forward `omitWhenUnbound` so the template emitter's
        // `emitCtxSeeding` honours the same universal-prologue skip as
        // the per-endpoint emitter. Without this, template-derived
        // lifecycle suites would still auto-seed `tenantIdVar` and put
        // a value on the wire for ops that the design says should omit
        // the field.
        omitWhenUnbound: s.omitWhenUnbound,
      }));
      for (const templateName of templateNames) {
        const templateOutDir = path.join(outDir, templateOutputDir(templateName));
        // Wipe the per-template subdir for the same reason the parent
        // `outDir` is wiped above: stale specs from a previous spec
        // version must not survive into the current run.
        await fs.rm(templateOutDir, { recursive: true, force: true });
        const written = await emitTemplateSuites({
          scenariosDir: getTemplateScenariosDir(repoRoot, templateName),
          outDir: templateOutDir,
          globalContextSeeds: seedsArg,
        });
        lifecycleCount += written.length;
      }
    }
    // #335: build a deterministic coverage summary alongside the raw
    // suppression set / entries. The summary block answers "how many
    // operations in the spec are covered, by what kind of suite, and
    // by which template" without requiring readers to re-walk the
    // feature-output / template-scenarios directories. The summary is
    // emitted for every emitter so PR diffs and the
    // `npm run coverage:report` script see the same shape regardless
    // of which target the materializer was invoked for.
    const allSpecOpIds = await loadSpecOperationIds(getSpecBundleDir(repoRoot));
    const summary = buildCoverageSummary({
      allSpecOpIds,
      emittedFeatureOpIds,
      suppressedOpIds: coverage.suppressedOpIds,
      entries: coverage.entries,
      variantSpecs: variantCount,
      lifecycleSpecs: lifecycleCount,
    });
    // #331: persist the coverage artefact alongside the suites so it
    // is diffable in PRs and consumable by the L3 invariant in
    // configs/<config>/regression-invariants.test.ts. Written for
    // every emitter so the artefact's presence is independent of
    // whether the current target shipped template suites this run.
    await fs.writeFile(
      path.join(outDir, 'coverage.json'),
      `${JSON.stringify(
        {
          version: 2,
          config: configName,
          emitter: emitter.id,
          summary,
          suppressedOpIds: [...coverage.suppressedOpIds].sort(),
          entries: [...coverage.entries].sort((a, b) =>
            a.operationId === b.operationId
              ? a.template === b.template
                ? a.aboxRow.localeCompare(b.aboxRow) || a.stepKind.localeCompare(b.stepKind)
                : a.template.localeCompare(b.template)
              : a.operationId.localeCompare(b.operationId),
          ),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    console.log(
      `Generated test suites for ${count} endpoints (+${variantCount} variant suites, +${lifecycleCount} lifecycle suites, -${suppressedCount} suppressed by scenario-template coverage) in ${outDir} (target: ${emitter.id})`,
    );
    return;
  }

  const endpointOpId = positional;
  let match: string | null = null;
  for (const f of files) {
    const content = await fs.readFile(path.join(featureDir, f), 'utf8');
    try {
      const parsed = parseScenarioCollection(content);
      if (parsed.endpoint?.operationId === endpointOpId) {
        match = f;
        break;
      }
    } catch {
      /* ignore */
    }
  }
  if (!match) {
    console.error('Could not locate scenario file for operationId', endpointOpId);
    process.exit(1);
  }
  const json = parseScenarioCollection(await fs.readFile(path.join(featureDir, match), 'utf8'));
  await writeEmitted(emitter, json, buildCtx(endpointOpId, 'feature'));
  console.log('Generated test suite for', endpointOpId, 'at', outDir, `(target: ${emitter.id})`);
}

function _hyphenizeOp(op: string) {
  return op.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
// removed findMethodPrefix (obsolete)

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
