import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCENARIO_KINDS } from '../../request-validation/src/model/types.js';

/**
 * Class-scoped regression guard: `generate.ts` computes, per operation, a
 * structural `applicable` set (via a series of `applicable.add('<kind>')`
 * calls) that COVERAGE.json's `missingApplicableKinds` is measured against.
 * It is hand-maintained in parallel with `SCENARIO_KINDS` — nothing enforces
 * the two stay in sync. A past audit found 10 kinds that were generated but
 * never wired into `applicable`, so `missingApplicableKinds` could never
 * surface a real gap for them: `generate.ts`'s backfill loop right after the
 * applicability block adds any kind that IS generated to `applicable`
 * regardless of whether an explicit rule exists, so a missing rule is
 * invisible right up until a kind that genuinely IS applicable for some
 * operation stops being generated there — i.e. exactly the real regression
 * this wiring exists to catch.
 *
 * This only catches "never wired in at all" — not "wired in with a
 * condition looser/tighter than the real generator's". That half still
 * needs a human (or the per-operation diffs this session did by hand).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

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
