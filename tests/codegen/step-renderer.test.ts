import { describe, expect, test } from 'vitest';
import { resolveScenarioServerOverride } from '../../materializer/src/playwright/stepRenderer.ts';

describe('resolveScenarioServerOverride', () => {
  test('returns undefined when no operation overrides servers', () => {
    expect(resolveScenarioServerOverride([{ serverOverride: undefined }, {}])).toBeUndefined();
  });

  test('returns the shared override when every operation agrees', () => {
    const url = '{schema}://{host}:{port}';
    expect(resolveScenarioServerOverride([{ serverOverride: url }, { serverOverride: url }])).toBe(
      url,
    );
  });

  test('throws when operations declare two different overrides', () => {
    expect(() =>
      resolveScenarioServerOverride([
        { serverOverride: '{schema}://{host}:{port}' },
        { serverOverride: '{schema}://{host}:{port}/other' },
      ]),
    ).toThrow(/mixes operations with different server overrides/);
  });

  // Regression: the initial implementation only compared distinct override
  // *strings*, so a scenario mixing one overridden step with one default-base
  // step (a single distinct override value, present on only some operations)
  // slipped through and silently picked the override for the whole scenario —
  // mis-routing the default-base step, which needs the normal `/v2` base.
  test('throws when a scenario mixes an override with a default-base operation', () => {
    expect(() =>
      resolveScenarioServerOverride([
        { serverOverride: '{schema}://{host}:{port}' },
        { serverOverride: undefined },
      ]),
    ).toThrow(/mixes operations with different server overrides/);
  });
});
