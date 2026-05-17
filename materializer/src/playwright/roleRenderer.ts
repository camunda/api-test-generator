// Per-config, per-role template renderer for the Playwright emitter
// (Lift 12 / #231).
//
// The renderer is uniform: for every step the Playwright emitter looks up
// the step's role via the ABox, asks the renderer for the call-site code,
// and uses it. The generic per-method path is just the "no role bound to
// this op" arm. Bound roles whose directory is missing OR whose
// `call-site.tmpl` is missing raise a hard error — there is no silent
// fallback (see ROLES.md).
//
// Roles live at `configs/<config>/codegen/playwright/roles/<role>/` and
// each may contain:
//   * `call-site.tmpl` (required) — Mustache template for the step's body
//   * `imports.tmpl`   (optional) — Mustache template for the imports
//                                    block contributions (rendered once
//                                    per spec-file, per role used)
//   * `support.<ext>`  (optional) — runtime helper vendored into the
//                                    suite under `<outDir>/support/<role>.<ext>`
//   * `match.json`     (optional) — gating conditions; without it the role
//                                    matches every step whose opId carries
//                                    the role binding in the ABox
//
// All templates are logic-free Mustache 4.x; authors must use triple-braces
// (`{{{var}}}`) for code interpolation to avoid HTML-escaping of `/`, `<`,
// `>` and `&` (which would corrupt TypeScript output).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoadedRoleBundle as SdkLoadedRoleBundle } from '@camunda8/emitter-sdk';
// Top-level import (vs. dynamic `await import`) — mustache is a small
// CommonJS package with a default export carrying `render`.
import Mustache from 'mustache';
import { getActiveConfigDir } from 'path-analyser/configResolver';
import type { RequestStep } from 'path-analyser/types';
import type { ImportsTemplateScope, PlaywrightRoleScope, RoleTemplateBundle } from '../roles.js';

const ROLES_DIRNAME = 'roles';
const EMITTER_DIRNAME = 'playwright';
const CODEGEN_DIRNAME = 'codegen';

/**
 * Optional per-role gating rules (`match.json`) that constrain which steps
 * with the role-bound opId actually dispatch through the role. An empty or
 * omitted array on a field matches every value for that field.
 */
interface RoleMatchSpec {
  bodyKinds?: string[];
  expectedStatuses?: number[];
}

/**
 * In-memory representation of a discovered role directory, with all
 * templates eagerly loaded. Templates are tiny (under 1KB each) so the
 * memory cost is negligible and avoids race conditions / repeated disk
 * reads during the per-step render loop.
 *
 * Structurally compatible with `@camunda8/emitter-sdk`'s
 * `LoadedRoleBundle` — the materializer's internal type retains the
 * loader-side path fields (`callSiteTemplatePath`, `supportFilePath`)
 * used by the support-file vendoring step, while still satisfying the
 * public SDK shape for assignment into `EmitContext.roleBundles`.
 */
export interface LoadedRoleBundle extends RoleTemplateBundle {
  /** Role name (matches the directory name and the ABox role identifier). */
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
   * Basename of the **source** helper file on disk, with any trailing
   * `.tmpl` suffix stripped (e.g. `'support.ts'`; for a templated source
   * `support.ts.tmpl` this is still `'support.ts'`). Used by
   * {@link materializeRoleSupportFiles} only to derive the file extension
   * via `path.extname` — the **emitted destination filename** is always
   * `<roleName><ext>` (e.g. `'deploymentGateway.ts'`) and is not stored
   * on the bundle. Treat this as the source basename, not the destination.
   */
  supportBasename?: string;
  /**
   * When true, the source file on disk is `support.<ext>.tmpl` (a Mustache
   * template) and the materializer must render it against the role's
   * {@link EmitContext.roleExtras} entry before writing it to the suite.
   * When false (the default), the source is `support.<ext>` and is copied
   * verbatim. Mutually exclusive — the loader rejects role directories
   * that contain both forms.
   */
  supportIsTemplated?: boolean;
}

/**
 * Locate the repo root (the directory containing `configs.json`) by
 * walking up from this module's location. Robust across both tsx (source)
 * and dist runtime modes so the role-template overlay works regardless of
 * how the codegen entry point is invoked.
 */
function findRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'configs.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `roleRenderer.findRepoRoot: could not locate a repo root (no configs.json found in any ancestor of ${here}).`,
  );
}

/**
 * Discover and load every role bundle defined under
 * `configs/<active>/codegen/playwright/roles/`. Returns a `Map<roleName, LoadedRoleBundle>`.
 *
 * Roles whose directory contains no `call-site.tmpl` raise immediately —
 * an empty role directory is an authoring mistake, not a "skip this role"
 * signal. The materializer enforces the inverse direction
 * (every ABox-bound role must have a directory) by reading from this same
 * map.
 */
export function loadRoleBundlesForActiveConfig(repoRoot?: string): Map<string, LoadedRoleBundle> {
  const root = repoRoot ?? findRepoRoot();
  const rolesDir = path.join(
    getActiveConfigDir(root),
    CODEGEN_DIRNAME,
    EMITTER_DIRNAME,
    ROLES_DIRNAME,
  );
  const result = new Map<string, LoadedRoleBundle>();
  if (!existsSync(rolesDir)) return result;

  for (const entry of readdirSync(rolesDir)) {
    const roleDir = path.join(rolesDir, entry);
    if (!statSync(roleDir).isDirectory()) continue;

    const callSitePath = path.join(roleDir, 'call-site.tmpl');
    if (!existsSync(callSitePath)) {
      throw new Error(
        `roleRenderer: role directory ${roleDir} is missing required call-site.tmpl. ` +
          `Either add the template or remove the directory.`,
      );
    }
    const importsPath = path.join(roleDir, 'imports.tmpl');
    // Discover support.<ext> (verbatim) or support.<ext>.tmpl (Mustache
    // template) by listing the directory — the role's helper language
    // (ts/js/java/...) is the role's choice, not the renderer's. Sort the
    // entries for deterministic selection, and throw if more than one
    // support file exists so the role directory has an unambiguous
    // contract (non-deterministic filesystem ordering could silently
    // select a different file across runs or machines). The two forms
    // are mutually exclusive: a role ships either a verbatim helper or a
    // templated helper, not both.
    const supportFiles = readdirSync(roleDir)
      .filter((f) => f.startsWith('support.'))
      .sort();
    if (supportFiles.length > 1) {
      throw new Error(
        `roleRenderer: role directory ${roleDir} contains multiple support files: ` +
          `${supportFiles.join(', ')}. Only one support.<ext>[.tmpl] file is permitted per role.`,
      );
    }
    let supportPath: string | undefined;
    let supportIsTemplated = false;
    if (supportFiles.length === 1) {
      supportPath = path.join(roleDir, supportFiles[0]);
      supportIsTemplated = supportFiles[0].endsWith('.tmpl');
    }
    const matchPath = path.join(roleDir, 'match.json');
    let match: RoleMatchSpec | undefined;
    if (existsSync(matchPath)) {
      const raw = readFileSync(matchPath, 'utf8');
      // biome-ignore lint/plugin: runtime contract boundary for parsed JSON
      const parsed = JSON.parse(raw) as RoleMatchSpec & { _comment?: unknown };
      match = {
        bodyKinds: Array.isArray(parsed.bodyKinds) ? parsed.bodyKinds.map(String) : undefined,
        expectedStatuses: Array.isArray(parsed.expectedStatuses)
          ? parsed.expectedStatuses.map(Number)
          : undefined,
      };
    }

    result.set(entry, {
      role: entry,
      roleName: entry,
      dir: roleDir,
      callSiteTemplatePath: callSitePath,
      importsTemplatePath: existsSync(importsPath) ? importsPath : undefined,
      supportFilePath: supportPath,
      // `supportBasename` is the FINAL emitted basename — strip the `.tmpl`
      // suffix when the source is a template so downstream consumers
      // (materializer, drift-detector invariants) see the same name a
      // verbatim helper would have.
      supportBasename: supportPath ? path.basename(supportPath).replace(/\.tmpl$/, '') : undefined,
      supportIsTemplated,
      callSiteTemplate: readFileSync(callSitePath, 'utf8'),
      importsTemplate: existsSync(importsPath) ? readFileSync(importsPath, 'utf8') : undefined,
      match,
    });
  }

  return result;
}

/**
 * Decide whether a step should be dispatched to its bound role. Returns
 * `true` when the role's `match.json` (if any) allows the step's
 * `bodyKind` and declared `expect.status`. Roles without a `match.json`
 * match every step that carries the role binding.
 */
export function stepMatchesRole(step: RequestStep, bundle: SdkLoadedRoleBundle): boolean {
  const m = bundle.match;
  if (!m) return true;
  if (m.bodyKinds && m.bodyKinds.length > 0) {
    if (!step.bodyKind || !m.bodyKinds.includes(step.bodyKind)) return false;
  }
  if (
    m.expectedStatuses &&
    m.expectedStatuses.length > 0 &&
    !m.expectedStatuses.includes(step.expect.status)
  ) {
    return false;
  }
  return true;
}

/**
 * Render `call-site.tmpl` for a single step. Returns the raw multi-line
 * template output; the caller indents lines to the desired depth.
 *
 * Templates MUST use triple-brace `{{{var}}}` interpolation for code; any
 * value rendered through double-braces is HTML-escaped by Mustache and
 * will corrupt TypeScript output. The renderer does not police this — it
 * is an authoring contract documented in ROLES.md.
 */
export function renderRoleCallSite(
  bundle: SdkLoadedRoleBundle,
  scope: PlaywrightRoleScope,
): string {
  return Mustache.render(bundle.callSiteTemplate, scope);
}

/**
 * Render `imports.tmpl` for a single role usage in a spec file. Returns
 * the template output (possibly multi-line — each non-empty line becomes
 * a distinct entry in the spec's import block, deduplicated by the
 * caller). Returns `''` when the role has no imports template.
 */
export function renderRoleImports(
  bundle: SdkLoadedRoleBundle,
  scope: ImportsTemplateScope,
): string {
  if (!bundle.importsTemplate) return '';
  return Mustache.render(bundle.importsTemplate, scope);
}
