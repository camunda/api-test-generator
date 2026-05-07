import fs from 'node:fs';
import path from 'node:path';

// Inline CONFIG resolver (#128 PR 2). Mirrors the safe-name rule applied
// centrally in path-analyser/src/configResolver.ts. This workspace
// compiles independently and cannot import from path-analyser.
const CONFIG_SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;
function getActiveConfigName(): string {
  const raw = process.env.CONFIG ?? 'camunda-oca';
  if (!CONFIG_SAFE_NAME.test(raw)) {
    throw new Error(
      `Invalid CONFIG value: ${JSON.stringify(raw)} (expected lowercase alphanumeric + hyphens)`,
    );
  }
  return raw;
}

/**
 * Resolves the spec path + provenance string for the request validation generator.
 *
 * Resolution order:
 *  1. `REQUEST_VALIDATION_SPEC` env var (absolute or relative path to a JSON/YAML spec).
 *  2. Bundled spec produced by the api-test-generator root pipeline:
 *     `<repoRoot>/spec/<config>/bundled/rest-api.bundle.json` (with provenance from
 *     `spec/<config>/bundled/spec-metadata.json` `specHash`).
 *  3. Legacy in-package cache: `cache/rest-api.yaml` (+ `cache/spec-commit.txt`)
 *     — retained so the generator still runs standalone if relocated.
 *
 * Throws if no spec can be located.
 */
export function resolveSpecSource(cwd: string = process.cwd()): {
  specPath: string;
  specProvenance?: string;
  source: 'env' | 'bundled' | 'legacy-cache';
} {
  const envPath = process.env.REQUEST_VALIDATION_SPEC;
  if (envPath) {
    const abs = path.isAbsolute(envPath) ? envPath : path.resolve(cwd, envPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`[spec/source] REQUEST_VALIDATION_SPEC points to non-existent path: ${abs}`);
    }
    return { specPath: abs, source: 'env' };
  }

  // 2. Look for the bundled spec produced by the root workspace pipeline,
  // partitioned by active config (#128 PR 2).
  const config = getActiveConfigName();
  const bundled = findUpwards(cwd, path.join('spec', config, 'bundled', 'rest-api.bundle.json'));
  if (bundled) {
    const metaPath = path.join(path.dirname(bundled), 'spec-metadata.json');
    let provenance: string | undefined;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (typeof meta.specHash === 'string') provenance = meta.specHash;
      } catch {
        /* ignore malformed metadata */
      }
    }
    return { specPath: bundled, specProvenance: provenance, source: 'bundled' };
  }

  // 3. Legacy in-package cache fallback.
  const legacyYaml = path.resolve(cwd, 'cache', 'rest-api.yaml');
  if (fs.existsSync(legacyYaml)) {
    const commitPath = path.join(path.dirname(legacyYaml), 'spec-commit.txt');
    let provenance: string | undefined;
    if (fs.existsSync(commitPath)) {
      try {
        provenance = fs.readFileSync(commitPath, 'utf8').trim();
      } catch {
        /* ignore */
      }
    }
    return { specPath: legacyYaml, specProvenance: provenance, source: 'legacy-cache' };
  }

  throw new Error(
    '[spec/source] No spec found. Either:\n' +
      '  • run `npm run fetch-spec` at the api-test-generator root to bundle the upstream spec, or\n' +
      '  • set REQUEST_VALIDATION_SPEC=/path/to/openapi.(json|yaml), or\n' +
      '  • place a spec at cache/rest-api.yaml inside this package.',
  );
}

function findUpwards(startDir: string, relativeTarget: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, relativeTarget);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
