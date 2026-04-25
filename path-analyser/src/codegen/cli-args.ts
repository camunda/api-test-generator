export interface ParsedCliArgs {
  target: string;
  positional: string | undefined;
  help: boolean;
}

/**
 * Parse `path-analyser/src/codegen/index.ts` CLI arguments.
 *
 * Supported flags:
 * - `--target=<id>` selects an emitter (default: `playwright`)
 * - `--help` / `-h` prints usage
 *
 * The first non-flag argument is the operationId or `--all` sentinel.
 * Additional positionals are ignored.
 */
export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  let target = 'playwright';
  let positional: string | undefined;
  let help = false;
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      help = true;
    } else if (a.startsWith('--target=')) {
      target = a.slice('--target='.length);
    } else if (!positional) {
      positional = a;
    }
  }
  return { target, positional, help };
}
