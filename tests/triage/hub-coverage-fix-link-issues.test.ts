import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/hub-coverage-fix-link-issues.sh',
);

// Runs the link script with a stub `gh` that records each `pr edit` call and captures the body piped to
// `--body-file -` into GH_BODY_DIR/<pr-number>.
function run(links: unknown, prs: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), 'cf-link-'));
  const bodies = join(dir, 'bodies');
  mkdirSync(bodies);
  writeFileSync(join(dir, 'verify-out.json'), JSON.stringify({ violations: [], links }));
  writeFileSync(join(dir, 'prs.json'), JSON.stringify(prs));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash
echo "gh $*" >> "$GH_LOG"
if [ "$1 $2" = "pr edit" ]; then cat > "$GH_BODY_DIR/$3"; fi
`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(dir, 'log'), '');
  const out = execFileSync('bash', [script, join(dir, 'verify-out.json'), join(dir, 'prs.json')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_LOG: join(dir, 'log'),
      GH_BODY_DIR: bodies,
      GITHUB_REPOSITORY: 'camunda/api-test-generator',
    },
  });
  const body = (n: number) =>
    existsSync(join(bodies, String(n))) ? readFileSync(join(bodies, String(n)), 'utf8') : '';
  return {
    stdout: out,
    calls: readFileSync(join(dir, 'log'), 'utf8').split('\n').filter(Boolean),
    body,
  };
}

const PLAIN = '## In plain words\n\nAdds the missing test.';

describe('hub-coverage-fix-link-issues', () => {
  it('appends `relates to #<issue>` to each linked PR body, preserving the original', () => {
    const r = run(
      [
        { number: 1, issue: 42 },
        { number: 2, issue: 7 },
      ],
      [
        { number: 1, body: PLAIN },
        { number: 2, body: PLAIN },
      ],
    );
    expect(r.calls.filter((c) => c.startsWith('gh pr edit'))).toHaveLength(2);
    expect(r.body(1)).toContain(PLAIN);
    expect(r.body(1).trimEnd().endsWith('relates to #42')).toBe(true);
    expect(r.body(2).trimEnd().endsWith('relates to #7')).toBe(true);
  });

  it('skips a PR whose body already carries the link', () => {
    const r = run([{ number: 3, issue: 9 }], [{ number: 3, body: `${PLAIN}\n\nrelates to #9` }]);
    expect(r.calls.some((c) => c.startsWith('gh pr edit'))).toBe(false);
    expect(r.stdout).toContain('already links #9');
  });

  it('makes no edit when there are no links', () => {
    const r = run([], [{ number: 1, body: PLAIN }]);
    expect(r.calls).toEqual([]);
  });

  it('skips a link with a malformed number and warns', () => {
    const r = run(
      [
        { number: 'x', issue: 9 },
        { number: 1, issue: 0 },
      ],
      [{ number: 1, body: PLAIN }],
    );
    expect(r.calls.some((c) => c.startsWith('gh pr edit'))).toBe(false);
    expect(r.stdout).toContain('bad PR number');
    expect(r.stdout).toContain('bad issue number');
  });
});
