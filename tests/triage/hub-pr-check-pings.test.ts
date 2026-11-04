import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/hub-pr-check.yml'),
  'utf8',
);

/**
 * The `ping=` assigned in each branch of the verdict `case "$CATEGORY"` in the report step.
 * The report step has two such `case` blocks: the comment builder (sets `tag`/`heading`, no ping —
 * it @-tags the PR author) and the Slack-fallback builder (sets `ping` for a bot/no-author PR).
 * Ping routing lives in the second one, so parse the `case` block that actually assigns `ping=`.
 */
function pingsByCategory(): Record<string, string[]> {
  let block = '';
  for (const m of workflow.matchAll(/case "\$CATEGORY" in/g)) {
    const s = m.index ?? 0;
    const e = workflow.indexOf('\n          esac\n', s);
    const candidate = workflow.slice(s, e);
    if (/\n\s*ping="/.test(candidate)) {
      block = candidate;
      break;
    }
  }
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

  it('pings hub-medic for every verdict except presuite', () => {
    for (const [category, values] of Object.entries(pings)) {
      expect(values.length, category).toBeGreaterThan(0);
      if (category === 'presuite') {
        for (const value of values) expect(value, category).not.toContain(HUB);
      } else {
        for (const value of values) expect(value, category).toContain(HUB);
      }
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

  it('escalation pings only test-automation-medic for presuite', () => {
    const escalation = workflow.slice(workflow.indexOf('Escalate a repeated'));
    const presuiteBlock = escalation.slice(
      escalation.indexOf('CATEGORY" = "presuite"'),
      escalation.indexOf('else'),
    );
    expect(presuiteBlock).toContain('$ta_medic');
    expect(presuiteBlock).not.toContain('$hub_medic');
  });

  it('escalation pings both groups for non-presuite no-evidence failures', () => {
    const escalation = workflow.slice(workflow.indexOf('keeps failing without any test evidence'));
    expect(escalation).toContain('"$hub_medic" "$ta_medic"');
  });

  it('escalation uses two stable markers: presuite and noevidence', () => {
    const escalation = workflow.slice(workflow.indexOf('Escalate a repeated'));
    const markers = [...escalation.matchAll(/--marker\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(markers).toHaveLength(1);
    const marker_tag = ['$', '{marker_tag}'].join('');
    expect(
      markers[0],
      'marker must use marker_tag (presuite | noevidence), not raw CATEGORY',
    ).toContain(marker_tag);
    expect(escalation).toContain('presuite');
    expect(escalation).toContain('noevidence');
  });
});
