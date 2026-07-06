import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getActiveConfigName,
  getPlaywrightSuiteDir,
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

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function bundleOperationIds(): Set<string> {
  const raw: unknown = JSON.parse(readFileSync(BUNDLED_SPEC_PATH, 'utf8'));
  const ids = new Set<string>();
  if (!isRecord(raw) || !isRecord(raw.paths)) return ids;
  for (const item of Object.values(raw.paths)) {
    if (!isRecord(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      if (isRecord(op) && typeof op.operationId === 'string') ids.add(op.operationId);
    }
  }
  return ids;
}

function readGeneratedSpec(relPath: string): string {
  return readFileSync(join(SUITE_DIR, relPath), 'utf8');
}

function explicitlySuppressedOpIds(): string[] {
  const raw: unknown = JSON.parse(readFileSync(COVERAGE_PATH, 'utf8'));
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
  it('version + catalog blockers are explicitly suppressed from the positive suite', () => {
    const suppressed = new Set(explicitlySuppressedOpIds());
    // Blocked on camunda-hub#25801 (versions) and #25576 (catalog).
    for (const op of [
      'createVersion',
      'getVersion',
      'updateVersion',
      'deleteVersion',
      'restoreVersion',
      'deleteCatalogAsset',
    ]) {
      expect(suppressed.has(op), `${op} should be explicitly suppressed`).toBe(true);
    }
  });
});
