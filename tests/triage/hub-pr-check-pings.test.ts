import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/hub-pr-check.yml'),
  'utf8',
);

/**
 * The Slack ping is routed by a single if/else override after the verdict `case`, not by the
 * `case` itself (which sets only the verdict text). The override's value is the one read into the
 * alert's closing line (`closing="${ping} please take a look."`), so it is the live routing to
 * guard — a per-category `ping=` inside the `case` would be dead code, silently overwritten here.
 */
function pingOverride(): string {
  const anchor = workflow.indexOf('if [ "$CATEGORY" = "presuite" ]; then\n            ping=');
  const end = workflow.indexOf('\n          fi\n', anchor);
  return workflow.slice(anchor, end);
}

/** The categories handled by the Slack verdict `case` (the one directly before the ping override). */
function slackVerdictCategories(): string[] {
  const commentIdx = workflow.indexOf('This Slack alert fires only in two cases');
  const caseStart = workflow.lastIndexOf('case "$CATEGORY" in', commentIdx);
  const caseEnd = workflow.indexOf('\n          esac\n', caseStart);
  const block = workflow.slice(caseStart, caseEnd);
  const cats: string[] = [];
  for (const line of block.split('\n')) {
    const label = line.match(/^ {12}([a-z-]+|\*)\)\s*$/);
    if (label?.[1]) cats.push(label[1]);
  }
  return cats;
}

describe('hub-pr-check Slack pings', () => {
  // The shell variables the workflow expands, written without a `${` so lint does not read them as a template.
  const HUB = ['$', '{hub_medic}'].join('');
  const TA = ['$', '{ta_medic}'].join('');

  it('the Slack verdict case covers every category', () => {
    expect(slackVerdictCategories().sort()).toEqual(
      ['*', 'flaky', 'generator-gap', 'infra', 'presuite', 'product', 'startup', 'unknown'].sort(),
    );
  });

  it('routes the ping in a single if/else override, not per-category', () => {
    const override = pingOverride();
    expect(override, 'the live ping override must exist').not.toBe('');
    // Exactly one ping assignment per branch — no per-category ping survives to be overwritten.
    expect([...workflow.matchAll(/\n\s*ping="/g)]).toHaveLength(2);
  });

  it('pings test-automation-medic for presuite, and only presuite', () => {
    const [presuiteBranch, elseBranch] = pingOverride().split('else');
    expect(presuiteBranch).toContain(TA);
    expect(presuiteBranch).not.toContain(HUB);
    expect(elseBranch).not.toContain(TA);
  });

  it('pings hub-medic for every other (bot-PR fallback) category', () => {
    const [, elseBranch] = pingOverride().split('else');
    expect(elseBranch).toContain(HUB);
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
