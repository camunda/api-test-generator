import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/hub-coverage-agent-prs.sh',
);

interface Pr {
  number: number;
  title: string;
  head: { ref: string };
  labels: { name: string }[];
  html_url: string;
}

function pr(n: number, over: Partial<Pr> = {}): Pr {
  return {
    number: n,
    title: `test(coverage-fix): add Thing${n} lifecycle`,
    head: { ref: `fix/coverage-thing-${n}` },
    labels: [{ name: 'nightly-api-fix' }, { name: 'auto-generated' }],
    html_url: `https://github.com/camunda/api-test-generator/pull/${n}`,
    ...over,
  };
}

// A fake `gh api` that prints FAKE_PAGES as two back-to-back JSON arrays (what --paginate does), or fails.
function run(prs: Pr[], fail = false): { out: string; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agent-prs-'));
  const half = Math.ceil(prs.length / 2);
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env bash
[ "$FAKE_FAIL" = 1 ] && { echo boom >&2; exit 1; }
printf '%s' "$FAKE_PAGE1"
printf '%s' "$FAKE_PAGE2"
`,
  );
  chmodSync(join(dir, 'gh'), 0o755);
  const out = join(dir, 'out.txt');
  const stdout = execFileSync('bash', [script, out], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'camunda/api-test-generator',
      FAKE_FAIL: fail ? '1' : '0',
      FAKE_PAGE1: JSON.stringify(prs.slice(0, half)),
      FAKE_PAGE2: JSON.stringify(prs.slice(half)),
    },
  });
  return { out: readFileSync(out, 'utf8'), stdout };
}

describe('hub-coverage-agent-prs.sh', () => {
  it('writes nothing when the agent has no open PR', () => {
    expect(run([]).out).toBe('');
  });

  it('lists one open agent PR with a link, a count and a review note', () => {
    const { out } = run([pr(690)]);
    expect(out).toContain('1 PR waiting for review');
    expect(out).toContain('<https://github.com/camunda/api-test-generator/pull/690|#690 ');
    expect(out).toContain('not a person');
  });

  it('counts and links several PRs, across pages', () => {
    const { out } = run([pr(1), pr(2), pr(3)]);
    expect(out).toContain('3 PRs waiting for review');
    for (const n of [1, 2, 3]) expect(out).toContain(`/pull/${n}|#${n} `);
  });

  it('ignores PRs that are not the agent: another branch, or no nightly-api-fix label', () => {
    const { out } = run([
      pr(1, { head: { ref: 'chore/spec-bump-camunda-hub' } }),
      pr(2, { labels: [{ name: 'auto-generated' }] }),
      pr(3),
    ]);
    expect(out).toContain('1 PR waiting for review');
    expect(out).toContain('#3 ');
    expect(out).not.toContain('#1 ');
    expect(out).not.toContain('#2 ');
  });

  it('escapes Slack markup in a title', () => {
    const { out } = run([pr(5, { title: 'a <b> & c' })]);
    expect(out).toContain('a &lt;b&gt; &amp; c');
  });

  it('warns and writes nothing when the list cannot be read, so the weekly message still goes out', () => {
    const r = run([pr(1)], true);
    expect(r.out).toBe('');
    expect(r.stdout).toContain('::warning::Could not list');
  });
});
