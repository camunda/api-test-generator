import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  assertCsharpSpecPresent,
  csharpSpecBundlePath,
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
    writeFileSync(
      path.join(repoRoot, 'configs.json'),
      JSON.stringify({ default: 'synthetic-config', configs: { 'synthetic-config': {} } }),
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
