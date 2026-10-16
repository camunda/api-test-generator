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

// Runs the link script with a stub `gh`. The script reads each PR body FRESH via `gh api .../pulls/N`
// (so the live-check section added just before is preserved), then edits via `gh pr edit --body-file -`.
// The stub serves per-PR bodies from GH_BODIES_DIR, fails the read for PRs listed in GH_FAILREAD, and
// captures the edited body to GH_EDIT_DIR/<n>.
function run(links: unknown, bodies: Record<number, string>, failRead: number[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'cf-link-'));
  const bodiesDir = join(dir, 'bodies');
  const editDir = join(dir, 'edits');
  mkdirSync(bodiesDir);
  mkdirSync(editDir);
  writeFileSync(join(dir, 'verify-out.json'), JSON.stringify({ violations: [], links }));
  for (const [n, body] of Object.entries(bodies)) writeFileSync(join(bodiesDir, n), body);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash
echo "gh $*" >> "$GH_LOG"
if [ "$1" = "api" ]; then
  num="\${2##*/}"
  case " $GH_FAILREAD " in *" $num "*) exit 1 ;; esac
  cat "$GH_BODIES_DIR/$num" 2>/dev/null || printf ''
  exit 0
fi
if [ "$1 $2" = "pr edit" ]; then cat > "$GH_EDIT_DIR/$3"; fi
`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(dir, 'log'), '');
  const out = execFileSync('bash', [script, join(dir, 'verify-out.json')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_LOG: join(dir, 'log'),
      GH_BODIES_DIR: bodiesDir,
      GH_EDIT_DIR: editDir,
      GH_FAILREAD: failRead.join(' '),
      GITHUB_REPOSITORY: 'camunda/api-test-generator',
    },
  });
  const edited = (n: number) =>
    existsSync(join(editDir, String(n))) ? readFileSync(join(editDir, String(n)), 'utf8') : '';
  return {
    stdout: out,
    calls: readFileSync(join(dir, 'log'), 'utf8').split('\n').filter(Boolean),
    edited,
    editCalls: readFileSync(join(dir, 'log'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('gh pr edit')),
  };
}

const PLAIN = '## In plain words\n\nAdds the missing test.';
const LIVE_CHECK = `${PLAIN}

<!-- live-check:start -->
### Live Hub check

[run](https://github.com/camunda/api-test-generator/actions/runs/123)
<!-- live-check:end -->`;

describe('hub-coverage-fix-link-issues', () => {
  it('appends `relates to #<issue>` to each linked PR, reading the body fresh', () => {
    const r = run(
      [
        { number: 1, issue: 42 },
        { number: 2, issue: 7 },
      ],
      { 1: PLAIN, 2: PLAIN },
    );
    expect(r.editCalls).toHaveLength(2);
    expect(r.edited(1)).toContain(PLAIN);
    expect(r.edited(1).trimEnd().endsWith('relates to #42')).toBe(true);
    expect(r.edited(2).trimEnd().endsWith('relates to #7')).toBe(true);
  });

  it('preserves the live-check section the preceding step added', () => {
    const r = run([{ number: 1, issue: 42 }], { 1: LIVE_CHECK });
    expect(r.edited(1)).toContain('### Live Hub check');
    expect(r.edited(1)).toContain('<!-- live-check:start -->');
    expect(r.edited(1)).toContain('<!-- live-check:end -->');
    expect(r.edited(1).trimEnd().endsWith('relates to #42')).toBe(true);
  });

  it('leaves the PR untouched when the body cannot be read', () => {
    const r = run([{ number: 1, issue: 42 }], { 1: PLAIN }, [1]);
    expect(r.editCalls).toHaveLength(0);
    expect(r.stdout).toContain('Could not read the description of PR #1');
  });

  it('skips a PR whose body already carries the link', () => {
    const r = run([{ number: 3, issue: 9 }], { 3: `${PLAIN}\n\nrelates to #9` });
    expect(r.editCalls).toHaveLength(0);
    expect(r.stdout).toContain('already links #9');
  });

  it('does not treat a longer issue number as the existing link (digit boundary)', () => {
    // `relates to #90` must not block linking #9.
    const r = run([{ number: 3, issue: 9 }], { 3: `${PLAIN}\n\nrelates to #90` });
    expect(r.editCalls).toHaveLength(1);
    expect(r.edited(3).trimEnd().endsWith('relates to #9')).toBe(true);
  });

  it('makes no edit when there are no links', () => {
    const r = run([], { 1: PLAIN });
    expect(r.calls).toEqual([]);
  });

  it('skips a link with a malformed number and warns', () => {
    const r = run(
      [
        { number: 'x', issue: 9 },
        { number: 1, issue: 0 },
      ],
      { 1: PLAIN },
    );
    expect(r.editCalls).toHaveLength(0);
    expect(r.stdout).toContain('bad PR number');
    expect(r.stdout).toContain('bad issue number');
  });
});
