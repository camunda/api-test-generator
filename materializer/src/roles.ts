// Type definitions for the operation-role rendering hook (Lift 12 / #231).
//
// See ./ROLES.md for the design. This file is the canonical type surface
// shared between the renderer (Phase 3), the materializer overlay (Phase 2),
// and the role-template authors. Nothing in here is wired into the codegen
// pipeline yet — Phase 1 ships the contract; later phases ship the runtime.

/**
 * Common scope variables provided to every role template, on every emitter.
 * Per-emitter scopes extend this with additional fields (see
 * `PlaywrightRoleScope` below).
 */
export interface CommonRoleScope {
  /** Response binding variable name allocated by the planner for this step (e.g. `resp42`). */
  respVar: string;
  /** OpenAPI path template (e.g. the operation's `op.path`). */
  pathTemplate: string;
  /** Uppercase HTTP verb. */
  method: string;
  /** OpenAPI `operationId` of the step's operation. */
  operationId: string;
  /** Role bound to this step. Useful in error-message wrappers. */
  roleName: string;
  /**
   * The string the generic per-method dispatch entry would have emitted for
   * this step. Always materialised eagerly. Templates may interpolate it
   * (wrap pattern) or ignore it (replace pattern). See ROLES.md.
   */
  defaultRender: string;
  /** The ctx variable name in scope (typically the literal `ctx`). */
  ctx: string;
}

/**
 * Scope variables provided to Playwright role templates. Extends
 * `CommonRoleScope`. The Java SDK and any future emitter define their own
 * per-emitter scope interface alongside their renderer.
 */
export interface PlaywrightRoleScope extends CommonRoleScope {
  /** Name of the Playwright `request` fixture in scope. */
  request: string;
  /** Name of the base-URL variable in scope. */
  baseUrl: string;
  /**
   * TypeScript expression evaluating to the request body for this step.
   * JSON literal, multipart builder call, or `undefined`.
   */
  body: string;
}

/**
 * Scope provided to `imports.tmpl`. Rendered **once per (spec-file, role)
 * pair**, not once per step — therefore receives only the role-static
 * subset of `CommonRoleScope` / per-emitter scopes, never per-step values
 * (`respVar`, `body`, `operationId`, `pathTemplate`, etc.).
 *
 * Step-dependent imports are not a use case the contract supports: if a
 * template's import block needs to differ between two steps of the same
 * role in the same spec, that variation belongs inside the helper, not in
 * the import template. The renderer enforces the narrower scope so that
 * a typoed reference to a per-step variable fails loudly at codegen time.
 */
export interface ImportsTemplateScope {
  /** The role identifier (e.g. `deploymentGateway`). */
  roleName: string;
  /**
   * Renderer-computed relative path from the current spec file to
   * `playwright/support/<role>` (no extension). Typically
   * `./support/<role>` for spec files at the suite root, `../support/<role>`
   * for spec files in subdirectories. Authors should interpolate this with
   * triple-braces to avoid HTML-escaping of `/`.
   */
  supportImportPath: string;
}

/**
 * Resolved on-disk shape of a per-role directory for one emitter, one
 * config. Produced by the materializer when it walks
 * `configs/<config>/codegen/<emitter>/roles/<role>/`.
 */
export interface RoleTemplateBundle {
  /** Role name (matches the directory name and the ABox role identifier). */
  role: string;
  /**
   * Absolute path to `call-site.tmpl`. Required: a role directory without
   * this file is malformed and the materializer raises.
   */
  callSiteTemplatePath: string;
  /**
   * Absolute path to `imports.tmpl`, when present. Optional; roles whose
   * call-site template needs no additional imports omit this file.
   */
  importsTemplatePath?: string;
  /**
   * Absolute path to `support.<ext>`, when present. Optional; roles that
   * inline everything in their call-site template need no vendored support.
   */
  supportFilePath?: string;
}

/**
 * Result of a single step's render. `body` is the emitted code for the step;
 * `imports` is the deduplicated set of import lines this step contributes to
 * the spec file.
 */
export interface RenderedStep {
  body: string;
  imports: ReadonlySet<string>;
}
