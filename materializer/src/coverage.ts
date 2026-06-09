// Scenario-template coverage extractor (#331, #335).
//
// Walks the per-template scenario JSON files emitted by the planner
// (`generated/<config>/scenarios/templates/<TemplateName>/*.json`) and
// collects every operationId that appears as the `op` of an `Invoke` or
// `Observe` step. Those operations are, by definition, the
// units-under-test of a well-formed scenario-driven spec — emitting a
// per-endpoint feature spec for the same operation would be redundant
// at best and structurally malformed at worst (see #331 for the
// EdgeLifecycle motivating example).
//
// The collector is deliberately template-agnostic: a new
// ScenarioTemplate added to `configs/<config>/ontology/scenario-templates.json`
// (and emitted by the planner under a new subdirectory of
// `scenarios/templates/`) extends suppression automatically as soon
// as its name appears in `templateNames`. In production the caller
// passes the ABox's template names directly — there is no separate
// materializer-side registry to keep in sync (#335).
//
// The on-disk output dir for each template is derived purely from the
// template name: `playwright/templates/<TemplateName>/`. This mirrors
// the planner's `scenarios/templates/<TemplateName>/` layout so the
// scenario JSON → emitted spec relationship is visible from the
// directory structure alone.
//
// `PrereqChain` steps are intentionally *excluded* from coverage —
// they are scaffolding, not units-under-test. The Invoke/Observe vs
// PrereqChain distinction is the same closed taxonomy declared in
// `scenarioTemplateSchema.ts`.

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Subdirectory under the Playwright suite root where the materializer
 * writes per-template suites. Derived purely from the template name —
 * no taxonomy translation. Mirrors the planner's
 * `scenarios/templates/<TemplateName>/` layout (#335).
 */
export function templateOutputDir(templateName: string): string {
  return path.join('templates', templateName);
}

export interface CoverageEntry {
  operationId: string;
  template: string;
  appliesToKind: string;
  aboxRow: string;
  stepKind: 'invoke' | 'observe';
  emittedSpec: string;
}

export interface CoverageResult {
  suppressedOpIds: Set<string>;
  entries: CoverageEntry[];
}

export interface BuildCoverageOptions {
  /** `generated/<config>/scenarios/templates/`. */
  templateScenariosRootDir: string;
  /** `configs/<config>/ontology/scenario-templates.json`, or `undefined`
   *  to treat every template as suppressing (the default). */
  templatesAboxPath: string | undefined;
  /**
   * The set of scenario-template names the materializer recognises
   * (in production, the names declared by the active config's
   * scenario-templates ABox). For each scenario file under
   * `<templateScenariosRootDir>/<templateName>/<subjectName>.json`
   * the recorded `emittedSpec` becomes
   * `templates/<templateName>/<subjectName>.lifecycle.spec.ts`.
   * Templates not in this list are skipped (no spec is emitted on
   * disk, so coverage cannot legitimately claim the op).
   */
  templateNames: readonly string[];
}

interface ScenarioStep {
  kind?: string;
  operationId?: string;
}

interface ScenarioFile {
  templateName?: string;
  subjectName?: string;
  subjectKind?: string;
  scenario?: { steps?: ScenarioStep[] };
}

interface ScenarioTemplateAbox {
  templates?: Array<{ name?: string; suppressesFeatureTest?: boolean }>;
}

/**
 * Collect coverage from on-disk scenario JSON files. Pure I/O —
 * caller decides where the artefact lives and how the suppression set
 * is consumed.
 */
export async function buildCoverage(opts: BuildCoverageOptions): Promise<CoverageResult> {
  const suppressByTemplate = await loadSuppressionMap(opts.templatesAboxPath);
  const entries: CoverageEntry[] = [];

  let templateDirs: string[];
  try {
    templateDirs = await fs.readdir(opts.templateScenariosRootDir);
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'code' in e && Reflect.get(e, 'code') === 'ENOENT') {
      return { suppressedOpIds: new Set(), entries: [] };
    }
    throw e;
  }
  templateDirs.sort();

  // Build a name → outputDir lookup. Templates not in `templateNames`
  // are skipped (no spec is emitted on disk, so coverage cannot
  // legitimately claim the op). The output dir is derived purely from
  // the name (`templates/<TemplateName>/`) — no taxonomy table.
  const outputDirByName = new Map(opts.templateNames.map((n) => [n, templateOutputDir(n)]));

  for (const templateName of templateDirs) {
    const templateDir = path.join(opts.templateScenariosRootDir, templateName);
    const stat = await fs.stat(templateDir);
    if (!stat.isDirectory()) continue;

    const emittedDir = outputDirByName.get(templateName);
    if (!emittedDir) continue;

    // Default: every well-formed scenario template suppresses. The
    // opt-out is per-template so a future non-functional template
    // (smoke / chaos / load) can emit a spec without claiming
    // coverage.
    const suppresses = suppressByTemplate.get(templateName) ?? true;
    if (!suppresses) continue;

    const files = (await fs.readdir(templateDir)).filter((f) => f.endsWith('.json')).sort();
    for (const f of files) {
      const raw = await fs.readFile(path.join(templateDir, f), 'utf8');
      let parsed: ScenarioFile;
      try {
        // biome-ignore lint/plugin: runtime contract boundary — planner-emitted scenario JSON; downstream emitter validates the full shape.
        parsed = JSON.parse(raw) as ScenarioFile;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
          `coverage: failed to parse scenario JSON ${path.join(templateDir, f)}: ${msg}`,
        );
      }
      const subjectName = parsed.subjectName;
      const subjectKind = parsed.subjectKind;
      const tmplName = parsed.templateName ?? templateName;
      if (!subjectName) continue;
      const emittedSpec = path.join(emittedDir, `${subjectName}.lifecycle.spec.ts`);
      const steps = parsed.scenario?.steps ?? [];
      for (const step of steps) {
        const kind = step.kind;
        if ((kind === 'invoke' || kind === 'observe') && step.operationId) {
          entries.push({
            operationId: step.operationId,
            template: tmplName,
            appliesToKind: subjectKind ?? '',
            aboxRow: subjectName,
            stepKind: kind,
            emittedSpec,
          });
        }
      }
    }
  }

  return {
    suppressedOpIds: new Set(entries.map((e) => e.operationId)),
    entries,
  };
}

async function loadSuppressionMap(
  templatesAboxPath: string | undefined,
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!templatesAboxPath) return out;
  let raw: string;
  try {
    raw = await fs.readFile(templatesAboxPath, 'utf8');
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'code' in e && Reflect.get(e, 'code') === 'ENOENT') {
      return out;
    }
    throw e;
  }
  let parsed: ScenarioTemplateAbox;
  try {
    // biome-ignore lint/plugin: runtime contract boundary — scenario-templates ABox JSON; only `templates[].name` and `templates[].suppressesFeatureTest` are read.
    parsed = JSON.parse(raw) as ScenarioTemplateAbox;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`coverage: failed to parse ${templatesAboxPath}: ${msg}`);
  }
  for (const t of parsed.templates ?? []) {
    if (typeof t.name === 'string') {
      out.set(t.name, t.suppressesFeatureTest !== false);
    }
  }
  return out;
}
