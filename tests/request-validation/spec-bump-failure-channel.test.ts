import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/spec-bump-check.yml'),
  'utf8',
);

describe('the spec-bump "check failed" post', () => {
  const step = workflow.slice(workflow.indexOf('name: Notify Slack (leg failure)'));
  const post = step.slice(0, step.indexOf('name: Upload generated outputs'));

  it('goes to the Hub channel for the Hub config and the OCA channel for camunda-oca', () => {
    expect(post).toContain(
      "matrix.private && '#camunda-hub-nightly-test-results' || '#c8-orchestration-cluster-e2e-test-results'",
    );
  });

  it('pings hub-medic for the Hub config only', () => {
    expect(post).toMatch(/matrix\.private && ' · :rotating_light: .*hub-medic/);
  });
});
