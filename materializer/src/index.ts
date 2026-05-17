import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  getFeatureOutputDir,
  getPlaywrightCodegenOptions,
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
import { getEmitter, listEmitters, registerEmitter } from './registry.js';

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

  // Wipe before write so emitted spec files left over from a previous spec
  // version cannot survive into the current run. Without this, local
  // pre-push validation can diverge from CI (which always sees a fresh tree).
  // The support/ tree, README.md, and responses.json are re-materialised below.
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  // Per-config Playwright codegen options
  // (configs.json#configs.<active>.codegen.playwright). Resolved INSIDE the
  // emitter.id check so a malformed `codegen.playwright` block cannot fail
  // codegen runs that target a non-Playwright emitter and don't consume
  // these options. Declared with the wider scope so writeEmitted below can
  // forward it; non-Playwright targets see `undefined`, which the
  // EmitContext schema already treats as "use the default".
  let recordResponses: boolean | undefined;
  // Lift 12 / #231: per-role template bundles for the active config's
  // Playwright emitter. Loaded from configs/<config>/codegen/playwright/roles/
  // and threaded into every EmitContext below. `undefined` for non-Playwright
  // emitters (computed inside the gate below). Per-role scope additions
  // (e.g. spec-derived `extracts` for deploymentGateway) live in
  // `roleExtras`, keyed by role name.
  let roleBundles: Map<string, import('./playwright/roleRenderer.js').LoadedRoleBundle> | undefined;
  let roleExtras: Map<string, Record<string, unknown>> | undefined;
  let getRoleForOperationFn: ((opId: string) => string | undefined) | undefined;
  if (emitter.id === 'playwright') {
    const codegenOpts = getPlaywrightCodegenOptions(repoRoot);
    recordResponses = codegenOpts.recordResponses;
    const excludeSupportFiles = recordResponses ? undefined : ['recorder.ts'];
    await materializeSupport(outDir, undefined, undefined, true, excludeSupportFiles);
    // Lift 12 / #231: load per-role bundles and vendor their helper files
    // alongside the built-in support files. Roles bound in the ABox but
    // missing a bundle raise at render time (see roleRenderer.findRoleForStep
    // in playwright/emitter.ts).
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
    // Gate the deploymentGateway-specific roleExtras on deploymentGatewayOpId
    // since loading the full operation graph is only needed to compute the
    // spec-driven extracts list for that role.
    if (deploymentGatewayOpId) {
      const graph = await loadGraph(baseDir);
      const deployOp = graph.operations[deploymentGatewayOpId];
      const extracts = computeDeploymentExtracts(deployOp);
      roleExtras = new Map<string, Record<string, unknown>>();
      roleExtras.set(DEPLOYMENT_GATEWAY_ROLE, { extracts: JSON.stringify(extracts) });
    }
  }

  if (positional === '--all') {
    let count = 0;
    for (const f of files) {
      try {
        const content = await fs.readFile(path.join(featureDir, f), 'utf8');
        const parsed = parseScenarioCollection(content);
        if (!parsed.endpoint?.operationId) continue;
        await writeEmitted(emitter, parsed, {
          outDir,
          suiteName: parsed.endpoint.operationId,
          mode: 'feature',
          globalContextSeeds,
          recordResponses,
          getRoleForOperation: getRoleForOperationFn,
          roleBundles,
          roleExtras,
        });
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
        await writeEmitted(emitter, parsed, {
          outDir,
          suiteName: parsed.endpoint.operationId,
          mode: 'variant',
          globalContextSeeds,
          recordResponses,
          getRoleForOperation: getRoleForOperationFn,
          roleBundles,
          roleExtras,
        });
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
  await writeEmitted(emitter, json, {
    outDir,
    suiteName: endpointOpId,
    mode: 'feature',
    globalContextSeeds,
    recordResponses,
    getRoleForOperation: getRoleForOperationFn,
    roleBundles,
    roleExtras,
  });
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
