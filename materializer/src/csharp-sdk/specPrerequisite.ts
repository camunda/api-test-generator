import fsSync from 'node:fs';
import path from 'node:path';
import { getSpecBundleDir } from 'path-analyser/configResolver';

export function csharpSpecBundlePath(repoRoot: string): string {
  return path.join(getSpecBundleDir(repoRoot), 'rest-api.bundle.json');
}

/**
 * Fail fast when the bundled spec the C# emitter needs for discriminator
 * discovery is absent. The caller (`materializer/src/index.ts`'s
 * `runForTarget`) calls this eagerly, BEFORE the C# output directory is
 * wiped — a missing spec must abort the whole run rather than being
 * discovered lazily inside `emitter.emit()`, where the per-file try/catch
 * in the `--all` feature/variant loops would otherwise swallow the error,
 * skip every file, and still exit 0 with an already-wiped, now-empty
 * output directory. `list-targets` and other emitters never call this, so
 * they stay independent of the spec being fetched.
 *
 * Lives in its own module (rather than inline in `index.ts`, which runs
 * its CLI entry point as a side effect of being imported) so it can be
 * unit-tested directly against a synthetic `repoRoot`.
 */
export function assertCsharpSpecPresent(repoRoot: string): void {
  const specPath = csharpSpecBundlePath(repoRoot);
  if (!fsSync.existsSync(specPath)) {
    throw new Error(
      `C# SDK discriminator spec is missing at ${specPath}; run npm run fetch-spec:ref first.`,
    );
  }
}
