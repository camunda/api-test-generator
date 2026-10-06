import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  assertCsharpSpecPresent,
  csharpSpecBundlePath,
  loadCsharpDiscriminatorTable,
} from '../../materializer/src/csharp-sdk/specPrerequisite.js';

/**
 * Regression coverage for the deferred missing-spec error (PR #668 review):
 * `loadCsharpDiscriminators` only threw once `emitter.emit()` ran, where the
 * `--all` feature/variant loops in `materializer/src/index.ts` catch any
 * per-file emission error and `console.warn`-skip it. With scenario output
 * already on disk but no bundled spec, a full `--all` run could wipe the C#
 * output directory (`fs.rm` runs unconditionally before `emit()` is ever
 * called), emit zero files, and still `process.exit(0)`.
 *
 * `assertCsharpSpecPresent` is the extracted, eagerly-called guard: it must
 * throw for a missing spec and must be a no-op once the spec is present, so
 * the caller can invoke it BEFORE the output-directory wipe instead of
 * relying on the lazy, swallowed failure inside `emit()`.
 *
 * Uses a synthetic `repoRoot` (its own temp `configs.json` + `spec/`) rather
 * than the real, shared `spec/camunda-oca/bundled/` tree other test files
 * read concurrently (vitest's `pool: 'forks'` can run test files in
 * parallel processes), so this test can never race or flake against them.
 */
describe('assertCsharpSpecPresent', () => {
  const tempDirs: string[] = [];

  function makeSyntheticRepoRoot(): string {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'csharp-spec-prereq-'));
    tempDirs.push(repoRoot);
    // `getSpecBundleDir()` (via `getActiveConfigName`) picks `process.env.CONFIG`
    // over this synthetic index's `default` when it's set, and validates
    // whichever it picks against this index's `configs` allowlist BEFORE
    // `assertCsharpSpecPresent` ever runs — so an inherited `CONFIG=camunda-oca`
    // or `CONFIG=camunda-hub` from the ambient shell/CI env throws "Unknown
    // CONFIG" here instead of reaching the prerequisite check this file means
    // to test. Including whatever CONFIG is actually inherited (if any) keeps
    // these fixtures isolated without mutating `process.env` ourselves.
    const inheritedConfig = process.env.CONFIG?.trim();
    const configs: Record<string, unknown> = { 'synthetic-config': {} };
    if (inheritedConfig) configs[inheritedConfig] = {};
    writeFileSync(
      path.join(repoRoot, 'configs.json'),
      JSON.stringify({ default: 'synthetic-config', configs }),
    );
    return repoRoot;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws when the bundled C# spec is missing', () => {
    const repoRoot = makeSyntheticRepoRoot();
    expect(() => assertCsharpSpecPresent(repoRoot)).toThrow(/C# SDK discriminator spec is missing/);
  });

  test('does not throw once the bundled C# spec exists', () => {
    const repoRoot = makeSyntheticRepoRoot();
    const specPath = csharpSpecBundlePath(repoRoot);
    mkdirSync(path.dirname(specPath), { recursive: true });
    writeFileSync(specPath, '{}');

    expect(() => assertCsharpSpecPresent(repoRoot)).not.toThrow();
  });
});

/**
 * Regression coverage for the gap `assertCsharpSpecPresent` deliberately
 * leaves open (see its own doc comment and PR #668 review, "Validate
 * discriminator table before clearing output"): existence-only checking
 * lets a PARSEABLE bundle that is missing `components.schemas` (the exact
 * fixture above, `'{}'`) pass the prerequisite check and then throw lazily
 * inside `emit()`'s memoized discriminator getter — which the `--all`
 * feature/variant loops in `materializer/src/index.ts` wrap in a per-file
 * try/catch, swallowing a whole-run precondition failure as "this one
 * scenario file failed". `loadCsharpDiscriminatorTable` is the eager,
 * directly-callable replacement `runForTarget` now invokes BEFORE the C#
 * output directory is wiped: it must throw for every bundle shape that
 * would previously have failed only inside `emit()`, not just for a
 * missing file.
 */
describe('loadCsharpDiscriminatorTable', () => {
  const tempDirs: string[] = [];

  function makeSyntheticRepoRoot(): string {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'csharp-discriminator-load-'));
    tempDirs.push(repoRoot);
    const inheritedConfig = process.env.CONFIG?.trim();
    const configs: Record<string, unknown> = { 'synthetic-config': {} };
    if (inheritedConfig) configs[inheritedConfig] = {};
    writeFileSync(
      path.join(repoRoot, 'configs.json'),
      JSON.stringify({ default: 'synthetic-config', configs }),
    );
    return repoRoot;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws when the bundled spec file is missing', () => {
    const repoRoot = makeSyntheticRepoRoot();
    expect(() => loadCsharpDiscriminatorTable(repoRoot)).toThrow(
      /C# SDK discriminator spec is missing/,
    );
  });

  test('throws when a parseable bundle is missing components.schemas', () => {
    const repoRoot = makeSyntheticRepoRoot();
    const specPath = csharpSpecBundlePath(repoRoot);
    mkdirSync(path.dirname(specPath), { recursive: true });
    writeFileSync(specPath, '{}');

    expect(() => loadCsharpDiscriminatorTable(repoRoot)).toThrow(/missing components\.schemas/);
  });

  test('throws a clear error when the bundled spec is not valid JSON', () => {
    const repoRoot = makeSyntheticRepoRoot();
    const specPath = csharpSpecBundlePath(repoRoot);
    mkdirSync(path.dirname(specPath), { recursive: true });
    writeFileSync(specPath, '{not valid json');

    expect(() => loadCsharpDiscriminatorTable(repoRoot)).toThrow(/not valid JSON/);
  });

  test('returns the discriminator table once the bundle has components.schemas', () => {
    const repoRoot = makeSyntheticRepoRoot();
    const specPath = csharpSpecBundlePath(repoRoot);
    mkdirSync(path.dirname(specPath), { recursive: true });
    writeFileSync(specPath, JSON.stringify({ components: { schemas: {} } }));

    expect(() => loadCsharpDiscriminatorTable(repoRoot)).not.toThrow();
  });
});
