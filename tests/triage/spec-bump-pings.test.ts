import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/spec-bump-check.yml'),
  'utf8',
);

describe('spec-bump-check Slack pings', () => {
  it('pings hub-medic when a step of the check itself failed', () => {
    const line = workflow.split('\n').find((l) => l.includes('Spec-bump check failed for'));
    expect(line).toBeDefined();
    expect(line).toContain('<!subteam^S014VK4482H|hub-medic>');
  });
});
