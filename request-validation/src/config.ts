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
   * String `format`s (OpenAPI `format:` values, e.g. `date-time`, `uri`) that
   * the server does NOT enforce at the request-validation layer, so a
   * syntactically-malformed-but-type-valid value passes schema validation
   * rather than being rejected with 400. The format-invalid generator skips
   * emitting a 400-expecting test for a field whose format is listed here.
   *
   * This is the format analogue of `enumCaseInsensitive`: it suppresses tests
   * whose 400 premise a given server does not honour. Example: Camunda Hub
   * binds `license.expiresAt` (`format: date-time`) to a plain String and does
   * not parse/validate it, so `'not-a-datetime'` is accepted at the validation
   * layer and the request proceeds to the authority gate (403 for the
   * entitlement-gated createCluster) — never the expected 400. `email` IS
   * enforced (addMember rejects a malformed address with 400), so only the
   * unenforced formats are listed, not all of them.
   *
   * Default: `[]` — every recognised format is treated as enforced.
   */
  unenforcedStringFormats: string[];
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
  /**
   * Which operations the 403 generator (auth-deny) targets, and how the deny
   * probe authenticates, in the `rbac` profile.
   *
   * - `'slice'` (default) — the OCA read-side model: a hardcoded allowlist of
   *   get-by-key reads (`authDeny.ts`'s `SLICE`), authenticated as a Basic-auth
   *   zero-grant probe USER that the suite global-setup provisions, against
   *   fixtures it also creates (so the rejection is an authorization decision,
   *   not a 404-not-found).
   * - `'all-secured'` — keyless, no-required-body, no-required-non-path-param
   *   `secured` operations, authenticated as a reduced-permission Bearer probe
   *   TOKEN (`RBAC_DENY_PROBE_BEARER_TOKEN`), no fixtures. Three categories are
   *   excluded because Hub checks body-validation (400) and resource-existence
   *   (404) before the authority check (@PreAuthorize, 403): by-key ops (path
   *   contains `{param}`), required-body ops (`bodyRequired: true`), and ops
   *   with required non-path parameters (query/header/cookie — missing param →
   *   400 before authz). The surviving surface is search/list/info endpoints.
   */
  authDenyMode: 'slice' | 'all-secured';
  /**
   * Maps resource-key names (path params AND body fields, e.g. `fileKey`,
   * `projectKey`, `workspaceKey`) to the env var holding a REAL key created by
   * the runner before tests run. Wherever the generator would otherwise emit a
   * filler placeholder (`'x'`, or `'1'` from constraintViolations/parameters) for
   * one of these names, it instead emits `process.env['<ENV>'] || '<filler>'`
   * (`||` so an unset OR empty env var falls back to the filler).
   *
   * This makes a malformed-field negative test ride on an otherwise-valid
   * envelope: the path param / referenced body resource exists, so the request
   * reaches the body-validation layer (400) instead of being short-circuited by
   * a resource lookup (404) or access check (403) on the placeholder. See #352.
   */
  resourceFixtures?: Record<string, string>;
  /**
   * Path-parameter-only overrides for `resourceFixtures`. Merged over
   * `resourceFixtures` when substituting PATH params (body fields use the base
   * map unchanged). Needed when a key name resolves to a different real resource
   * depending on location — e.g. Hub `projectKey`: createFile/createFolder bodies
   * authorize against the V1 Project (projects table), but `PATCH /projects/{projectKey}`
   * resolves a V2 ProcessApplication (process_applications table), so the path
   * needs a V2 project key while the body needs a V1 one (#352).
   */
  pathResourceFixtures?: Record<string, string>;
  /**
   * Operations to exclude from negative-suite generation entirely, with a
   * documented reason. Use for ops that are blocked upstream so their negative
   * tests can't reach the validation path they target (e.g. Hub version ops —
   * updateVersion/restoreVersion — whose fixture can't exist per
   * camunda/camunda-hub#25801, so they 404 instead of 400; tracked via #419).
   * The whole op is dropped (all its negative cases), so the nightly stays green
   * on known blockers instead of perpetually red. Re-enable when unblocked.
   * The optional `knownIssue` feeds the nightly's "skipped due to known issues"
   * Slack thread (see the workflow's derive step).
   */
  excludeOperations?: { operationId: string; reason: string; knownIssue?: KnownIssue }[];
  /**
   * Suite-wide known issues NOT tied to a single excluded op (e.g. the
   * generator-level wrong-type-key skip for camunda/camunda-hub#25926). Surfaced
   * in the nightly's "skipped due to known issues" Slack thread alongside the
   * per-entry `knownIssue`s.
   */
  knownIssues?: KnownIssue[];
}

/**
 * A reference to an upstream issue that explains why some coverage is skipped.
 * Consumed by the nightly workflow to build the per-suite "known issues" Slack
 * thread (single source of truth: the config that causes the skip also carries
 * its issue link).
 *
 * CONVENTION: the nightly dedupes bullets by `url`, so within a single config
 * file every entry that points at the same `url` MUST use the same `summary`
 * (otherwise the rendered bullet depends on entry order). Enforced by
 * tests/codegen/known-issue-summary-consistency.test.ts. (The same url may
 * carry a different summary in a *different* config/suite — the check is
 * per-file.)
 */
export interface KnownIssue {
  summary: string;
  url: string;
  /** Optional in-repo tracking issue (e.g. #419 for the version exclusion). */
  tracker?: string;
}

const DEFAULTS: RequestValidationConfig = {
  enumCaseInsensitive: false,
  unenforcedStringFormats: [],
  authAbsentMode: 'conditional',
  authDenyMode: 'slice',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Resource-fixture maps are name → env-var-name. Reject empty keys/values: an
// empty env var name would silently disable substitution (and emit a confusing
// `process.env[""]` lookup) rather than failing fast on an invalid config.
function isEnvVarNameRecord(v: unknown): v is Record<string, string> {
  return (
    isPlainObject(v) &&
    Object.entries(v).every(([k, x]) => typeof x === 'string' && k.length > 0 && x.length > 0)
  );
}

function isKnownIssue(v: unknown): v is KnownIssue {
  return (
    isPlainObject(v) &&
    typeof v.summary === 'string' &&
    v.summary.trim().length > 0 &&
    typeof v.url === 'string' &&
    v.url.trim().length > 0 &&
    (v.tracker === undefined || (typeof v.tracker === 'string' && v.tracker.trim().length > 0))
  );
}

function isExcludeOperations(
  v: unknown,
): v is { operationId: string; reason: string; knownIssue?: KnownIssue }[] {
  return (
    Array.isArray(v) &&
    v.every(
      (e) =>
        isPlainObject(e) &&
        typeof e.operationId === 'string' &&
        e.operationId.trim().length > 0 &&
        typeof e.reason === 'string' &&
        e.reason.trim().length > 0 &&
        (e.knownIssue === undefined || isKnownIssue(e.knownIssue)),
    )
  );
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
  if ('unenforcedStringFormats' in parsed) {
    const v = parsed.unenforcedStringFormats;
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.length > 0)) {
      throw new Error(
        `Invalid ${configPath}: "unenforcedStringFormats" must be an array of non-empty strings.`,
      );
    }
    merged.unenforcedStringFormats = v;
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
  if ('authDenyMode' in parsed) {
    const v = parsed.authDenyMode;
    if (v !== 'slice' && v !== 'all-secured') {
      throw new Error(
        `Invalid ${configPath}: "authDenyMode" must be "slice" or "all-secured", got ${JSON.stringify(v)}.`,
      );
    }
    merged.authDenyMode = v;
  }
  if ('resourceFixtures' in parsed) {
    const v = parsed.resourceFixtures;
    if (!isEnvVarNameRecord(v)) {
      throw new Error(
        `Invalid ${configPath}: "resourceFixtures" must be a Record<string, string> mapping non-empty names to non-empty env var names.`,
      );
    }
    merged.resourceFixtures = v;
  }
  if ('pathResourceFixtures' in parsed) {
    const v = parsed.pathResourceFixtures;
    if (!isEnvVarNameRecord(v)) {
      throw new Error(
        `Invalid ${configPath}: "pathResourceFixtures" must be a Record<string, string> mapping non-empty names to non-empty env var names.`,
      );
    }
    merged.pathResourceFixtures = v;
  }
  if ('excludeOperations' in parsed) {
    const v = parsed.excludeOperations;
    if (!isExcludeOperations(v)) {
      throw new Error(
        `Invalid ${configPath}: "excludeOperations" must be an array of { operationId, reason, knownIssue? } objects — operationId/reason are non-empty strings, and knownIssue (when present) must be { summary, url, tracker? } with non-empty strings.`,
      );
    }
    merged.excludeOperations = v;
  }
  if ('knownIssues' in parsed) {
    const v = parsed.knownIssues;
    if (!Array.isArray(v) || !v.every(isKnownIssue)) {
      throw new Error(
        `Invalid ${configPath}: "knownIssues" must be an array of { summary, url, tracker? } objects with non-empty strings.`,
      );
    }
    merged.knownIssues = v;
  }
  return merged;
}
