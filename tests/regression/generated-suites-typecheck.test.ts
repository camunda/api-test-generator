import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Class-of-defect guard test (PR #89 review comment 2).
 *
 * The emitter declares `ctx` as `Record<string, unknown>` rather than
 * `Record<string, any>` to keep the generated suite biome-clean
 * (`noExplicitAny` is escalated to error). The reviewer's concern was that
 * `unknown` would break any consumer who runs `tsc --strict` over the
 * emitted suite — particularly the `ctx.<param>Var || '${param}'` URL
 * fallback pattern, which is a truthy-context use of an `unknown` value.
 *
 * `||`/`&&`/`??` are in fact permitted on `unknown` in TS, and template
 * `${expr}` slots accept any expression, so the current emit shape
 * typechecks under `strict: true`. This test pins that contract: any
 * future emitter change that produces a pattern requiring narrowing
 * (e.g. arithmetic, member access, or call on an `unknown` ctx value)
 * will trip `tsc` here regardless of which specific operation site
 * regressed.
 *
 * Both generators ship a strict-mode `tsconfig.json` alongside their
 * output; we invoke `tsc --noEmit` against each.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

interface Suite {
  label: string;
  tsconfig: string;
}

const SUITES: readonly Suite[] = [
  {
    label: 'path-analyser',
    tsconfig: path.join(REPO_ROOT, 'path-analyser', 'dist', 'generated-tests', 'tsconfig.json'),
  },
  {
    label: 'request-validation',
    tsconfig: path.join(REPO_ROOT, 'request-validation', 'generated', 'tsconfig.json'),
  },
];

describe.each(SUITES)('emitted $label suite typechecks under strict mode', ({
  label,
  tsconfig,
}) => {
  test(`${label}: tsc --noEmit succeeds`, () => {
    if (!existsSync(tsconfig)) {
      throw new Error(
        `${label} suite tsconfig not found at ${tsconfig}. ` +
          `Run \`npm run testsuite:generate && npm run generate:request-validation\` to produce it before running this test.`,
      );
    }
    const result = spawnSync('npx', ['--no-install', 'tsc', '--noEmit', '-p', tsconfig], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (result.error) {
      throw new Error(
        `Failed to launch tsc for ${label} suite: ${result.error.message}. ` +
          `Ensure the repo's pinned \`typescript\` is installed (run \`npm ci\`).`,
      );
    }
    if (result.status !== 0) {
      throw new Error(
        `tsc failed for ${label} suite (exit ${result.status === null ? 'null (process did not exit normally)' : result.status}):\n${result.stdout}\n${result.stderr}`,
      );
    }
    expect(result.status).toBe(0);
  }, 120_000);
});
