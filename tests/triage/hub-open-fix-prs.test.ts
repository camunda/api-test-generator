import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/hub-open-fix-prs.sh',
);

// A fake `gh` on PATH: `pr list` prints the numbers in FAKE_PRS, `pr diff N` prints FAKE_DIFF_BYTES bytes
// unless N is FAKE_DIFF_FAIL, and FAKE_LIST_FAIL=1 makes the listing fail.
function setup(): { dir: string; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'open-fix-prs-'));
  const gh = join(dir, 'gh');
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
case "$1 $2" in
  "pr list") [ "$FAKE_LIST_FAIL" = 1 ] && { echo boom >&2; exit 1; }; for n in $FAKE_PRS; do echo "$n"; done ;;
  "pr diff") [ "$FAKE_DIFF_FAIL" = "$3" ] && { echo nope >&2; exit 1; }; head -c "$FAKE_DIFF_BYTES" /dev/zero | tr '\\0' 'x'; echo ;;
esac
`,
  );
  chmodSync(gh, 0o755);
  return { dir, out: join(dir, 'out.json') };
}

function run(env: Record<string, string>): { status: number; out: string; stderr: string } {
  const { dir, out } = setup();
  try {
    execFileSync('bash', [script, out], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'camunda/api-test-generator',
        ...env,
      },
    });
    return { status: 0, out, stderr: '' };
  } catch (e) {
    const status = typeof e === 'object' && e !== null && 'status' in e ? Number(e.status) : 1;
    // GitHub reads ::error:: workflow commands from stdout, so keep both streams.
    const stdout = typeof e === 'object' && e !== null && 'stdout' in e ? String(e.stdout) : '';
    const err = typeof e === 'object' && e !== null && 'stderr' in e ? String(e.stderr) : '';
    const stderr = `${stdout}${err}`;
    return { status, out, stderr };
  }
}

describe('hub-open-fix-prs.sh', () => {
  it('writes every open PR with its whole diff', () => {
    const r = run({ FAKE_PRS: '7 8', FAKE_DIFF_BYTES: '60000' });
    expect(r.status).toBe(0);
    const parsed: unknown = JSON.parse(readFileSync(r.out, 'utf8'));
    expect(Array.isArray(parsed) && parsed.length).toBe(2);
    expect(Array.isArray(parsed) && parsed[0].diff.length).toBeGreaterThan(59000);
  });

  it('writes an empty list when there are no open PRs', () => {
    const r = run({ FAKE_PRS: '', FAKE_DIFF_BYTES: '10' });
    expect(r.status).toBe(0);
    expect(readFileSync(r.out, 'utf8').trim()).toBe('[]');
  });

  it('fails and writes nothing when the listing fails', () => {
    const r = run({ FAKE_LIST_FAIL: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Could not list');
    expect(existsSync(r.out)).toBe(false);
  });

  it('fails and writes nothing when one diff cannot be read', () => {
    const r = run({ FAKE_PRS: '7 8', FAKE_DIFF_BYTES: '10', FAKE_DIFF_FAIL: '8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('#8');
    expect(existsSync(r.out)).toBe(false);
  });

  it('fails and writes nothing when a diff is larger than the cap, instead of truncating it', () => {
    const r = run({ FAKE_PRS: '7', FAKE_DIFF_BYTES: '5000', MAX_DIFF_BYTES: '1000' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('larger than 1000 bytes');
    expect(existsSync(r.out)).toBe(false);
  });
});
