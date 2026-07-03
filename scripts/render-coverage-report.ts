// Render the materializer's coverage artefact as a human-readable
// report (#335 follow-up).
//
// Reads `generated/<active-config>/playwright/coverage.json` (v2) and
// emits a deterministic Markdown report by default. Pass `--format=json`
// to re-emit the raw JSON (useful when piping to other tools).
//
// Usage:
//   npm run coverage:report                        # Markdown to stdout
//   npm run coverage:report -- --format=json       # JSON to stdout
//   npm run coverage:report -- --input <file>      # explicit path override
//   npm run coverage:report -- --out <file>        # write to a file
//
// The renderer is a pure transform: it never re-walks the planner
// outputs or the bundled spec. The summary block embedded in
// coverage.json by the materializer is the single source of truth, so
// the JSON artefact and the Markdown report agree by construction.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getActiveConfigName, getPlaywrightSuiteDir } from '../path-analyser/src/configResolver.ts';

// Derive REPO_ROOT from the script's own location rather than walking
// up from process.cwd() looking for a package.json — this is a
// monorepo with nested package.json files (materializer/, path-analyser/, …)
// so a cwd-based search would happily stop at a workspace package.json
// and then break configs.json lookups (cf. PR #337 review). The script
// lives at <repo>/scripts/render-coverage-report.ts, so the repo root
// is one directory up. This matches the convention used by sibling
// scripts (export-ontology.ts, build-ontology.ts, run-pw-request-validation.ts).
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

interface PerTemplateSummary {
  name: string;
  specs: number;
  uniqueOperations: number;
  entries: number;
  invokeSteps: number;
  observeSteps: number;
}

interface CoverageSummary {
  totalSpecOperations: number;
  emittedFeatureSpecs: number;
  suppressedByTemplate: number;
  suppressedExplicit?: number;
  variantSpecs: number;
  lifecycleSpecs: number;
  unmappedOperations: string[];
  perTemplate: PerTemplateSummary[];
}

interface CoverageArtefact {
  version: number;
  config?: string;
  emitter?: string;
  summary?: CoverageSummary;
  suppressedOpIds?: string[];
  entries?: unknown[];
}

interface CliArgs {
  format: 'markdown' | 'json';
  inputPath: string | undefined;
  outPath: string | undefined;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let format: 'markdown' | 'json' = 'markdown';
  let inputPath: string | undefined;
  let outPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--format=json' || arg === '--json') format = 'json';
    else if (arg === '--format=markdown' || arg === '--markdown') format = 'markdown';
    else if (arg === '--format' && i + 1 < argv.length) {
      const v = argv[++i];
      if (v !== 'json' && v !== 'markdown') {
        throw new Error(`--format must be 'json' or 'markdown' (got '${v}')`);
      }
      format = v;
    } else if (arg === '--input' && i + 1 < argv.length) {
      inputPath = argv[++i];
    } else if (arg === '--out' && i + 1 < argv.length) {
      outPath = argv[++i];
    } else if (arg === '-h' || arg === '--help') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { format, inputPath, outPath };
}

function printUsage(): void {
  console.error(
    [
      'Usage: tsx scripts/render-coverage-report.ts [--format markdown|json] [--input <path>] [--out <path>]',
      '',
      'Reads the materializer coverage artefact and emits a human-readable',
      "report. Defaults to Markdown on stdout for the active config's",
      'Playwright suite (`generated/<config>/playwright/coverage.json`).',
    ].join('\n'),
  );
}

export function renderMarkdown(artefact: CoverageArtefact): string {
  const summary = artefact.summary;
  if (!summary) {
    throw new Error(
      `coverage artefact has no 'summary' block (version ${artefact.version}); ` +
        're-run the materializer (`npm run codegen:playwright:all`) to produce a v2 artefact.',
    );
  }
  const config = artefact.config ?? '(unknown config)';
  const emitter = artefact.emitter ?? '(unknown emitter)';
  const total = summary.totalSpecOperations;
  const emitted = summary.emittedFeatureSpecs;
  const suppressed = summary.suppressedByTemplate;
  const explicit = summary.suppressedExplicit ?? 0;
  const covered = emitted + suppressed;
  const pct = total > 0 ? ((covered / total) * 100).toFixed(1) : '0.0';

  const lines: string[] = [];
  lines.push(`# Coverage report — ${config}`);
  lines.push('');
  lines.push(`- Emitter: \`${emitter}\``);
  lines.push(`- Spec operations: **${total}**`);
  lines.push(`- Emitted feature specs: **${emitted}**`);
  lines.push(`- Suppressed by scenario-template coverage: **${suppressed}**`);
  lines.push(`- Suppressed explicitly (out of scope / positive-suppress): **${explicit}**`);
  lines.push(`- Variant specs: **${summary.variantSpecs}**`);
  lines.push(`- Lifecycle (template) specs: **${summary.lifecycleSpecs}**`);
  lines.push(`- Operation coverage: **${covered} / ${total} (${pct}%)**`);
  lines.push(`- Unmapped operations: **${summary.unmappedOperations.length}**`);
  lines.push('');

  lines.push('## Reconciliation');
  lines.push('');
  lines.push('```');
  lines.push(`spec operations:          ${String(total).padStart(4)}`);
  lines.push(`  emitted feature specs:  ${String(emitted).padStart(4)}`);
  lines.push(
    `+ suppressed by template: ${String(suppressed).padStart(4)}  (covered by ${summary.lifecycleSpecs} lifecycle specs)`,
  );
  lines.push(
    `+ suppressed (explicit):  ${String(explicit).padStart(4)}  (out of scope / positive-suppress)`,
  );
  lines.push(`+ unmapped:               ${String(summary.unmappedOperations.length).padStart(4)}`);
  lines.push(
    `= total covered + gaps:   ${String(emitted + suppressed + explicit + summary.unmappedOperations.length).padStart(4)}`,
  );
  lines.push('```');
  lines.push('');
  lines.push(
    `Variant specs (${summary.variantSpecs}) are emitted in addition to the per-endpoint feature specs and enumerate optional sub-shapes; they do not contribute to the spec-operation coverage tally.`,
  );
  lines.push('');

  lines.push('## Per-template coverage');
  lines.push('');
  if (summary.perTemplate.length === 0) {
    lines.push('_No template-derived coverage in this run._');
  } else {
    lines.push('| Template | Specs | Unique ops | Entries | Invoke steps | Observe steps |');
    lines.push('|---|---:|---:|---:|---:|---:|');
    for (const t of summary.perTemplate) {
      lines.push(
        `| \`${t.name}\` | ${t.specs} | ${t.uniqueOperations} | ${t.entries} | ${t.invokeSteps} | ${t.observeSteps} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Unmapped operations');
  lines.push('');
  if (summary.unmappedOperations.length === 0) {
    lines.push('_None — every spec operation is covered by a feature or lifecycle suite._');
  } else {
    lines.push(
      'Operations declared in the bundled OpenAPI spec that the planner produced no feature scenario for and that no scenario-template lifecycle suite covers:',
    );
    lines.push('');
    for (const opId of summary.unmappedOperations) {
      lines.push(`- \`${opId}\``);
    }
  }
  lines.push('');

  return lines.join('\n');
}

function main(argv: readonly string[]): void {
  const args = parseArgs(argv);
  const inputPath = args.inputPath ?? path.join(getPlaywrightSuiteDir(REPO_ROOT), 'coverage.json');
  if (!existsSync(inputPath)) {
    const activeConfig = getActiveConfigName(REPO_ROOT);
    throw new Error(
      `coverage artefact not found at ${inputPath} ` +
        `(active config: ${activeConfig}). Run \`npm run codegen:playwright:all\` to produce it.`,
    );
  }
  // biome-ignore lint/plugin: runtime contract boundary — materializer-emitted coverage artefact.
  const artefact = JSON.parse(readFileSync(inputPath, 'utf8')) as CoverageArtefact;
  const output =
    args.format === 'json'
      ? `${JSON.stringify(artefact, null, 2)}\n`
      : `${renderMarkdown(artefact)}\n`;
  if (args.outPath) {
    writeFileSync(args.outPath, output, 'utf8');
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`render-coverage-report: ${msg}`);
    process.exit(1);
  }
}
