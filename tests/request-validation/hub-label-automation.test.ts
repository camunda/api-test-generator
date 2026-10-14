import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '../../.github/scripts');
const read = (name: string) => readFileSync(join(scripts, name), 'utf8');

function configLabel(config: string): string {
  return execFileSync(
    'bash',
    ['-c', `source "${join(scripts, 'spec-bump-common.sh')}"; config_label`],
    { env: { ...process.env, CONFIG: config }, encoding: 'utf8' },
  ).trim();
}

describe('the hub label on automation PRs and issues', () => {
  it('marks Hub work with the hub label, and camunda-oca work with nothing', () => {
    expect(configLabel('camunda-hub')).toBe('hub');
    expect(configLabel('camunda-oca')).toBe('');
  });

  it('adds it to the spec-bump PR when it opens, and when it finds one already open', () => {
    const src = read('spec-bump-open-pr.sh');
    expect(src).toContain('hub_label="$(config_label)"');
    expect(src).toContain('gh pr edit "$existing" --add-label "$hub_label"');
    expect(src).toContain('gh pr edit "$branch" --add-label "$hub_label"');
  });

  it('adds it to the spec-bump tracking issue when it opens, and on every update', () => {
    const src = read('spec-bump-report.sh');
    expect(src).toContain('hub_label="$(config_label)"');
    expect(src).toContain('gh issue edit "$existing" --add-label "$hub_label"');
    expect(src).toContain(`gh issue edit "\${new_url##*/}" --add-label "$hub_label"`);
  });

  it('opens the re-enable PR with the hub label', () => {
    expect(read('hub-reenable-check.sh')).toContain('--label nightly-api-fix --label hub');
  });
});
