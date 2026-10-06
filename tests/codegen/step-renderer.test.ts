import type { RequestStep } from 'path-analyser/types';
import { describe, expect, test } from 'vitest';
import {
  renderInlineStepLines,
  resolveScenarioServerOverride,
} from '../../materializer/src/playwright/stepRenderer.ts';

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

describe('renderInlineStepLines — detailContains assertion on an error step (#404)', () => {
  function buildStep(expectation: RequestStep['expect']): RequestStep {
    return {
      operationId: 'createWidget',
      method: 'post',
      pathTemplate: '/widgets',
      expect: expectation,
    };
  }

  test('parses the response body and asserts detail contains the substring', () => {
    const lines = renderInlineStepLines({
      step: buildStep({ status: 400, detailContains: 'multi-tenancy is disabled' }),
      idx: 0,
      varName: 'response1',
      urlExpr: "'/widgets'",
      method: 'post',
    });
    const output = lines.join('\n');
    expect(output).toContain('const detailBody = await response1.json().catch(() => undefined)');
    expect(output).toContain(
      'expect(typeof detailBody?.detail === \'string\' && detailBody.detail.includes("multi-tenancy is disabled")',
    );
  });

  test('omits the assertion entirely when detailContains is not set', () => {
    const lines = renderInlineStepLines({
      step: buildStep({ status: 400 }),
      idx: 0,
      varName: 'response1',
      urlExpr: "'/widgets'",
      method: 'post',
    });
    const output = lines.join('\n');
    expect(output).not.toContain('detailBody');
  });

  test('matches a detail string containing the exact substring, not an unrelated one', () => {
    const lines = renderInlineStepLines({
      step: buildStep({ status: 400, detailContains: 'multi-tenancy is disabled' }),
      idx: 0,
      varName: 'response1',
      urlExpr: "'/widgets'",
      method: 'post',
    });
    const output = lines.join('\n');
    // The rendered assertion is a template literal string, not code we can
    // eval directly here — but a non-inverted `.includes()` check against
    // the real detailContains value proves the polarity directly, rather
    // than trusting the substring match alone (which would also pass for
    // an accidentally-inverted `!detailBody.detail.includes(...)`).
    expect(output).not.toContain('!detailBody.detail.includes');
    expect(output).toContain('detailBody.detail.includes(');
  });
});
