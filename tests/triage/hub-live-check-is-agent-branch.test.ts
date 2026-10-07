import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/hub-live-check-is-agent-branch.sh',
);

function isAgent(ref?: string): boolean {
  const args = ref === undefined ? [script] : [script, ref];
  return spawnSync('bash', args).status === 0;
}

describe('hub-live-check-is-agent-branch.sh', () => {
  it('treats the coverage-fix and nightly-triage agent branches as agent branches', () => {
    expect(isAgent('fix/coverage-remove-member-403-123')).toBe(true);
    expect(isAgent('fix/coverage-project-snapshot-9')).toBe(true);
    expect(isAgent('fix/nightly-triage-suppress-foo')).toBe(true);
    expect(isAgent('fix/nightly-triage-wrong-assertion')).toBe(true);
  });

  it('does not treat other branches as agent branches', () => {
    expect(isAgent('main')).toBe(false);
    expect(isAgent('feat/coverage-thing')).toBe(false);
    expect(isAgent('chore/spec-bump-camunda-hub')).toBe(false);
    expect(isAgent('claude/hub-label-fix-prs')).toBe(false);
    expect(isAgent('prefix/fix/coverage-x')).toBe(false);
  });

  it('fails closed on an empty or missing branch name', () => {
    expect(isAgent('')).toBe(true);
    expect(isAgent()).toBe(true);
  });

  it('does not run a branch name as a command', () => {
    expect(isAgent('fix/coverage-$(touch /tmp/pwned-by-branch-name)')).toBe(true);
    expect(isAgent('x; exit 0')).toBe(false);
  });
});
