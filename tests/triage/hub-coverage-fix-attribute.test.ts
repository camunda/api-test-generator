import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../.github/scripts/hub-coverage-fix-attribute.sh',
);

// Stubs keep the test off git and the network: `gh` records each `pr edit` it is asked
// to make (and fails calls whose args match a pattern), and the author resolver maps an
// operationId to a login from a table. So the test exercises the script's parsing of the
// verifier output, the author resolution, the review request and the @camunda/hub team
// fallback — not the real resolver/gh.
const GH_BODY = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
if [ -s "$GH_FAIL" ]; then
  while IFS= read -r pat; do
    [ -n "$pat" ] || continue
    case "$*" in *"$pat"*) exit 1 ;; esac
  done < "$GH_FAIL"
fi
exit 0
`;
const RESOLVER_BODY = `#!/usr/bin/env bash
awk -v op="$1" '$1==op{print $2; exit}' "$RESOLVER_MAP"
`;

interface Opts {
  authors?: Record<string, string>;
  failPatterns?: string[];
  hubGit?: boolean;
}

function runAttr(verifyOut: unknown, opts: Opts = {}): { log: string[]; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cov-attr-'));
  const outFile = join(dir, 'verify-out.json');
  writeFileSync(outFile, typeof verifyOut === 'string' ? verifyOut : JSON.stringify(verifyOut));
  const ghLog = join(dir, 'gh.log');
  writeFileSync(ghLog, '');
  const ghFail = join(dir, 'gh.fail');
  writeFileSync(ghFail, `${(opts.failPatterns ?? []).join('\n')}\n`);
  const resolverMap = join(dir, 'resolver.map');
  writeFileSync(
    resolverMap,
    `${Object.entries(opts.authors ?? {})
      .map(([o, l]) => `${o} ${l}`)
      .join('\n')}\n`,
  );

  const gh = join(dir, 'gh');
  writeFileSync(gh, GH_BODY);
  chmodSync(gh, 0o755);
  const resolver = join(dir, 'resolver.sh');
  writeFileSync(resolver, RESOLVER_BODY);
  chmodSync(resolver, 0o755);

  const hub = join(dir, 'hub');
  mkdirSync(hub);
  if (opts.hubGit !== false) mkdirSync(join(hub, '.git'));

  let stdout = '';
  try {
    stdout = execFileSync('bash', [script, outFile, hub], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GH: gh,
        AUTHOR_RESOLVER: resolver,
        GH_LOG: ghLog,
        GH_FAIL: ghFail,
        RESOLVER_MAP: resolverMap,
        HUB_TOKEN: 'x',
        HUB_TEAM: 'camunda/hub',
        GITHUB_REPOSITORY: 'camunda/api-test-generator',
      },
    });
  } catch (err) {
    stdout = String(err);
  }
  const log = readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean);
  return { log, stdout };
}

const count = (log: string[], needle: string) => log.filter((l) => l.includes(needle)).length;

describe('hub-coverage-fix-attribute.sh', () => {
  it('requests the endpoint author as reviewer on the PR', () => {
    const { log } = runAttr(
      { violations: [], links: [], authors: [{ number: 11, operationId: 'getFile' }] },
      { authors: { getFile: 'alice' } },
    );
    expect(log).toContain('pr edit 11 --repo camunda/api-test-generator --add-reviewer alice');
    // author resolved, so no team fallback for this PR
    expect(
      count(log, 'pr edit 11 --repo camunda/api-test-generator --add-reviewer camunda/hub'),
    ).toBe(0);
  });

  it('resolves the specific operation (status gap) to its own author', () => {
    const { log } = runAttr(
      { authors: [{ number: 14, operationId: 'getFolder' }] },
      { authors: { getFile: 'alice', getFolder: 'bob' } },
    );
    expect(log).toContain('pr edit 14 --repo camunda/api-test-generator --add-reviewer bob');
    expect(count(log, '--add-reviewer alice')).toBe(0);
  });

  it('falls back to the @camunda/hub team when no author resolves', () => {
    const { log } = runAttr({ authors: [{ number: 12, operationId: 'getZ' }] }, { authors: {} });
    expect(log).toContain(
      'pr edit 12 --repo camunda/api-test-generator --add-reviewer camunda/hub',
    );
  });

  it('falls back to the team when the author review request fails', () => {
    const { log } = runAttr(
      { authors: [{ number: 13, operationId: 'getFile' }] },
      {
        authors: { getFile: 'alice' },
        failPatterns: ['pr edit 13 --repo camunda/api-test-generator --add-reviewer alice'],
      },
    );
    expect(log).toContain('pr edit 13 --repo camunda/api-test-generator --add-reviewer alice'); // attempted
    expect(log).toContain(
      'pr edit 13 --repo camunda/api-test-generator --add-reviewer camunda/hub',
    ); // backstop
  });

  it('does nothing for a non-JSON verifier output', () => {
    const { log, stdout } = runAttr('not json {');
    expect(log).toHaveLength(0);
    expect(stdout).toContain('not JSON');
  });

  it('requests the team for every PR when the camunda-hub checkout is unavailable', () => {
    // Minting or cloning the private repo failed → no individual authors can be resolved, but every
    // verified PR must still end with a reviewer, so the team is requested for all of them.
    const { log } = runAttr(
      {
        authors: [
          { number: 11, operationId: 'getFile' },
          { number: 12, operationId: 'getZ' },
        ],
      },
      { authors: { getFile: 'alice' }, hubGit: false },
    );
    expect(log).toContain(
      'pr edit 11 --repo camunda/api-test-generator --add-reviewer camunda/hub',
    );
    expect(log).toContain(
      'pr edit 12 --repo camunda/api-test-generator --add-reviewer camunda/hub',
    );
    // no clone to resolve from, so no individual author is requested
    expect(count(log, '--add-reviewer alice')).toBe(0);
  });

  it('does nothing when there are no authors to attribute', () => {
    const { log, stdout } = runAttr({ violations: [], links: [], authors: [] });
    expect(log).toHaveLength(0);
    expect(stdout).not.toContain('not JSON');
  });
});
