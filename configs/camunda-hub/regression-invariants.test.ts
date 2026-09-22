import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getActiveConfigName,
  getPlaywrightSuiteDir,
  getRequestValidationSuiteDir,
  getSpecBundleDir,
} from '../../path-analyser/src/configResolver.js';

/**
 * Bundled-spec invariants — Layer 3, camunda-hub config (#128).
 *
 * The camunda-hub counterpart of configs/camunda-oca/regression-invariants.test.ts:
 * each `it` is a single named regression statement of the form "X must hold for
 * the hub bundled-spec output". These lock in behaviours already proven correct
 * against a live hub (see #408 verification) so a generator regression surfaces
 * as one named failure rather than a red nightly.
 *
 * Per-config guard (#128): this file lives under configs/camunda-hub/ and only
 * runs when the active CONFIG is camunda-hub. `describe.skipIf` collects the
 * file but skips the suite for any other config, so the default `npm test`
 * (camunda-oca) no-ops here and a camunda-hub CI leg runs it against the
 * regenerated hub output.
 *
 * Prerequisites: the hub pipeline must have been generated for the PINNED spec.
 * Hub bundles in local mode from the ../camunda-hub sibling clone (SPEC_REF is
 * ignored — fetch-spec bundles whatever ref that clone has checked out), so
 * check out the pin *there* first, then bundle + generate:
 *   git -C ../camunda-hub checkout <specRef from configs/camunda-hub/spec-pin.json>
 *   CONFIG=camunda-hub npm run fetch-spec
 *   CONFIG=camunda-hub npm run testsuite:generate
 * The spec-pin gate (tests/regression/spec-pin.setup.ts) then aborts on drift
 * from configs/camunda-hub/spec-pin.json before these assertions load.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const CONFIG_NAME = 'camunda-hub';
const ACTIVE_CONFIG = getActiveConfigName(REPO_ROOT);
const describeForThisConfig = describe.skipIf(ACTIVE_CONFIG !== CONFIG_NAME);

const SUITE_DIR = getPlaywrightSuiteDir(REPO_ROOT);
const BUNDLED_SPEC_PATH = join(getSpecBundleDir(REPO_ROOT), 'rest-api.bundle.json');
const COVERAGE_PATH = join(SUITE_DIR, 'coverage.json');
const RV_SECURED_VERSIONS_PATH = join(
  getRequestValidationSuiteDir(REPO_ROOT),
  'secured',
  'versions-validation-api-tests.spec.ts',
);
const RV_SECURED_CATALOG_PATH = join(
  getRequestValidationSuiteDir(REPO_ROOT),
  'secured',
  'catalog-validation-api-tests.spec.ts',
);

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Mirror the OCA file's actionable-missing-output pattern: fail with a clear
// "not generated — run this" message instead of a low-signal ENOENT, so a
// suite that hasn't been generated (the common local-repro slip) is obvious.
const GEN_HINT =
  "check out the pinned specRef in ../camunda-hub, then run 'CONFIG=camunda-hub npm run fetch-spec && CONFIG=camunda-hub npm run testsuite:generate'";
function readRequired(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Hub pipeline output not found at ${path}. To reproduce: ${GEN_HINT}.`);
  }
  return readFileSync(path, 'utf8');
}

let _bundleOpIdsCache: Set<string> | undefined;
function bundleOperationIds(): Set<string> {
  if (_bundleOpIdsCache) return _bundleOpIdsCache;
  const raw: unknown = JSON.parse(readRequired(BUNDLED_SPEC_PATH));
  const ids = new Set<string>();
  if (isRecord(raw) && isRecord(raw.paths)) {
    for (const item of Object.values(raw.paths)) {
      if (!isRecord(item)) continue;
      for (const [method, op] of Object.entries(item)) {
        if (!HTTP_METHODS.has(method.toLowerCase())) continue;
        if (isRecord(op) && typeof op.operationId === 'string') ids.add(op.operationId);
      }
    }
  }
  _bundleOpIdsCache = ids;
  return ids;
}

function readGeneratedSpec(relPath: string): string {
  return readRequired(join(SUITE_DIR, relPath));
}

function explicitlySuppressedOpIds(): string[] {
  const raw: unknown = JSON.parse(readRequired(COVERAGE_PATH));
  if (isRecord(raw) && Array.isArray(raw.explicitlySuppressedOpIds)) {
    return raw.explicitlySuppressedOpIds.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

const ENTITY_LIFECYCLE = 'templates/EntityLifecycle';
const EDGE_LIFECYCLE = 'templates/EdgeLifecycle';

describeForThisConfig('camunda-hub bundled-spec invariants (#128)', () => {
  // --- Surface: the modelled hub API is present in the bundle ---------------
  it('the bundle exposes the workspace/project/file/folder create operations', () => {
    const ids = bundleOperationIds();
    for (const op of ['createWorkspace', 'createProject', 'createFile', 'createFolder']) {
      expect(ids.has(op), `${op} missing from bundled hub spec`).toBe(true);
    }
  });

  it('the bundle exposes the workspace-member edge operations', () => {
    const ids = bundleOperationIds();
    for (const op of ['addMember', 'removeMember', 'searchMembers']) {
      expect(ids.has(op), `${op} missing from bundled hub spec`).toBe(true);
    }
  });

  // --- Lifecycle generation --------------------------------------------------
  it('generates an entity lifecycle spec for each container entity', () => {
    for (const entity of ['Workspace', 'Project', 'Folder', 'File']) {
      const path = join(SUITE_DIR, ENTITY_LIFECYCLE, `${entity}.lifecycle.spec.ts`);
      expect(existsSync(path), `${entity}.lifecycle.spec.ts not generated`).toBe(true);
    }
  });

  it('generates the WorkspaceMemberMembership edge lifecycle spec', () => {
    const path = join(SUITE_DIR, EDGE_LIFECYCLE, 'WorkspaceMemberMembership.lifecycle.spec.ts');
    expect(existsSync(path)).toBe(true);
  });

  // --- Server-minted-key chaining (#408 Gap 1) -------------------------------
  it('File lifecycle chains createWorkspace → createProject → createFile (no search-discovery for keys)', () => {
    const spec = readGeneratedSpec(`${ENTITY_LIFECYCLE}/File.lifecycle.spec.ts`);
    expect(spec).toContain('createWorkspace');
    expect(spec).toContain('createProject');
    expect(spec).toContain('createFile');
    // The parent projectKey comes from the create-chain, never sourced by
    // searching for a pre-existing project (fragile, `items[0]` may be undefined).
    expect(spec).not.toContain('searchProjects');
  });

  // --- Edge scope-key chaining (#408 Gap 2) ----------------------------------
  it('the edge lifecycle chains createWorkspace and uses the extracted workspaceKey in addMember', () => {
    const spec = readGeneratedSpec(`${EDGE_LIFECYCLE}/WorkspaceMemberMembership.lifecycle.spec.ts`);
    expect(spec).toContain('createWorkspace');
    // addMember's path scope key is the extracted var, not a fresh seed.
    expect(spec).toContain('workspaceKeyVar');
    expect(spec).toMatch(/\/workspaces\/\$\{ctx\.workspaceKeyVar/);
  });

  // --- Nested filter-scope binding (#408 Gap 3) ------------------------------
  it('searchVersions scopes its filter to the produced fileKey, not a placeholder', () => {
    const spec = readGeneratedSpec('searchVersions.feature.spec.ts');
    expect(spec).toContain('fileKey: ctx.fileKeyVar');
    expect(spec).not.toMatch(/fileKey:\s*'placeholder'/);
  });

  // --- Suppression contract (upstream-blocked ops stay out of the suite) -----
  it('catalog blocker is explicitly suppressed from the positive suite', () => {
    const suppressed = new Set(explicitlySuppressedOpIds());
    // deleteCatalogAsset: blocked on #25576 (no obtainable assetKey).
    for (const op of ['deleteCatalogAsset']) {
      expect(suppressed.has(op), `${op} should be explicitly suppressed`).toBe(true);
    }
  });

  // The other half of the contract above: camunda-hub#28913 (SNAPSHOT frozen
  // mid-inc-8019) is resolved — verified live 2026-09-22 against a freshly
  // published camunda/hub:SNAPSHOT, searchCatalogAssetFileUsages now returns
  // 200 for a real assetKey — so it must NOT be suppressed. Without this,
  // re-adding it to positive-suppress.json later would pass every other
  // invariant in this file silently; this one exists solely to catch that
  // regression.
  it('searchCatalogAssetFileUsages (unblocked by camunda-hub#28713) is NOT suppressed from the positive suite', () => {
    const suppressed = new Set(explicitlySuppressedOpIds());
    expect(
      suppressed.has('searchCatalogAssetFileUsages'),
      'searchCatalogAssetFileUsages should NOT be suppressed — see positive-suppress.json',
    ).toBe(false);
  });

  it('searchCatalogAssetFileUsages has a non-empty generated positive-suite feature spec', () => {
    // Guarded on bundle presence like the suppression check above: this op
    // could be absent from an older pinned bundle, and an unconditional
    // readGeneratedSpec would throw loudly on ENOENT rather than reporting a
    // clean, actionable failure — same reasoning as bundleOperationIds()'s
    // other conditional guard.
    if (!bundleOperationIds().has('searchCatalogAssetFileUsages')) return;
    const spec = readGeneratedSpec('searchCatalogAssetFileUsages.feature.spec.ts');
    expect(spec, 'searchCatalogAssetFileUsages.feature.spec.ts has no emitted test').toContain(
      'test(',
    );
  });

  // The positive-suite guards above have no negative-suite counterpart: the
  // request-validation generator doesn't fail on an absent operation, so
  // re-adding searchCatalogAssetFileUsages to excludeOperations later would
  // leave the nightly green while silently dropping the promised negative
  // coverage. Same bundle-presence guard as above.
  it('searchCatalogAssetFileUsages keeps negative-suite coverage', () => {
    if (!bundleOperationIds().has('searchCatalogAssetFileUsages')) return;
    const spec = readRequired(RV_SECURED_CATALOG_PATH);
    expect(spec, 'searchCatalogAssetFileUsages has no negative-suite tests').toContain(
      "test('searchCatalogAssetFileUsages",
    );
  });

  // The other half of the contract above: these 5 ops were blocked on
  // camunda-hub#25801 — closed as a duplicate of #27382, which was fixed
  // (PR #27610 lifted the public-API restriction on in-process-application
  // version creation) — so they must NOT be suppressed. Without this,
  // re-adding any one of them to positive-suppress.json later would pass
  // every other invariant in this file silently; this one exists solely to
  // catch that regression.
  it('version ops (unblocked by camunda-hub#27382/#27610) are NOT suppressed from the positive suite', () => {
    const suppressed = new Set(explicitlySuppressedOpIds());
    for (const op of [
      'createVersion',
      'getVersion',
      'updateVersion',
      'deleteVersion',
      'restoreVersion',
    ]) {
      expect(
        suppressed.has(op),
        `${op} should NOT be suppressed — see positive-suppress.json`,
      ).toBe(false);
    }
  });

  // Not-suppressed alone doesn't prove coverage exists: the planner could
  // still emit zero feature/variant specs for an op (or the op could vanish
  // from the bundle) while the suppression check above stays green. The
  // emitter writes `<op>.feature.spec.ts` even for an empty scenario
  // collection, so file existence alone isn't proof either — assert the
  // file actually contains an emitted `test(` block.
  it('each unblocked version op has a non-empty generated positive-suite feature spec', () => {
    for (const op of [
      'createVersion',
      'getVersion',
      'updateVersion',
      'deleteVersion',
      'restoreVersion',
    ]) {
      const spec = readGeneratedSpec(`${op}.feature.spec.ts`);
      expect(spec, `${op}.feature.spec.ts has no emitted test`).toContain('test(');
    }
  });

  // The positive-suite guards above have no negative-suite counterpart: the
  // request-validation generator doesn't fail on an absent operation, so
  // re-adding updateVersion/restoreVersion to excludeOperations (or otherwise
  // losing their scenarios) would leave the nightly green while silently
  // dropping the promised negative coverage. Assert each version op still
  // has negative tests, and pin the first of updateVersion's two intentional
  // gaps (malformed-json-body, camunda-hub#28911 — the second, missing-
  // required/explicit-null-required, is pinned in the next test below) so
  // together they stay a fixed, documented pair rather than silently
  // widening.
  it('each version op keeps negative-suite coverage, with only updateVersion malformed-json-body omitted here (see the next test for its other gap)', () => {
    const spec = readRequired(RV_SECURED_VERSIONS_PATH);
    for (const op of [
      'createVersion',
      'getVersion',
      'updateVersion',
      'deleteVersion',
      'restoreVersion',
    ]) {
      expect(spec, `${op} has no negative-suite tests`).toContain(`test('${op}`);
    }
    expect(
      spec,
      'updateVersion malformed-json-body should stay excluded — see request-validation.json',
    ).not.toContain('updateVersion__malformedJsonBody');
  });

  // Pins the second of updateVersion's two intentional gaps (the first,
  // malformed-json-body, is pinned in the test above): camunda-hub#29306,
  // updateVersion not enforcing name as required — missing-required and
  // explicit-null cases. Same reasoning as the pin above; together the two
  // tests keep the pair fixed rather than letting either widen silently.
  it('updateVersion missing-required/explicit-null name coverage stays excluded (camunda-hub#29306)', () => {
    const spec = readRequired(RV_SECURED_VERSIONS_PATH);
    expect(
      spec,
      'updateVersion - Missing name should stay excluded — see request-validation.json',
    ).not.toContain("test('updateVersion - Missing name'");
    expect(
      spec,
      'updateVersion__explicitNull__name should stay excluded — see request-validation.json',
    ).not.toContain('updateVersion__explicitNull__name');
  });
});
