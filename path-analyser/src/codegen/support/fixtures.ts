// Centralized fixture resolution for generated Playwright tests.
//
// `@@FILE:<rel-path>` markers in scenario bodies are replaced with the bytes
// of a real fixture file at materialization time. Suites can run from the
// repo root, from path-analyser/, or from a vendored standalone copy, so we
// try a handful of likely locations rather than pin a single layout.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
 */
export async function resolveFixture(p: string): Promise<Buffer> {
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
  for (const cand of candidates) {
    try {
      return await fs.readFile(cand);
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Fixture not found: ${p}`);
}
