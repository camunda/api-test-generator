import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeKindCoverage } from '../../request-validation/src/analysis/kindCoverage.js';
import {
  KIND_ALIASES,
  normalizeKind,
  SCENARIO_KINDS,
} from '../../request-validation/src/model/types.js';

/**
 * COVERAGE.json counts an aliased scenario kind under another kind's name
 * (`body-top-type-mismatch` is reported as `type-mismatch`). The present kinds and the applicable
 * kinds must both be normalized, otherwise `missingApplicableKinds` lists the aliased kind as
 * missing for every operation that takes it even though its scenarios exist, and the weekly hub
 * response-coverage report then shows a gap that is not real.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

describe('request-validation: scenario kind aliases', () => {
  it('normalizes an aliased kind and leaves every other kind unchanged', () => {
    expect(normalizeKind('body-top-type-mismatch')).toBe('type-mismatch');
    expect(normalizeKind('missing-required')).toBe('missing-required');
  });

  it('only aliases real scenario kinds onto real scenario kinds', () => {
    const known = new Set<string>(SCENARIO_KINDS);
    for (const [from, to] of Object.entries(KIND_ALIASES)) {
      expect(known.has(from), `alias source ${from} is not a scenario kind`).toBe(true);
      expect(known.has(to), `alias target ${to} is not a scenario kind`).toBe(true);
    }
  });
});

describe('request-validation: per-operation kind coverage', () => {
  it('does not report an aliased kind as missing for an object-body operation', () => {
    // Object body: the generator marks both names applicable, and the scenarios it produced for
    // the aliased kind are counted under type-mismatch.
    const result = computeKindCoverage(
      ['missing-required', 'type-mismatch', 'body-top-type-mismatch', 'auth-absent'],
      ['missing-required', 'type-mismatch', 'auth-absent'],
    );
    expect(result.missingApplicable).toEqual([]);
    expect([...result.applicable].sort()).toEqual([
      'auth-absent',
      'missing-required',
      'type-mismatch',
    ]);
    expect([...result.present].sort()).toEqual([
      'auth-absent',
      'missing-required',
      'type-mismatch',
    ]);
  });

  it('counts an aliased scenario under the kind it is aliased to', () => {
    const result = computeKindCoverage(['type-mismatch'], ['body-top-type-mismatch']);
    expect([...result.present]).toEqual(['type-mismatch']);
    expect(result.missingApplicable).toEqual([]);
  });

  it('still reports a real gap, once, when neither the kind nor its alias was generated', () => {
    const result = computeKindCoverage(
      ['missing-required', 'type-mismatch', 'body-top-type-mismatch'],
      ['missing-required'],
    );
    expect(result.missingApplicable).toEqual(['type-mismatch']);
  });

  it('treats a generated kind as applicable even without an explicit rule', () => {
    const result = computeKindCoverage([], ['format-invalid']);
    expect([...result.applicable]).toEqual(['format-invalid']);
    expect(result.missingApplicable).toEqual([]);
  });
});

describe('weekly hub coverage report: plain-language labels', () => {
  it('has a label for every scenario kind COVERAGE.json can report', () => {
    const src = readFileSync(join(__dirname, '../../scripts/e2e/hub_response_coverage.py'), 'utf8');
    const block = src.slice(
      src.indexOf('CHECK_NAMES = {'),
      src.indexOf('\n}\n', src.indexOf('CHECK_NAMES = {')),
    );
    const labelled = new Set(Array.from(block.matchAll(/'([a-z-]+)':/g), (m) => m[1]));
    const reportable = new Set(SCENARIO_KINDS.map((kind) => normalizeKind(kind)));
    const unlabelled = [...reportable].filter((kind) => !labelled.has(kind)).sort();
    expect(
      unlabelled,
      `Scenario kinds with no plain-language label in CHECK_NAMES (hub_response_coverage.py); the Slack message would show the internal name:\n  - ${unlabelled.join('\n  - ')}`,
    ).toEqual([]);
  });
});
