import type { EndpointScenarioCollection } from '../types.js';

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
  /** Suite name used in the file name and `describe()` block. */
  suiteName: string;
  /** Generation mode — `feature` is the default for path-analyser scenarios. */
  mode: 'feature' | 'integration';
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
