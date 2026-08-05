import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCENARIO_KINDS } from '../../request-validation/src/model/types.js';

/**
 * Class-scoped regression guard: `generate.ts` computes, per operation, a
 * structural `applicable` set (via a series of `applicable.add('<kind>')`
 * calls) that COVERAGE.json's `missingApplicableKinds` is measured against.
 * It is hand-maintained in parallel with `SCENARIO_KINDS` — nothing enforces
 * the two stay in sync, and #500/#511 found 10 kinds (including one from
 * that very PR) that were generated but never wired into `applicable`, so
 * `missingApplicableKinds` could never surface a real gap for them (see
 * `generate.ts`'s backfill loop right after the applicability block — it
 * silently covers any kind that IS generated regardless of whether an
 * explicit rule exists, so this drift is invisible unless a kind becomes
 * inapplicable-but-still-flagged-as-generated, i.e. exactly a real bug).
 *
 * This only catches "never wired in at all" — not "wired in with a
 * condition looser/tighter than the real generator's". That half still
 * needs a human (or the per-operation diffs this session did by hand).
 */
describe('request-validation: coverage applicability wiring', () => {
  it('every SCENARIO_KINDS entry has an applicable.add(...) call in generate.ts', () => {
    const src = readFileSync(
      join(__dirname, '../../request-validation/scripts/generate.ts'),
      'utf8',
    );
    const wired = new Set<string>();
    for (const m of src.matchAll(/applicable\.add\(\s*['"]([a-z-]+)['"]\s*\)/g)) {
      wired.add(m[1]);
    }
    const unwired = SCENARIO_KINDS.filter((kind) => !wired.has(kind));
    expect(
      unwired,
      `Scenario kinds with no applicable.add(...) rule in generate.ts (a real coverage ` +
        `gap for these kinds is invisible to COVERAGE.json's missingApplicableKinds):\n  - ${unwired.join('\n  - ')}`,
    ).toEqual([]);
  });
});
