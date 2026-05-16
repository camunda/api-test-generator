// Centralized fixture resolution for generated Playwright tests.
//
// `@@FILE:<rel-path>` markers in scenario bodies are resolved to the bytes
// of a real fixture file when the generated tests run. Suites can run from
// the repo root, from path-analyser/, or from a vendored standalone copy,
// so we try a handful of likely locations rather than pin a single layout.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function errnoCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const code = Reflect.get(err, 'code');
  return typeof code === 'string' ? code : undefined;
}

/**
 * Read a fixture identified by a `@@FILE:`-relative path. Throws if no
 * candidate location resolves.
 *
 * The vendored `<suite>/fixtures/` directory (sibling to `<suite>/support/`,
 * populated by `materializeFixtures`) is the primary source — the walk-up
 * candidates from `import.meta.url` cover that and dist/generated-tests/
 * layouts. The `process.cwd()`-relative candidates are an in-repo
 * convenience for running generated suites from the api-test-generator
 * checkout (#221 / Lift 11: per-config fixtures live at
 * `configs/<config>/fixtures/`). The config name is read from
 * `process.env.CONFIG` (defaulting to `camunda-oca`, matching
 * `configs.json#default`) so the fallback works for any active config.
 *
 * Only `ENOENT` / `ENOTDIR` are treated as "try the next candidate".
 * Any other error (e.g. `EACCES` — file exists but is unreadable) is
 * remembered and surfaced in the final thrown message so debugging
 * fixture issues isn't reduced to a generic "not found".
 */
export async function resolveFixture(p: string): Promise<Buffer> {
  if (typeof p !== 'string' || p.trim() === '') {
    throw new Error('Fixture path missing after @@FILE:');
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const activeConfig = process.env.CONFIG?.trim() || 'camunda-oca';
  const candidates: string[] = [
    p,
    path.resolve(process.cwd(), p),
    // When running from path-analyser/
    path.resolve(process.cwd(), 'fixtures', p),
    // When running from the api-test-generator repo root: per-config
    // fixtures live under configs/<config>/fixtures (#221 / Lift 11).
    path.resolve(process.cwd(), 'configs', activeConfig, 'fixtures', p),
    // Walk up from this helper (lives in <suite>/support/) looking for a
    // sibling fixtures/ directory. Three levels covers the standalone
    // vendored layout, dist/generated-tests/, and the repo-root layout.
    path.resolve(here, '..', 'fixtures', p),
    path.resolve(here, '..', '..', 'fixtures', p),
    path.resolve(here, '..', '..', '..', 'fixtures', p),
  ];
  let lastError: Error | undefined;
  for (const cand of candidates) {
    try {
      return await fs.readFile(cand);
    } catch (err) {
      const code = errnoCode(err);
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  if (lastError) {
    throw new Error(`Fixture not found: ${p}. Last error: ${lastError.message}`);
  }
  throw new Error(`Fixture not found: ${p}`);
}
