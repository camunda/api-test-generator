import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Active-config resolver for the semantic-graph-extractor workspace.
 *
 * Mirrors the contract of `path-analyser/src/configResolver.ts`:
 *   1. CONFIG is read from `process.env.CONFIG` (trimmed); if unset or
 *      empty, the default declared in `<repoRoot>/configs.json` is used.
 *   2. The resolved name must match `^[a-z0-9][a-z0-9-]*$` (defense in
 *      depth against path-traversal).
 *   3. The resolved name must be a key in `configs.json`'s `configs`
 *      map (allowlist — typos fail loud rather than silently creating
 *      a new directory).
 *
 * This file duplicates the central resolver because path-analyser
 * compiles to ESM (NodeNext) and lives outside this workspace's
 * `rootDir`. Keep the two aligned. See #128.
 */

const CONFIG_SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function getActiveConfigName(repoRoot: string): string {
  const indexPath = path.join(repoRoot, 'configs.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to read configs.json at ${indexPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (
    !isPlainObject(parsed) ||
    typeof parsed.default !== 'string' ||
    !isPlainObject(parsed.configs)
  ) {
    throw new Error(
      `Malformed configs.json at ${indexPath}: expected { default: string, configs: object }`,
    );
  }
  const allowlist = parsed.configs;
  const fromEnv = (process.env.CONFIG ?? '').trim();
  const name = fromEnv.length > 0 ? fromEnv : parsed.default;
  if (!CONFIG_SAFE_NAME.test(name)) {
    throw new Error(
      `Invalid CONFIG value: ${JSON.stringify(name)} (expected lowercase alphanumeric + hyphens)`,
    );
  }
  if (!Object.keys(allowlist).includes(name)) {
    const known = Object.keys(allowlist).join(', ') || '(none)';
    throw new Error(
      `Unknown CONFIG ${JSON.stringify(name)}. Declared configs in configs.json: ${known}.`,
    );
  }
  return name;
}
