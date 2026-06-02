/**
 * Resolve per-role extras from an emitter's declared `roleHooks` (#350).
 *
 * Extracted from the orchestrator's `run()` so the dispatch contract is
 * unit-testable independently of disk I/O. Consumers pass an emitter
 * (whose `roleHooks` declaration drives the loop) and a small context
 * object; the function looks up each declared hook in the SDK registry.
 *
 * Contract (#350):
 *
 * - **Advisory declaration.** A hook declared in `emitter.roleHooks`
 *   that has no registered provider is *skipped*, not a hard error.
 *   This lets a single emitter (e.g. `PlaywrightEmitter` declaring
 *   `['deployment']`) target both configs that ship a deployment role
 *   bundle (camunda-oca) and configs that don't (camunda-hub) without
 *   forcing the latter to vendor a no-op provider just to satisfy
 *   registration. The downstream dispatch sites
 *   (`findRoleForStep` in the playwright emitter,
 *   `materializeRoleSupportFiles` in materialize-support) already raise
 *   meaningful errors when an operation *is* dispatched to a role
 *   whose extras / bundle aren't populated, so the advisory check is
 *   safe.
 *
 * - **Disjoint roles.** Two providers attempting to populate the same
 *   role key throw — providers must own disjoint roles.
 *
 * - **Undefined extras = skip.** A provider whose `compute()` returns
 *   `undefined` is treated as "nothing to contribute for this config";
 *   the role is simply not added to the returned map.
 */
import { type EmitterStrategy, getRoleHookProvider } from '@camunda8/emitter-sdk';

/**
 * Thrown when two role-hook providers attempt to populate the same role
 * key. This is a deterministic, expected failure (not a bug in the
 * provider's compute()), so the orchestrator catches it specifically and
 * exits with the message — any other error from a provider should bubble
 * up with its full stack trace.
 */
export class RoleHookConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleHookConflictError';
  }
}

export interface RoleHookCtx {
  /** Absolute path to the repo root. Forwarded to provider.compute(). */
  repoRoot: string;
  /** Active config name (e.g. 'camunda-oca'). Forwarded to provider.compute(). */
  configName: string;
}

/**
 * Resolve every declared `roleHook` for the given emitter and return
 * the per-role extras map. Returns `undefined` when no hook contributed
 * anything (so the caller can skip allocating an empty map).
 *
 * Throws `Error` if two providers populate the same role.
 */
export async function resolveRoleExtras(
  emitter: Pick<EmitterStrategy, 'id' | 'roleHooks'>,
  ctx: RoleHookCtx,
): Promise<Map<string, Record<string, unknown>> | undefined> {
  let roleExtras: Map<string, Record<string, unknown>> | undefined;
  for (const hook of emitter.roleHooks ?? []) {
    const provider = getRoleHookProvider(hook);
    if (!provider) {
      // Advisory: the emitter declares this hook but the active config
      // didn't ship a provider for it. Operations that actually need the
      // role's extras will surface a named error at dispatch time
      // (`findRoleForStep` / `materializeRoleSupportFiles`); silent skip
      // is correct for configs that have no operation dispatched to the
      // role.
      continue;
    }
    const extras = await provider.compute(ctx);
    if (extras === undefined) continue;
    if (!roleExtras) roleExtras = new Map<string, Record<string, unknown>>();
    if (roleExtras.has(provider.role)) {
      throw new RoleHookConflictError(
        `Role-hook provider for hook ${JSON.stringify(
          hook,
        )} attempted to overwrite extras for role ${JSON.stringify(
          provider.role,
        )} already populated by an earlier hook. Hook providers must own disjoint roles.`,
      );
    }
    roleExtras.set(provider.role, extras);
  }
  return roleExtras;
}
