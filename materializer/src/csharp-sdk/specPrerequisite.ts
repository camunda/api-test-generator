import fsSync from 'node:fs';
import path from 'node:path';
import { getSpecBundleDir } from 'path-analyser/configResolver';
import { buildCsharpDiscriminatorTable, type CsharpDiscriminatorTable } from './discriminators.js';

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

/**
 * Load and validate the discriminator table the C# emitter needs, failing
 * fast on anything that would otherwise only surface lazily inside
 * `emit()`. `assertCsharpSpecPresent` only proves the bundle *file exists*
 * — a parseable bundle that exists but is missing `components.schemas` (or
 * is otherwise malformed JSON) passes that check and then throws inside
 * `buildCsharpDiscriminatorTable`, which the `--all` feature/variant loops
 * in `materializer/src/index.ts` call lazily (memoized, on first `emit()`)
 * inside a per-file try/catch. That swallows the error per scenario file,
 * so a whole-run precondition failure is misreported as "this one file
 * failed" and the run still exits 0 with an already-wiped, now-empty
 * output directory (PR #668 review).
 *
 * The caller must invoke this eagerly, BEFORE the output-directory wipe,
 * exactly like `assertCsharpSpecPresent`. Lives alongside it (rather than
 * inline in `index.ts`) for the same reason: `index.ts` runs its CLI entry
 * point as a side effect of being imported, so it is not directly
 * unit-testable.
 */
export function loadCsharpDiscriminatorTable(repoRoot: string): CsharpDiscriminatorTable {
  assertCsharpSpecPresent(repoRoot);
  const specPath = csharpSpecBundlePath(repoRoot);
  let bundle: unknown;
  try {
    bundle = JSON.parse(fsSync.readFileSync(specPath, 'utf-8'));
  } catch (e) {
    throw new Error(
      `C# SDK discriminator spec at ${specPath} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return buildCsharpDiscriminatorTable(bundle);
}
