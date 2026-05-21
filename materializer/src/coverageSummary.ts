// Deterministic coverage summary (#335 follow-up).
//
// Reads the bundled OpenAPI spec for the active config and folds the
// emitted-feature opIds, the template-derived suppression set, and the
// raw coverage entries into a single summary block that ships inside
// `generated/<config>/playwright/coverage.json` (v2). The summary is
// the source of truth for:
//
//   • the reconciliation math (total spec ops = emitted features +
//     suppressed-by-template + unmapped),
//   • per-template aggregates (specs, unique ops, total entries,
//     invoke / observe step tallies),
//   • the unmapped-operations list (must be empty on a healthy run).
//
// Built once by the materializer so a separate report renderer
// (`scripts/render-coverage-report.ts`) can transform it without
// re-walking the planner outputs — guaranteeing the Markdown report
// and the JSON artefact agree by construction.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CoverageEntry } from './coverage.js';

export interface PerTemplateSummary {
  name: string;
  specs: number;
  uniqueOperations: number;
  entries: number;
  invokeSteps: number;
  observeSteps: number;
}

export interface CoverageSummary {
  totalSpecOperations: number;
  emittedFeatureSpecs: number;
  suppressedByTemplate: number;
  variantSpecs: number;
  lifecycleSpecs: number;
  unmappedOperations: string[];
  perTemplate: PerTemplateSummary[];
}

export interface BuildCoverageSummaryInput {
  allSpecOpIds: readonly string[];
  emittedFeatureOpIds: ReadonlySet<string>;
  suppressedOpIds: ReadonlySet<string>;
  entries: readonly CoverageEntry[];
  variantSpecs: number;
  lifecycleSpecs: number;
}

interface BundledSpec {
  paths?: Record<string, Record<string, unknown>>;
}

/**
 * Collect every operationId declared in the bundled OpenAPI spec.
 * Returns `[]` when the spec is missing (e.g. a config that ships no
 * bundled spec) so the summary still renders deterministically.
 */
export async function loadSpecOperationIds(specBundleDir: string): Promise<string[]> {
  const bundledSpecPath = path.join(specBundleDir, 'rest-api.bundle.json');
  let raw: string;
  try {
    raw = await fs.readFile(bundledSpecPath, 'utf8');
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'code' in e && Reflect.get(e, 'code') === 'ENOENT') {
      return [];
    }
    throw e;
  }
  let spec: BundledSpec;
  try {
    // biome-ignore lint/plugin: runtime contract boundary — bundled OpenAPI spec; only paths[].{method}.operationId is read.
    spec = JSON.parse(raw) as BundledSpec;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`coverage summary: failed to parse ${bundledSpecPath}: ${msg}`);
  }
  const ids: string[] = [];
  for (const pathItem of Object.values(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const op of Object.values(pathItem)) {
      if (!op || typeof op !== 'object') continue;
      const opId = Reflect.get(op, 'operationId');
      if (typeof opId === 'string' && opId.length > 0) ids.push(opId);
    }
  }
  return ids.sort();
}

export function buildCoverageSummary(input: BuildCoverageSummaryInput): CoverageSummary {
  const accountedFor = new Set<string>([...input.emittedFeatureOpIds, ...input.suppressedOpIds]);
  const unmappedOperations = input.allSpecOpIds.filter((id) => !accountedFor.has(id)).sort();

  const perTemplateAgg = new Map<
    string,
    { specs: Set<string>; opIds: Set<string>; entries: number; invoke: number; observe: number }
  >();
  for (const e of input.entries) {
    let agg = perTemplateAgg.get(e.template);
    if (!agg) {
      agg = { specs: new Set(), opIds: new Set(), entries: 0, invoke: 0, observe: 0 };
      perTemplateAgg.set(e.template, agg);
    }
    agg.specs.add(e.emittedSpec);
    agg.opIds.add(e.operationId);
    agg.entries++;
    if (e.stepKind === 'invoke') agg.invoke++;
    else if (e.stepKind === 'observe') agg.observe++;
  }
  const perTemplate: PerTemplateSummary[] = [...perTemplateAgg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, agg]) => ({
      name,
      specs: agg.specs.size,
      uniqueOperations: agg.opIds.size,
      entries: agg.entries,
      invokeSteps: agg.invoke,
      observeSteps: agg.observe,
    }));

  return {
    totalSpecOperations: input.allSpecOpIds.length,
    emittedFeatureSpecs: input.emittedFeatureOpIds.size,
    suppressedByTemplate: input.suppressedOpIds.size,
    variantSpecs: input.variantSpecs,
    lifecycleSpecs: input.lifecycleSpecs,
    unmappedOperations,
    perTemplate,
  };
}
