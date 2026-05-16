import type { EndpointScenarioCollection, GlobalContextSeed } from '../types.js';
import type { LoadedRoleBundle } from './playwright/roleRenderer.js';

/**
 * Context passed to an {@link Emitter} on every invocation.
 *
 * Keep this surface tight — every consumer of the emitter registry depends on
 * it. New optional fields are fine; making existing fields required is a
 * breaking change for third-party emitters.
 */
export interface EmitContext {
  /** Absolute path of the directory tests should be emitted into. */
  outDir: string;
  /** Suite name used for test naming (for example, `describe()` blocks) and optionally for file names, depending on the emitter. */
  suiteName: string;
  /** Generation mode — `feature` is the default for path-analyser scenarios. `variant` is used for optional sub-shape variant suites (#37 / #105). */
  mode: 'feature' | 'integration' | 'variant';
  /**
   * Bindings that every emitted scenario must seed before its request plan
   * runs (e.g. the default-tenant identifier under single-tenant mode).
   * Sourced from the global-context-seeds ABox. Optional so
   * emitters that don't need universal seeding (or unit tests that exercise
   * unrelated paths) can omit it; when omitted the emitter writes no
   * universal-seed prologue and no multipart strip branches.
   */
  globalContextSeeds?: readonly GlobalContextSeed[];
  /**
   * Whether the emitted suite should record every response observation by
   * calling `recordResponse({...})` (and importing it / `sanitizeBody` from
   * `./support/recorder`). Sourced from
   * `configs.json#configs.<active>.codegen.playwright.recordResponses`.
   *
   * Optional with a default of `true` — omitting the field preserves the
   * pre-config behaviour. Only the Playwright emitter consumes this today.
   */
  recordResponses?: boolean;
  /**
   * Resolver returning the ontological role (per the active config's
   * artifact-kinds ABox) bound to `opId`, or `undefined` when no role is
   * declared. The Playwright emitter uses this to route role-bound steps
   * through `roleBundles` (Lift 12 / #231) instead of the generic
   * per-method path. Optional — emitters that omit it produce a suite
   * with no role-dispatched steps (every step takes the inline path).
   */
  getRoleForOperation?: (opId: string) => string | undefined;
  /**
   * Loaded per-role template bundles for the active emitter, keyed by
   * role name. Populated by the orchestrator via
   * `loadRoleBundlesForActiveConfig` (Lift 12 / #231). Bound roles whose
   * bundle is missing raise a hard error during rendering — there is no
   * silent fallback.
   */
  roleBundles?: Map<string, LoadedRoleBundle>;
  /**
   * Per-role scope additions exposed to role templates as extra Mustache
   * variables. Keyed by role name. The renderer merges these into
   * `PlaywrightRoleScope` before rendering `call-site.tmpl`. For the
   * `deploymentGateway` role (Lift 12 / Phase 4) this carries an
   * `extracts` JSON literal computed from the role-bound op's
   * `responseSemanticLeaves`. Optional and emitter-agnostic — future
   * roles populate their own keys.
   */
  roleExtras?: Map<string, Record<string, unknown>>;
}

/**
 * A single output artifact returned by an {@link Emitter}. Paths are relative
 * to {@link EmitContext.outDir}; the orchestrator handles directory creation
 * and write-out so that emitters stay pure.
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
 */
export interface Emitter {
  /** Stable identifier used by `--target=<id>`. Must be unique in a registry. */
  readonly id: string;
  /** Human-readable name for logs and docs. */
  readonly name: string;
  /** Lowers a scenario collection into output files. */
  emit(collection: EndpointScenarioCollection, ctx: EmitContext): Promise<EmittedFile[]>;
}
