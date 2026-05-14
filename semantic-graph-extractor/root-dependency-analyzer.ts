import { type LoadResult, loadBootstrapSequences } from './ontology/bootstrapSequencesLoader';
import type { OperationDependencyGraph, RootOperationAnalysis } from './types';

/**
 * Generic, ABox-driven loader for the bootstrap-sequence and entry-point
 * analysis previously produced by the heuristic `RootDependencyAnalyzer`.
 *
 * Replaces (#202, Lift 2) the OCA-specific operation/kind literals and
 * the `isDeploymentOperation()`/`isSetupOperation()` heuristics with a
 * declarative ABox at `configs/<active>/ontology/bootstrap-sequences.json`.
 *
 * What's still computed here vs lifted to the ABox:
 *
 *   - `bootstrapSequences`: lifted. Source of truth is the ABox; the
 *     loader filters out sequences whose operationIds aren't all in the
 *     spec (preserves the original `if (operationExists(...))` shape
 *     declaratively).
 *
 *   - `entryPointOperations`: kept. This is a *structural* property of
 *     the dependency graph (operations that are not the target of any
 *     edge), not an API-specific assertion, so it stays computed.
 *
 *   - `deploymentOperations` / `setupOperations`: were heuristic
 *     classifications (path substrings, opId prefixes, hard-coded
 *     setup-operation literals).
 *     No downstream consumer reads either field today (planner reads
 *     only `bootstrapSequences`). They are preserved on the type for
 *     ABI stability and emitted as empty arrays so a future ABox slice
 *     ("operation roles" — see #199 axis 3) can populate them without
 *     a contract change.
 */
export interface RootDependencyAnalyzerOptions {
  knownSemanticTypes: Set<string>;
  /**
   * Absolute path to the repo root that hosts `configs.json`. When
   * omitted, ABox loading is skipped entirely (the analyzer still
   * computes structural entry points). Production callers
   * (`SemanticGraphExtractor.extractGraph` via `index.ts main`) always
   * pass this; ad-hoc test callers that exercise the extractor against
   * synthesized fixtures may omit it to bypass the cross-reference
   * checks against the active config's published ABox.
   */
  repoRoot?: string;
  /**
   * If true, treat any soft-dropped bootstrap sequence (one whose
   * operationIds aren't all present in the parsed spec) as a hard
   * error. Off by default because the ABox is intended to ship across
   * API variants where some sequences may legitimately not apply; CI
   * for the active config can enable it (env var
   * `STRICT_BOOTSTRAP_ABOX=1`) to assert ABox/spec consistency.
   */
  strictBootstrapAbox?: boolean;
}

export class RootDependencyAnalyzer {
  analyzeRootDependencies(
    graph: OperationDependencyGraph,
    opts: RootDependencyAnalyzerOptions,
  ): RootOperationAnalysis {
    console.log('Analyzing root dependencies...');

    const knownOperationIds = new Set(Array.from(graph.operations.keys()));
    if (opts.repoRoot === undefined) {
      console.log(
        'No repoRoot provided; skipping bootstrap-sequences ABox (entry-points still computed).',
      );
      const entryPointOperations = this.findEntryPointOperations(graph);
      return {
        deploymentOperations: [],
        setupOperations: [],
        entryPointOperations,
        bootstrapSequences: [],
        droppedBootstrapSequences: [],
      };
    }
    const loaded: LoadResult = loadBootstrapSequences(opts.repoRoot, {
      knownOperationIds,
      knownSemanticTypes: opts.knownSemanticTypes,
    });

    if (loaded.droppedForMissingOperations.length > 0) {
      // (1) Visible: stderr + WARNING prefix + summary line so a CI
      // log scrape (`grep -i 'WARNING: bootstrap'`) catches drops
      // even when the rest of the extractor output is verbose.
      // (3) Strict mode (env-driven; defaults off) escalates to a
      // hard error so the active config can assert ABox/spec
      // consistency without hand-rolled tests scraping the warning.
      const summary = `WARNING: bootstrap-sequences ABox dropped ${loaded.droppedForMissingOperations.length} sequence(s) because at least one referenced operationId is absent from the parsed spec:`;
      console.warn(summary);
      for (const dropped of loaded.droppedForMissingOperations) {
        console.warn(`  - '${dropped.name}' missing operationId(s): ${dropped.missing.join(', ')}`);
      }
      if (opts.strictBootstrapAbox) {
        const detail = loaded.droppedForMissingOperations
          .map((d) => `'${d.name}' (missing: ${d.missing.join(', ')})`)
          .join('; ');
        throw new Error(
          `Strict bootstrap-sequences ABox: refusing to silently drop ${loaded.droppedForMissingOperations.length} sequence(s): ${detail}`,
        );
      }
    }

    const entryPointOperations = this.findEntryPointOperations(graph);

    console.log(
      `Loaded ${loaded.sequences.length} bootstrap sequences from ABox; ${entryPointOperations.length} structural entry points.`,
    );

    return {
      // No longer heuristically classified — see header comment. A
      // future ABox slice (#199 axis 3) can lift these too.
      deploymentOperations: [],
      setupOperations: [],
      entryPointOperations,
      bootstrapSequences: loaded.sequences,
      // (2) Surface drops on the graph so downstream tooling and L3
      // invariants can detect unexpected drops without scraping logs.
      droppedBootstrapSequences: loaded.droppedForMissingOperations,
    };
  }

  /**
   * Operations with no inbound dependency edges. Structural property
   * of the graph — kept here because it's API-agnostic.
   */
  private findEntryPointOperations(graph: OperationDependencyGraph): string[] {
    const targetOperations = new Set(graph.edges.map((e) => e.targetOperationId));
    const entryPoints: string[] = [];
    for (const opId of Array.from(graph.operations.keys())) {
      if (!targetOperations.has(opId)) {
        entryPoints.push(opId);
      }
    }
    return entryPoints;
  }
}
