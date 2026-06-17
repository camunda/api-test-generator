import fs from 'node:fs';
import path from 'node:path';

/**
 * Per-config request-validation settings.
 *
 * Loaded from `configs/<active>/request-validation.json` (relative to the
 * repository root). When the file is absent or any field is missing, defaults
 * are used. The defaults are conservative — they preserve the
 * pre-issue-#129 behaviour so that adding the loader is observably a no-op
 * for any config that does not opt in.
 *
 * See issue #129 for the `enumCaseInsensitive` semantics.
 */
export interface RequestValidationConfig {
  /**
   * When `true`, the negative-test generator skips every case-only enum
   * mutation — i.e. an input string `m` for an enum with members `E` where
   *   `m ∉ E` (a 400 candidate by membership), and
   *   `∃ e ∈ E. e.toLowerCase() === m.toLowerCase()` (only differs by case).
   *
   * Mutations that change non-case characters (`${value}_INVALID`, totally
   * unrelated values like `NOPE`, etc.) are still emitted regardless.
   *
   * Default: `false` — case-only mutations are emitted as 400-expecting
   * tests. Set this to `true` for APIs whose parser accepts enum values
   * case-insensitively (the upstream Camunda 8 OCA parser does — see
   * camunda/camunda#52409).
   */
  enumCaseInsensitive: boolean;
  /**
   * Which operations the 401 generators — auth-absent (no credentials) and
   * auth-invalid (invalid/unknown bearer credential) — target in the `secured` profile.
   *
   * - `'conditional'` (default) — only operations secured on the conditional
   *   `auth` axis (a `security` requirement referencing an
   *   `x-enforcement: conditional` scheme — camunda/camunda#53708). This is the
   *   OCA model, where most of the API is unconditionally public and only a
   *   subset is conditionally secured.
   * - `'all-secured'` — every operation whose effective `security` *mandates*
   *   authentication (`OperationModel.secured`: every OR-alternative names a
   *   scheme; `false` for `security: []` and for any anonymous `{}` alternative
   *   like `[{}, { bearerAuth: [] }]`, which permits unauthenticated access).
   *   For an API uniformly authenticated via a single global scheme (e.g.
   *   Camunda Hub's `security: [{ bearerAuth: [] }]`, which declares no
   *   `x-enforcement`), this emits a no-credentials → 401 probe per secured op.
   */
  authAbsentMode: 'conditional' | 'all-secured';
}

const DEFAULTS: RequestValidationConfig = {
  enumCaseInsensitive: false,
  authAbsentMode: 'conditional',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Load `configs/<config>/request-validation.json` and merge with defaults.
 * `repoRoot` must be the directory containing `configs.json`.
 * `configName` is the resolved active config name.
 *
 * Throws if the file exists but is malformed (parse error, non-object root,
 * or wrong-typed known field). A missing file is not an error — defaults apply.
 */
export function loadRequestValidationConfig(
  repoRoot: string,
  configName: string,
): RequestValidationConfig {
  const configPath = path.join(repoRoot, 'configs', configName, 'request-validation.json');
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULTS };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Malformed ${configPath}: expected a JSON object at the root.`);
  }
  const merged: RequestValidationConfig = { ...DEFAULTS };
  if ('enumCaseInsensitive' in parsed) {
    const v = parsed.enumCaseInsensitive;
    if (typeof v !== 'boolean') {
      throw new Error(
        `Invalid ${configPath}: "enumCaseInsensitive" must be a boolean, got ${typeof v}.`,
      );
    }
    merged.enumCaseInsensitive = v;
  }
  if ('authAbsentMode' in parsed) {
    const v = parsed.authAbsentMode;
    if (v !== 'conditional' && v !== 'all-secured') {
      throw new Error(
        `Invalid ${configPath}: "authAbsentMode" must be "conditional" or "all-secured", got ${JSON.stringify(v)}.`,
      );
    }
    merged.authAbsentMode = v;
  }
  return merged;
}
