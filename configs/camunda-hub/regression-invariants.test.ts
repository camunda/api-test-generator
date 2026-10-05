import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

  // camunda-hub#25576 resolved (verified live 2026-09-22): deleteCatalogAsset
  // now genuinely deletes a real, ingested-and-read-back assetKey (204,
  // confirmed gone on re-search). It runs against its own disposable asset
  // now (scripts/e2e/run-hub.sh, #598), so it must NOT be suppressed —
  // without this, re-adding it to positive-suppress.json later would pass
  // every other invariant in this file silently.
  it('deleteCatalogAsset (unblocked by camunda-hub#25576) is NOT suppressed from the positive suite', () => {
    const suppressed = new Set(explicitlySuppressedOpIds());
    expect(
      suppressed.has('deleteCatalogAsset'),
      'deleteCatalogAsset should NOT be suppressed — see positive-suppress.json',
    ).toBe(false);
  });

  it('deleteCatalogAsset has a non-empty generated positive-suite feature spec', () => {
    const spec = readGeneratedSpec('deleteCatalogAsset.feature.spec.ts');
    expect(spec, 'deleteCatalogAsset.feature.spec.ts has no emitted test').toContain('test(');
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
  // has negative tests, and pin that updateVersion's malformed-json-body
  // scenario is back (camunda-hub#28911 fixed — verified live: a top-level
  // JSON string now 400s instead of binding into `name` via Jackson's
  // delegating constructor; the exclusion is removed from
  // request-validation.json). The other of updateVersion's two intentional
  // gaps (missing-required/explicit-null-required, camunda-hub#29306, still
  // open) is pinned separately in the next test below.
  it('each version op keeps negative-suite coverage, including updateVersion malformed-json-body (camunda-hub#28911 fixed — see the next test for the still-open gap)', () => {
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
      'updateVersion malformed-json-body should be covered again — camunda-hub#28911 is fixed',
    ).toContain('updateVersion__malformedJsonBody');
  });

  // Pins updateVersion's one remaining intentional gap (the other,
  // malformed-json-body, was fixed and unpinned in the test above —
  // camunda-hub#28911): camunda-hub#29306, updateVersion not enforcing name
  // as required — missing-required and explicit-null cases.
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
    // The exclusion is scoped to just these two scenario kinds — prove that
    // narrowly, not just that *some* updateVersion test survives (which the
    // generic negative-coverage check above would pass even if this
    // exclusion had over-widened to drop everything else too).
    for (const stillCovered of [
      "test('updateVersion - Body wrong top-level type'",
      "test('updateVersion - Constraint violation name (#1)'",
      "test('updateVersion - Missing authentication'",
    ]) {
      expect(
        spec,
        `${stillCovered} should still be covered — the exclusion should not have widened beyond missing-required/explicit-null-required`,
      ).toContain(stillCovered);
    }
  });

  // #602 — submitProjectSnapshotReview 403s a snapshot with no active review
  // request (runtime-states.json's ProjectSnapshotReviewRequested). Pin the
  // fix concretely: the positive-suite chain must call
  // requestProjectSnapshotReview BEFORE submitProjectSnapshotReview, on the
  // same snapshot. A bare `.toContain('submitProjectSnapshotReview')` would
  // pass vacuously — the describe title and initSpecSalt call both already
  // contain that literal string regardless of whether the actual chain is
  // ordered correctly — so this matches the concrete `test.step(...)` calls
  // instead.
  it('submitProjectSnapshotReview chains requestProjectSnapshotReview first, on the same snapshot', () => {
    const spec = readGeneratedSpec('submitProjectSnapshotReview.feature.spec.ts');
    const createIdx = spec.indexOf("test.step('createProjectSnapshot'");
    const requestIdx = spec.indexOf("test.step('requestProjectSnapshotReview'");
    const submitIdx = spec.indexOf("test.step('submitProjectSnapshotReview'");
    expect(createIdx, 'createProjectSnapshot step missing from the chain').toBeGreaterThan(-1);
    expect(requestIdx, 'requestProjectSnapshotReview step missing from the chain').toBeGreaterThan(
      -1,
    );
    expect(submitIdx, 'submitProjectSnapshotReview step missing from the chain').toBeGreaterThan(
      -1,
    );
    expect(
      createIdx,
      'createProjectSnapshot must run before requestProjectSnapshotReview',
    ).toBeLessThan(requestIdx);
    expect(
      requestIdx,
      'requestProjectSnapshotReview must run before submitProjectSnapshotReview',
    ).toBeLessThan(submitIdx);
    // Both the review-request and the review submission must target the
    // SAME snapshot key (the chain's one produced projectSnapshotKeyVar),
    // not two different snapshots — which the ordering checks above alone
    // wouldn't catch.
    const requestStep = spec.slice(requestIdx, submitIdx);
    const submitStep = spec.slice(submitIdx);
    expect(
      requestStep,
      'requestProjectSnapshotReview must target ctx.projectSnapshotKeyVar',
    ).toMatch(/project-snapshots\/\$\{ctx\.projectSnapshotKeyVar/);
    expect(submitStep, 'submitProjectSnapshotReview must target ctx.projectSnapshotKeyVar').toMatch(
      /project-snapshots\/\$\{ctx\.projectSnapshotKeyVar/,
    );
    // No second createProjectSnapshot sneaks in between the request and the
    // submit — that would decouple the review request from the snapshot
    // actually being reviewed even though both steps above still reference
    // the same variable name.
    expect(
      requestStep.indexOf("test.step('createProjectSnapshot'"),
      'a second createProjectSnapshot must not appear between the review request and the submission',
    ).toBe(-1);
  });

  // #619 — Hub answers a nonexistent path key with a clean 404 on every method and on
  // list/search operations under a missing parent, so notFoundMode is 'declared' and every
  // operation with a path key that documents a 404 gets a "Nonexistent <key> returns 404" test.
  // Pin it from the spec itself so a new operation, or a change to the mode, cannot silently
  // drop one. An operation that is deliberately skipped must be listed here with its reason.
  it('every operation with a path key that documents a 404 has a not-found test (#619)', () => {
    // purgeFile is idempotent by contract (204 for a file that never existed); its 404 means
    // "belongs to another organization", which no fake key can provoke.
    const NO_NOT_FOUND_TEST = new Set(['purgeFile']);
    const secured = join(getRequestValidationSuiteDir(REPO_ROOT), 'secured');
    const corpus = readdirSync(secured)
      .filter((f) => f.endsWith('-validation-api-tests.spec.ts'))
      .map((f) => readRequired(join(secured, f)))
      .join('\n');
    const raw: unknown = JSON.parse(readRequired(BUNDLED_SPEC_PATH));
    const missing: string[] = [];
    let checked = 0;
    if (isRecord(raw) && isRecord(raw.paths)) {
      for (const [urlPath, item] of Object.entries(raw.paths)) {
        if (!urlPath.includes('{') || !isRecord(item)) continue;
        for (const [method, opDef] of Object.entries(item)) {
          if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(opDef)) continue;
          const opId = opDef.operationId;
          if (typeof opId !== 'string' || !isRecord(opDef.responses) || !('404' in opDef.responses))
            continue;
          if (NO_NOT_FOUND_TEST.has(opId)) {
            expect(
              corpus,
              `${opId} is listed as having no not-found test but has one`,
            ).not.toContain(`test('${opId} - Nonexistent`);
            continue;
          }
          checked++;
          if (!corpus.includes(`test('${opId} - Nonexistent`)) missing.push(opId);
        }
      }
    }
    // Guards against a vacuous pass: the spec has dozens of keyed operations documenting a 404.
    expect(
      checked,
      'found suspiciously few keyed 404 operations - did the spec parse?',
    ).toBeGreaterThan(30);
    expect(missing, 'operations with a documented 404 but no not-found test').toEqual([]);
  });
  it('conflict-replay operations assert a 409 on the repeated call and document that 409 (#620)', () => {
    const raw: unknown = JSON.parse(
      readRequired(join(REPO_ROOT, 'configs/camunda-hub/conflict-replay.json')),
    );
    const replay = isRecord(raw) && Array.isArray(raw.replay) ? raw.replay : [];
    const ids = replay.map((e) => (isRecord(e) ? e.operationId : undefined));
    // The two cases confirmed live against camunda/hub:SNAPSHOT.
    expect(ids).toContain('requestProjectSnapshotReview');
    expect(ids).toContain('updateFile');
    const bundle: unknown = JSON.parse(readRequired(BUNDLED_SPEC_PATH));
    const documented409 = new Set<string>();
    if (isRecord(bundle) && isRecord(bundle.paths)) {
      for (const item of Object.values(bundle.paths)) {
        if (!isRecord(item)) continue;
        for (const [method, opDef] of Object.entries(item)) {
          if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(opDef)) continue;
          if (
            typeof opDef.operationId === 'string' &&
            isRecord(opDef.responses) &&
            '409' in opDef.responses
          )
            documented409.add(opDef.operationId);
        }
      }
    }
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      expect(
        documented409.has(id),
        `${id} is in conflict-replay.json but the spec documents no 409`,
      ).toBe(true);
      const spec = readGeneratedSpec(`${id}.feature.spec.ts`);
      const at = spec.indexOf(`${id} - duplicate conflict`);
      expect(at, `${id}: no "duplicate conflict" test generated`).toBeGreaterThan(-1);
      expect(spec.slice(at), `${id}: the repeated call does not assert 409`).toContain('toBe(409)');
      const entry = replay.find((e) => isRecord(e) && e.operationId === id);
      const changeBody = isRecord(entry) && isRecord(entry.changeBody) ? entry.changeBody : {};
      for (const [field, value] of Object.entries(changeBody)) {
        expect(
          spec.slice(at),
          `${id}: the changeBody value for ${field} is not in the generated request`,
        ).toContain(`${field}: ${JSON.stringify(value).replace(/^"|"$/g, "'")}`);
      }
    }
  });
  it('every operation that documents a 409 has a conflict test or a tracked reason it has none (#621)', () => {
    const raw: unknown = JSON.parse(
      readRequired(join(REPO_ROOT, 'configs/camunda-hub/conflict-replay.json')),
    );
    const listed = (key: string): Record<string, unknown>[] =>
      isRecord(raw) && Array.isArray(raw[key]) ? raw[key].filter(isRecord) : [];
    const tested = new Set<unknown>([
      ...listed('replay').map((e) => e.operationId),
      ...listed('sequences')
        .filter((e) => (e.expectStatus ?? 409) === 409)
        .map((e) => e.operationId),
    ]);
    const untested = listed('untested');
    for (const e of untested) {
      expect(e.issue, `${String(e.operationId)}: untested needs a tracking issue URL`).toMatch(
        /^https:\/\/github\.com\/.+\/issues\/\d+$/,
      );
      expect(
        tested.has(e.operationId),
        `${String(e.operationId)} is both tested and untested`,
      ).toBe(false);
    }
    const untestedIds = new Set(untested.map((e) => e.operationId));
    const bundle: unknown = JSON.parse(readRequired(BUNDLED_SPEC_PATH));
    const documented: string[] = [];
    if (isRecord(bundle) && isRecord(bundle.paths)) {
      for (const item of Object.values(bundle.paths)) {
        if (!isRecord(item)) continue;
        for (const [method, opDef] of Object.entries(item)) {
          if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(opDef)) continue;
          if (
            typeof opDef.operationId === 'string' &&
            isRecord(opDef.responses) &&
            '409' in opDef.responses
          )
            documented.push(opDef.operationId);
        }
      }
    }
    expect(
      documented.length,
      'found no operation documenting a 409 - did the spec parse?',
    ).toBeGreaterThan(5);
    expect(
      documented.filter((id) => !tested.has(id) && !untestedIds.has(id)),
      'operations documenting a 409 with neither a conflict test nor an untested entry',
    ).toEqual([]);
    expect(
      [...untestedIds].filter((id) => typeof id !== 'string' || !documented.includes(id)),
      'untested entries for operations that no longer document a 409',
    ).toEqual([]);
    // Each sequence must have produced its generated test asserting its status, and the
    // target must document that status.
    const documentedStatus = (id: string, status: string): boolean => {
      if (!isRecord(bundle) || !isRecord(bundle.paths)) return false;
      for (const item of Object.values(bundle.paths)) {
        if (!isRecord(item)) continue;
        for (const opDef of Object.values(item)) {
          if (isRecord(opDef) && opDef.operationId === id && isRecord(opDef.responses))
            return status in opDef.responses;
        }
      }
      return false;
    };
    for (const seq of listed('sequences')) {
      const id = String(seq.operationId);
      const status = String(seq.expectStatus ?? 409);
      expect(
        documentedStatus(id, status),
        `${id} has a sequence but the spec documents no ${status}`,
      ).toBe(true);
      const label = status === '409' ? 'conflict' : 'precondition';
      const spec = readGeneratedSpec(`${id}.variant.spec.ts`);
      const at = spec.indexOf(`${status} ${label} - ${String(seq.name).replace(/-/g, ' ')}`);
      expect(at, `${id}: no "${String(seq.name)}" ${label} test generated`).toBeGreaterThan(-1);
      const next = spec.indexOf('\n  test(', at + 1);
      const sequenceTest = spec.slice(at, next < 0 ? undefined : next);
      expect(sequenceTest, `${id}: the last call does not assert ${status}`).toContain(
        `toBe(${status})`,
      );
      // A setup body override must reach the generated request: "${xVar}" becomes ctx.xVar.
      for (const step of Array.isArray(seq.before) ? seq.before : []) {
        if (!isRecord(step) || !isRecord(step.body)) continue;
        for (const [field, value] of Object.entries(step.body)) {
          const ref = typeof value === 'string' ? /^\$\{(\w+)\}$/.exec(value) : null;
          const rendered = ref ? `ctx.${ref[1]}` : JSON.stringify(value).replaceAll('"', "'");
          expect(
            sequenceTest.replaceAll('"', "'"),
            `${id}: the ${String(step.operationId)} body override ${field} is not in the generated request`,
          ).toContain(`${field}: ${rendered}`);
        }
      }
    }
  });
  it('keyed and write operations assert a 403 for a principal without grants (#622)', () => {
    const rbac = join(getRequestValidationSuiteDir(REPO_ROOT), 'rbac');
    const corpus = readdirSync(rbac)
      .filter((f) => f.endsWith('-validation-api-tests.spec.ts'))
      .map((f) => readRequired(join(rbac, f)))
      .join('\n');
    const denied = (opId: string) => corpus.includes(`test('${opId} - Denied (no permission)'`);
    // The full surface, derived from the spec and the fixture config rather than from the
    // generator: every secured operation with no required non-path parameter whose path keys
    // all have a fixture. Each must assert a 403 unless it is listed with the reason it cannot.
    const NO_DENY_TEST: Record<string, string> = {
      addMember: 'baseline email is invalid; Hub validates the format before authorization (400)',
      ingestCatalogAssets: 'multipart-only body, no baseline to send',
    };
    const config: unknown = JSON.parse(
      readRequired(join(REPO_ROOT, 'configs/camunda-hub/request-validation.json')),
    );
    const fixtureNames = new Set(
      isRecord(config)
        ? [
            ...Object.keys(isRecord(config.resourceFixtures) ? config.resourceFixtures : {}),
            ...Object.keys(
              isRecord(config.pathResourceFixtures) ? config.pathResourceFixtures : {},
            ),
          ]
        : [],
    );
    const bundle: unknown = JSON.parse(readRequired(BUNDLED_SPEC_PATH));
    const candidates: string[] = [];
    if (isRecord(bundle) && isRecord(bundle.paths)) {
      const globalSecurity = Array.isArray(bundle.security) ? bundle.security : [];
      for (const item of Object.values(bundle.paths)) {
        if (!isRecord(item)) continue;
        for (const [method, opDef] of Object.entries(item)) {
          if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(opDef)) continue;
          if (typeof opDef.operationId !== 'string') continue;
          const security = Array.isArray(opDef.security) ? opDef.security : globalSecurity;
          if (
            security.length === 0 ||
            security.some((r) => isRecord(r) && Object.keys(r).length === 0)
          )
            continue;
          const params = [
            ...(Array.isArray(item.parameters) ? item.parameters : []),
            ...(Array.isArray(opDef.parameters) ? opDef.parameters : []),
          ].filter(isRecord);
          if (params.some((p) => p.required === true && p.in !== 'path')) continue;
          const pathKeys = params.filter((p) => p.in === 'path').map((p) => String(p.name));
          if (pathKeys.some((k) => !fixtureNames.has(k))) continue;
          candidates.push(opDef.operationId);
        }
      }
    }
    expect(
      candidates.length,
      'found suspiciously few deny candidates - did the spec parse?',
    ).toBeGreaterThan(50);
    expect(
      candidates.filter((id) => !denied(id) && !(id in NO_DENY_TEST)),
      'operations that can reach the authority check but have no 403 test',
    ).toEqual([]);
    for (const id of Object.keys(NO_DENY_TEST)) {
      expect(denied(id), `${id} is listed as having no 403 test but has one`).toBe(false);
    }
    const generated = new Set(
      [...corpus.matchAll(/test\('(\w+) - Denied \(no permission\)'/g)].map((m) => m[1]),
    );
    expect(
      [...generated].filter((id) => !candidates.includes(id)),
      '403 tests for operations outside the derived surface',
    ).toEqual([]);
  });
  it('every search operation sends page and sort in a success-path test, and asserts them (#623)', () => {
    const raw: unknown = JSON.parse(
      readRequired(join(REPO_ROOT, 'configs/camunda-hub/search-paging.json')),
    );
    const searches =
      isRecord(raw) && Array.isArray(raw.searches) ? raw.searches.filter(isRecord) : [];
    const limit = isRecord(raw) ? raw.limit : undefined;
    const bundle: unknown = JSON.parse(readRequired(BUNDLED_SPEC_PATH));
    const schemas =
      isRecord(bundle) && isRecord(bundle.components) && isRecord(bundle.components.schemas)
        ? bundle.components.schemas
        : {};
    const resolve = (node: unknown): Record<string, unknown> => {
      let cur = node;
      while (isRecord(cur) && typeof cur.$ref === 'string')
        cur = schemas[cur.$ref.split('/').pop() ?? ''];
      return isRecord(cur) ? cur : {};
    };
    // Derived from the spec: an operation whose JSON request body takes both `page` and `sort`.
    const searchOps: string[] = [];
    if (isRecord(bundle) && isRecord(bundle.paths)) {
      for (const item of Object.values(bundle.paths)) {
        if (!isRecord(item)) continue;
        for (const [method, opDef] of Object.entries(item)) {
          if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(opDef)) continue;
          const content =
            isRecord(opDef.requestBody) && isRecord(opDef.requestBody.content)
              ? opDef.requestBody.content
              : {};
          const json = isRecord(content['application/json']) ? content['application/json'] : {};
          const props = resolve(json.schema).properties;
          if (
            isRecord(props) &&
            'page' in props &&
            'sort' in props &&
            typeof opDef.operationId === 'string'
          )
            searchOps.push(opDef.operationId);
        }
      }
    }
    expect(
      searchOps.length,
      'found suspiciously few search operations - did the spec parse?',
    ).toBeGreaterThan(10);
    const configured = searches.map((e) => String(e.operationId));
    expect(
      searchOps.filter((id) => !configured.includes(id)),
      'search operations with no paging test',
    ).toEqual([]);
    expect(
      configured.filter((id) => !searchOps.includes(id)),
      'paging entries for operations that are not searches',
    ).toEqual([]);
    for (const entry of searches) {
      const id = String(entry.operationId);
      const spec = readGeneratedSpec(`${id}.variant.spec.ts`);
      // Each test is read on its own: the offset test repeats the sort fields, so a slice running
      // into it would let it satisfy assertions meant for the limit and sort test.
      const segment = (title: string): string => {
        const start = spec.indexOf(title);
        if (start < 0) return '';
        const next = spec.indexOf('\n  test(', start + 1);
        return spec.slice(start, next < 0 ? undefined : next);
      };
      const test = segment('page and sort (limit');
      expect(test, `${id}: no paging test generated`).not.toBe('');
      expect(test, `${id}: limit not asserted`).toContain(`toBeLessThanOrEqual(${String(limit)})`);
      expect(test, `${id}: page not sent`).toContain(`limit: ${String(limit)}`);
      const sort = isRecord(entry.sort) ? entry.sort : {};
      expect(test, `${id}: sort not sent`).toContain(`field: '${String(sort.field)}'`);
      expect(test, `${id}: sort direction not sent`).toContain(`order: '${String(sort.order)}'`);
      const offsetTest = segment('page offset (from');
      expect(offsetTest, `${id}: no offset test generated`).not.toBe('');
      expect(offsetTest, `${id}: offset not sent`).toContain(
        `from: ${String(isRecord(raw) ? raw.offsetFrom : '')}`,
      );
      // The offset test compares two queries made a moment apart, so it sorts ascending
      // (an item created in between lands after the slice) when the order is checked.
      const offsetOrder = entry.checkOrder === true ? 'ASC' : String(sort.order);
      expect(offsetTest, `${id}: offset sort not sent`).toContain(`order: '${offsetOrder}'`);
      if (entry.checkOrder === true) {
        expect(test, `${id}: order not asserted`).toContain('[...values].sort()');
        expect(test, `${id}: opposite order not compared`).toContain('reversedValues');
        expect(test, `${id}: opposite values not validated`).toContain(
          "reversedValues.every((v) => typeof v === 'string' && v !== '')",
        );
        expect(offsetTest, `${id}: offset slice not compared`).toContain('unpaged');
      }
      if (isRecord(entry.filter)) {
        expect(test, `${id}: filter not sent`).toContain('filter:');
        expect(offsetTest, `${id}: filter not sent with the offset`).toContain('filter:');
      }
    }
    expect(
      searches
        .filter((e) => isRecord(e.filter))
        .map((e) => e.operationId)
        .sort(),
    ).toEqual(['searchCatalogAssets', 'searchWorkspaces']);
  });
  it('optional request fields are sent and echoed back where the response allows it (#624)', () => {
    const raw: unknown = JSON.parse(
      readRequired(join(REPO_ROOT, 'configs/camunda-hub/optional-fields.json')),
    );
    const list = (key: string): Record<string, unknown>[] =>
      isRecord(raw) && Array.isArray(raw[key]) ? raw[key].filter(isRecord) : [];
    const variants = list('variants');
    expect(variants.length, 'no optional-field variants configured').toBeGreaterThan(5);
    for (const v of variants) {
      const id = String(v.operationId);
      const spec = readGeneratedSpec(`${id}.variant.spec.ts`);
      const start = spec.indexOf(`optional fields - ${String(v.name)}`);
      expect(start, `${id}: no "${String(v.name)}" optional-fields test generated`).toBeGreaterThan(
        -1,
      );
      const next = spec.indexOf('\n  test(', start + 1);
      const test = spec.slice(start, next < 0 ? undefined : next);
      for (const [field, value] of Object.entries(isRecord(v.body) ? v.body : {})) {
        expect(test, `${id}: ${field} not sent`).toContain(
          `${field}: ${JSON.stringify(value).replace(/^"|"$/g, "'")}`,
        );
      }
      for (const [field, value] of Object.entries(isRecord(v.echo) ? v.echo : {})) {
        // The formatter rewrites string quotes, so compare with quotes normalised.
        expect(test.replaceAll('"', "'"), `${id}: ${field} not checked in the response`).toContain(
          `echoed.${field}).toEqual(${JSON.stringify(value).replaceAll('"', "'")})`,
        );
      }
    }
    for (const u of list('untested')) {
      expect(u.issue, `${String(u.operationId)}: untested needs a tracking issue URL`).toMatch(
        /^https:\/\/github\.com\/.+\/issues\/\d+$/,
      );
    }
  });
  it('lifecycle steps validate the response body whenever the route has a schema (#626)', () => {
    const bundle: unknown = JSON.parse(readRequired(BUNDLED_SPEC_PATH));
    const routeOf = new Map<string, string>();
    if (isRecord(bundle) && isRecord(bundle.paths)) {
      for (const [urlPath, item] of Object.entries(bundle.paths)) {
        if (!isRecord(item)) continue;
        for (const [method, opDef] of Object.entries(item)) {
          if (
            HTTP_METHODS.has(method.toLowerCase()) &&
            isRecord(opDef) &&
            typeof opDef.operationId === 'string'
          )
            routeOf.set(opDef.operationId, `${method.toUpperCase()} ${urlPath}`);
        }
      }
    }
    const responses: unknown = JSON.parse(
      readRequired(join(SUITE_DIR, 'json-body-assertions', 'responses.json')),
    );
    const withSchema = new Set<string>();
    for (const e of isRecord(responses) && Array.isArray(responses.responses)
      ? responses.responses
      : []) {
      if (isRecord(e) && e.status === '200')
        withSchema.add(`${String(e.method)} ${String(e.path)}`);
    }
    expect(
      withSchema.size,
      'no response schemas found - was responses.json generated?',
    ).toBeGreaterThan(20);
    let validated = 0;
    const missing: string[] = [];
    for (const dir of [ENTITY_LIFECYCLE, EDGE_LIFECYCLE, 'templates/RestoreLifecycle']) {
      for (const file of readdirSync(join(SUITE_DIR, dir))) {
        if (!file.endsWith('.lifecycle.spec.ts')) continue;
        const source = readGeneratedSpec(`${dir}/${file}`);
        for (const block of source.split('await test.step(').slice(1)) {
          if (!/\.status\(\)\)\.toBe\(200\)/.test(block)) continue;
          const opId = /operationId: '(\w+)'/.exec(block)?.[1];
          const route = opId ? routeOf.get(opId) : undefined;
          if (!opId || !route || !withSchema.has(route)) continue;
          if (block.includes('validateResponse(')) validated++;
          else missing.push(`${dir}/${file}: ${opId}`);
        }
      }
    }
    expect(validated, 'no lifecycle step validates its response').toBeGreaterThan(30);
    expect(missing, 'lifecycle steps with a response schema but no validateResponse').toEqual([]);
  });
});
