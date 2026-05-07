import path from 'node:path';

/**
 * Resolves the directory holding the active generator configuration's
 * sidecar files (domain-semantics.json, filter-providers.json,
 * request-defaults.json, spec-pin.json).
 *
 * The active config name comes from `process.env.CONFIG`. If unset,
 * the default from the top-level configs.json is used (`camunda-oca`).
 * See #128 for the broader configuration-driven generation work.
 *
 * @param repoRoot Absolute path to the api-test-generator repository root.
 */
export function getActiveConfigName(): string {
  const fromEnv = process.env.CONFIG?.trim();
  if (fromEnv) return fromEnv;
  return 'camunda-oca';
}

export function getActiveConfigDir(repoRoot: string): string {
  return path.resolve(repoRoot, 'configs', getActiveConfigName());
}
