import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/spec-bump-check.yml'),
  'utf8',
);

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
});

describe('spec-bump-check hub spec-drift alert', () => {
  // The op-surface / coverage-drift alert (the "Build hub Slack message" step) is hub-only and
  // always ends its text with a hub-medic page — a new upstream domain is the Hub team's to adopt.
  it('exposes the hub-medic subteam to the message builder', () => {
    expect(workflow).toContain("HUB_MEDIC='<!subteam^S014VK4482H|hub-medic>'");
  });

  it('appends the hub-medic page to the drift alert text', () => {
    // Build the needle without a literal `${` so biome does not read it as a template placeholder.
    const page = [':rotating_light: $', '{e.HUB_MEDIC}'].join('');
    expect(workflow).toContain(page);
  });
});
