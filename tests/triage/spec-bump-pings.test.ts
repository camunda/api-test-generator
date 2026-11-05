import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(join(dir, '../../.github/workflows/spec-bump-check.yml'), 'utf8');
const openPr = readFileSync(join(dir, '../../.github/scripts/spec-bump-open-pr.sh'), 'utf8');

describe('spec-bump-check Slack pings', () => {
  const line = workflow.split('\n').find((l) => l.includes('Spec-bump check failed for')) ?? '';

  it('pings hub-medic when a step of the Hub check itself failed', () => {
    expect(line).toContain(
      "matrix.private && ' · :rotating_light: <!subteam^S014VK4482H|hub-medic>'",
    );
  });

  it('does not page hub-medic for the camunda-oca leg, which the test automation team owns', () => {
    expect(line).toContain("|| '')");
  });

  it('keeps the mention on one line: an expression string does not interpret "\\n"', () => {
    expect(line).not.toContain('\\n');
  });

  it('references hub-medic exactly once — the failure alert, never the drift alert', () => {
    // The op-surface / coverage-drift alert deliberately pings nobody (its bump
    // PR carries a reviewer instead); only the failed-run alert pages hub-medic.
    expect(workflow.split('S014VK4482H').length - 1).toBe(1);
  });
});

describe('spec-bump-check hub bump PR reviewer', () => {
  it('requests @camunda/hub review on the bump PR', () => {
    expect(openPr).toContain('--add-reviewer camunda/hub');
  });

  it('requests it only on the hub (private) leg', () => {
    // request_hub_review returns early unless IS_PRIVATE=true (oca routes elsewhere).
    expect(openPr).toMatch(/IS_PRIVATE[^\n]*\|\|\s*return 0/);
  });
});
