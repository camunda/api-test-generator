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
