import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  type EmitContext,
  type EmitterStrategy,
  getEmitter,
  type LoadedRoleBundle,
  listEmitters,
  registerEmitter,
} from '@camunda8/emitter-sdk';
import {
  getActiveConfigDir,
  getActiveConfigName,
  getFeatureOutputDir,
  getPlaywrightSuiteDir,
  getVariantOutputDir,
} from 'path-analyser/configResolver';
import { loadGraph } from 'path-analyser/graphLoader';
import {
  assertSafeGlobalContextSeeds,
  deriveArtifactKindsViews,
  deriveGlobalContextSeedsViews,
} from 'path-analyser/ontology/loader';
import {
  DEPLOYMENT_GATEWAY_ROLE,
  findDeploymentGatewayOpId,
  getRoleForOperation,
} from 'path-analyser/ontology/operationRoles';
import type { EndpointScenarioCollection, GlobalContextSeed } from 'path-analyser/types';
import { parseCliArgs } from './cli-args.js';
import { computeDeploymentExtracts } from './deploymentExtracts.js';
import { writeEmitted } from './orchestrator.js';
import { PlaywrightEmitter } from './playwright/emitter.js';
import {
  materializeFixtures,
  materializeResponseSchemas,
  materializeRoleSupportFiles,
  materializeSupport,
} from './playwright/materialize-support.js';
import { loadRoleBundlesForActiveConfig } from './playwright/roleRenderer.js';

// Built-in emitter registration. New emitters register themselves here.
registerEmitter(PlaywrightEmitter);

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
 * top-level `properties` map with leaf `type: boolean|string|number`).
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
      return true;
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
    'Usage: node materializer/dist/src/index.js [--target=<id>] <operationId>|--all\n' +
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
    await materializeSupport(outDir, undefined, undefined, true, excludeSupportFiles);
    // Lift 12 / #231: load per-role bundles and vendor their helper files
    // alongside the built-in support files. Roles bound in the ABox but
    // missing a bundle raise at render time (see roleRenderer.findRoleForStep
    // in playwright/emitter.ts). The wider materializer LoadedRoleBundle
    // (which carries `supportFilePath`) is structurally a superset of the
    // SDK shape, so we feed it straight into `materializeRoleSupportFiles`
    // and assign the same map into ctx.roleBundles below.
    roleBundles = loadRoleBundlesForActiveConfig(repoRoot);
    await materializeRoleSupportFiles(outDir, roleBundles);
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
  // Lift 9 / #225: discriminator for the deployment-gateway routing in
  // the Playwright emitter, sourced from the active config's
  // artifact-kinds ABox (`operationRules[].role === "deploymentGateway"`).
  // `undefined` when no ABox is shipped, or when no rule declares the
  // role — the emitter will then take the inline-multipart path for
  // every step.
  const artifactViews = deriveArtifactKindsViews(repoRoot);
  const deploymentGatewayOpId = findDeploymentGatewayOpId(
    artifactViews ? { operationArtifactRules: artifactViews.operationArtifactRules } : undefined,
  );
  // Lift 12 / #231: wire role dispatch for all Playwright configs that ship
  // an ABox view, regardless of whether a deploymentGateway op is bound.
  // Gating getRoleForOperationFn on deploymentGatewayOpId would silently
  // disable role dispatch for any config that defines roles other than
  // deploymentGateway (or defines deploymentGateway roles but hasn't yet
  // bound the gateway op).
  if (emitter.id === 'playwright') {
    const domain = artifactViews
      ? { operationArtifactRules: artifactViews.operationArtifactRules }
      : undefined;
    getRoleForOperationFn = (opId: string) => getRoleForOperation(domain, opId);
    if (deploymentGatewayOpId) {
      const graph = await loadGraph(baseDir);
      const deployOp = graph.operations[deploymentGatewayOpId];
      const extracts = computeDeploymentExtracts(deployOp);
      roleExtras = new Map<string, Record<string, unknown>>();
      roleExtras.set(DEPLOYMENT_GATEWAY_ROLE, { extracts: JSON.stringify(extracts) });
    }
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

  if (positional === '--all') {
    let count = 0;
    for (const f of files) {
      try {
        const content = await fs.readFile(path.join(featureDir, f), 'utf8');
        const parsed = parseScenarioCollection(content);
        if (!parsed.endpoint?.operationId) continue;
        await writeEmitted(emitter, parsed, buildCtx(parsed.endpoint.operationId, 'feature'));
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
    console.log(
      `Generated test suites for ${count} endpoints (+${variantCount} variant suites) in ${outDir} (target: ${emitter.id})`,
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
