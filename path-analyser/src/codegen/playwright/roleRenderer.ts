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
// Top-level import (vs. dynamic `await import`) — mustache is a small
// CommonJS package with a default export carrying `render`. Cleanest at the
// type system level is to use the namespace import.
import Mustache from 'mustache';
import { getActiveConfigDir } from '../../configResolver.js';
import type { RequestStep } from '../../types.js';
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
 */
export interface LoadedRoleBundle extends RoleTemplateBundle {
  /** Eagerly-loaded contents of `call-site.tmpl`. */
  callSiteTemplate: string;
  /** Eagerly-loaded contents of `imports.tmpl`, when present. */
  importsTemplate?: string;
  /** Parsed `match.json`, when present. */
  match?: RoleMatchSpec;
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
    // Discover support.<ext> by listing the directory — the role's helper
    // language (ts/js/java/...) is the role's choice, not the renderer's.
    let supportPath: string | undefined;
    for (const f of readdirSync(roleDir)) {
      if (f.startsWith('support.')) {
        supportPath = path.join(roleDir, f);
        break;
      }
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
      callSiteTemplatePath: callSitePath,
      importsTemplatePath: existsSync(importsPath) ? importsPath : undefined,
      supportFilePath: supportPath,
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
export function stepMatchesRole(step: RequestStep, bundle: LoadedRoleBundle): boolean {
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
export function renderRoleCallSite(bundle: LoadedRoleBundle, scope: PlaywrightRoleScope): string {
  return Mustache.render(bundle.callSiteTemplate, scope);
}

/**
 * Render `imports.tmpl` for a single role usage in a spec file. Returns
 * the template output (possibly multi-line — each non-empty line becomes
 * a distinct entry in the spec's import block, deduplicated by the
 * caller). Returns `''` when the role has no imports template.
 */
export function renderRoleImports(bundle: LoadedRoleBundle, scope: ImportsTemplateScope): string {
  if (!bundle.importsTemplate) return '';
  return Mustache.render(bundle.importsTemplate, scope);
}
