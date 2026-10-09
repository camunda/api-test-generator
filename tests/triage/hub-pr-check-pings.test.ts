import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/hub-pr-check.yml'),
  'utf8',
);

/** The `ping=` assigned in each branch of the verdict `case "$CATEGORY"` in the report step. */
function pingsByCategory(): Record<string, string[]> {
  const start = workflow.indexOf('case "$CATEGORY" in');
  const end = workflow.indexOf('\n          esac\n', start);
  const block = workflow.slice(start, end);
  const out: Record<string, string[]> = {};
  let current = '';
  for (const line of block.split('\n')) {
    const label = line.match(/^ {12}([a-z-]+|\*)\)\s*$/);
    if (label?.[1]) {
      current = label[1];
      out[current] = [];
    }
    const ping = line.match(/^\s*ping="([^"]*)"/);
    if (ping && current) out[current]?.push(ping[1] ?? '');
  }
  return out;
}

describe('hub-pr-check Slack pings', () => {
  const pings = pingsByCategory();
  // The shell variables the workflow expands, written without a `${` so lint does not read them as a template.
  const HUB = ['$', '{hub_medic}'].join('');
  const TA = ['$', '{ta_medic}'].join('');

  it('finds every verdict category', () => {
    expect(Object.keys(pings).sort()).toEqual(
      ['*', 'flaky', 'generator-gap', 'infra', 'presuite', 'product', 'startup', 'unknown'].sort(),
    );
  });

  it('pings hub-medic for every verdict', () => {
    for (const [category, values] of Object.entries(pings)) {
      expect(values.length, category).toBeGreaterThan(0);
      for (const value of values) expect(value, category).toContain(HUB);
    }
  });

  it('adds test-automation-medic only for a failure before the suites started', () => {
    for (const [category, values] of Object.entries(pings)) {
      for (const value of values) {
        if (category === 'presuite') expect(value).toContain(TA);
        else expect(value, category).not.toContain(TA);
      }
    }
  });

  it('pings both groups when the run keeps failing with no evidence', () => {
    const escalation = workflow.slice(workflow.indexOf('keeps failing without any test evidence'));
    expect(escalation).toContain('"$hub_medic" "$ta_medic"');
  });
});
