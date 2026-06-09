/**
 * Public contract types for @camunda8/emitter-sdk.
 *
 * External emitter packages should import everything from
 * `@camunda8/emitter-sdk` (the barrel) rather than reaching into
 * `path-analyser` or `materializer` internals. This file is the
 * authoritative shape of the contract; any breaking change requires
 * a package version bump.
 */

import type { EndpointScenarioCollection, GlobalContextSeed } from 'path-analyser/types';

/**
 * A JSON Schema (draft-2020-12 compatible). Kept as a permissive
 * record so the SDK does not pin a specific JSON Schema typing
 * library; the orchestrator validates `configs/<name>/codegen/<id>/config.json`
 * against this at boot.
 */
export type JSONSchema = Record<string, unknown>;

/**
 * Per-role match constraints (`match.json` in a role bundle directory).
 * An empty or omitted array on a field matches every value for that field.
 */
export interface RoleMatchSpec {
  bodyKinds?: string[];
  expectedStatuses?: number[];
}

/**
 * An eagerly-loaded role-template bundle, ready to be rendered by an
 * emitter. The orchestrator loads these from
 * `configs/<name>/codegen/<emitter>/roles/<role>/` and passes them
 * through {@link EmitContext.roleBundles}.
 */
export interface LoadedRoleBundle {
  /** Role name (matches the directory name). */
  roleName: string;
  /** Absolute path to the role directory on disk. */
  dir: string;
  /** Eagerly-loaded contents of `call-site.tmpl`. */
  callSiteTemplate: string;
  /** Eagerly-loaded contents of `imports.tmpl`, when present. */
  importsTemplate?: string;
  /** Parsed `match.json`, when present. */
  match?: RoleMatchSpec;
  /**
   * Optional vendored helper file (e.g. `support.ts`) that the orchestrator
   * has already materialized under `<outDir>/support/<roleName>.<ext>`.
   * Carries the basename of the emitted helper so call-site templates can
   * reference it without re-deriving the path.
   */
  supportBasename?: string;
}

/**
 * Context passed to an {@link EmitterStrategy} on every invocation.
 *
 * Keep this surface tight — every consumer of the emitter registry depends
 * on it. New optional fields are fine; making existing fields required is a
 * breaking change for third-party emitters.
 */
export interface EmitContext {
  /** Absolute path of the directory tests should be emitted into. */
  outDir: string;

  /** Suite name used for test naming (e.g. `describe()` blocks) and optionally for file names. */
  suiteName: string;

  /** Generation mode — `feature` is the default for path-analyser scenarios. `variant` is used for optional sub-shape variant suites (#37 / #105). */
  mode: 'feature' | 'integration' | 'variant';

  /**
   * Active config name (e.g. `'camunda-oca'`). Sourced from the
   * `CONFIG` env var via path-analyser's `getActiveConfigName()`,
   * defaulting to `configs.json`'s `default` entry.
   */
  configName: string;

  /**
   * Per-emitter configuration loaded from
   * `configs/<configName>/codegen/<emitterId>/config.json`. Already
   * validated against {@link EmitterStrategy.configSchema} when present.
   * An empty object when no config file exists.
   */
  emitterConfig: Record<string, unknown>;

  /**
   * Resolve a path relative to the active config directory
   * (`configs/<configName>/<relative>`) to an absolute path. Use this
   * instead of constructing config paths from scratch — keeps emitters
   * independent of the on-disk layout.
   */
  resolveConfigPath: (relative: string) => string;

  /**
   * Bindings that every emitted scenario must seed before its request plan
   * runs (e.g. the default-tenant identifier under single-tenant mode).
   * Sourced from the global-context-seeds ABox. Optional — when omitted,
   * the emitter writes no universal-seed prologue and no multipart strip
   * branches.
   */
  globalContextSeeds?: readonly GlobalContextSeed[];

  /**
   * Resolver returning the ontological role bound to `opId` (per the
   * active config's artifact-kinds ABox), or `undefined` when no role
   * is declared. Emitters route role-bound steps through `roleBundles`
   * (Lift 12 / #231) instead of the generic per-method path. Optional —
   * emitters that omit it produce a suite with no role-dispatched steps.
   */
  getRoleForOperation?: (opId: string) => string | undefined;

  /**
   * Loaded per-role template bundles for the active emitter, keyed by
   * role name. Populated by the orchestrator. Bound roles whose bundle
   * is missing raise a hard error during rendering — there is no silent
   * fallback.
   */
  roleBundles?: Map<string, LoadedRoleBundle>;

  /**
   * Per-role scope additions exposed to role templates as extra
   * template variables. Keyed by role name. Populated by per-role
   * hook providers declared via {@link EmitterStrategy.roleHooks}.
   * Emitter-agnostic — providers populate their own keys.
   */
  roleExtras?: Map<string, Record<string, unknown>>;
}

/**
 * A single output artifact returned by an {@link EmitterStrategy}. Paths are
 * relative to {@link EmitContext.outDir}; the orchestrator handles directory
 * creation and write-out so that emitters stay pure.
 */
export interface EmittedFile {
  /** Path relative to {@link EmitContext.outDir}. Forward slashes only. */
  relativePath: string;
  /** UTF-8 file content. */
  content: string;
}

/**
 * Strategy that lowers a scenario collection into one or more output files.
 *
 * Implementations must be **pure**: they may not touch the filesystem, the
 * network, or any global state. All inputs come through {@link EmitContext}
 * and the scenario collection; all outputs come back as {@link EmittedFile}.
 *
 * Register an instance with {@link registerEmitter} at module load time.
 */
export interface EmitterStrategy {
  /** Stable identifier used by `--target=<id>`. Unique per registry. */
  readonly id: string;

  /** Human-readable name for logs / docs / `--help`. */
  readonly name: string;

  /**
   * Which named configs (from `configs.json`) this emitter targets.
   * Use `['*']` for config-agnostic emitters. Use specific names
   * (`['camunda-oca']`) for emitters that hard-code config-specific
   * output shapes. Required — every emitter declares its compatibility
   * surface explicitly.
   */
  readonly supportedConfigs: readonly string[];

  /**
   * Optional JSON Schema describing this emitter's per-config knobs.
   * When provided, the orchestrator validates
   * `configs/<configName>/codegen/<id>/config.json` against it before
   * invoking {@link emit}. When absent, the emitter receives an empty
   * `{}` config.
   */
  readonly configSchema?: JSONSchema;

  /**
   * Per-role hook names this emitter consumes. The orchestrator
   * matches hook names against registered hook providers (see
   * {@link registerRoleHookProvider}) and populates
   * {@link EmitContext.roleExtras} accordingly. Empty / omitted ⇒
   * emitter consumes no role extras.
   *
   * Example: `['deployment']` for an emitter that consumes
   * spec-derived deployment extracts (Lift 12).
   */
  readonly roleHooks?: readonly string[];

  /**
   * Declarative upstream operation-map source for SDK emitters. When
   * present, the generic SDK-map fetcher (`scripts/fetch-sdk-maps.ts`,
   * driven off the `list-targets` projection) sparse-clones `repo` and
   * copies `path` to `out`, instead of each emitter shipping its own
   * bespoke `fetch-<lang>-map` script.
   *
   * This is **declarative metadata only** — the emitter never performs
   * the fetch itself, preserving the purity of {@link emit}. The
   * orchestrator/build layer reads the declaration and runs the (impure)
   * clone. Omit for emitters with no upstream map (e.g. Playwright).
   */
  readonly sdkMap?: EmitterSdkMap;

  /**
   * One-shot per-suite scaffolding. Returns the framing files for the
   * emitted project (e.g. `package.json`, `tsconfig.json`, `README.md`,
   * `playwright.config.ts`). Called once per CLI invocation, before any
   * {@link emit} call. Optional — omit if the emitter writes loose
   * specs into an existing project.
   */
  scaffold?(ctx: EmitContext): Promise<EmittedFile[]>;

  /**
   * Lowers one scenario collection into output files. Pure: no
   * filesystem, no network, no global state.
   */
  emit(collection: EndpointScenarioCollection, ctx: EmitContext): Promise<EmittedFile[]>;
}

/**
 * Declarative description of an emitter's upstream operation-map source.
 * Consumed by the generic SDK-map fetcher and exposed via the
 * `list-targets` registry projection.
 */
export interface EmitterSdkMap {
  /** Upstream repository, `owner/name` (e.g. `camunda/orchestration-cluster-api-js`). */
  readonly repo: string;
  /** Path to the map file within the upstream repo (e.g. `examples/operation-map.json`). */
  readonly path: string;
  /**
   * Environment variable controlling the fetched ref (branch/tag/SHA).
   * Defaults to `main` when the variable is unset.
   */
  readonly refEnv: string;
  /** Output path, relative to the repo root (e.g. `spec/js-sdk/operation-map.json`). */
  readonly out: string;
}

/**
 * A role-hook provider populates one key in {@link EmitContext.roleExtras}.
 * Providers are registered via {@link registerRoleHookProvider} at module
 * load time; the orchestrator invokes the provider for any emitter that
 * declares the matching hook name in {@link EmitterStrategy.roleHooks}.
 */
export interface RoleHookProvider {
  /** Stable hook name. Matches values in {@link EmitterStrategy.roleHooks}. */
  readonly hook: string;

  /**
   * Role this hook applies to (matches a role directory name under
   * `configs/<configName>/codegen/<emitterId>/roles/<role>/`).
   */
  readonly role: string;

  /**
   * Compute the per-role extras object. Called once per CLI invocation,
   * before any emitter is invoked. Return `undefined` when the hook has
   * nothing to contribute for the active config (e.g. no operation is
   * bound to the role in the current ABox); the orchestrator then omits
   * the role from {@link EmitContext.roleExtras}.
   *
   * `repoRoot` is the absolute path to the repository root (the directory
   * containing `configs.json`). Providers may read disk artifacts under
   * `generated/<configName>/`, `configs/<configName>/`, etc.
   */
  compute(args: {
    repoRoot: string;
    configName: string;
  }): Promise<Record<string, unknown> | undefined>;
}
