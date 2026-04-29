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
 * Candidate order is intentionally a superset of the previous inline
 * resolver in the emitter. The previous code resolved relative to
 * `__dirname` of each emitted spec; this helper resolves relative to its
 * own `import.meta.url` (it lives under `<suite>/support/`) and also walks
 * up an extra level so it finds `path-analyser/fixtures/` regardless of
 * how the suite was vendored or invoked.
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
  const candidates: string[] = [
    p,
    path.resolve(process.cwd(), p),
    // When running from path-analyser/
    path.resolve(process.cwd(), 'fixtures', p),
    // When running from repo root
    path.resolve(process.cwd(), 'path-analyser/fixtures', p),
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
