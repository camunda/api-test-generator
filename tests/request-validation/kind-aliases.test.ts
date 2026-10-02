import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  computeKindCoverage,
  kindsRemovedEntirely,
  listOperationsWithoutScenarios,
} from '../../request-validation/src/analysis/kindCoverage.js';
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

describe('request-validation: operations with no scenario left', () => {
  const byOperation = {
    createFolder: {
      applicable: new Set(['missing-required', 'type-mismatch']),
      missingApplicable: [],
    },
    zeta: {
      applicable: new Set(['auth-absent', 'format-invalid']),
      missingApplicable: ['format-invalid', 'auth-absent'],
    },
    alpha: { applicable: new Set(['auth-absent']), missingApplicable: ['auth-absent'] },
  };

  it('lists an operation whose scenarios were all excluded, with the kinds that apply to it', () => {
    const result = listOperationsWithoutScenarios(byOperation, new Set(['createFolder']));
    expect(result.map((o) => o.operationId)).toEqual(['alpha', 'zeta']);
    expect(result[1]).toEqual({
      operationId: 'zeta',
      applicableKindCount: 2,
      presentKindCount: 0,
      missingApplicableKinds: ['format-invalid', 'auth-absent'],
    });
  });

  it('leaves out an operation that still has a scenario', () => {
    const result = listOperationsWithoutScenarios(byOperation, new Set(['createFolder', 'zeta']));
    expect(result.map((o) => o.operationId)).toEqual(['alpha']);
  });

  it('lists nothing when every operation has a scenario', () => {
    expect(listOperationsWithoutScenarios(byOperation, new Set(Object.keys(byOperation)))).toEqual(
      [],
    );
  });
});

describe('request-validation: kinds a scoped exclusion removed entirely', () => {
  const scenario = (operationId: string, type: string) => ({ operationId, type });

  it('holds a kind when the exclusion removed every scenario of it', () => {
    const before = [scenario('op', 'format-invalid'), scenario('op', 'missing-required')];
    const after = [scenario('op', 'missing-required')];
    expect(kindsRemovedEntirely(before, after)).toEqual({ op: ['format-invalid'] });
  });

  it('does not hold a kind the exclusion only narrowed (a sibling scenario is left)', () => {
    const before = [scenario('op', 'constraint-violation'), scenario('op', 'constraint-violation')];
    const after = [scenario('op', 'constraint-violation')];
    expect(kindsRemovedEntirely(before, after)).toEqual({});
  });

  it('does not hold a kind that was never generated, so a regression cannot hide', () => {
    const before = [scenario('op', 'missing-required')];
    const after = [scenario('op', 'missing-required')];
    expect(kindsRemovedEntirely(before, after)).toEqual({});
  });

  it('keeps operations apart and sorts the held kinds', () => {
    const before = [
      scenario('a', 'union'),
      scenario('a', 'enum-violation'),
      scenario('b', 'union'),
    ];
    const after = [scenario('b', 'union')];
    expect(kindsRemovedEntirely(before, after)).toEqual({ a: ['enum-violation', 'union'] });
  });

  it('reports an aliased kind under the name COVERAGE.json uses', () => {
    const before = [scenario('op', 'body-top-type-mismatch')];
    expect(kindsRemovedEntirely(before, [])).toEqual({ op: ['type-mismatch'] });
  });

  it('does not hold the canonical kind while another scenario still counts under it', () => {
    const before = [scenario('op', 'body-top-type-mismatch'), scenario('op', 'type-mismatch')];
    const after = [scenario('op', 'type-mismatch')];
    expect(kindsRemovedEntirely(before, after)).toEqual({});
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
