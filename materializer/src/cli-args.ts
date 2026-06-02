export interface ParsedCliArgs {
  target: string;
  positional: string | undefined;
  help: boolean;
  /**
   * `--all-targets`: run codegen for every emitter the active config
   * enables (intersected with the registry and each emitter's
   * `supportedConfigs`), rather than the single `--target`. The
   * positional (`--all` or an operationId) still selects which
   * scenarios each target emits.
   */
  allTargets: boolean;
  /**
   * `list-targets` subcommand: print the registered emitters as JSON
   * (id, name, supportedConfigs, sdkMap) and exit. Lets the build
   * system (e.g. the generic SDK-map fetcher) read the registry instead
   * of duplicating the per-target list in npm scripts.
   */
  listTargets: boolean;
}

/**
 * Parse `materializer/src/index.ts` CLI arguments.
 *
 * Supported flags:
 * - `--target=<id>` selects an emitter (default: `playwright`)
 * - `--all-targets` runs every enabled+registered emitter
 * - `list-targets` (subcommand) prints the registry as JSON
 * - `--help` / `-h` prints usage
 *
 * The first non-flag argument is the operationId or `--all` sentinel
 * (or the `list-targets` subcommand). Additional positionals are ignored.
 */
export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  let target = 'playwright';
  let positional: string | undefined;
  let help = false;
  let allTargets = false;
  let listTargets = false;
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      help = true;
    } else if (a === '--all-targets') {
      allTargets = true;
    } else if (a === 'list-targets') {
      listTargets = true;
    } else if (a.startsWith('--target=')) {
      target = a.slice('--target='.length);
    } else if (!positional) {
      positional = a;
    }
  }
  return { target, positional, help, allTargets, listTargets };
}
